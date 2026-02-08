/**
 * Mock audio data generators
 * Generates realistic audio data for testing without real audio processing
 */

/**
 * Generate a valid silent MP3 blob
 * Creates a minimal MP3 file with valid headers that browsers can play
 * @param durationSeconds - Duration of the audio file in seconds
 * @returns Blob containing a valid MP3 file
 */
export function generateMockMP3Blob(durationSeconds: number = 3): Blob {
	// Minimal valid MP3 file structure
	// This is a silent MP3 frame that can be repeated
	const mp3Frame = new Uint8Array([
		0xff, 0xfb, 0x90, 0x00, // MP3 sync word + MPEG1 Layer3 128kbps 44100Hz
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
	]);

	// Calculate number of frames needed (26ms per frame at 44.1kHz)
	const framesNeeded = Math.ceil((durationSeconds * 1000) / 26);

	// Create buffer with repeated frames
	const buffer = new Uint8Array(mp3Frame.length * framesNeeded);
	for (let i = 0; i < framesNeeded; i++) {
		buffer.set(mp3Frame, i * mp3Frame.length);
	}

	return new Blob([buffer], { type: 'audio/mpeg' });
}

/**
 * Generate mock PCM16 audio data for STT testing
 * Creates silent 16-bit PCM audio at 16kHz sample rate
 * @param durationMs - Duration in milliseconds
 * @returns ArrayBuffer containing PCM16 audio data
 */
export function generateMockPCM16Audio(durationMs: number): ArrayBuffer {
	const sampleRate = 16000; // 16kHz for STT
	const numSamples = Math.floor((durationMs / 1000) * sampleRate);
	const buffer = new Int16Array(numSamples);

	// Fill with silence (zeros) or very quiet noise
	for (let i = 0; i < numSamples; i++) {
		// Add tiny random noise to make it more realistic
		buffer[i] = Math.floor(Math.random() * 20 - 10);
	}

	return buffer.buffer;
}

/**
 * Generate mock live TTS audio data
 * Creates 24kHz float32 PCM audio with sentence index prefix
 * @param sentenceIndex - Index of the sentence (prefixed to audio data)
 * @param text - Text being synthesized (used to calculate duration)
 * @returns ArrayBuffer containing sentence index + f32 PCM audio
 */
export function generateMockLiveTTSAudio(sentenceIndex: number, text: string): ArrayBuffer {
	const sampleRate = 24000; // 24kHz for TTS

	// Rough estimation: ~100ms per character for speech
	const durationMs = Math.max(100, text.length * 100);
	const numSamples = Math.floor((durationMs / 1000) * sampleRate);

	// Create buffer: 4 bytes for sentence index + float32 samples
	const totalBytes = 4 + (numSamples * 4);
	const buffer = new ArrayBuffer(totalBytes);
	const view = new DataView(buffer);

	// Write sentence index as uint32 (little-endian)
	view.setUint32(0, sentenceIndex, true);

	// Write float32 PCM samples (silence with slight noise)
	const audioView = new Float32Array(buffer, 4);
	for (let i = 0; i < numSamples; i++) {
		// Generate quiet pink noise
		audioView[i] = (Math.random() * 0.02 - 0.01);
	}

	return buffer;
}

/**
 * Create a base64-encoded audio chunk for WebSocket transmission
 * @param durationMs - Duration of the chunk in milliseconds
 * @returns Base64-encoded audio data
 */
export function generateMockAudioChunk(durationMs: number = 100): string {
	const audioData = generateMockPCM16Audio(durationMs);
	const uint8Array = new Uint8Array(audioData);

	// Convert to base64
	let binary = '';
	for (let i = 0; i < uint8Array.length; i++) {
		binary += String.fromCharCode(uint8Array[i]);
	}

	return btoa(binary);
}
