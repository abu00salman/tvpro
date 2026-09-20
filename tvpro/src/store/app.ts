import type {
  Channel, Episode, Favorite, ItemKind, Library, Movie, Playlist, PlaylistSecret, Route, Series,
  UserSettings, View, WatchHistory, XtreamRef,
} from '@/types';
import { toAppError } from '@/lib/errors';
import { importPlaylist, loadFromSecret, type PlaylistInput } from '@/lib/iptv/importer';
import { buildStreamUrl, fetchMovieDetails, fetchSeriesSeasons, fetchShortEpg } from '@/lib/iptv/xtream';
import { playback } from '@/lib/player/controller';
import { unseal } from '@/lib/security/vault';
import { db } from '@/lib/storage/db';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/lib/storage/settings';
import { debounce, itemKey } from '@/lib/utils';
import { createStore } from './createStore';
import { epgKey, epgStore, loadEpg, mergePrograms } from './epg';

/** v1 has one profile; every per-user record is already namespaced so profiles can be added later. */
const PROFILE_ID = 'default';

export interface AppState {
  ready: boolean;
  route: Route;
  online: boolean;
  settings: UserSettings;
  playlists: Playlist[];
  activePlaylistId: string | null;
  libraryLoading: boolean;
  channels: Channel[];
  movies: Movie[];
  series: Series[];
  favorites: Record<string, Favorite>;
  history: Record<string, WatchHistory>;
  currentChannelId: string | null;
  previousChannelId: string | null;
  /** Bumps on every zap so the on-screen channel banner can re-trigger. */
  zapCount: number;
}

export const app = createStore<AppState>({
  ready: false, route: { view: 'home' }, online: true, settings: DEFAULT_SETTINGS,
  playlists: [], activePlaylistId: null, libraryLoading: false,
  channels: [], movies: [], series: [], favorites: {}, history: {},
  currentChannelId: null, previousChannelId: null, zapCount: 0,
});

const secrets = new Map<string, PlaylistSecret>();

/* ───────────────────────────── Routing (hash based, static-host friendly) ───────────────────────────── */

const VIEWS: ReadonlySet<string> = new Set<View>([
  'home', 'live', 'movies', 'movie', 'series', 'show', 'favorites', 'recent', 'search', 'guide',
  'playlists', 'settings', 'connect', 'watch',
]);

