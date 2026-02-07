"""
Whisper Speech-to-Text HTTP API Server

Provides a simple HTTP endpoint for transcribing audio using faster-whisper.
"""

import io
import os
import base64
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from faster_whisper import WhisperModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Whisper STT API")

# Model configuration
MODEL_PATH = os.getenv("MODEL_PATH", "/app/model")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")  # int8 for CPU efficiency
CPU_THREADS = int(os.getenv("CPU_THREADS", "4"))

# Global model instance
model: Optional[WhisperModel] = None


class TranscribeRequest(BaseModel):
    """Request body for transcription."""
    audio: str  # Base64 encoded PCM16 audio at 16kHz
    language: str = "en"


class TranscribeResponse(BaseModel):
    """Response body for transcription."""
    text: str
    segments: list


@app.on_event("startup")
async def load_model():
    """Load the Whisper model on startup."""
    global model
    logger.info(f"Loading Whisper model from {MODEL_PATH}")
    logger.info(f"Compute type: {COMPUTE_TYPE}, CPU threads: {CPU_THREADS}")
    
    try:
        model = WhisperModel(
            MODEL_PATH,
            device="cpu",
            compute_type=COMPUTE_TYPE,
            cpu_threads=CPU_THREADS,
        )
        logger.info("Whisper model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {"status": "healthy"}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest):
    """
    Transcribe audio to text.
    
    Expects base64-encoded PCM16 audio at 16kHz sample rate.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Decode base64 audio
        audio_bytes = base64.b64decode(request.audio)
        
        # Convert PCM16 bytes to numpy array
        import numpy as np
        audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        
        # Run transcription
        segments, info = model.transcribe(
            audio_array,
            language=request.language,
            beam_size=5,
            vad_filter=True,  # Filter out non-speech
        )
        
        # Collect results
        text_parts = []
        segment_list = []
        
        for segment in segments:
            text_parts.append(segment.text)
            segment_list.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
            })
        
        full_text = "".join(text_parts)
        logger.info(f"Transcribed {len(audio_bytes)} bytes -> {len(full_text)} chars")
        
        return TranscribeResponse(text=full_text, segments=segment_list)
        
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
