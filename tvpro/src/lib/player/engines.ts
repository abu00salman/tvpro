import type Hls from 'hls.js';
import type { ErrorData, Level } from 'hls.js';
import type { EngineOptions, PlaybackEngine, PlaybackErrorKind, PlaybackSource, TrackOption } from './types';

const HLS_RE = /\.m3u8?(\?|#|$)|[?&/]m3u8/i;
const FILE_RE = /\.(mp4|m4v|webm|mov|mkv|avi|mp3|aac|ogg)(\?|#|$)/i;

const isApplePlatform = (): boolean =>
  typeof navigator !== 'undefined' && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

const qualityLabel = (l: Level): string =>
  l.height >= 2160 ? '4K' : l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`;

/** Warm the hls.js chunk (code only — no stream data is requested). */
export const preloadHls = (): void => void import('hls.js');

/* ───────────────────────────── Native engine ───────────────────────────── */

interface NativeAudioTrack { enabled: boolean; label: string; language: string }
interface NativeAudioTrackList { length: number; [index: number]: NativeAudioTrack }
type VideoWithAudioTracks = HTMLVideoElement & { audioTracks?: NativeAudioTrackList };

class NativeEngine implements PlaybackEngine {
  readonly name = 'native' as const;
  private readonly onError: () => void;
  private readonly onMeta: () => void;

  constructor(private video: VideoWithAudioTracks, source: PlaybackSource, private opts: EngineOptions) {
    this.onError = () => {
      const code = video.error?.code;
      const kind: PlaybackErrorKind = code === 2 ? 'network' : code === 3 ? 'decode' : code === 4 ? 'format' : 'unavailable';
      opts.onFatal(kind, `MediaError ${code ?? '?'}: ${video.error?.message ?? ''}`);
    };
    this.onMeta = () => {
      if (source.startAt && Number.isFinite(video.duration)) video.currentTime = source.startAt;
      opts.onTracksChanged();
    };
    video.addEventListener('error', this.onError);
    video.addEventListener('loadedmetadata', this.onMeta);
    video.src = source.url;
    video.load();
    void video.play().catch(() => undefined);
  }

  destroy(): void {
    this.video.removeEventListener('error', this.onError);
    this.video.removeEventListener('loadedmetadata', this.onMeta);
    this.video.removeAttribute('src');
    this.video.load(); // releases the network connection and decoder
  }

  getQualities(): TrackOption[] { return []; }
  getQuality(): number { return -1; }
  setQuality(): void { /* the platform player adapts on its own */ }

  getAudioTracks(): TrackOption[] {
    const list = this.video.audioTracks;
    if (!list || list.length < 2) return [];
    return Array.from({ length: list.length }, (_, i) => ({ id: i, label: list[i].label || list[i].language || `Audio ${i + 1}` }));
  }
  getAudioTrack(): number {
    const list = this.video.audioTracks;
    if (!list) return -1;
    for (let i = 0; i < list.length; i++) if (list[i].enabled) return i;
    return -1;
  }
  setAudioTrack(id: number): void {
    const list = this.video.audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].enabled = i === id;
    this.opts.onTracksChanged();
  }

  private subtitles(): TextTrack[] {
    return Array.from(this.video.textTracks).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  }
  getTextTracks(): TrackOption[] {
    return this.subtitles().map((t, i) => ({ id: i, label: t.label || t.language || `Subtitles ${i + 1}` }));
  }
  getTextTrack(): number { return this.subtitles().findIndex((t) => t.mode === 'showing'); }
  setTextTrack(id: number): void {
    this.subtitles().forEach((t, i) => { t.mode = i === id ? 'showing' : 'disabled'; });
    this.opts.onTracksChanged();
  }
}

/* ───────────────────────────── hls.js engine ───────────────────────────── */

class HlsEngine implements PlaybackEngine {
  readonly name = 'hls.js' as const;
  private networkRecoveries = 0;
  private mediaRecoveries = 0;

  constructor(private hls: Hls, HlsLib: typeof Hls, video: HTMLVideoElement, source: PlaybackSource, private opts: EngineOptions) {
    const { Events, ErrorTypes } = HlsLib;

    hls.on(Events.MANIFEST_PARSED, () => {
      const ceiling = opts.quality;
      if (ceiling !== 'auto') {
        // Treat the user's default quality as a ceiling; ABR still works below it.
        const cap = hls.levels.reduce((best, l, i) => (l.height && l.height <= ceiling && (best < 0 || l.height >= hls.levels[best].height) ? i : best), -1);
        if (cap >= 0) hls.autoLevelCapping = cap;
      }
      opts.onTracksChanged();
      void video.play().catch(() => undefined);
    });
    hls.on(Events.LEVEL_SWITCHED, opts.onTracksChanged);
    hls.on(Events.AUDIO_TRACKS_UPDATED, opts.onTracksChanged);
    hls.on(Events.SUBTITLE_TRACKS_UPDATED, opts.onTracksChanged);

    hls.on(Events.ERROR, (_e, data: ErrorData) => {
      if (!data.fatal) return;
      const detail = `${data.type} · ${data.details}${data.response?.code ? ` · HTTP ${data.response.code}` : ''}`;
      if (data.type === ErrorTypes.MEDIA_ERROR && this.mediaRecoveries++ < 2) return hls.recoverMediaError();
      if (data.type === ErrorTypes.NETWORK_ERROR) {
        const manifest = /manifest/i.test(data.details);
        if (!manifest && this.networkRecoveries++ < 1) return hls.startLoad();
        const code = data.response?.code ?? 0;
        if (manifest && /parsing/i.test(data.details)) return opts.onFatal('format', detail);
        return opts.onFatal(code >= 400 ? 'unavailable' : manifest ? 'network' : 'interrupted', detail);
      }
      opts.onFatal(data.type === ErrorTypes.MEDIA_ERROR ? 'decode' : 'format', detail);
    });

    // Order matters for startup time: attach first, then request the manifest immediately.
    hls.attachMedia(video);
    hls.loadSource(source.url);
  }

  destroy(): void { this.hls.destroy(); }

  getQualities(): TrackOption[] {
    // Several renditions can share a height; keep the best one per label.
    const byLabel = new Map<string, number>();
    this.hls.levels.forEach((l, i) => byLabel.set(qualityLabel(l), i));
    return Array.from(byLabel, ([label, id]) => ({ id, label })).sort((a, b) => b.id - a.id);
  }
  getQuality(): number { return this.hls.autoLevelEnabled ? -1 : this.hls.currentLevel; }
  setQuality(id: number): void {
    if (id === -1) this.hls.autoLevelCapping = -1;
    this.hls.currentLevel = id; // immediate switch (flushes buffer) — feels instant
    this.opts.onTracksChanged();
  }

  getAudioTracks(): TrackOption[] {
    const tracks = this.hls.audioTracks;
    return tracks.length < 2 ? [] : tracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Audio ${i + 1}` }));
  }
  getAudioTrack(): number { return this.hls.audioTrack; }
  setAudioTrack(id: number): void { this.hls.audioTrack = id; }

  getTextTracks(): TrackOption[] {
    return this.hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Subtitles ${i + 1}` }));
  }
  getTextTrack(): number { return this.hls.subtitleDisplay ? this.hls.subtitleTrack : -1; }
  setTextTrack(id: number): void {
    this.hls.subtitleDisplay = id >= 0;
    this.hls.subtitleTrack = id;
    this.opts.onTracksChanged();
  }
}

/* ───────────────────────────── Engine selection ───────────────────────────── */

export async function createEngine(video: HTMLVideoElement, source: PlaybackSource, opts: EngineOptions): Promise<PlaybackEngine> {
  const looksLikeFile = FILE_RE.test(source.url);
  const looksLikeHls = HLS_RE.test(source.url) || (source.live && !looksLikeFile);
  if (!looksLikeHls || opts.forceNative) return new NativeEngine(video, source, opts);

  const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
  const preferNative = opts.preference === 'native' || (opts.preference === 'auto' && isApplePlatform());
  if (nativeHls && preferNative) return new NativeEngine(video, source, opts);

  const HlsLib = (await import('hls.js')).default;
  if (!HlsLib.isSupported()) return new NativeEngine(video, source, opts); // e.g. iPhone: native HLS only

  const hls = new HlsLib({
    enableWorker: true,
    lowLatencyMode: source.live,
    startFragPrefetch: true,          // fetch the first segment while the playlist is still being handled
    capLevelToPlayerSize: true,       // don't pull 4K into a small player
    startPosition: source.startAt ?? -1,
    maxBufferLength: source.live ? 12 : 30,
    maxMaxBufferLength: source.live ? 30 : 120,
    backBufferLength: source.live ? 10 : 60,
    manifestLoadingTimeOut: 8000,
    manifestLoadingMaxRetry: 1,
    levelLoadingTimeOut: 8000,
    fragLoadingTimeOut: 15000,
  });
  return new HlsEngine(hls, HlsLib, video, source, opts);
}
