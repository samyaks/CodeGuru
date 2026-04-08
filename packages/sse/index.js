const connections = new Map();
const eventBuffers = new Map();
const bufferTimers = new Map();

const MAX_BUFFER_SIZE = 50;
const BUFFER_TTL_MS = 5 * 60 * 1000;

function touchBuffer(id) {
  if (bufferTimers.has(id)) clearTimeout(bufferTimers.get(id));
  bufferTimers.set(id, setTimeout(() => {
    eventBuffers.delete(id);
    bufferTimers.delete(id);
  }, BUFFER_TTL_MS));
}

function addConnection(id, res, { origin } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', id })}\n\n`);

  if (!connections.has(id)) {
    connections.set(id, []);
  }
  connections.get(id).push(res);

  const heartbeat = setInterval(() => {
    try {
      res.write('data: {"type":"heartbeat"}\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  res.on('close', () => {
    clearInterval(heartbeat);
    removeConnection(id, res);
  });
}

function removeConnection(id, res) {
  const conns = connections.get(id);
  if (!conns) return;
  const idx = conns.indexOf(res);
  if (idx !== -1) conns.splice(idx, 1);
  if (conns.length === 0) connections.delete(id);
}

function broadcast(id, data) {
  if (!eventBuffers.has(id)) eventBuffers.set(id, []);
  const buffer = eventBuffers.get(id);
  buffer.push(data);
  if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();
  touchBuffer(id);

  const conns = connections.get(id) || [];
  const message = `data: ${JSON.stringify(data)}\n\n`;

  for (let i = conns.length - 1; i >= 0; i--) {
    try {
      conns[i].write(message);
    } catch {
      conns.splice(i, 1);
    }
  }
}

function getRecentEvents(id) {
  return eventBuffers.get(id) || [];
}

module.exports = { addConnection, removeConnection, broadcast, getRecentEvents };
