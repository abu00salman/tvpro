import { createStore } from '@/store/createStore';
import type { EnginePreference, QualityPreference } from '@/types';
import { createEngine } from './engines';
import type { PlaybackEngine, PlaybackErrorKind, PlaybackSource, TrackOption } from './types';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'reconnecting' | 'error' | 'ended';

export interface PlayerState {
  status: PlayerStatus;
  error?: PlaybackErrorKind;
  errorDetail?: string;
  isLive: boolean;
  engine?: string;
  mode: 'direct' | 'compatibility';
  unstable: boolean;
  qualities: TrackOption[];
  quality: number;
  audioTracks: TrackOption[];
  audioTrack: number;
  textTracks: TrackOption[];
  textTrack: number;
}

const INITIAL: PlayerState = {
  status: 'idle', isLive: false, unstable: false, mode: 'direct',
  qualities: [], quality: -1, audioTracks: [], audioTrack: -1, textTracks: [], textTrack: -1,
};

declare global {
  interface Window {
    __tvproPrecheck?: (s: PlaybackSource) => string | undefined;
    __tvproDiagEvent?: (ev: string, err: string | null, detail: string | null | undefined, ctl: unknown) => void;
    __tvproClassify?: (kind: string, detail: string | undefined, ctl: unknown) => string;
    __tvproMarkGood?: (channelId?: string) => void;
  }
}

export const playerStore = createStore<PlayerState>(INITIAL);

/** Hard cap on start() calls per play (counts every internal fallback), so a dead source can never loop. */
const MAX_STARTS = 3;
const WATCHDOG_MS = 22_000;
const RETRYABLE: ReadonlySet<PlaybackErrorKind> = new Set(['network', 'interrupted', 'unavailable']);
const VIDEO_EVENTS = ['playing', 'pause', 'waiting', 'ended'] as const;

/**
 * Owns the single <video> element's lifecycle. Switching channel = swap the engine's source;
 * React never re-mounts the player. Every load gets a token so stale async work is discarded.
 */
class PlaybackController {
  private video: HTMLVideoElement | null = null;
  private engine: PlaybackEngine | null = null;
  private source: PlaybackSource | null = null;
  private token = 0;
  private attempts = 0;
  private triedNative = false;
  private triedHls = false;
  private fmtSwitched = false;
  private starts = 0;
  private gatewayIndex = -1;
  private hardErr: { kind: PlaybackErrorKind; detail?: string } | null = null;
  private autoStepped = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  /** Called with the gateway origin that just produced a working stream (lets the app remember it). */
  onGatewayWorked?: (origin: string) => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private stalls: number[] = [];
  private prefs: { engine: EnginePreference; quality: QualityPreference } = { engine: 'auto', quality: 'auto' };

  configure(prefs: { engine: EnginePreference; quality: QualityPreference }): void { this.prefs = prefs; }

  attach(video: HTMLVideoElement): void {
    this.video = video;
    VIDEO_EVENTS.forEach((e) => video.addEventListener(e, this.onVideoEvent));
    window.addEventListener('online', this.onOnline);
    if (this.source) void this.start();
  }

  detach(): void {
    this.stop();
    if (this.video) VIDEO_EVENTS.forEach((e) => this.video!.removeEventListener(e, this.onVideoEvent));
    window.removeEventListener('online', this.onOnline);
    this.video = null;
  }

  load(source: PlaybackSource): void {
    this.source = source;
    this.attempts = 0;
    this.starts = 0;
    this.triedNative = false;
    this.triedHls = false;
    this.fmtSwitched = false;
    this.hardErr = null;
    this.autoStepped = false;
    this.gatewayIndex = this.mustUseGateway(source) ? 0 : -1;
    this.stalls = [];
    if (this.video) void this.start();
  }

