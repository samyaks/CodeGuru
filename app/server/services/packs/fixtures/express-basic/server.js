const express = require('express');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/boom', () => { throw new Error('db password is hunter2'); });

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on ${port}`));
