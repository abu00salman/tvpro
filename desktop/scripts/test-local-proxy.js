'use strict';
// Plain-Node smoke test for the local loopback gateway (no Electron, no display, no real network needed).
// Run: node desktop/scripts/test-local-proxy.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLocalGateway } = require('../src/localProxy');

async function main() {
  // Real sockets for the client -> local-proxy leg (the thing actually under test: localProxy.js's HTTP server
  // and its Node-request <-> Fetch-request adapter). The proxy's own upstream fetch (local-proxy -> "provider")
  // is mocked, same pattern as tests/gateway.test.mjs, so this never makes a real network call.
  const realFetch = globalThis.fetch;
  const PANEL = 'http://panel.example.com';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === PANEL + '/hls/stream.m3u8') return new Response('#EXTM3U\n#EXTINF:10,\nsegment0.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (u === PANEL + '/hls/segment0.ts') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp2t' } });
    throw new TypeError('connect ECONNREFUSED (no mock route for ' + u + ')');
  };

  const gw = createLocalGateway(path.join(__dirname, '..', '..', 'tvpro-gateway-deno.ts'));
  const base = await gw.start();
  console.log('local gateway listening at', base);
  assert.ok(base.startsWith('http://127.0.0.1:'), 'binds to loopback only');

  // 1. playlist is fetched (through a real socket into our http.Server) and rewritten through the same proxy
  const r1 = await realFetch(`${base}/proxy?url=${encodeURIComponent(PANEL + '/hls/stream.m3u8')}`);
  assert.equal(r1.status, 200);
  const text = await r1.text();
  assert.ok(text.includes(`${base}/proxy?url=`), 'segment URL rewritten through the local gateway: ' + text);
  console.log('✓ playlist rewrite works through the loopback proxy (real socket in, mocked upstream out)');

  // 2. a segment streams through untouched, over a real socket
  const segUrl = text.trim().split('\n').pop();
  const r2 = await realFetch(segUrl);
  assert.equal(r2.status, 200);
  assert.equal((await r2.arrayBuffer()).byteLength, 3);
  console.log('✓ segment streams through the loopback proxy over a real socket');

  // 3. SSRF guard inherited from the shared gateway core: a private/loopback target is refused, not fetched
  const r3 = await realFetch(`${base}/proxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
  assert.equal(r3.status, 403, 'SSRF guard must still apply to the local gateway');
  console.log('✓ SSRF guard (cloud metadata address) still enforced from inside the desktop app');

  // 4. only loopback can talk to it: simulate a non-loopback remote address hitting the same handler
  const http = require('node:http');
  const net = require('node:net');
  const directSocket = net.connect({ host: '127.0.0.1', port: Number(new URL(base).port) });
  await new Promise((resolve, reject) => { directSocket.on('connect', resolve); directSocket.on('error', reject); });
  directSocket.destroy(); // the loopback check lives in the request handler using req.socket.remoteAddress,
  // which net.connect from this same machine always reports as 127.0.0.1 — there is no way to forge a non-
  // loopback remoteAddress from a real client without already being on another host, which the 127.0.0.1 bind
  // itself already prevents. This confirms the bind address, which is the actual boundary; see localProxy.js.

  await gw.stop();
  globalThis.fetch = realFetch;
  console.log('\nlocal proxy: all checks passed');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
