/**
 * Mock STT data generators
 * Generates realistic transcripts for testing STT functionality
 */

// Sample transcript phrases that sound natural when concatenated
const transcriptPhrases = [
	'Hello, this is a test of the speech recognition system.',
	'The weather today is quite pleasant with clear skies.',
	'I need to finish this project by the end of the week.',
	'Can you help me understand how this feature works?',
	'The quick brown fox jumps over the lazy dog.',
	'Machine learning models are becoming increasingly sophisticated.',
	'Let me know if you have any questions about this.',
	'I think we should schedule a meeting to discuss the details.',
	'The application is running smoothly without any errors.',
	'Thank you for your patience while we work on this.',
	'Please make sure to save your work before closing the application.',
	'The system will automatically update every few minutes.',
	'We need to consider the user experience when designing this interface.',
	'Have you tried restarting the service to see if that helps?',
	'The documentation provides detailed instructions for setup.',
	'I appreciate your feedback on the new features.',
	'Let me check the logs to see what might be causing the issue.',
	'The team has been working hard to improve performance.',
	'We should test this thoroughly before deploying to production.',
	'The API endpoint is responding as expected.',
	'Make sure all dependencies are properly installed.',
	'The configuration file needs to be updated with the correct values.',
	'I will send you a summary of our discussion shortly.',
	'The new release includes several bug fixes and improvements.',
	'Please review the changes and let me know your thoughts.',
	'We can implement that feature in the next sprint.',
	'The database connection is stable and working correctly.',
	'I recommend running the tests before committing your changes.',
	'The interface is intuitive and easy to navigate.',
	'Let me walk you through the process step by step.'
];

// Additional filler phrases for longer transcripts
const fillerPhrases = [
	'Um, well, you know,',
	'So, basically,',
	'I mean,',
	'Actually,',
	'You see,',
	'In other words,',
	'To be honest,',
	'By the way,',
	'As I was saying,',
	'On the other hand,'
];

/**
 * Generate a realistic transcript based on audio duration
 * Uses ~150 words per minute as the speech rate
 *
 * @param audioDurationMs - Duration of the audio in milliseconds
 * @returns Natural-sounding transcript text
 */
export function generateMockTranscript(audioDurationMs: number): string {
	// Calculate target word count based on speech rate
	// 150 words per minute = 2.5 words per second
	const targetWordCount = Math.ceil((audioDurationMs / 1000) * 2.5);

	// For very short durations, return a partial phrase
	if (targetWordCount < 3) {
		return 'Hello';
	}

	if (targetWordCount < 8) {
		return 'Hello, this is a test.';
	}

	const words: string[] = [];
	let currentWordCount = 0;

	// Keep adding phrases until we reach target word count
	while (currentWordCount < targetWordCount) {
		// Occasionally add filler phrases for realism (20% chance)
		if (Math.random() < 0.2 && words.length > 0) {
			const filler = fillerPhrases[Math.floor(Math.random() * fillerPhrases.length)];
			words.push(filler);
			currentWordCount += filler.split(' ').length;
		}

		// Add a random transcript phrase
		const phrase = transcriptPhrases[Math.floor(Math.random() * transcriptPhrases.length)];
		words.push(phrase);
		currentWordCount += phrase.split(' ').length;
	}

	let transcript = words.join(' ');

	// Trim to approximate target word count
	const allWords = transcript.split(' ');
	if (allWords.length > targetWordCount * 1.2) {
		// If we're significantly over, trim and add ellipsis
		transcript = allWords.slice(0, targetWordCount).join(' ') + '...';
	}

	return transcript;
}

/**
 * Generate mock transcript segments with timestamps
 * Useful for testing time-aligned transcriptions
 *
 * @param audioDurationMs - Duration of the audio in milliseconds
 * @returns Array of transcript segments with start and end times
 */
export interface TranscriptSegment {
	text: string;
	startMs: number;
	endMs: number;
}

export function generateMockTranscriptSegments(audioDurationMs: number): TranscriptSegment[] {
	const fullTranscript = generateMockTranscript(audioDurationMs);
	const sentences = fullTranscript.match(/[^.!?]+[.!?]+/g) || [fullTranscript];

	const segments: TranscriptSegment[] = [];
	let currentTime = 0;
	const avgWordsPerMinute = 150;

	sentences.forEach((sentence, index) => {
		const wordCount = sentence.trim().split(/\s+/).length;
		// Calculate duration: (words / words_per_minute) * 60000 ms
		const durationMs = (wordCount / avgWordsPerMinute) * 60000;

		segments.push({
			text: sentence.trim(),
			startMs: Math.round(currentTime),
			endMs: Math.round(currentTime + durationMs)
		});

		currentTime += durationMs;
	});

	// Normalize to fit actual audio duration
	const totalDuration = segments[segments.length - 1].endMs;
	if (totalDuration !== audioDurationMs) {
		const scaleFactor = audioDurationMs / totalDuration;
		segments.forEach(segment => {
			segment.startMs = Math.round(segment.startMs * scaleFactor);
			segment.endMs = Math.round(segment.endMs * scaleFactor);
		});
	}

	return segments;
}

/**
 * Generate partial transcript for streaming STT
 * Simulates real-time transcription with incremental updates
 *
 * @param audioDurationMs - Duration of audio processed so far
 * @param isPartial - Whether this is a partial result (vs final)
 * @returns Transcript text appropriate for streaming context
 */
export function generateMockStreamingTranscript(
	audioDurationMs: number,
	isPartial: boolean = true
): string {
	const transcript = generateMockTranscript(audioDurationMs);

	if (isPartial) {
		// For partial results, sometimes truncate mid-word for realism
		if (Math.random() < 0.3) {
			const words = transcript.split(' ');
			const lastWord = words[words.length - 1];
			if (lastWord.length > 3) {
				words[words.length - 1] = lastWord.slice(0, -Math.floor(Math.random() * 3) - 1);
			}
			return words.join(' ');
		}
	}

	return transcript;
}
