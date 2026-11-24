// Standalone server: `npm start` → http://localhost:4600
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 4600);
const HOST = process.env.HOST || '127.0.0.1';

const { app, stop } = createApp({ dataDir: process.env.DATA_DIR });
const server = app.listen(PORT, HOST, () => {
  console.log(`PharmaChain OS running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`API base: http://localhost:${PORT}/api/v1  ·  OpenAPI: /api/v1/openapi.json`);
});

const shutdown = () => { stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