  /**
   * User-facing Retry (also fired when the browser comes back online). It advances to the NEXT gateway rather than
   * restarting at the first one: a gateway can be structurally unable to reach one channel's host (e.g. a platform
   * edge block that happens before our code runs), and restarting at index 0 would retry that same dead gateway forever.
   */
  retry(): void {
    const source = this.source;
    if (!source) return;
    this.starts = 0; this.hardErr = null; this.fmtSwitched = false; this.attempts = 0;
    this.triedNative = false; this.triedHls = false;
    if (this.mustUseGateway(source)) {
      const n = source.gatewayUrls?.length ?? 0;
      this.gatewayIndex = n ? (this.gatewayIndex + 1) % n : 0;
    } else this.gatewayIndex = -1;
    void this.start();
  }

  /** Plain-HTTP streams cannot be fetched by an HTTPS page, so they must go through a gateway. */
  private mustUseGateway(s: PlaybackSource): boolean {
    return !!s.gatewayUrls?.length && typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(s.url);
  }

  stop(): void {
    this.token++;
    this.clearTimers();
    this.destroyEngine();
    this.source = null;
    playerStore.set(INITIAL);
  }

  setQuality(id: number): void { this.engine?.setQuality(id); this.syncTracks(); }
  setAudioTrack(id: number): void { this.engine?.setAudioTrack(id); this.syncTracks(); }
  setTextTrack(id: number): void { this.engine?.setTextTrack(id); this.syncTracks(); }

  private async start(): Promise<void> {
    const video = this.video, source = this.source;
    if (!video || !source) return;
    const token = ++this.token;
    const hooks = typeof window !== 'undefined' ? window : undefined;

    const precheck = hooks?.__tvproPrecheck?.(source);
    if (precheck) {
      this.clearTimers(); this.destroyEngine();
      playerStore.set({ ...INITIAL, status: 'error', error: 'format', isLive: source.live, errorDetail: precheck });
      return;
    }
    this.clearTimers();
    this.destroyEngine();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      playerStore.set({ ...INITIAL, status: 'error', error: 'offline', isLive: source.live });
      return;
    }
    playerStore.set({
      ...INITIAL, status: this.attempts ? 'reconnecting' : 'loading', isLive: source.live,
      mode: this.gatewayIndex >= 0 ? 'compatibility' : 'direct',
    });

