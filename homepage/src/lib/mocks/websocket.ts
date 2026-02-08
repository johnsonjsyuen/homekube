/**
 * Mock WebSocket implementations for STT and Live TTS
 * Simulates WebSocket API for local development and testing
 */

import { delay, mockLog } from './index';
import { generateMockTranscript } from './data/stt';
import { generateMockLiveTTSAudio } from './data/audio';

/**
 * WebSocket ready states
 */
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * Mock STT WebSocket
 * Simulates real-time speech-to-text WebSocket connection
 *
 * Behavior:
 * - 300ms connection delay
 * - Buffers audio chunks
 * - Generates partial transcripts every 20 chunks
 * - Returns final transcript on "commit" message
 */
export class MockSTTWebSocket extends EventTarget {
	private _readyState: number = CONNECTING;
	private _url: string;
	private _audioBuffer: ArrayBuffer[] = [];
	private _audioChunkCount: number = 0;
	private _totalAudioDuration: number = 0;
	private _accumulatedTranscript: string = '';

	// WebSocket API properties
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;

	// WebSocket API additional properties
	binaryType: 'blob' | 'arraybuffer' = 'blob';
	protocol: string = '';
	extensions: string = '';
	bufferedAmount: number = 0;

	// WebSocket constants (static)
	static readonly CONNECTING = CONNECTING;
	static readonly OPEN = OPEN;
	static readonly CLOSING = CLOSING;
	static readonly CLOSED = CLOSED;

	// WebSocket constants (instance)
	readonly CONNECTING = CONNECTING;
	readonly OPEN = OPEN;
	readonly CLOSING = CLOSING;
	readonly CLOSED = CLOSED;

	get readyState(): number {
		return this._readyState;
	}

	get url(): string {
		return this._url;
	}

	constructor(url: string) {
		super();
		this._url = url;
		mockLog('STT WebSocket: Connecting to', url);

		// Simulate connection delay (300ms)
		delay(300).then(() => {
			// Verify state hasn't changed during connection delay
			if (this._readyState === CONNECTING) {
				this._readyState = OPEN;
				mockLog('STT WebSocket: Connected');
				this._dispatchOpen();
			} else {
				mockLog('STT WebSocket: Connection aborted, state changed to', this._readyState);
			}
		});
	}

	/**
	 * Send data to the WebSocket
	 * Handles both audio data and control messages
	 */
	send(data: string | ArrayBuffer | Blob): void {
		if (this._readyState !== OPEN) {
			throw new Error('WebSocket is not open');
		}

		if (typeof data === 'string') {
			// Handle control messages
			try {
				const message = JSON.parse(data);
				this._handleControlMessage(message);
			} catch (e) {
				mockLog('STT WebSocket: Invalid control message', data);
			}
		} else {
			// Handle audio data - call async method without blocking
			// (fire and forget pattern, errors are logged internally)
			void this._handleAudioData(data);
		}
	}

	/**
	 * Close the WebSocket connection
	 */
	close(code: number = 1000, reason: string = ''): void {
		if (this._readyState === CLOSING || this._readyState === CLOSED) {
			return;
		}

		mockLog('STT WebSocket: Closing', code, reason);
		this._readyState = CLOSING;

		// Simulate close delay
		delay(50).then(() => {
			this._readyState = CLOSED;
			this._dispatchClose(code, reason);
		});
	}

	/**
	 * Handle audio data chunks
	 */
	private async _handleAudioData(data: ArrayBuffer | Blob): Promise<void> {
		let audioBuffer: ArrayBuffer;

		if (data instanceof Blob) {
			audioBuffer = await data.arrayBuffer();
		} else {
			audioBuffer = data;
		}

		this._audioBuffer.push(audioBuffer);
		this._audioChunkCount++;

		// Calculate audio duration (assuming 16kHz PCM16)
		const sampleRate = 16000;
		const bytesPerSample = 2; // 16-bit = 2 bytes
		const durationMs = (audioBuffer.byteLength / bytesPerSample / sampleRate) * 1000;
		this._totalAudioDuration += durationMs;

		mockLog(`STT WebSocket: Received audio chunk ${this._audioChunkCount} (${Math.round(durationMs)}ms)`);

		// Generate partial transcript every 20 chunks
		if (this._audioChunkCount % 20 === 0) {
			const transcript = generateMockTranscript(this._totalAudioDuration);
			this._accumulatedTranscript = transcript;

			// Send partial transcript message
			this._dispatchMessage({
				type: 'transcript',
				text: transcript,
				timestamp: Date.now()
			});

			mockLog('STT WebSocket: Generated partial transcript:', transcript.slice(0, 50) + '...');
		}
	}

