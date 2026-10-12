/** TV Pro domain model. Everything the UI renders is described here. */

export type PlaylistType = 'm3u-url' | 'm3u-file' | 'xtream' | 'demo';
export type ItemKind = 'channel' | 'movie' | 'series';

/** AES-GCM payload produced by lib/security/vault. */
export interface EncryptedBlob {
  iv: ArrayBuffer;
  data: ArrayBuffer;
}

export interface Playlist {
  id: string;
  name: string;
  type: PlaylistType;
  createdAt: number;
  updatedAt: number;
  counts: { channels: number; movies: number; series: number };
  /** Encrypted source (M3U URL or server credentials). Never stored in plain text. */
  secret?: EncryptedBlob;
  epgUrl?: string;
}

/** Decrypted shape of Playlist.secret. Lives in memory only. */
export type PlaylistSecret =
  | { type: 'm3u-url'; url: string }
  | { type: 'xtream'; server: string; username: string; password: string };

/** Reference to a server-side stream; the playable URL is built at play time. */
export interface XtreamRef {
  kind: 'live' | 'movie' | 'series';
  id: string;
  ext: string;
}

interface BaseItem {
  id: string;
  playlistId: string;
  name: string;
  group: string;
  logo?: string;
  url?: string;
  xt?: XtreamRef;
}

export interface Channel extends BaseItem {
  kind: 'channel';
  number: number;
  tvgId?: string;
}

export interface Movie extends BaseItem {
  kind: 'movie';
  year?: number;
  rating?: number;
  /** seconds */
  duration?: number;
  plot?: string;
  genre?: string;
  backdrop?: string;
  addedAt?: number;
}

export interface Episode {
  id: string;
  season: number;
  number: number;
  title: string;
  url?: string;
  xt?: XtreamRef;
  thumbnail?: string;
  duration?: number;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface Series {
  kind: 'series';
  id: string;
  playlistId: string;
  name: string;
  group: string;
  logo?: string;
  seasons: Season[];
  plot?: string;
  year?: number;
  rating?: number;
  genre?: string;
  backdrop?: string;
  addedAt?: number;
  /** Set when seasons must be fetched lazily from the server. */
  xtSeriesId?: string;
}

export type LibraryItem = Channel | Movie | Series;

export interface Library {
  playlistId: string;
  channels: Channel[];
  movies: Movie[];
  series: Series[];
}

export interface EPGProgram {
  channelId: string;
  title: string;
  description?: string;
  start: number;
  end: number;
}

export interface Favorite {
  key: string;
  kind: ItemKind;
  addedAt: number;
}

export interface EpisodeProgress {
  position: number;
  duration: number;
}

export interface WatchHistory {
  key: string;
  kind: ItemKind;
  itemId: string;
  title: string;
  logo?: string;
  position: number;
  duration: number;
  updatedAt: number;
  /** Series only */
  episodeId?: string;
  episodeLabel?: string;
  episodes?: Record<string, EpisodeProgress>;
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'en' | 'ar';
export type EnginePreference = 'auto' | 'hlsjs' | 'native';
export type QualityPreference = 'auto' | 2160 | 1080 | 720 | 480;

export interface UserSettings {
  theme: ThemeMode;
  language: Language;
  engine: EnginePreference;
  quality: QualityPreference;
  autoPlay: boolean;
  pictureInPicture: boolean;
  epg: boolean;
  developerMode: boolean;
  lastChannelId?: string;
  volume: number;
  muted: boolean;
}

/** Reserved for the profile / parental-control roadmap. v1 ships a single profile. */
export interface Profile {
  id: string;
  name: string;
  kids: boolean;
  pinHash?: string;
  lockedGroups: string[];
}

export type View =
  | 'home' | 'live' | 'movies' | 'movie' | 'series' | 'show' | 'favorites'
  | 'recent' | 'search' | 'guide' | 'playlists' | 'settings' | 'connect' | 'watch';

export interface Route {
  view: View;
  id?: string;
}
