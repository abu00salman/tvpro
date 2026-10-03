'use strict';
// A loopback-only HTTP proxy that reuses TV Pro's own validated gateway core (tvpro-gateway-deno.ts) so the
// desktop app does not have to depend on the third-party-hosted Cloudflare/Deno gateways for HTTP-over-HTTPS and
// CORS relaying. It is pure defense-in-depth: the same SSRF/redirect/host validation that already ships in the
// gateway file runs unmodified here, in the main process, not the sandboxed renderer. Never exposed beyond
// 127.0.0.1; every connection's remote address is checked a second time regardless.
const http = require('node:http');
const net = require('node:net');

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** Loads the gateway's `export default { fetch(request) }` from its source text without a TypeScript build step
 *  (the file is already plain, portable JS — see PLAYBACK-INVESTIGATION.md / tests/e2e/playback.e2e.mjs, which
 *  loads it the same way). Verified by the project's own gateway test suite running the same file this way. */
async function loadGatewayModule(gatewaySourcePath) {
  const fs = require('node:fs');
  const src = fs.readFileSync(gatewaySourcePath, 'utf8');
  const mod = await import('data:text/javascript,' + encodeURIComponent(src));
  if (!mod || !mod.default || typeof mod.default.fetch !== 'function') {
    throw new Error('tvpro-gateway-deno.ts did not export a fetch handler');
  }
  return mod.default;
}

async function nodeRequestToFetchRequest(req, origin) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  headers.delete('host'); // avoid leaking the loopback Host header into upstream header construction
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(origin + req.url, {
    method: req.method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'content-encoding') return; // undici already decoded the body
    res.setHeader(k, v);
  });
  if (!response.body) { res.end(); return; }
  const { Readable } = require('node:stream');
  Readable.fromWeb(response.body).pipe(res);
}

/** @returns {{ start(): Promise<string>, stop(): Promise<void> }} start() resolves to the proxy's base URL
 *  (e.g. "http://127.0.0.1:53211"), or rejects if the gateway module failed to load. */
function createLocalGateway(gatewaySourcePath) {
  let server = null;
  let gatewayModule = null;

  async function start() {
    gatewayModule = await loadGatewayModule(gatewaySourcePath);
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const remote = req.socket.remoteAddress || '';
        if (!isLoopback(remote)) { res.writeHead(403).end('loopback only'); return; }
        const origin = 'http://127.0.0.1:' + req.socket.localPort;
        nodeRequestToFetchRequest(req, origin)
          .then((request) => gatewayModule.fetch(request, {}))
          .then((response) => sendFetchResponse(res, response))
          .catch(() => { if (!res.headersSent) res.writeHead(502); res.end('local gateway error'); });
      });
      server.on('error', reject);
      // 127.0.0.1 explicitly (never 0.0.0.0): nothing outside this machine's own processes can reach it.
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        resolve('http://127.0.0.1:' + port);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => { if (server) server.close(() => resolve()); else resolve(); });
  }

  return { start, stop };
}

module.exports = { createLocalGateway, isLoopback };