	/**
	 * Handle control messages (e.g., "commit")
	 */
	private _handleControlMessage(message: any): void {
		mockLog('STT WebSocket: Control message', message);

		if (message.type === 'commit' || message.action === 'commit') {
			// Generate final transcript
			let finalTranscript: string;

			if (this._audioChunkCount === 0) {
				finalTranscript = '';
			} else if (this._accumulatedTranscript) {
				// Use accumulated transcript if available
				finalTranscript = this._accumulatedTranscript;
			} else {
				// Generate based on total audio duration
				finalTranscript = generateMockTranscript(this._totalAudioDuration);
			}

			// Send final transcript message
			this._dispatchMessage({
				type: 'transcript',
				text: finalTranscript,
				timestamp: Date.now()
			});

			mockLog('STT WebSocket: Final transcript:', finalTranscript);

			// Reset buffers for next session
			this._audioBuffer = [];
			this._audioChunkCount = 0;
			this._totalAudioDuration = 0;
			this._accumulatedTranscript = '';
		}
	}

	/**
	 * Dispatch 'open' event
	 */
	private _dispatchOpen(): void {
		const event = new Event('open');
		this.dispatchEvent(event);
		if (this.onopen) {
			this.onopen(event);
		}

		// Send connected message immediately after connection opens
		this._dispatchMessage({
			type: 'connected',
			timestamp: Date.now()
		});
	}

	/**
	 * Dispatch 'message' event
	 */
	private _dispatchMessage(data: any): void {
		const event = new MessageEvent('message', {
			data: JSON.stringify(data)
		});
		this.dispatchEvent(event);
		if (this.onmessage) {
			this.onmessage(event);
		}
	}

	/**
	 * Dispatch 'error' event
	 */
	private _dispatchError(error: string): void {
		const event = new ErrorEvent('error', {
			message: error
		});
		this.dispatchEvent(event);
		if (this.onerror) {
			this.onerror(event);
		}
	}

	/**
	 * Dispatch 'close' event
	 */
	private _dispatchClose(code: number, reason: string): void {
		const event = new CloseEvent('close', {
			code,
			reason,
			wasClean: code === 1000
		});
		this.dispatchEvent(event);
		if (this.onclose) {
			this.onclose(event);
		}
	}
}

/**
 * Mock Live TTS WebSocket
 * Simulates real-time text-to-speech WebSocket connection
 *
 * Behavior:
 * - 200ms connection delay
 * - Handles auth handshake
 * - Generates word timings and audio for each text chunk
 * - Simulates streaming audio synthesis
 */
export class MockLiveTTSWebSocket extends EventTarget {
	private _readyState: number = CONNECTING;
	private _url: string;
	private _isAuthenticated: boolean = false;
	private _sentenceIndex: number = 0;

	// WebSocket API properties
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;

	// WebSocket API additional properties
	binaryType: 'blob' | 'arraybuffer' = 'blob';
	protocol: string = '';
	extensions: string = '';
	bufferedAmount: number = 0;

	// WebSocket constants (static)
	static readonly CONNECTING = CONNECTING;
	static readonly OPEN = OPEN;
	static readonly CLOSING = CLOSING;
	static readonly CLOSED = CLOSED;

	// WebSocket constants (instance)
	readonly CONNECTING = CONNECTING;
	readonly OPEN = OPEN;
	readonly CLOSING = CLOSING;
	readonly CLOSED = CLOSED;

	get readyState(): number {
		return this._readyState;
	}

	get url(): string {
		return this._url;
	}

	constructor(url: string) {
		super();
		this._url = url;
		mockLog('Live TTS WebSocket: Connecting to', url);

		// Simulate connection delay (200ms)
		delay(200).then(() => {
			// Verify state hasn't changed during connection delay
			if (this._readyState === CONNECTING) {
				this._readyState = OPEN;
				mockLog('Live TTS WebSocket: Connected');
				this._dispatchOpen();
			} else {
				mockLog('Live TTS WebSocket: Connection aborted, state changed to', this._readyState);
			}
		});
	}

	/**
	 * Send data to the WebSocket
	 */
	send(data: string | ArrayBuffer | Blob): void {
		if (this._readyState !== OPEN) {
			throw new Error('WebSocket is not open');
		}

		if (typeof data === 'string') {
			try {
				const message = JSON.parse(data);
				// Call async method without blocking (fire and forget pattern)
				void this._handleMessage(message);
			} catch (e) {
				mockLog('Live TTS WebSocket: Invalid message', data);
			}
		} else {
			mockLog('Live TTS WebSocket: Binary data not supported in send');
		}
	}

