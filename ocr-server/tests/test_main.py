import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def mock_ocr_engine():
    """Mock PaddleOCR engine."""
    engine = MagicMock()
    engine.ocr.return_value = [[
        [[[0, 0], [100, 0], [100, 20], [0, 20]], ("Hello World", 0.95)],
        [[[0, 30], [100, 30], [100, 50], [0, 50]], ("Second line", 0.88)],
    ]]
    return engine


@pytest.fixture
def client(mock_ocr_engine):
    """Create test client with mocked OCR and auth."""
    import os
    os.environ["OCR_TEST_MODE"] = "1"

    with patch.dict(os.environ, {"OCR_TEST_MODE": "1"}):
        import importlib
        import main
        importlib.reload(main)
        main.ocr_engine = mock_ocr_engine

        with TestClient(main.app) as c:
            yield c


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ocr_no_auth(client):
    """Request without auth should fail."""
    png = _make_tiny_png()
    resp = client.post(
        "/api/ocr",
        files={"file": ("test.png", png, "image/png")},
    )
    assert resp.status_code == 422  # Missing authorization header


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
    mock_ocr_engine.ocr.return_value = [None]
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
