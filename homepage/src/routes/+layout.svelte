<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;

		let timeout: ReturnType<typeof setTimeout>;

		const sendPrefetch = () => {
			navigator.serviceWorker.controller?.postMessage({ type: 'PREFETCH_WEATHER' });
		};

		if (navigator.serviceWorker.controller) {
			timeout = setTimeout(sendPrefetch, 5000);
		} else {
			// On first visit, controller is null until the SW calls clients.claim()
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				timeout = setTimeout(sendPrefetch, 5000);
			}, { once: true });
		}

		const interval = setInterval(sendPrefetch, 15 * 60 * 1000);
		return () => {
			clearTimeout(timeout);
			clearInterval(interval);
		};
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
