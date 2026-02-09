# Homekube Project - Coder Agent Memory

## Architecture: Speech-to-Text Pipeline
- **Frontend**: Svelte app at `homepage/src/routes/SttTab.svelte` - captures audio via WebAudio API, sends base64 PCM16 chunks over WebSocket
- **Rust Backend**: `speech-to-text/src/transcribe.rs` - Axum WebSocket server with VAD-based segmentation. Receives audio from frontend, buffers it, sends segments to Python whisper server via HTTP POST
- **Python Whisper Server**: `speech-to-text/whisper_server.py` - FastAPI server using faster-whisper. Receives audio+params via POST, returns transcription

## Data Flow
Frontend (WebSocket JSON: audio + initial_prompt) -> Rust backend (VAD + buffering) -> Python server (HTTP POST: WhisperRequest) -> faster-whisper model

## Key Patterns
- Frontend uses Svelte 5 runes ($state) not stores
- Rust backend uses `serde_json::Value` for parsing incoming WebSocket messages (not typed deserialization)
- Audio segments include overlap (~0.5s) for context between VAD-segmented chunks
- `initial_prompt` flows from frontend transcript accumulator through all layers to condition whisper
