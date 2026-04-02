# @codeguru/sse

Server-Sent Events connection manager for CodeGuru services.

## Usage

```js
const { addConnection, broadcast } = require('@codeguru/sse');

// In an Express route handler:
router.get('/stream', (req, res) => {
  addConnection(streamId, res);
});

// Broadcast to all connected clients:
broadcast(streamId, { type: 'progress', message: 'Working...' });
```
