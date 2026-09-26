# TV Pro playback investigation (September 2026)

The app ships in this repo only as a compiled Next.js export, so every fix below is a targeted patch to the built
bundle (`_next/static/chunks/app/page-*.js`) plus the gateway sources. The IPTV panel itself could not be reached
from the build environment. Evidence comes from:
- the minified player code,
- two diagnostic reports taken on the user's iPhone against the real panel,
- a local end-to-end reproduction: the real bundle in Chromium, a mock Xtream panel, and the real gateway code
  (`tests/e2e/playback.e2e.mjs`).

## Request chain (what actually happens)

TV Pro (https) → Xtream `player_api.php` (library, through a gateway because the panel is plain http)
→ stream URL `http://PANEL/live/USER/PASS/ID.m3u8` (movies: `/movie/…/ID.<container_extension>`, episodes: `/series/…/EPISODE_ID.<container_extension>`)
→ gateway `/proxy?url=…` (mixed content forces a gateway for http panels on an https page)
→ panel answers `302` to a **bare-IP edge** (`http://103.163.132.49/hls/<token>/…`)
→ gateway rewrites the playlist so every segment/key/variant goes back through the same gateway
→ Safari native HLS (iPhone) or hls.js (other browsers).

## Root causes found (with evidence)

| # | Cause | Evidence | Owner |
|---|---|---|---|
| 1 | **Request amplification against a 1-connection subscription.** Before every play the app probed gateways (full playlist + segment fetch = a real provider session) *while the previous channel was still playing*, then played (2nd session). On failure it rotated through all gateways and then retried 4× with backoff, and hls.js retried the playlist once more per attempt. Before PR #10 the probe hit all 4 gateways **in parallel from 4 different IPs**. | E2E with the previously deployed bundle: successful play = **2** provider sessions; provider 403 = **12** attempts; upstream timeout = **20** attempts; MKV on iPhone = 2 requests for a file that cannot play. Account reports `max_connections=1`. | TV Pro |
| 2 | **Cloudflare gateways cannot reach this provider.** The panel redirects to a bare IP; Cloudflare Workers refuse bare-IP subrequests (error 1003). The stale saved `proxyUrl` (old default `gateway.tv-pro.app`) kept Cloudflare **first** even after the list was reordered. | Diagnostic report: both Cloudflare gateways → `403 error code: 1003`; Deno gateway → playlist 200 + 8.7 MB MPEG-TS segment. Code: gateway list was `[settings.proxyUrl ?? remembered, ...list]`. | TV Pro config / Cloudflare platform limit |
| 3 | **Provider refusal.** At 21:41 the panel answered the stream request with the literal body `Blocked` (HTTP 200) while `player_api` reported the account `Active`, `0/1` connections. | Diagnostic report (the old Deno gateway rewrote `Blocked` into a fake segment URL, which is how the body became visible). The earlier stream at 20:22 through the same gateway worked. | Provider (plausibly triggered by #1: many sessions from several data-centre IPs in a short time) |
| 4 | **Containers the browser cannot play** (MKV/AVI, some HEVC) were attempted through the gateways before failing. | Safari has no Matroska support. The files played in Infuse. E2E: 2 wasted requests per MKV on iPhone. | Browser limitation (TV Pro wasted connections on it) |
| 5 | **Refusals were retried everywhere.** A 403/401 from the provider went to the next gateway (a new IP) instead of stopping. | Code: rotation set included `unavailable` (HTTP ≥ 400). | TV Pro |

Not a cause: URL construction. Movies use `container_extension`, episodes use their own id plus `container_extension`,
and live uses `.m3u8`, which this account allows (`allowed_output_formats = m3u8, ts, rtmp`). `direct_source` is not
used, which is correct for Xtream panels.

## Fixes

**Player (page bundle).**
- No pre-play probe; the first attempt is the real one.
- Gateway order: the gateway that last played successfully, then Deno (`great-fox`, `rmz`), then Cloudflare. The stale saved `proxyUrl` no longer overrides it.
- **Hard budget of 3 stream attempts per play.** hls.js manifest auto-retry is off; the player's budget decides.
- A 4xx from the provider ends the attempt: no gateway rotation, no retry. Only transport errors are retried, once.
- On Safari/iPhone, MKV/AVI/WMV/FLV go straight to the external-player offer with **zero** provider requests.
- Every stream request and failure is logged (redacted) to `localStorage["tvpro:playdiag"]` and classified
  (`UPSTREAM_401/403/404/429/5XX`, `UPSTREAM_TIMEOUT`, `NO_DATA_TIMEOUT`, `HLS_MANIFEST_INVALID`, `HLS_SEGMENT_FAILURE`,
  `UNSUPPORTED_CONTAINER`, `UNSUPPORTED_CODEC`, `MIXED_CONTENT`, `DIRECT_CORS_OR_NETWORK`, `GATEWAY_FAILURE`, …).
  With developer mode on, the error screen shows the classification.
- After a failure: one `player_api.php` call (no stream session) turns it into `AUTH_FAILED`, `ACCOUNT_<STATUS>` or
  `CONNECTION_LIMIT` with a clear message. Nothing is claimed without that evidence.
- VLC/Infuse panel on every playback error. Before handing off, the page's video is stopped so the single connection is free.
- iPhone: one tap on fullscreen or Picture in Picture works even while the controls are auto-hidden.

**Gateway v5 (`cloudflare-worker.js`, `tvpro-gateway-deno.ts`, one shared core).**
- GET/HEAD (HEAD served from GET), Range → 206 with Content-Range/Accept-Ranges/Content-Length.
- Manual redirects: every hop is SSRF-checked; relative URIs resolve against the final URL.
- Playlists are detected by content and rewritten (segments, keys, maps, variants; query tokens kept). Media always streams: a live `.ts` or a movie is never buffered.
- A 15 s header timeout, plus `X-TVPro-Error` / `X-TVPro-Upstream-Status` on every failure.
- Refusal bodies (`Blocked`, expired, …) become **403** (`UPSTREAM_BLOCKED`, `UPSTREAM_REFUSED`), so they are not retried through other gateways.
- Crash-proof wrapper: CORS is always present. An opaque "Load failed" can no longer come from the gateway code.
- Cloudflare fails fast on bare-IP or non-standard-port targets (`GATEWAY_UNSUPPORTED_TARGET` / `_PORT`) instead of 1003.
- Security kept: private, loopback, link-local, metadata and IPv6-local targets are blocked, including after redirects; `file:` and credentials-in-URL are refused; there is a per-IP rate limit (Deno); target URLs are never logged.

**diag.html.** Shows the subscription status first. It opens **no** stream when the connections are full or the account is inactive, tests one route at a time and stops at the first that works, shows the gateway's error code and upstream status, and includes the app's recent playback log. All credentials are redacted.

## Tests

- `node --test tests/gateway.test.mjs`: 66 gateway tests (both builds). They cover live HLS with redirects, relative URIs,
  keys, nested playlists, `.m3u8`→`.ts`, endless streams, text/plain playlists, MP4 Range/206, MKV streaming, HEAD,
  401/403/404/429/5xx, `Blocked`, expired HTML, empty body, timeout, connection reset, SSRF (8 targets and redirects),
  redirect loops, Cloudflare bare-IP and port limits, and the crash wrapper.
- `TVPRO_MEDIA=<dir> node tests/e2e/playback.e2e.mjs`: 12 end-to-end scenarios against the real bundle
  (see the file header for the media needed). Results after the fix:
  - live play = **1** provider session through Deno, and Cloudflare is never tried;
  - a channel switch leaves 0 requests to the old channel;
  - `Blocked` = 1 attempt, classified `UPSTREAM_403`, with no credentials in the log, UI or console;
  - connection limit = 1 attempt plus the provider's own `1/1` message;
  - timeout = 3 attempts;
  - MP4 movie and series episode play (URLs built from `container_extension`);
  - MKV on iPhone = 0 provider requests plus the VLC/Infuse offer;
  - gateways down = 3 attempts, classified;
  - wrong password stays on the login screen;
  - an HTTPS source with CORS plays directly with no gateway;
  - an HTTPS source refused by CORS makes one gateway fallback.

Not testable here: Safari's native HLS engine (no WebKit in the build environment) and the real panel.

## Remaining limits (outside TV Pro's control)

- Browsers cannot play MKV/AVI or some HEVC streams; those go to VLC/Infuse.
- A provider that blocks data-centre IPs, or limits the account to one connection, can refuse gateway traffic no matter what the app does. The new logging shows exactly when that happens (`UPSTREAM_BLOCKED` / `UPSTREAM_403` / `CONNECTION_LIMIT`).
- Cloudflare Workers can never reach bare-IP panels; only the Deno gateways serve this provider.
- `great-fox` runs an older gateway build, deployed from another Deno account. Pasting the new `tvpro-gateway-deno.ts` there adds the new error codes; it plays correctly as is. `rmz` redeploys from `main` automatically. The Cloudflare Worker needs `wrangler deploy` (or a paste in the dashboard).

## Demo library (7 channels · 7 movies · 7 series)

"Try the demo" builds the library on the viewer's device (`__tvproBuildDemo` in the page chunk). Every item is checked
before it is listed:
- **Channels:** the broadcasters' own free public streams (Al Arabiya, Al Hadath, Sky News Arabia, DW Arabic,
  France 24 Arabic, Red Bull TV, DW English, plus spares). Each playlist is fetched once, and the first 7 that answer are
  kept. Each channel has a generated SVG logo.
- **Movies:** public-domain classics from the Internet Archive (Night of the Living Dead, Charade, His Girl Friday,
  Nosferatu, The General, The Kid, The Little Shop of Horrors, plus spares), resolved to the item's H.264 MP4, with the
  Archive's artwork.
- **Series:** real public-domain TV series and cartoon series (Sherlock Holmes 1954, The Beverly Hillbillies, Bonanza,
  The Lone Ranger, Flash Gordon, The Cisco Kid, Popeye, plus spares). Each has up to 6 episodes, with artwork and
  thumbnails. Movies are never used as episodes.

Archive search/metadata requests go direct first and through a gateway if the browser can't read them (CORS). This is
why the first version found only 1 classic film: search from the phone failed. The old reference test streams (Akamai
test, Apple bip-bop, Mux, bitdash, Unified Streaming) did not play on the user's phone and were removed. An existing
demo library is upgraded automatically on the next visit (`demoVersion` 3). Tests: `tests/demo.test.mjs` (4) and the
demo e2e scenario (7/7/7, artwork, an episode plays, automatic upgrade).