function parseHash(): Route {
  const [view, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return VIEWS.has(view) ? { view: view as View, id: rest.length ? decodeURIComponent(rest.join('/')) : undefined } : { view: 'home' };
}

export function navigate(view: View, id?: string): void {
  location.hash = `/${view}${id ? `/${encodeURIComponent(id)}` : ''}`;
}

export function goBack(): void {
  if (app.get().route.view === 'home') return;
  if (history.length > 1) history.back();
  else navigate('home');
}

/* ───────────────────────────── Settings ───────────────────────────── */

export function applyAppearance(settings: UserSettings): void {
  const root = document.documentElement;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.lang = settings.language;
  root.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#080A0D' : '#F6F7F9');
}

export function updateSettings(patch: Partial<UserSettings>): void {
  const settings = { ...app.get().settings, ...patch };
  app.set({ settings });
  saveSettings(settings);
  applyAppearance(settings);
  playback.configure({ engine: settings.engine, quality: settings.quality });
}

/* ───────────────────────────── Boot ───────────────────────────── */

const persistFavorites = debounce(() => void db.put('kv', app.get().favorites, `favorites:${PROFILE_ID}`), 300);
const persistHistory = debounce(() => void db.put('kv', app.get().history, `history:${PROFILE_ID}`), 800);

let started = false;

export async function init(): Promise<void> {
  if (started) return; // React strict mode mounts twice in development
  started = true;
  const settings = loadSettings();
  app.set({ settings, route: parseHash(), online: navigator.onLine });
  applyAppearance(settings);
  playback.configure({ engine: settings.engine, quality: settings.quality });

  window.addEventListener('hashchange', () => app.set({ route: parseHash() }));
  window.addEventListener('online', () => app.set({ online: true }));
  window.addEventListener('offline', () => app.set({ online: false }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(app.get().settings));

  try {
    const [playlists, favorites, history, active] = await Promise.all([
      db.getAll<Playlist>('playlists'),
      db.get<Record<string, Favorite>>('kv', `favorites:${PROFILE_ID}`),
      db.get<Record<string, WatchHistory>>('kv', `history:${PROFILE_ID}`),
      db.get<string>('kv', 'activePlaylist'),
    ]);
    playlists.sort((a, b) => a.createdAt - b.createdAt);
    app.set({ playlists, favorites: favorites ?? {}, history: history ?? {} });
    const target = playlists.find((p) => p.id === active) ?? playlists[0];
    if (target) await activatePlaylist(target.id);
  } catch {
    /* storage unavailable (e.g. locked-down private mode): run in memory */
  }
  app.set({ ready: true });
}

/* ───────────────────────────── Playlists ───────────────────────────── */

async function secretFor(playlistId: string): Promise<PlaylistSecret | undefined> {
  const cached = secrets.get(playlistId);
  if (cached) return cached;
  const blob = app.get().playlists.find((p) => p.id === playlistId)?.secret;
  if (!blob) return undefined;
  const secret = await unseal<PlaylistSecret>(blob);
  secrets.set(playlistId, secret);
  return secret;
}

function showLibrary(library: Library): void {
  playback.stop();
  app.set({
    activePlaylistId: library.playlistId, channels: library.channels, movies: library.movies, series: library.series,
    currentChannelId: null, previousChannelId: null, libraryLoading: false,
  });
  void db.put('kv', library.playlistId, 'activePlaylist');
  scheduleEpg();
}

function scheduleEpg(): void {
  epgStore.set({ index: {} });
  const { settings, playlists, activePlaylistId } = app.get();
  const playlist = playlists.find((p) => p.id === activePlaylistId);
  if (!settings.epg || !playlist) return;
  // Guide data is the lowest priority: wait until the browser is idle.
  const run = async () => loadEpg(playlist, await secretFor(playlist.id).catch(() => undefined));
  if ('requestIdleCallback' in window) requestIdleCallback(() => void run(), { timeout: 4000 });
  else setTimeout(() => void run(), 1500);
}

export async function activatePlaylist(id: string): Promise<void> {
  app.set({ libraryLoading: true });
  const library = await db.get<Library>('libraries', id);
  showLibrary(library ?? { playlistId: id, channels: [], movies: [], series: [] });
}

/** Throws AppError; the connect screen turns the code into a friendly sentence. */
export async function addPlaylist(input: PlaylistInput): Promise<void> {
  try {
    const { playlist, library, secret } = await importPlaylist(input);
    if (secret) secrets.set(playlist.id, secret);
    app.set((s) => ({ playlists: [...s.playlists.filter((p) => p.id !== playlist.id), playlist] }));
    showLibrary(library);
  } catch (e) {
    throw toAppError(e);
  }
}

export async function refreshPlaylist(id: string): Promise<void> {
  try {
    const secret = await secretFor(id);
    if (!secret) return; // uploaded files and the demo have nothing to refresh from
    const parsed = await loadFromSecret(secret, id);
    const library: Library = { playlistId: id, channels: parsed.channels, movies: parsed.movies, series: parsed.series };
    const playlists = app.get().playlists.map((p) => p.id !== id ? p : {
      ...p, updatedAt: Date.now(), epgUrl: p.epgUrl ?? parsed.epgUrl,
      counts: { channels: library.channels.length, movies: library.movies.length, series: library.series.length },
    });
    await Promise.all([db.put('libraries', library), db.put('playlists', playlists.find((p) => p.id === id)!)]);
    await db.delete('kv', `epg:${id}`);
    app.set({ playlists });
    if (app.get().activePlaylistId === id) showLibrary(library);
  } catch (e) {
    throw toAppError(e);
  }
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  const playlists = app.get().playlists.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 60) || p.name } : p));
  app.set({ playlists });
  await db.put('playlists', playlists.find((p) => p.id === id)!);
}

export async function removePlaylist(id: string): Promise<void> {
  secrets.delete(id);
  await Promise.all([db.delete('playlists', id), db.delete('libraries', id), db.delete('kv', `epg:${id}`)]);
  const playlists = app.get().playlists.filter((p) => p.id !== id);
  app.set({ playlists });
  if (app.get().activePlaylistId !== id) return;
  if (playlists[0]) await activatePlaylist(playlists[0].id);
  else {
    playback.stop();
    app.set({ activePlaylistId: null, channels: [], movies: [], series: [], currentChannelId: null, previousChannelId: null });
  }
}

/* ───────────────────────────── Streams ───────────────────────────── */

export async function resolveStreamUrl(item: { playlistId?: string; url?: string; xt?: XtreamRef }, playlistId: string): Promise<string | null> {
  if (item.url) {
    // Raw MPEG-TS cannot play in browsers; the same live endpoint is normally offered as HLS.
    return /\/live\/.+\.ts(\?|$)/i.test(item.url) ? item.url.replace(/\.ts(\?|$)/i, '.m3u8$1') : item.url;
  }
  const secret = await secretFor(playlistId).catch(() => undefined);
  return item.xt && secret?.type === 'xtream' ? buildStreamUrl(secret, item.xt) : null;
}

