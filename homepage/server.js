/**
 * Custom Node.js server for SvelteKit with WebSocket proxy support.
 * 
 * SvelteKit's adapter-node doesn't natively support WebSocket proxying,
 * so we wrap the handler and intercept upgrade requests for /api/tts/live.
 */

import { createServer } from 'http';
import { handler } from './build/handler.js';
import { WebSocketServer, WebSocket } from 'ws';

const port = process.env.PORT || 3000;

// Create HTTP server
const server = createServer(handler);

// Create WebSocket server for handling upgrades
const wss = new WebSocketServer({ noServer: true });

// Backend TTS service URL
const TTS_BACKEND = process.env.TTS_BACKEND_URL || 'ws://text-to-speech:3000';

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/api/tts/live') {
        // Accept the client WebSocket connection
        wss.handleUpgrade(request, socket, head, (clientWs) => {
            console.log('[WS Proxy] Client connected to /api/tts/live');

            // Connect to backend
            const backendUrl = `${TTS_BACKEND}/ws/live`;
            const backendWs = new WebSocket(backendUrl);

            let backendReady = false;
            const messageQueue = [];

            backendWs.on('open', () => {
                console.log('[WS Proxy] Connected to backend');
                backendReady = true;
                // Send any queued messages
                for (const msg of messageQueue) {
                    backendWs.send(msg);
                }
                messageQueue.length = 0;
            });

            backendWs.on('message', (data, isBinary) => {
                // Forward backend messages to client
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(data, { binary: isBinary });
                }
            });

            backendWs.on('close', (code, reason) => {
                console.log(`[WS Proxy] Backend closed: ${code} ${reason}`);
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close(code, reason);
                }
            });

            backendWs.on('error', (error) => {
                console.error('[WS Proxy] Backend error:', error.message);
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close(1011, 'Backend connection error');
                }
            });

            // Forward client messages to backend
            clientWs.on('message', (data, isBinary) => {
                if (backendReady) {
                    backendWs.send(data, { binary: isBinary });
                } else {
                    // Queue message until backend is ready
                    messageQueue.push(data);
                }
            });

            clientWs.on('close', (code, reason) => {
                console.log(`[WS Proxy] Client closed: ${code} ${reason}`);
                if (backendWs.readyState === WebSocket.OPEN || backendWs.readyState === WebSocket.CONNECTING) {
                    backendWs.close(code, reason);
                }
            });

            clientWs.on('error', (error) => {
                console.error('[WS Proxy] Client error:', error.message);
                if (backendWs.readyState === WebSocket.OPEN) {
                    backendWs.close(1011, 'Client connection error');
                }
            });
        });
    } else {
        // Not a path we handle, destroy the socket
        socket.destroy();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