	/**
	 * Close the WebSocket connection
	 */
	close(code: number = 1000, reason: string = ''): void {
		if (this._readyState === CLOSING || this._readyState === CLOSED) {
			return;
		}

		mockLog('Live TTS WebSocket: Closing', code, reason);
		this._readyState = CLOSING;

		// Simulate close delay
		delay(50).then(() => {
			this._readyState = CLOSED;
			this._dispatchClose(code, reason);
		});
	}

	/**
	 * Handle incoming messages
	 */
	private async _handleMessage(message: any): Promise<void> {
		mockLog('Live TTS WebSocket: Received message', message.type);

		if (message.type === 'auth') {
			await this._handleAuth(message);
		} else if (message.type === 'synthesize_append') {
			await this._handleSynthesizeAppend(message);
		} else {
			mockLog('Live TTS WebSocket: Unknown message type', message.type);
		}
	}

	/**
	 * Handle authentication message
	 */
	private async _handleAuth(message: any): Promise<void> {
		mockLog('Live TTS WebSocket: Authenticating...');

		// Simulate auth delay
		await delay(100);

		this._isAuthenticated = true;

		// Send auth_ok response
		this._dispatchMessage({
			type: 'auth_ok',
			timestamp: Date.now()
		});

		mockLog('Live TTS WebSocket: Authentication successful');
	}

	/**
	 * Handle synthesize_append message
	 */
	private async _handleSynthesizeAppend(message: any): Promise<void> {
		if (!this._isAuthenticated) {
			mockLog('Live TTS WebSocket: Not authenticated');
			this._dispatchError('Not authenticated');
			return;
		}

		const text = message.text || '';
		const sentenceIndex = this._sentenceIndex++;

		mockLog(`Live TTS WebSocket: Synthesizing sentence ${sentenceIndex}: "${text}"`);

		// Calculate word timings (~80ms per character)
		const msPerChar = 80;
		const words = text.split(/\s+/).filter(w => w.length > 0);
		const wordTimings: Array<{ word: string; start_ms: number; end_ms: number }> = [];

		let currentTime = 0;
		for (const word of words) {
			const duration = word.length * msPerChar;
			wordTimings.push({
				word,
				start_ms: currentTime,
				end_ms: currentTime + duration
			});
			currentTime += duration + msPerChar; // Add space between words
		}

		// Send word_timing message
		this._dispatchMessage({
			type: 'word_timing',
			sentence_index: sentenceIndex,
			words: wordTimings
		});

		// Generate and send audio data
		const audioData = generateMockLiveTTSAudio(sentenceIndex, text);

		// Simulate audio generation delay
		await delay(50);

		// Send audio as binary data
		this._dispatchBinaryMessage(audioData);

		mockLog(`Live TTS WebSocket: Sent audio for sentence ${sentenceIndex} (${audioData.byteLength} bytes)`);

		// Send sentence_done message
		await delay(10);
		this._dispatchMessage({
			type: 'sentence_done',
			sentence_index: sentenceIndex
		});

		mockLog(`Live TTS WebSocket: Sentence ${sentenceIndex} complete`);
	}

	/**
	 * Dispatch 'open' event
	 */
	private _dispatchOpen(): void {
		const event = new Event('open');
		this.dispatchEvent(event);
		if (this.onopen) {
			this.onopen(event);
		}
	}

	/**
	 * Dispatch 'message' event with JSON data
	 */
	private _dispatchMessage(data: any): void {
		const event = new MessageEvent('message', {
			data: JSON.stringify(data)
		});
		this.dispatchEvent(event);
		if (this.onmessage) {
			this.onmessage(event);
		}
	}

	/**
	 * Dispatch 'message' event with binary data
	 */
	private _dispatchBinaryMessage(data: ArrayBuffer): void {
		const event = new MessageEvent('message', {
			data: data
		});
		this.dispatchEvent(event);
		if (this.onmessage) {
			this.onmessage(event);
		}
	}

	/**
	 * Dispatch 'error' event
	 */
	private _dispatchError(error: string): void {
		const event = new ErrorEvent('error', {
			message: error
		});
		this.dispatchEvent(event);
		if (this.onerror) {
			this.onerror(event);
		}
	}

	/**
	 * Dispatch 'close' event
	 */
	private _dispatchClose(code: number, reason: string): void {
		const event = new CloseEvent('close', {
			code,
			reason,
			wasClean: code === 1000
		});
		this.dispatchEvent(event);
		if (this.onclose) {
			this.onclose(event);
		}
	}
}
