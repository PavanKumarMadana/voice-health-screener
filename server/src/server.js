import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { env } from './config/env.js';
import { attachCallHandler } from './websocket/callHandler.js';

const app = express();
app.use(cors({ origin: env.clientOrigins }));
app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'voice-health-screener' }));

// Bind to the address configured for the host (Render assigns PORT automatically and
// expects the service to listen on it). No localhost is hardcoded for production.
const server = http.createServer(app);
const websocketServer = new WebSocketServer({ server, path: '/ws', maxPayload: 10 * 1024 * 1024 });
websocketServer.on('connection', attachCallHandler);
websocketServer.on('error', (error) => console.error('WebSocket server error:', error.message));

server.listen(env.port, () => console.log(`Voice health screener server listening on port ${env.port}`));
