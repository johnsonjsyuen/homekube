import asyncio
import os
import logging
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware

from auth import validate_token

logger = logging.getLogger("ocr-server")
logging.basicConfig(level=logging.INFO)

ocr_engine = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ocr_engine
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
    yield


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
    return {"status": "ok"}


@app.post("/api/ocr")
async def ocr_extract(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Stream-read with size limit
    chunks = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)  # 1MB chunks
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 20MB)")
        chunks.append(chunk)
    contents = b"".join(chunks)

    # Write to temp file for PaddleOCR
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as tmp:
        tmp.write(contents)
        tmp.flush()

        # Run OCR in thread pool to avoid blocking the event loop
        result = await asyncio.to_thread(ocr_engine.ocr, tmp.name, cls=True)  # type: ignore[union-attr]

    # Extract text from results
    lines = []
    if result and result[0]:
        for line in result[0]:
            box = line[0]  # [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            text = line[1][0]
            confidence = line[1][1]
            lines.append({
                "text": text,
                "confidence": round(confidence, 4),
                "bbox": box,
            })

    full_text = "\n".join(item["text"] for item in lines)

    username = user.get("preferred_username", user.get("sub", "unknown"))
    logger.info(f"OCR completed for user={username}: {len(lines)} lines extracted")

    return {
        "text": full_text,
        "lines": lines,
        "line_count": len(lines),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
