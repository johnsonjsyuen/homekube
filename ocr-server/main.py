import asyncio
import base64
import json
import os
import logging
import tempfile
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware

from auth import validate_token

logger = logging.getLogger("ocr-server")
logging.basicConfig(level=logging.INFO)

ocr_engine = None
db_pool = None
anthropic_api_key: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ocr_engine, db_pool, anthropic_api_key

    # Init PaddleOCR
    logger.info("Loading PaddleOCR engine...")
    from paddleocr import PaddleOCR
    model_dir = os.getenv("OCR_MODEL_DIR", "/models")
    os.makedirs(model_dir, exist_ok=True)
    ocr_engine = PaddleOCR(
        lang=os.getenv("OCR_LANG", "en"),
        use_angle_cls=True,
        show_log=False,
        det_model_dir=os.path.join(model_dir, "det"),
        rec_model_dir=os.path.join(model_dir, "rec"),
        cls_model_dir=os.path.join(model_dir, "cls"),
    )
    logger.info("PaddleOCR engine loaded")

    # Init Anthropic API key (used via httpx, no SDK)
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_api_key:
        logger.info("Anthropic API key configured, Claude OCR available")
    else:
        logger.warning("ANTHROPIC_API_KEY not set, Claude OCR disabled")

    # Init database
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        from psycopg_pool import ConnectionPool
        db_pool = ConnectionPool(db_url, min_size=1, max_size=5)
        db_pool.open()
        _init_db()
        logger.info("Database connected")
    else:
        logger.warning("DATABASE_URL not set, history disabled")

    yield

    if db_pool:
        db_pool.close()


def _init_db():
    """Create tables if they don't exist."""
    with db_pool.connection() as conn:  # type: ignore[union-attr]
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ocr_jobs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                filename TEXT NOT NULL,
                engine TEXT NOT NULL,
                text TEXT NOT NULL,
                lines JSONB NOT NULL DEFAULT '[]',
                line_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ocr_jobs_user ON ocr_jobs(user_id, created_at DESC)
        """)
        conn.commit()


app = FastAPI(title="OCR Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://tauri.localhost",
        "http://localhost:5173",
        "http://localhost:1420",
        "https://home.johnsonyuen.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB


async def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    token = authorization[7:]
    try:
        claims = await validate_token(token)
        return claims
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "claude_available": anthropic_api_key is not None,
        "history_available": db_pool is not None,
    }


async def _ocr_paddle(contents: bytes) -> dict:
    """Run PaddleOCR on image bytes."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as tmp:
        tmp.write(contents)
        tmp.flush()
        result = await asyncio.to_thread(ocr_engine.ocr, tmp.name, cls=True)  # type: ignore[union-attr]

    lines = []
    if result and result[0]:
        for line in result[0]:
            box = line[0]
            text = line[1][0]
            confidence = line[1][1]
            lines.append({
                "text": text,
                "confidence": round(confidence, 4),
                "bbox": box,
            })

    full_text = "\n".join(item["text"] for item in lines)
    return {"text": full_text, "lines": lines, "line_count": len(lines)}


async def _ocr_claude(contents: bytes, content_type: str) -> dict:
    """Run Claude vision OCR via Anthropic Messages API (httpx, no SDK)."""
    if not anthropic_api_key:
        raise HTTPException(status_code=503, detail="Claude OCR not available (API key not configured)")

    b64 = base64.standard_b64encode(contents).decode("utf-8")
    media_type = content_type or "image/png"

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": b64},
                        },
                        {
                            "type": "text",
                            "text": "Extract all text from this image exactly as it appears. "
                                    "Preserve the original formatting, line breaks, and structure. "
                                    "Output only the extracted text, nothing else.",
                        },
                    ],
                }],
            },
            timeout=60,
        )

    if resp.status_code != 200:
        detail = resp.text[:200]
        logger.error(f"Claude API error {resp.status_code}: {detail}")
        raise HTTPException(status_code=502, detail=f"Claude API error: {resp.status_code}")

    data = resp.json()
    extracted = data["content"][0]["text"]

    lines_list = [l for l in extracted.split("\n") if l.strip()]
    lines = [{"text": l, "confidence": 1.0, "bbox": []} for l in lines_list]

    return {"text": extracted, "lines": lines, "line_count": len(lines)}


def _save_job(job_id: str, user: dict, filename: str, engine: str, result: dict):
    """Save OCR result to database."""
    if not db_pool:
        return
    user_id = user.get("sub", "unknown")
    username = user.get("preferred_username", user.get("sub", "unknown"))
    with db_pool.connection() as conn:
        conn.execute(
            """INSERT INTO ocr_jobs (id, user_id, username, filename, engine, text, lines, line_count)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (job_id, user_id, username, filename, engine,
             result["text"], json.dumps(result["lines"]), result["line_count"]),
        )
        conn.commit()


@app.post("/api/ocr")
async def ocr_extract(
    file: UploadFile = File(...),
    engine: str = Query(default="paddle", pattern="^(paddle|claude)$"),
    user: dict = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Stream-read with size limit
    chunks = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 20MB)")
        chunks.append(chunk)
    contents = b"".join(chunks)

    if engine == "claude":
        result = await _ocr_claude(contents, file.content_type)
    else:
        result = await _ocr_paddle(contents)

    username = user.get("preferred_username", user.get("sub", "unknown"))
    logger.info(f"OCR completed for user={username} engine={engine}: {result['line_count']} lines")

    # Save to history
    job_id = str(uuid.uuid4())
    await asyncio.to_thread(_save_job, job_id, user, file.filename or "unknown", engine, result)

    result["id"] = job_id
    result["engine"] = engine
    return result


@app.get("/api/ocr/history")
async def ocr_history(
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    if not db_pool:
        raise HTTPException(status_code=503, detail="History not available")

    user_id = user.get("sub", "unknown")

    def query():
        with db_pool.connection() as conn:  # type: ignore[union-attr]
            rows = conn.execute(
                """SELECT id, filename, engine, text, line_count, created_at
                   FROM ocr_jobs WHERE user_id = %s
                   ORDER BY created_at DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            count_row = conn.execute(
                "SELECT COUNT(*) FROM ocr_jobs WHERE user_id = %s", (user_id,)
            ).fetchone()
            return rows, count_row[0] if count_row else 0

    rows, total = await asyncio.to_thread(query)

    jobs = []
    for row in rows:
        jobs.append({
            "id": row[0],
            "filename": row[1],
            "engine": row[2],
            "text_preview": row[3][:200] if row[3] else "",
            "line_count": row[4],
            "created_at": row[5].isoformat() if row[5] else None,
        })

    return {"jobs": jobs, "total": total}


@app.get("/api/ocr/history/{job_id}")
async def ocr_history_detail(
    job_id: str,
    user: dict = Depends(get_current_user),
):
    if not db_pool:
        raise HTTPException(status_code=503, detail="History not available")

    user_id = user.get("sub", "unknown")

    def query():
        with db_pool.connection() as conn:  # type: ignore[union-attr]
            row = conn.execute(
                """SELECT id, filename, engine, text, lines, line_count, created_at
                   FROM ocr_jobs WHERE id = %s AND user_id = %s""",
                (job_id, user_id),
            ).fetchone()
            if not row:
                return None
            return {
                "id": row[0],
                "filename": row[1],
                "engine": row[2],
                "text": row[3],
                "lines": json.loads(row[4]) if isinstance(row[4], str) else row[4],
                "line_count": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
            }

    result = await asyncio.to_thread(query)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