export async function playChannel(id: string): Promise<void> {
  const state = app.get();
  const channel = state.channels.find((c) => c.id === id);
  if (!channel) return;
  if (state.currentChannelId !== id) {
    app.set({ currentChannelId: id, previousChannelId: state.currentChannelId, zapCount: state.zapCount + 1 });
  }
  // 1. playback first …
  const url = await resolveStreamUrl(channel, channel.playlistId);
  if (app.get().currentChannelId !== id) return;
  if (url) playback.load({ url, live: true });
  // 2. … then everything that is merely nice to have.
  updateSettings({ lastChannelId: id });
  touchHistory({ key: itemKey('channel', id), kind: 'channel', itemId: id, title: channel.name, logo: channel.logo, position: 0, duration: 0 });
  if (channel.xt && state.settings.epg && !epgStore.get().index[epgKey(channel)]) {
    const secret = await secretFor(channel.playlistId).catch(() => undefined);
    if (secret?.type === 'xtream') {
      fetchShortEpg(secret, channel.xt.id, epgKey(channel)).then((p) => mergePrograms(epgKey(channel), p)).catch(() => undefined);
    }
  }
}

/** Step through `order` (the list the viewer is currently looking at). */
export function zap(delta: number, order: Channel[]): void {
  if (!order.length) return;
  const i = order.findIndex((c) => c.id === app.get().currentChannelId);
  const next = order[(Math.max(i, 0) + delta + order.length) % order.length];
  void playChannel(i < 0 ? order[0].id : next.id);
}

export function previousChannel(): void {
  const prev = app.get().previousChannelId;
  if (prev) void playChannel(prev);
}

/* ───────────────────────────── Lazy details ───────────────────────────── */

function patchLibrary(patch: Partial<Pick<AppState, 'movies' | 'series'>>): void {
  app.set(patch);
  const s = app.get();
  if (s.activePlaylistId) void db.put<Library>('libraries', { playlistId: s.activePlaylistId, channels: s.channels, movies: s.movies, series: s.series });
}

export async function ensureSeasons(show: Series): Promise<void> {
  if (show.seasons.length || !show.xtSeriesId) return;
  const secret = await secretFor(show.playlistId);
  if (secret?.type !== 'xtream') return;
  const seasons = await fetchSeriesSeasons(secret, show.xtSeriesId);
  patchLibrary({ series: app.get().series.map((s) => (s.id === show.id ? { ...s, seasons } : s)) });
}

export async function ensureMovieDetails(movie: Movie): Promise<void> {
  if (movie.plot || !movie.xt) return;
  const secret = await secretFor(movie.playlistId);
  if (secret?.type !== 'xtream') return;
  const details = await fetchMovieDetails(secret, movie.xt.id);
  patchLibrary({ movies: app.get().movies.map((m) => (m.id === movie.id ? { ...m, ...details, plot: details.plot ?? ' ' } : m)) });
}

/* ───────────────────────────── Favorites & history ───────────────────────────── */

export function toggleFavorite(kind: ItemKind, id: string): void {
  const key = itemKey(kind, id);
  app.set((s) => {
    const favorites = { ...s.favorites };
    if (favorites[key]) delete favorites[key];
    else favorites[key] = { key, kind, addedAt: Date.now() };
    return { favorites };
  });
  persistFavorites();
}

function touchHistory(entry: Omit<WatchHistory, 'updatedAt'>): void {
  app.set((s) => ({ history: { ...s.history, [entry.key]: { ...s.history[entry.key], ...entry, updatedAt: Date.now() } } }));
  persistHistory();
}

export function recordMovieProgress(movie: Movie, position: number, duration: number): void {
  touchHistory({ key: itemKey('movie', movie.id), kind: 'movie', itemId: movie.id, title: movie.name, logo: movie.logo, position, duration });
}

export function recordEpisodeProgress(show: Series, episode: Episode, position: number, duration: number): void {
  const key = itemKey('series', show.id);
  const episodes = { ...app.get().history[key]?.episodes, [episode.id]: { position, duration } };
  touchHistory({
    key, kind: 'series', itemId: show.id, title: show.name, logo: show.logo, position, duration, episodes,
    episodeId: episode.id, episodeLabel: `S${episode.season} · E${episode.number}`,
  });
}

export function clearHistory(): void {
  app.set({ history: {} });
  persistHistory();
}

export async function clearCache(): Promise<void> {
  await Promise.all(app.get().playlists.map((p) => db.delete('kv', `epg:${p.id}`)));
  if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  scheduleEpg();
}

export function reloadGuide(): void { scheduleEpg(); }
