// Plain-Node smoke test for the restream HTTP server, using a fake "ffmpeg" (a tiny shell script that writes a
// minimal real HLS playlist+segment, the same files a real ffmpeg -c copy -f hls run would produce) so this
// proves the server's own logic (session lifecycle, SSRF guard, file serving, idle cleanup) without needing a
// real ffmpeg binary or a real video source. Run: node restream/test-server.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'tvpro-restream-test-'));
const fakeFfmpeg = path.join(dir, 'ffmpeg');
// Mimics real ffmpeg's -hls_segment_filename/-output argument positions closely enough for this server (it only
// cares about the playlist path, the last argument) and writes real, valid-looking HLS output.
writeFileSync(fakeFfmpeg, `#!/bin/sh
for out in "$@"; do :; done
outdir=$(dirname "$out")
cat > "$outdir/seg00000.ts" <<'EOF'
fake-ts-bytes
EOF
cat > "$out" <<'EOF'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
seg00000.ts
#EXT-X-ENDLIST
EOF
sleep 2
`);
chmodSync(fakeFfmpeg, 0o755);

const port = 18787 + Math.floor(Math.random() * 1000);
const env = { ...process.env, PORT: String(port), FFMPEG_PATH: fakeFfmpeg, RESTREAM_MAX_CONCURRENT: '1', RESTREAM_IDLE_MS: '1500' };
const server = spawn(process.execPath, [path.join(import.meta.dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => process.env.DEBUG && console.log('[server]', d.toString().trim()));

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start in time')), 5000);
  server.stdout.on('data', (d) => { if (d.toString().includes('listening')) { clearTimeout(t); resolve(); } });
});

const base = `http://127.0.0.1:${port}`;

// 1. health check
{
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  console.log('✓ /health responds');
}

// 2. SSRF guard: a private/loopback/metadata target is refused before ffmpeg ever runs
{
  const r = await fetch(`${base}/restream/start?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
  assert.equal(r.status, 403);
  console.log('✓ SSRF guard blocks a cloud metadata target');
}
{
  const r = await fetch(`${base}/restream/start?url=${encodeURIComponent('http://127.0.0.1:9999/x')}`);
  assert.equal(r.status, 403);
  console.log('✓ SSRF guard blocks a loopback target');
}

// 3. a real start: fake ffmpeg writes a real playlist, server waits for it and returns a URL
{
  const r = await fetch(`${base}/restream/start?url=${encodeURIComponent('http://panel.example.com/movie/u/p/1.mkv')}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.id && j.playlistUrl);
  console.log('✓ /restream/start returns a session once the playlist file exists:', j.playlistUrl);

  // 4. the playlist and segment are actually servable, with the right content-type and CORS header
  const pr = await fetch(base + j.playlistUrl);
  assert.equal(pr.status, 200);
  assert.equal(pr.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  assert.equal(pr.headers.get('access-control-allow-origin'), '*');
  const playlist = await pr.text();
  assert.ok(playlist.includes('seg00000.ts'));
  console.log('✓ playlist is servable with the right content-type and CORS header');

  const sr = await fetch(`${base}/restream/${j.id}/seg00000.ts`);
  assert.equal(sr.status, 200);
  assert.equal(sr.headers.get('content-type'), 'video/mp2t');
  console.log('✓ segment is servable');

  // 5. path traversal is refused
  const tr = await fetch(`${base}/restream/${j.id}/..%2Fserver.js`);
  assert.notEqual(tr.status, 200);
  console.log('✓ path traversal attempt refused');
}

// 6. a second concurrent session is refused once RESTREAM_MAX_CONCURRENT is reached
{
  const r = await fetch(`${base}/restream/start?url=${encodeURIComponent('http://panel.example.com/movie/u/p/2.mkv')}`);
  assert.equal(r.status, 503);
  console.log('✓ concurrency cap (RESTREAM_MAX_CONCURRENT=1) enforced');
}

// 7. idle cleanup: wait past RESTREAM_IDLE_MS and confirm the session is gone
await new Promise((r) => setTimeout(r, 2200));
{
  const r = await fetch(`${base}/health`);
  const j = await r.json();
  assert.equal(j.sessions, 0, 'idle session should have been cleaned up');
  console.log('✓ idle session auto-stopped after RESTREAM_IDLE_MS');
}

server.kill('SIGTERM');
console.log('\nrestream server: all checks passed');
