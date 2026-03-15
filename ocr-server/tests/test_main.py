import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from main import app, get_current_user


_test_user = {"sub": "test_user", "preferred_username": "test_user"}
app.dependency_overrides[get_current_user] = lambda: _test_user


@pytest.fixture
def mock_ocr_engine():
    """Mock PaddleOCR engine with 3.0 result objects."""
    engine = MagicMock()
    result_obj = MagicMock()
    result_obj.rec_texts = ["Hello World", "Second line"]
    result_obj.rec_scores = [0.95, 0.88]
    engine.predict.return_value = [result_obj]
    return engine


@pytest.fixture
def client(mock_ocr_engine):
    """Create test client with mocked OCR and auth."""
    import main
    main.ocr_engine = mock_ocr_engine
    main.db_pool = None

    with TestClient(app) as c:
        yield c


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["claude_available"] is False
    assert data["history_available"] is False


def test_ocr_no_auth():
    """Request without auth should fail (test without dependency override)."""
    original = app.dependency_overrides.pop(get_current_user, None)
    try:
        import main
        main.ocr_engine = MagicMock()
        main.db_pool = None
        with TestClient(app) as c:
            png = _make_tiny_png()
            resp = c.post(
                "/api/ocr",
                files={"file": ("test.png", png, "image/png")},
            )
            assert resp.status_code == 422  # Missing authorization header
    finally:
        if original is not None:
            app.dependency_overrides[get_current_user] = original


def test_ocr_success(client):
    """OCR with valid auth should return extracted text."""
    png = _make_tiny_png()
    resp = client.post(
        "/api/ocr",
        files={"file": ("test.png", png, "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "Hello World\nSecond line"
    assert data["line_count"] == 2
    assert data["engine"] == "paddle"
    assert len(data["lines"]) == 2
    assert data["lines"][0]["text"] == "Hello World"
    assert data["lines"][0]["confidence"] == 0.95
    assert data["lines"][1]["text"] == "Second line"


def test_ocr_non_image(client):
    """Non-image files should be rejected."""
    resp = client.post(
        "/api/ocr",
        files={"file": ("test.txt", b"hello", "text/plain")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 400
    assert "image" in resp.json()["detail"].lower()


def test_ocr_empty_result(client, mock_ocr_engine):
    """OCR with no detected text should return empty."""
    empty_result = MagicMock()
    empty_result.rec_texts = []
    empty_result.rec_scores = []
    mock_ocr_engine.predict.return_value = [empty_result]
    png = _make_tiny_png()
    resp = client.post(
        "/api/ocr",
        files={"file": ("test.png", png, "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == ""
    assert data["line_count"] == 0
    assert data["lines"] == []


def test_ocr_claude_not_available(client):
    """Claude engine should return 503 when API key not configured."""
    png = _make_tiny_png()
    resp = client.post(
        "/api/ocr?engine=claude",
        files={"file": ("test.png", png, "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 503


def test_ocr_invalid_engine(client):
    """Invalid engine should be rejected."""
    png = _make_tiny_png()
    resp = client.post(
        "/api/ocr?engine=invalid",
        files={"file": ("test.png", png, "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 422


def test_history_not_available(client):
    """History should return 503 when database not configured."""
    resp = client.get(
        "/api/ocr/history",
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 503


def _make_tiny_png() -> bytes:
    """Create a minimal valid 1x1 PNG."""
    import struct
    import zlib

    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\xff\xff"
    idat = zlib.compress(raw)

    return signature + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
