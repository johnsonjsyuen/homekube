import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
	// Load env file based on `mode` in the current working directory.
	const env = loadEnv(mode, process.cwd(), '');

	return {
		plugins: [tailwindcss(), sveltekit()],
		resolve: {
			alias: {
				'$lib/auth': path.resolve(
					__dirname,
					env.VITE_DEV_MODE === 'mock'
						? 'src/lib/auth.mock.ts'
						: 'src/lib/auth.ts'
				)
			}
		}
	};
});
