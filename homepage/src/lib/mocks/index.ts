/**
 * Mock system core utilities
 * Controls mock mode and provides shared utilities for all mock implementations
 */

/**
 * Check if mock mode is enabled
 * Set VITE_DEV_MODE=mock in .env to activate
 */
export const isMockMode = import.meta.env.VITE_DEV_MODE === 'mock';

/**
 * Delay execution for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay execution for a random duration between min and max milliseconds
 */
export function randomDelay(min: number, max: number): Promise<void> {
	const ms = Math.floor(Math.random() * (max - min + 1)) + min;
	return delay(ms);
}

/**
 * Return a random element from an array
 */
export function randomChoice<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Log a message with [Mock] prefix for debugging
 */
export function mockLog(...args: any[]): void {
	if (isMockMode) {
		console.log('[Mock]', ...args);
	}
}
