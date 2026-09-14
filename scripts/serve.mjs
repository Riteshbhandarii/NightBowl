import { createServer } from 'node:http';
import compression from 'compression';

// Astro's standalone entry auto-starts when imported unless this is disabled.
// Wrapping its complete handler keeps static assets and server routes portable
// while ensuring large JS/CSS responses are compressed outside a managed CDN.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('../dist/server/entry.mjs');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4321);
const compress = compression();

const server = createServer((request, response) => {
  compress(request, response, (error) => {
    if (error) {
      response.writeHead(500);
      response.end('Internal server error');
      return;
    }
    Promise.resolve(handler(request, response)).catch((handlerError) => {
      console.error(handlerError);
      if (!response.headersSent) response.writeHead(500);
      response.end('Internal server error');
    });
  });
});

server.listen(port, host, () => {
  console.log(`NightBowl listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