    const gw = this.gatewayIndex >= 0 ? source.gatewayUrls?.[this.gatewayIndex] : undefined;
    const effective: PlaybackSource = gw ? { ...source, url: gw, detectUrl: source.url } : source;
    this.starts++;
    hooks?.__tvproDiagEvent?.('request', null, null, this);

    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      const st = playerStore.get().status;
      if (st === 'loading' || st === 'reconnecting' || st === 'buffering') this.fail('network', 'no playback within budget');
    }, WATCHDOG_MS);

    try {
      const engine = await createEngine(video, effective, {
        preference: this.prefs.engine, quality: this.prefs.quality,
        forceNative: this.triedNative, forceHls: this.triedHls && !this.triedNative,
        onFatal: (kind, detail) => { if (token === this.token) this.fail(kind, detail); },
        onTracksChanged: () => { if (token === this.token) this.syncTracks(); },
      });
      if (token !== this.token) return engine.destroy(); // user already zapped away
      this.engine = engine;
      playerStore.set({ engine: engine.name });
    } catch (e) {
      if (token === this.token) this.fail('format', e instanceof Error ? e.message : String(e));
    }
  }

  private fail(kind: PlaybackErrorKind, detail?: string): void {
    const hooks = typeof window !== 'undefined' ? window : undefined;
    hooks?.__tvproDiagEvent?.('fail', kind, detail, this);
    if ((kind === 'format' || kind === 'decode') && !this.hardErr) this.hardErr = { kind, detail };
    const usedHls = this.engine?.name === 'hls.js';
    this.destroyEngine();

    const giveUp = (): void => {
      const k = this.hardErr?.kind ?? (navigator.onLine ? kind : 'offline');
      const d = this.hardErr ? this.hardErr.detail : detail;
      playerStore.set({
        status: 'error', error: navigator.onLine ? kind : 'offline',
        errorDetail: hooks?.__tvproClassify ? hooks.__tvproClassify(k, d, this) : detail,
      });
    };

    if (this.starts >= MAX_STARTS) return giveUp();
    // Unknown container: give the platform decoder one chance, then the other engine, before giving up.
    if (kind === 'format' && usedHls && !this.triedNative) { this.triedNative = true; return void this.start(); }
    if ((kind === 'format' || kind === 'decode') && !usedHls && !this.triedHls && !this.triedNative && this.source?.live) {
      this.triedHls = true; return void this.start();
    }

    const gateways = this.source?.gatewayUrls ?? [];
    // A provider-confirmed HTTP 4xx is never rotated away from: another gateway reaches the same refusing provider.
    const httpRefusal = /HTTP (4\d\d)/.test(String(detail ?? ''));
    const rotatable = RETRYABLE.has(kind) || ((kind === 'format' || kind === 'decode') && !this.fmtSwitched && (this.fmtSwitched = true));
    if (!httpRefusal && rotatable && this.gatewayIndex + 1 < gateways.length) {
      this.gatewayIndex++; this.attempts = 0; this.triedNative = false;
      return void this.start();
    }
    if (!httpRefusal && (kind === 'network' || kind === 'interrupted') && this.attempts < 1) {
      const delay = Math.min(1000 * 2 ** this.attempts, 8000) + Math.random() * 300;
      this.attempts++;
      playerStore.set({ status: 'reconnecting' });
      this.retryTimer = setTimeout(() => void this.start(), delay);
      return;
    }
    giveUp();
  }

  private syncTracks(): void {
    const e = this.engine;
    if (!e) return;
    playerStore.set({
      qualities: e.getQualities(), quality: e.getQuality(),
      audioTracks: e.getAudioTracks(), audioTrack: e.getAudioTrack(),
      textTracks: e.getTextTracks(), textTrack: e.getTextTrack(),
    });
  }

  private onVideoEvent = (event: Event): void => {
    const { status } = playerStore.get();
    if (status === 'error' || !this.source) return;
    switch (event.type) {
      case 'playing': {
        clearTimeout(this.watchdog);
        playerStore.set({ status: 'playing' });
        window.__tvproMarkGood?.(this.source.__chId);
        const gw = this.gatewayIndex >= 0 ? this.source.gatewayUrls?.[this.gatewayIndex] : undefined;
        if (gw) this.onGatewayWorked?.(new URL(gw).origin);
        // Only a stretch of healthy playback resets the retry budget — prevents endless loops.
        clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
          this.attempts = 0; this.starts = 0;
          playerStore.set({ unstable: false });
          if (this.autoStepped && this.engine) { this.engine.setQuality(-1); this.autoStepped = false; this.syncTracks(); }
        }, 15_000);
        break;
      }
      case 'pause':
        if (status !== 'reconnecting' && status !== 'loading') playerStore.set({ status: 'paused' });
        break;
      case 'waiting': {
        if (status === 'loading' || status === 'reconnecting') break;
        const now = Date.now();
        this.stalls = [...this.stalls.filter((t) => now - t < 30_000), now];
        const unstable = this.stalls.length >= 3;
        playerStore.set({ status: 'buffering', unstable });
        // Repeated stalls on an "auto" quality: step one rung down rather than keep rebuffering.
        if (unstable && !this.autoStepped && this.prefs.quality === 'auto' && this.engine) {
          const qs = this.engine.getQualities();
          if (qs.length > 1) {
            const cur = this.engine.getQuality();
            const idx = cur < 0 ? 0 : qs.findIndex((q) => q.id === cur);
            const next = idx >= 0 && idx + 1 < qs.length ? qs[idx + 1] : qs[qs.length - 1];
            if (next && next.id !== cur) { this.engine.setQuality(next.id); this.autoStepped = true; this.syncTracks(); }
          }
        }
        break;
      }
      case 'ended':
        playerStore.set({ status: 'ended' });
        break;
    }
  };

  private onOnline = (): void => {
    if (playerStore.get().status === 'error' && this.source) this.retry();
  };

  private destroyEngine(): void {
    clearTimeout(this.watchdog);
    this.engine?.destroy();
    this.engine = null;
  }

  private clearTimers(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.stableTimer);
  }
}

export const playback = new PlaybackController();
