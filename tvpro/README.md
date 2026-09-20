# TV Pro — Watch Simply.

A premium, privacy-first **media player** for the web. TV Pro plays the streaming sources *you* provide
(M3U URL, server login, or an uploaded M3U file). It ships with **no channels, playlists or servers**.

> TV Pro does not provide, host, sell, or distribute TV channels, movies, playlists, or streaming content.
> Users must provide their own authorized streaming sources.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in ./out
```

Requires Node 18.17+. The build is a **fully static export** — upload `out/` to any static host
(GitHub Pages, Cloudflare Pages, Netlify, Nginx…). No server, no database, no accounts.

**GitHub Pages under a sub-path** (`user.github.io/repo`): build with
`NEXT_PUBLIC_BASE_PATH=/repo npm run build`. With a custom domain no variable is needed.
Add an empty `out/.nojekyll` file so Pages serves the `_next` folder (already included in the packaged build).

## Stack

Next.js 14 (App Router, static export) · React 18 · TypeScript `strict` (no `any`) · Tailwind CSS · hls.js.
No state library, no UI kit, no analytics. First load ≈ 120 kB; every screen is its own lazy chunk; hls.js loads only when needed.

## Project map

```
src/
  app/            layout (CSP, no-flash theme script, fonts), page (router + lazy screens), globals.css (design tokens)
  components/
    player/       Player, PlayerMenu (quality/audio/subtitles/speed), overlays, Watch (VOD full window)
    channels/     LiveTV (Categories | Channels | Player), ChannelRow
    movies/ series/ home/ favorites/ search/ epg/ playlists/ settings/ onboarding/ navigation/ system/ ui/
  lib/
    player/       playback abstraction: controller (retry/backoff, tokens), engines (HLS.js + native), Media Session
    m3u/          tolerant single-pass M3U parser (channels / movies / SxxExx episodes)
    iptv/         importer, server-login API client, http (timeouts, gzip), worker client, demo library
    epg/          XMLTV parser (rolling window)          search/   normalised + fuzzy index (Arabic aware)
    security/     URL validation (SSRF rules), text sanitising, credential vault (AES-GCM)
    storage/      IndexedDB (playlists, libraries, kv) + localStorage (small settings only)
    navigation/   geometric D-pad / remote focus         i18n/     en + ar dictionaries, typed keys
  workers/        library.worker — M3U and XMLTV parsing off the main thread
  store/          tiny external store (useSyncExternalStore): app state + EPG
  hooks/  types/
public/           manifest, sw.js (offline shell), icons
```

### How the important parts work

- **Instant zapping.** One `<video>` element and one controller live for the whole session. Changing channel only swaps
  the source: the previous engine is destroyed, a load token cancels stale work, the OSD banner shows the channel number,
  the UI never re-mounts. hls.js is pre-warmed when Live TV opens. EPG loads later in idle time and never blocks playback.
- **Keys.** `Space/K` play · `F` full screen · `M` mute · `P` PiP · `↑ ↓` / `CH±` / `PgUp PgDn` zap · `L` previous channel ·
  `← →` seek (VOD) · `Esc` back. Arrows otherwise move focus geometrically, so TV remotes work everywhere (Tizen/webOS Back keys included).
- **Failure handling.** Network/media errors retry with exponential backoff (max 4), fall back to native HLS where it exists,
  then show a human sentence with *Retry* / *Back*. Going back online retries automatically. Technical detail appears only in Developer mode.
- **Big playlists.** Parsing happens in a Web Worker; lists and grids are virtualised (≈400 DOM nodes with 20,000 channels);
  search is debounced and indexed once. Tested: 20k channels + 3k movies + 1.2k episodes import in about a second.
- **Routing.** Hash routes (`#/live`, `#/movie/<id>`, `#/watch/…`) so the static build works on any host without rewrites.

## Privacy & security

- No analytics, no tracking, no third-party scripts. The only external request the shell makes is Google Fonts
  (self-host the fonts and drop `fonts.googleapis.com` / `fonts.gstatic.com` from the CSP if you want zero third parties).
- M3U URLs and server credentials are **AES-GCM encrypted** with a non-extractable WebCrypto key kept in IndexedDB.
  Passwords are never written to `localStorage`, never logged, never displayed in the Playlist Manager.
  Server-login items store stream *references*; the playable URL is built in memory at play time.
- Source URLs must be `http(s)`; `localhost`, private ranges, link-local and cloud-metadata hosts are rejected.
- CSP is set via `<meta>`; when you control the host, send the same policy as an HTTP header and add `frame-ancestors 'none'`.

## Browser limits you should know (they are not bugs)

1. **CORS.** A browser can only read a playlist/stream if the source sends `Access-Control-Allow-Origin`. Many IPTV
   sources don't. The app then says *"the source may not allow web players"*. Uploading the `.m3u` file avoids CORS for
   the playlist itself, but each stream still needs CORS for hls.js (Safari's native HLS does not).
2. **Mixed content.** On an `https://` site browsers block `http://` streams. TV Pro detects this and explains it.
3. **Formats.** Browsers play HLS (`.m3u8`), MP4/WebM. Raw MPEG-TS (`.ts`) and most `.mkv`/`.avi` VOD can't play; live `.ts`
   server URLs are automatically requested as `.m3u8`.

### Optional proxy (roadmap)
A small proxy solves 1 and 2. If you build one, keep the same rules as `src/lib/security/url.ts`: http/https only, resolve DNS
and block private/loopback/link-local/metadata IPs **after** resolution, re-check on redirects, cap response size and time,
forward no cookies, never log query strings (they carry credentials), rate-limit per IP.

## Demo mode

"Explore demo" loads a handful of public **test** streams (Big Buck Bunny, Sintel, Tears of Steel, vendor test patterns) and a
synthetic guide. To remove it: delete `src/lib/iptv/demo.ts`, the `demo` branch in `importer.ts`, and the button in `Onboarding.tsx`.

## Architecture-ready, not shipped in v1

Profiles and parental controls (PIN, locked categories, Kids mode): all per-user records are already namespaced by profile id and
`Profile` exists in `types/`. Catch-up/recording, cloud sync and Chromecast/AirPlay buttons are intentionally absent rather than faked.

## QA checklist used

RTL + LTR · long and mixed-direction names · missing logos/posters · 20k-channel playlist · invalid / private URL · broken stream →
retry → friendly error · previous channel · VOD resume · offline banner · light/dark/system without flash · keyboard-only and D-pad · 390 px → 2560 px.
Real-device checks still recommended: Safari iOS (native HLS, PiP), Samsung/LG TV browsers.
