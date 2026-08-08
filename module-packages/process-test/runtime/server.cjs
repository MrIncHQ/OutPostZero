const http = require('node:http');

const startedAt = new Date().toISOString();
const moduleData = process.env.OUTPOST_ZERO_MODULE_DATA || '';
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({
      ok: true,
      moduleId: 'portable-process-test',
      pid: process.pid,
      startedAt,
      dataPath: moduleData,
    }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('Not found');
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('message', (message) => {
  if (message && message.type === 'shutdown') shutdown();
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the loopback port.');
  console.log(JSON.stringify({ type: 'ready', port: address.port, pid: process.pid, startedAt }));
});
