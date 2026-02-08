/**
 * Mock TTS job management
 * Manages in-memory TTS jobs for local development testing
 */

import { randomDelay, mockLog } from '../index';
import { generateMockMP3Blob } from './audio';

export interface MockTTSJob {
	id: string;
	filename: string;
	voice: string;
	speed: number;
	status: 'processing' | 'completed' | 'error';
	createdAt: Date;
	completedAt?: Date;
	audioBlob?: Blob;
	error?: string;
}

// In-memory job storage
const jobs = new Map<string, MockTTSJob>();
let jobIdCounter = 1;

/**
 * Initialize with seeded example jobs
 */
function seedJobs(): void {
	if (jobs.size > 0) return; // Already seeded

	// Completed job
	const completedJob: MockTTSJob = {
		id: 'mock-job-1',
		filename: 'welcome.txt',
		voice: 'alloy',
		speed: 1.0,
		status: 'completed',
		createdAt: new Date(Date.now() - 3600000), // 1 hour ago
		completedAt: new Date(Date.now() - 3595000),
		audioBlob: generateMockMP3Blob(5)
	};
	jobs.set(completedJob.id, completedJob);

	// Processing job
	const processingJob: MockTTSJob = {
		id: 'mock-job-2',
		filename: 'longtext.txt',
		voice: 'shimmer',
		speed: 1.2,
		status: 'processing',
		createdAt: new Date(Date.now() - 5000) // 5 seconds ago
	};
	jobs.set(processingJob.id, processingJob);

	// Error job
	const errorJob: MockTTSJob = {
		id: 'mock-job-3',
		filename: 'invalid.txt',
		voice: 'echo',
		speed: 1.5,
		status: 'error',
		createdAt: new Date(Date.now() - 7200000), // 2 hours ago
		completedAt: new Date(Date.now() - 7195000),
		error: 'Invalid text format'
	};
	jobs.set(errorJob.id, errorJob);

	jobIdCounter = 4; // Start new jobs from 4

	mockLog('Seeded 3 example TTS jobs');
}

// Seed jobs on module load
seedJobs();

/**
 * Create a new mock TTS job
 * Job will auto-complete after 2-5 seconds
 * @param filename - Name of the input file
 * @param voice - Voice name
 * @param speed - Speech speed multiplier
 * @returns Job ID
 */
export function createMockJob(
	filename: string,
	voice: string = 'alloy',
	speed: number = 1.0
): string {
	const id = `mock-job-${jobIdCounter++}`;

	const job: MockTTSJob = {
		id,
		filename,
		voice,
		speed,
		status: 'processing',
		createdAt: new Date()
	};

	jobs.set(id, job);
	mockLog(`Created TTS job ${id}: ${filename}`);

	// Auto-complete after random delay (2-5 seconds)
	randomDelay(2000, 5000).then(() => {
		const currentJob = jobs.get(id);
		if (currentJob && currentJob.status === 'processing') {
			// 90% success, 10% error
			if (Math.random() < 0.9) {
				currentJob.status = 'completed';
				currentJob.completedAt = new Date();
				// Generate audio based on filename length (proxy for content length)
				const audioDuration = Math.max(2, Math.min(10, filename.length / 10));
				currentJob.audioBlob = generateMockMP3Blob(audioDuration);
				mockLog(`Job ${id} completed`);
			} else {
				currentJob.status = 'error';
				currentJob.completedAt = new Date();
				currentJob.error = 'Mock synthesis error';
				mockLog(`Job ${id} failed`);
			}
		}
	});

	return id;
}

/**
 * Get a job by ID
 * @param id - Job ID
 * @returns Job object or undefined if not found
 */
export function getMockJob(id: string): MockTTSJob | undefined {
	return jobs.get(id);
}

/**
 * Get all jobs sorted by creation date (newest first)
 * @returns Array of all jobs
 */
export function getAllMockJobs(): MockTTSJob[] {
	return Array.from(jobs.values()).sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
	);
}

/**
 * Delete a job by ID
 * @param id - Job ID
 * @returns true if deleted, false if not found
 */
export function deleteMockJob(id: string): boolean {
	return jobs.delete(id);
}

/**
 * Clear all jobs (useful for testing)
 */
export function clearAllMockJobs(): void {
	jobs.clear();
	jobIdCounter = 1;
	mockLog('Cleared all TTS jobs');
}

/**
 * Reset to seeded state (clear and re-seed)
 */
export function resetMockJobs(): void {
	clearAllMockJobs();
	seedJobs();
}
