import type { EnginePreference, QualityPreference } from '@/types';

export type PlaybackErrorKind = 'unavailable' | 'network' | 'format' | 'decode' | 'interrupted' | 'offline';

export interface PlaybackSource {
  url: string;
  live: boolean;
  /** Resume position in seconds (recorded content only). */
  startAt?: number;
}

export interface TrackOption {
  id: number;
  label: string;
}

export interface EngineOptions {
  preference: EnginePreference;
  quality: QualityPreference;
  forceNative?: boolean;
  onFatal: (kind: PlaybackErrorKind, detail?: string) => void;
  onTracksChanged: () => void;
}

/**
 * Playback abstraction. The UI and controller only ever talk to this interface, so new
 * engines (DASH, WebRTC, a native TV player bridge…) can be added without touching the UI.
 * `-1` always means "auto" for quality and "off" for text tracks.
 */
export interface PlaybackEngine {
  readonly name: 'hls.js' | 'native';
  destroy(): void;
  getQualities(): TrackOption[];
  getQuality(): number;
  setQuality(id: number): void;
  getAudioTracks(): TrackOption[];
  getAudioTrack(): number;
  setAudioTrack(id: number): void;
  getTextTracks(): TrackOption[];
  getTextTrack(): number;
  setTextTrack(id: number): void;
}
