# Mock System Documentation

This directory contains a complete mock implementation of the HomeKube authentication and API services for local development and testing without requiring backend infrastructure.

## Table of Contents

- [Quick Start](#quick-start)
- [What Gets Mocked](#what-gets-mocked)
- [Activating Mock Mode](#activating-mock-mode)
- [File Structure](#file-structure)
- [Mock Implementations](#mock-implementations)
- [Mock Data Generation](#mock-data-generation)
- [Testing UI Features](#testing-ui-features)
- [Limitations](#limitations)
- [Returning to Production Mode](#returning-to-production-mode)

## Quick Start

1. Set mock mode in your environment file:
   ```bash
   echo "VITE_DEV_MODE=mock" >> homepage/.env
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open the app in your browser. You'll be automatically authenticated as `mockuser` with admin privileges.

## What Gets Mocked

The mock system provides realistic replacements for the following services:

### Authentication
- **Keycloak SSO**: Auto-authenticates with a mock user account
  - Username: `mockuser`
  - Roles: `user`, `admin`
  - Token refresh simulation

### TTS (Text-to-Speech)
- **HTTP API Routes**: Job creation and status endpoints
  - `/api/tts/generate` - Create TTS jobs
  - `/api/tts/jobs` - List all jobs
  - `/api/tts/status/[id]` - Get job status and download audio
- **Live TTS WebSocket**: Real-time streaming TTS via WebSocket

### STT (Speech-to-Text)
- **STT WebSocket**: Real-time audio transcription via WebSocket
  - Accepts audio streams
  - Returns realistic transcripts
  - Simulates partial and final results

## Activating Mock Mode

### Method 1: Environment Variable (Recommended)

Create or edit `homepage/.env`:

```env
VITE_DEV_MODE=mock
```

### Method 2: Direct Edit

For testing, you can temporarily modify the check in `homepage/src/lib/mocks/index.ts`:

```typescript
// Force enable mock mode
export const isMockMode = true;
```

**Note**: Don't commit this change to version control.

### Verification

Check the browser console for mock mode indicators:

```
[Mock] Seeded 3 example TTS jobs
[MockKeycloak] Initializing with config: {...}
[MockKeycloak] Auto-authenticated as: mockuser
```

## File Structure

```
src/lib/mocks/
├── README.md                 # This file
├── index.ts                  # Core utilities (isMockMode, delay, randomChoice)
├── keycloak.ts              # Mock Keycloak authentication client
├── websocket.ts             # Mock WebSocket implementations (STT & Live TTS)
└── data/
    ├── audio.ts             # Audio data generators (MP3, PCM16, Float32)
    ├── stt.ts               # STT transcript generators
    └── tts.ts               # TTS job management and state

src/lib/
└── auth.mock.ts             # Mock auth module (aliased via vite.config.ts)
```

## Mock Implementations

### MockKeycloak (`keycloak.ts`)

Replaces the real Keycloak client with an auto-authenticating version.

**Features**:
- Auto-authentication after 300ms (simulates async login)
- Token generation with expiration tracking
- Token refresh simulation
- Logout functionality (resets state)

**Usage**:
The mock is automatically loaded when `VITE_DEV_MODE=mock` via the auth module aliasing mechanism in `vite.config.ts`.

The Vite configuration uses conditional aliasing to swap between real and mock implementations:

```typescript
// vite.config.ts
resolve: {
  alias: {
    '$lib/auth': path.resolve(
      __dirname,
      process.env.VITE_DEV_MODE === 'mock'
        ? 'src/lib/auth.mock.ts'  // Mock implementation
        : 'src/lib/auth.ts'        // Production implementation
    )
  }
}
```

When you import the auth module, Vite automatically resolves it based on the `VITE_DEV_MODE` environment variable:

```typescript
import { initKeycloak } from '$lib/auth';
// Resolves to auth.mock.ts when VITE_DEV_MODE=mock
// Resolves to auth.ts in production
```

**Token Format**:
```typescript
{
  preferred_username: 'mockuser',
  realm_access: { roles: ['user', 'admin'] },
  exp: <timestamp + 1 hour>,
  iat: <timestamp>
}
```

### TTS API Routes

HTTP endpoints that manage TTS jobs using in-memory storage.

**Routes**:
- `src/routes/api/tts/generate/+server.ts` - Create TTS jobs
- `src/routes/api/tts/jobs/+server.ts` - List all jobs
- `src/routes/api/tts/status/[id]/+server.ts` - Get job status and download audio

**Seeded Jobs**:
On initialization, three example jobs are created:
- Job 1: Completed (5 seconds of audio)
- Job 2: Processing (will complete after 2-5 seconds)
- Job 3: Error state

**Job Creation**:
- Accepts file uploads, voice, and speed parameters
- Returns job ID immediately
- Auto-completes after 2-5 seconds
- 90% success rate, 10% error rate (for testing error handling)

**Job Status**:
- Returns job metadata (status, timestamps, voice, speed)
- For completed jobs, returns downloadable MP3 blob
- Audio duration based on filename length (proxy for content)

### STT WebSocket

Mock WebSocket for real-time speech transcription.

**Features**:
- Accepts PCM16 audio at 16kHz sample rate
- Returns partial transcripts during streaming
- Returns final transcript on audio completion
- Simulates ~150 words per minute speech rate

**Testing**:
1. Open the STT tab in the application
2. Click "Start Recording" to connect to the mock WebSocket
3. Grant microphone permissions when prompted
4. Speak into your microphone
5. Observe partial transcripts updating in real-time as audio is sent
6. Click "Stop Recording" to finalize and receive the complete transcript
7. Use the "Copy" button to copy the transcript to clipboard

**Message Protocol**:
```typescript
// Client sends audio chunks
ws.send(pcm16AudioData); // ArrayBuffer of Int16 samples

// Server responds with transcripts
{
  type: 'partial',
  text: 'Hello, this is...',
  timestamp: 1234567890
}

{
  type: 'final',
  text: 'Hello, this is a complete sentence.',
  timestamp: 1234567890
}
```

### Live TTS WebSocket

Mock WebSocket for real-time TTS streaming.

**Features**:
- Accepts text in chunks via `synthesize_append` messages
- Returns Float32 PCM audio at 24kHz
- Audio chunks prefixed with sentence index (uint32)
- Simulates ~100ms synthesis per character

**Testing**:
1. Open the Live TTS tab in the application
2. Click "Connect" to establish WebSocket connection
3. Type text into the editor (or paste from clipboard)
4. Text is automatically sent in chunks as you type
5. Observe audio chunks being received and played back
6. Monitor the sentence index and playback progress
7. Click "Disconnect" to close the connection

**Message Protocol**:
```typescript
// Client sends text chunks
{
  type: 'synthesize_append',
  text: 'Hello world',
  sentenceIndex: 0
}

// Server responds with audio chunks
// Format: [uint32 sentenceIndex][Float32 samples...]
// Each audio chunk contains:
// - 4 bytes: sentence index (little-endian uint32)
// - Remaining bytes: Float32 PCM samples at 24kHz
```

## Mock Data Generation

### Audio Generation (`data/audio.ts`)

#### `generateMockMP3Blob(durationSeconds)`
Creates valid silent MP3 files that browsers can play.

**Technical Details**:
- MPEG1 Layer3 format
- 128kbps bitrate
- 44.1kHz sample rate
- ~26ms per frame
- Valid MP3 headers and sync words

**Example**:
```typescript
import { generateMockMP3Blob } from '$lib/mocks/data/audio';

const audio = generateMockMP3Blob(3); // 3 second silent MP3
const url = URL.createObjectURL(audio);
audioElement.src = url;
```

#### `generateMockPCM16Audio(durationMs)`
Creates 16-bit PCM audio for STT testing.

**Format**:
- Int16 samples
- 16kHz sample rate
- Quiet noise (±10 amplitude) to simulate silence

#### `generateMockLiveTTSAudio(sentenceIndex, text)`
Creates Float32 PCM audio with sentence prefix.

**Format**:
- 4-byte sentence index (uint32 little-endian)
- Float32 samples (-1.0 to 1.0)
- 24kHz sample rate
- Duration: ~100ms per character

### Transcript Generation (`data/stt.ts`)

#### `generateMockTranscript(audioDurationMs)`
Creates natural-sounding transcripts based on audio duration.

**Features**:
- ~150 words per minute speech rate
- 30 realistic phrases
- 10 filler phrases ("Um, well", "Actually", etc.)
- 20% chance of filler insertion
- Automatic trimming to target word count

**Example**:
```typescript
import { generateMockTranscript } from '$lib/mocks/data/stt';

// 5 seconds = ~12 words
const transcript = generateMockTranscript(5000);
// "Hello, this is a test of the speech recognition system. Um, well, you know, ..."
```

#### `generateMockTranscriptSegments(audioDurationMs)`
Creates time-aligned transcript segments.

**Returns**:
```typescript
[
  { text: "Hello, this is a test.", startMs: 0, endMs: 1600 },
  { text: "The weather is nice.", startMs: 1600, endMs: 3200 }
]
```

### TTS Job Management (`data/tts.ts`)

In-memory job storage with auto-completion simulation.

**Job States**:
- `processing`: Job is being synthesized
- `completed`: Audio is ready for download
- `error`: Synthesis failed

**API**:
```typescript
import { createMockJob, getMockJob, getAllMockJobs } from '$lib/mocks/data/tts';

const jobId = createMockJob('story.txt', 'alloy', 1.0);
// Returns immediately, completes after 2-5 seconds

const job = getMockJob(jobId);
// { id, filename, voice, speed, status, createdAt, audioBlob?, ... }

const allJobs = getAllMockJobs();
// Sorted by creation date (newest first)
```

**Job Lifecycle**:
1. Job created with `status: 'processing'`
2. Random delay of 2-5 seconds
3. 90% chance: `status: 'completed'`, `audioBlob` generated
4. 10% chance: `status: 'error'`, `error` message set

## Testing UI Features

### TTS Tab

**What You Can Test**:
- Upload text files (mocked, no actual file reading)
- Select voice and speed
- Submit TTS jobs
- View job history with 3 pre-seeded jobs
- Watch jobs transition from processing to completed
- Download audio files (silent MP3s)
- Handle error states

**Test Scenarios**:
```typescript
// 1. Create a job
// - Select any file
// - Choose voice and speed
// - Click "Generate Speech"
// - Job appears in history with "processing" status

// 2. Wait for completion
// - After 2-5 seconds, job status updates to "completed"
// - Download button becomes available

// 3. Download audio
// - Click download
// - Receives valid silent MP3 file

// 4. Error handling
// - 10% of jobs fail
// - Error message displays in job list
```

### STT Tab

**What You Can Test**:
- Connect to mock STT WebSocket
- Grant microphone permissions
- Start recording and stream audio
- View partial transcripts updating in real-time
- Stop recording and receive final transcript
- Copy transcript to clipboard

**Test Scenarios**:
```typescript
// 1. Start STT session
// - Click "Start Recording"
// - Grant microphone access
// - WebSocket connects to mock endpoint

// 2. Real-time transcription
// - Speak into microphone
// - Audio is captured and sent as PCM16 chunks
// - Partial transcripts appear and update dynamically
// - Simulates ~150 words per minute transcription rate

// 3. Finalize transcript
// - Click "Stop Recording"
// - Receive final complete transcript
// - Transcript is displayed in the UI

// 4. Copy to clipboard
// - Click "Copy" button
// - Transcript is copied for use in other apps
```

### Live TTS Tab

**What You Can Test**:
- Connect to mock Live TTS WebSocket
- Type or paste text into the editor
- Receive streaming audio chunks
- Play back synthesized speech (silent audio)
- Monitor sentence-by-sentence playback progress

**Test Scenarios**:
```typescript
// 1. Connect to Live TTS
// - Click "Connect" button
// - WebSocket establishes connection to mock endpoint
// - Connection status updates to "Connected"

// 2. Send text for synthesis
// - Type text into the editor
// - Text is automatically chunked and sent via synthesize_append
// - Each sentence gets a unique index

// 3. Receive audio stream
// - Audio chunks arrive with sentence index prefix
// - Mock generates ~100ms of audio per character
// - Float32 PCM samples at 24kHz sample rate

// 4. Playback monitoring
// - Audio is queued and played back sequentially
// - Track which sentence is currently playing
// - Silent audio plays through browser's audio context

// 5. Disconnect
// - Click "Disconnect" button
// - WebSocket closes cleanly
// - Audio playback stops
```

### Authentication

**What You Can Test**:
- Automatic authentication on page load
- Token display in UI
- Username display (`mockuser`)
- Role-based features (user has admin role)
- Token refresh (simulated, happens when token expires)

## Limitations

### Audio
- **No Real Sound**: Generated audio is silent (zeros with slight noise)
- **Fixed Format**: MP3s are minimal valid files, not realistic speech
- **No Voice Variety**: All voices produce identical silent audio

### Transcripts
- **Random Content**: Transcripts are randomly generated from preset phrases
- **No Audio Analysis**: Transcript generation ignores actual audio content
- **Limited Vocabulary**: Uses only 30 phrases and 10 filler phrases

### WebSockets
- **Simplified Protocol**: Implements core protocol features for testing
- **No Network Errors**: Doesn't simulate connection drops or retries
- **No Backpressure**: Doesn't handle slow consumers

### Data Persistence
- **Memory Only**: All data is lost on page refresh
- **No Database**: Jobs don't persist across sessions
- **No User Separation**: All users share the same mock data

### Authentication
- **No Security**: Token is just a mock string, not a real JWT
- **Single User**: Only `mockuser` is available
- **No Login UI**: Authentication is automatic, can't test login flow

## Returning to Production Mode

### Method 1: Environment Variable

Remove or change the `VITE_DEV_MODE` setting in `.env`:

```env
# Option A: Remove the line entirely
# VITE_DEV_MODE=mock

# Option B: Set to empty or any other value
VITE_DEV_MODE=production
```

### Method 2: Restart Development Server

After changing `.env`, restart the dev server:

```bash
# Stop the current server (Ctrl+C)
npm run dev
```

### Verification

The browser console should no longer show `[Mock]` or `[MockKeycloak]` messages. Instead, you'll see:
- Real Keycloak login redirects
- Network requests to backend services
- WebSocket connections to production endpoints

### Production Configuration

Ensure your production environment variables are set:

```env
VITE_KEYCLOAK_URL=https://auth.yourdomain.com
VITE_KEYCLOAK_REALM=your-realm
VITE_KEYCLOAK_CLIENT_ID=your-client-id
```

## Troubleshooting

### Mock Mode Not Activating

1. Check `.env` file exists and contains `VITE_DEV_MODE=mock`
2. Restart the development server
3. Clear browser cache and reload
4. Check browser console for mock mode indicators

### Mock Mode Stuck After Disabling

1. Remove `VITE_DEV_MODE=mock` from `.env`
2. Restart the development server (important!)
3. Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
4. Clear site data in browser DevTools

### Jobs Not Completing

- Jobs auto-complete after 2-5 seconds
- Refresh the jobs list manually if polling is disabled
- Check browser console for `[Mock]` completion messages

### Audio Won't Play

- Audio is silent by design (testing UI, not audio quality)
- Ensure browser has audio permissions
- Check that MP3 codec is supported (should be universal)
- Verify the blob URL is created correctly

## Development Tips

### Adding New Mock Features

1. Create new mock implementation in appropriate file
2. Export mock class or functions
3. Update component to check `isMockMode` and use mock
4. Add tests for new mock functionality
5. Update this README with new features

### Debugging Mock Behavior

Enable verbose logging:

```typescript
import { mockLog } from '$lib/mocks';

mockLog('My debug message', data);
// Only logs when isMockMode is true
```

### Resetting Mock State

For testing, you can reset all mock data:

```typescript
import { resetMockJobs } from '$lib/mocks/data/tts';

resetMockJobs(); // Clears and re-seeds with 3 example jobs
```

## Contributing

When adding new features to the mock system:

1. **Keep it realistic**: Mock behavior should match production as closely as possible
2. **Add delays**: Use `randomDelay()` to simulate network latency
3. **Include error cases**: Add configurable failure modes for testing
4. **Document everything**: Update this README with new features
5. **Log activity**: Use `mockLog()` for debugging

## License

This mock system is part of the HomeKube project and shares the same license.
