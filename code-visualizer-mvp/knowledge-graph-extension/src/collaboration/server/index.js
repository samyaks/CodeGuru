#!/usr/bin/env node

/**
 * Y.js WebSocket Server for Real-Time Collaboration
 * 
 * This server handles real-time document synchronization using CRDTs (Conflict-free Replicated Data Types).
 * Features:
 * - Multi-client synchronization
 * - Presence awareness (cursors, typing indicators)
 * - Persistence to avoid data loss
 * - Automatic reconnection handling
 * - Horizontal scaling support (optional Redis)
 */

const WebSocket = require('ws');
const http = require('http');
const Y = require('yjs');
const { setupWSConnection, setPersistence, docs } = require('y-websocket/bin/utils');

// Configuration
const PORT = process.env.PORT || 1234;
const HOST = process.env.HOST || 'localhost';
const PERSISTENCE = process.env.YPERSISTENCE || 'memory'; // 'memory' | 'redis' | 'mongodb'
const GC_INTERVAL = 30000; // Garbage collect every 30 seconds
const PING_INTERVAL = 30000; // Ping clients every 30 seconds

// Optional: Set up persistence
if (PERSISTENCE !== 'memory') {
  console.log(`[Y.js Server] Persistence mode: ${PERSISTENCE}`);
  // Note: y-websocket supports LevelDB persistence out of the box
  // For Redis/MongoDB, you'd implement custom persistence adapters
}

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      activeConnections: wss.clients.size,
      activeDocuments: docs.size,
      memory: process.memoryUsage()
    }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connections: wss.clients.size,
      documents: docs.size,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('UpdateAI Y.js Collaboration Server');
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

console.log(`[Y.js Server] Starting WebSocket server on ws://${HOST}:${PORT}`);

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  const urlParams = new URL(req.url, `http://${req.headers.host}`);
  const workspaceId = urlParams.pathname.slice(1); // Remove leading slash
  
  console.log(`[Y.js Server] New connection to workspace: ${workspaceId}`);
  console.log(`[Y.js Server] Active connections: ${wss.clients.size}`);
  
  // Optional: Authentication check
  const token = urlParams.searchParams.get('token');
  if (process.env.REQUIRE_AUTH === 'true' && !token) {
    console.log('[Y.js Server] Connection rejected: Missing auth token');
    ws.close(1008, 'Authentication required');
    return;
  }
  
  // Set up Y.js connection
  setupWSConnection(ws, req, {
    gc: true // Enable garbage collection
  });
  
  ws.on('close', () => {
    console.log(`[Y.js Server] Connection closed for workspace: ${workspaceId}`);
    console.log(`[Y.js Server] Active connections: ${wss.clients.size}`);
  });
  
  ws.on('error', (error) => {
    console.error('[Y.js Server] WebSocket error:', error);
  });
});

// Periodic cleanup of inactive documents
setInterval(() => {
  const now = Date.now();
  docs.forEach((doc, docName) => {
    // Remove documents with no connections after 10 minutes
    if (doc.conns.size === 0 && now - doc.lastAccess > 600000) {
      console.log(`[Y.js Server] Cleaning up inactive document: ${docName}`);
      doc.destroy();
      docs.delete(docName);
    }
  });
}, GC_INTERVAL);

// Periodic ping to keep connections alive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[Y.js Server] Terminating inactive connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`\n✅ [Y.js Server] Running on ws://${HOST}:${PORT}`);
  console.log(`✅ [Y.js Server] Health check: http://${HOST}:${PORT}/health`);
  console.log(`✅ [Y.js Server] Metrics: http://${HOST}:${PORT}/metrics\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Y.js Server] SIGTERM received, closing server gracefully');
  wss.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });
  server.close(() => {
    console.log('[Y.js Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Y.js Server] SIGINT received, closing server gracefully');
  wss.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });
  server.close(() => {
    console.log('[Y.js Server] Server closed');
    process.exit(0);
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('[Y.js Server] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Y.js Server] Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
