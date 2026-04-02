const connections = new Map();

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

module.exports = { addConnection, removeConnection, broadcast };
