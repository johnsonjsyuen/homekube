# Text-to-Speech Service

A REST API service that converts text to speech using the Kokoro TTS model.

## API Endpoints

### POST /generate
Upload a text file to generate speech.

**Request:**
- `text_file`: The text file to convert (multipart form)
- `voice`: Voice to use (default: `af_heart`)
- `speed`: Playback speed (default: `1.0`)

**Response:**
```json
{ "id": "uuid-of-job" }
```

### GET /status/:id
Check job status or download the generated audio.

**Response:**
- If processing: `{ "status": "processing" }`
- If error: `{ "status": "error", "message": "..." }`
- If completed: Returns MP3 file with `Content-Type: audio/mpeg`

## Testing

### Test Mode

The service supports a **test mode** that skips actual TTS generation and produces dummy audio. This enables fast CI testing without requiring the Kokoro model files.

Enable test mode by setting the environment variable:
```bash
TTS_TEST_MODE=1
```

In test mode:
- A valid 1-second silent WAV file is generated instead of calling `kokoro-tts`
- The WAV is still converted to MP3 via ffmpeg (testing that pipeline)
- All database operations work normally

### Running Tests Locally

**With real TTS (requires model files in /app):**
```bash
cargo test --test integration_test
```

**With test mode (no model files needed):**
```bash
TTS_TEST_MODE=1 cargo test --test integration_test
```

### CI Testing

The CI workflow (`.forgejo/workflows/e2e.yml`) automatically runs in test mode:

1. Builds the Docker image
2. Starts PostgreSQL and the TTS service with `TTS_TEST_MODE=1`
3. Submits a test file to `/generate`
4. Polls `/status/:id` until completion
5. Verifies an MP3 file is returned

### What the Tests Validate

| Component | Test Mode | Production Mode |
|-----------|-----------|-----------------|
| Docker image builds | ✅ | ✅ |
| App starts & connects to PostgreSQL | ✅ | ✅ |
| `/generate` accepts file uploads | ✅ | ✅ |
| Job created in database | ✅ | ✅ |
| Background job processing | ✅ | ✅ |
| WAV → MP3 conversion (ffmpeg) | ✅ | ✅ |
| `/status/:id` returns audio | ✅ | ✅ |
| Actual Kokoro TTS generation | ❌ | ✅ |

## Development

### Prerequisites

- Rust 1.75+
- Docker
- PostgreSQL (or use Docker)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `STORAGE_PATH` | No | Path for generated audio files (default: `/app/storage`) |
| `TTS_TEST_MODE` | No | Set to `1` to enable test mode |

### Building

```bash
# Build locally
cargo build --release

# Build Docker image
docker build -t text-to-speech .
```

### Running

```bash
# With Docker Compose (recommended)
docker-compose up

# Or manually
DATABASE_URL=postgres://user:password@localhost/tts cargo run
```
