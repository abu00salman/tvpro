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
  unstable: boolean;
  qualities: TrackOption[];
  quality: number;
  audioTracks: TrackOption[];
  audioTrack: number;
  textTracks: TrackOption[];
  textTrack: number;
}

const INITIAL: PlayerState = {
  status: 'idle', isLive: false, unstable: false,
  qualities: [], quality: -1, audioTracks: [], audioTrack: -1, textTracks: [], textTrack: -1,
};

export const playerStore = createStore<PlayerState>(INITIAL);

const MAX_RETRIES = 4;
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
    this.triedNative = false;
    this.stalls = [];
    if (this.video) void this.start();
  }

  retry(): void {
    if (!this.source) return;
    this.attempts = 0;
    void this.start();
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
    this.clearTimers();
    this.destroyEngine();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      playerStore.set({ ...INITIAL, status: 'error', error: 'offline', isLive: source.live });
      return;
    }
    playerStore.set({ ...INITIAL, status: this.attempts ? 'reconnecting' : 'loading', isLive: source.live });

    try {
      const engine = await createEngine(video, source, {
        preference: this.prefs.engine, quality: this.prefs.quality, forceNative: this.triedNative,
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
    const usedHls = this.engine?.name === 'hls.js';
    this.destroyEngine();
    // Unknown container: give the platform decoder one chance before giving up.
    if (kind === 'format' && usedHls && !this.triedNative) {
      this.triedNative = true;
      return void this.start();
    }
    if (RETRYABLE.has(kind) && this.attempts < MAX_RETRIES) {
      const delay = Math.min(1000 * 2 ** this.attempts, 8000) + Math.random() * 300;
      this.attempts++;
      playerStore.set({ status: 'reconnecting' });
      this.retryTimer = setTimeout(() => void this.start(), delay);
      return;
    }
    playerStore.set({ status: 'error', error: navigator.onLine ? kind : 'offline', errorDetail: detail });
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
      case 'playing':
        playerStore.set({ status: 'playing' });
        // Only a stretch of healthy playback resets the retry budget — prevents endless loops.
        clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => { this.attempts = 0; playerStore.set({ unstable: false }); }, 15_000);
        break;
      case 'pause':
        if (status !== 'reconnecting' && status !== 'loading') playerStore.set({ status: 'paused' });
        break;
      case 'waiting': {
        if (status === 'loading' || status === 'reconnecting') break;
        const now = Date.now();
        this.stalls = [...this.stalls.filter((t) => now - t < 30_000), now];
        playerStore.set({ status: 'buffering', unstable: this.stalls.length >= 3 });
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
    this.engine?.destroy();
    this.engine = null;
  }

  private clearTimers(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.stableTimer);
  }
}

export const playback = new PlaybackController();
