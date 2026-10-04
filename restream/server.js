'use strict';
/**
 * TV Pro — optional FFmpeg restream fallback.
 *
 * Last tier in DIRECT -> PROXY -> RESTREAM. Only reached when a movie/episode fails in the browser with an
 * UNSUPPORTED_CONTAINER/CODEC classification (see the bundle patch this ships with) -- never for live channels,
 * since holding an ffmpeg process open against a source is a second continuous connection to the provider, and
 * this project's one hard rule (learned the hard way, see PLAYBACK-INVESTIGATION.md) is: never open an extra
 * connection a user didn't ask for on a subscription that may allow only one. A one-shot VOD remux is safe;
 * babysitting a live feed indefinitely is not, so this server intentionally only remuxes on-demand files.
 *
 * What it does: ffmpeg remuxes (NOT re-encodes — `-c copy`, same video/audio bytes, just a container/packaging
 * browsers understand) a source the browser's own demuxer rejected (classic case: MKV) into HLS, and serves that
 * HLS locally. This is deliberately NOT bundled into the Cloudflare Worker or the Deno gateway: neither can run a
 * real ffmpeg process (no persistent runtime, no binary access, strict CPU/time limits) -- this is designed to
 * run on your own Docker host / VPS / Railway / Render, completely separate from Cloudflare (which keeps doing
 * what it already does: the domain, TLS, and the website itself).
 *
 * NOT reachable from the public internet by default behavior alone: run it behind your own auth/firewalling if
 * you expose it beyond localhost. This file does not implement end-user authentication.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 8787);
const MAX_CONCURRENT = Number(process.env.RESTREAM_MAX_CONCURRENT || 2);
const SESSION_IDLE_MS = Number(process.env.RESTREAM_IDLE_MS || 5 * 60 * 1000); // kill ffmpeg 5 min after last segment request
const STORAGE_ROOT = process.env.RESTREAM_STORAGE || path.join(os.tmpdir(), 'tvpro-restream');
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

// ---------------------------------------------------------------- SSRF/host validation ----
// tvpro-gateway-deno.ts's own isBlockedHost()/validateTarget() aren't exported (only its {fetch} handler is), so
// true reuse (the pattern used in desktop/src/localProxy.js, which only needed the handler itself) isn't
// available here. This is a deliberately small, independent reimplementation of the same private/loopback/
// metadata-address blocklist, not a fork of that file's logic.
async function isTargetAllowed(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b] = m.slice(1, 3).map(Number);
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
    }
    if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- sessions ----
const sessions = new Map(); // id -> { dir, proc, lastAccess, idleTimer }

function redact(u) {
  try { return new URL(u).host; } catch { return '***'; }
}

function startSession(sourceUrl) {
  const id = crypto.randomBytes(12).toString('hex');
  const dir = path.join(STORAGE_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const playlist = path.join(dir, 'index.m3u8');
  const args = [
    '-nostdin', '-loglevel', 'error', '-y',
    '-i', sourceUrl,
    '-c', 'copy', // remux only: same video/audio bytes, just repackaged into HLS. No re-encode, minimal CPU.
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    playlist,
  ];
  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderrTail = '';
  proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
  proc.on('exit', (code) => {
    const s = sessions.get(id);
    if (s) s.exitCode = code;
    if (code !== 0) console.warn('[restream] ffmpeg exited', code, 'for session', id, '(source host:', redact(sourceUrl) + ')', stderrTail ? '-- ' + stderrTail.split('\n').slice(-3).join(' | ') : '');
  });
  const session = { id, dir, proc, lastAccess: Date.now(), idleTimer: null, exitCode: null, playlist };
  const checkInterval = Math.max(1000, Math.min(30000, Math.floor(SESSION_IDLE_MS / 3)));
  session.idleTimer = setInterval(() => {
    if (Date.now() - session.lastAccess > SESSION_IDLE_MS) stopSession(id);
  }, checkInterval);
  sessions.set(id, session);
  return session;
}

function stopSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  clearInterval(s.idleTimer);
  try { s.proc.kill('SIGTERM'); } catch { /* already dead */ }
  sessions.delete(id);
  fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

process.on('SIGTERM', () => { for (const id of sessions.keys()) stopSession(id); process.exit(0); });
process.on('SIGINT', () => { for (const id of sessions.keys()) stopSession(id); process.exit(0); });

// ---------------------------------------------------------------- HTTP ----
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { json(res, 404, { error: 'not_found' }); return; }
    res.writeHead(200, { 'content-type': contentType, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');

  if (url.pathname === '/health') return json(res, 200, { ok: true, sessions: sessions.size, maxConcurrent: MAX_CONCURRENT });

  if (url.pathname === '/restream/start' && req.method === 'GET') {
    const source = url.searchParams.get('url');
    if (!source) return json(res, 400, { error: 'missing url' });
    if (!(await isTargetAllowed(source))) return json(res, 403, { error: 'blocked target' });
    if (sessions.size >= MAX_CONCURRENT) return json(res, 503, { error: 'restream_busy', max: MAX_CONCURRENT });
    const session = startSession(source);
    // Give ffmpeg a moment to write the first segments before telling the player to fetch the playlist.
    const deadline = Date.now() + 15000;
    (function waitForPlaylist() {
      if (fs.existsSync(session.playlist)) return json(res, 200, { id: session.id, playlistUrl: `/restream/${session.id}/index.m3u8` });
      if (session.exitCode != null) return json(res, 502, { error: 'ffmpeg_failed', code: session.exitCode });
      if (Date.now() > deadline) return json(res, 504, { error: 'timeout_starting_restream' });
      setTimeout(waitForPlaylist, 300);
    })();
    return;
  }

  const m = /^\/restream\/([a-f0-9]{24})\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
  if (m && req.method === 'GET') {
    const [, id, file] = m;
    const session = sessions.get(id);
    if (!session) return json(res, 404, { error: 'unknown_session' });
    session.lastAccess = Date.now();
    const filePath = path.join(session.dir, file);
    if (!filePath.startsWith(session.dir)) return json(res, 403, { error: 'forbidden' });
    const ct = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
    return serveFile(res, filePath, ct);
  }

  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`TV Pro restream server listening on :${PORT} (max ${MAX_CONCURRENT} concurrent, idle timeout ${SESSION_IDLE_MS / 1000}s)`));
