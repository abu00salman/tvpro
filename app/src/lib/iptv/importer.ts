import type { Library, Playlist, PlaylistSecret, PlaylistType } from '@/types';
import { AppError } from '../errors';
import { sanitizeText, validateSourceUrl } from '../security/url';
import { seal } from '../security/vault';
import { db } from '../storage/db';
import { uid } from '../utils';
import type { ParsedLibrary } from '../m3u/parser';
import { buildDemoLibrary, DEMO_PLAYLIST_ID } from './demo';
import { fetchSource, readText } from './http';
import { parseM3UAsync } from './workerClient';
import { fetchXtreamLibrary } from './xtream';

export type PlaylistInput =
  | { kind: 'm3u'; name: string; url: string; epgUrl?: string }
  | { kind: 'file'; name: string; file: File; epgUrl?: string }
  | { kind: 'xtream'; name: string; server: string; username: string; password: string }
  | { kind: 'demo' };

const MAX_PLAYLIST_BYTES = 200 * 1024 * 1024;

export async function loadFromSecret(secret: PlaylistSecret, playlistId: string): Promise<ParsedLibrary> {
  if (secret.type === 'xtream') {
    validateSourceUrl(secret.server);
    return fetchXtreamLibrary(secret, playlistId);
  }
  const url = validateSourceUrl(secret.url).toString();
  const text = await readText(await fetchSource(url), url);
  return parseText(text, playlistId);
}

async function parseText(text: string, playlistId: string): Promise<ParsedLibrary> {
  if (text.length > MAX_PLAYLIST_BYTES) throw new AppError('too-large');
  if (!/#EXTINF|#EXTM3U/i.test(text.slice(0, 4096)) && !/^\s*https?:\/\//im.test(text.slice(0, 4096))) throw new AppError('empty');
  return parseM3UAsync(text, playlistId);
}

export interface ImportResult {
  playlist: Playlist;
  library: Library;
  secret?: PlaylistSecret;
}

/** Validates, fetches, parses (off the main thread) and persists a new playlist. */
export async function importPlaylist(input: PlaylistInput): Promise<ImportResult> {
  const id = input.kind === 'demo' ? DEMO_PLAYLIST_ID : uid();
  let parsed: ParsedLibrary;
  let secret: PlaylistSecret | undefined;
  let type: PlaylistType;
  let name: string;
  let epgUrl: string | undefined;

  switch (input.kind) {
    case 'demo':
      type = 'demo'; name = 'TV Pro Demo'; parsed = buildDemoLibrary();
      break;
    case 'file':
      type = 'm3u-file'; name = input.name || input.file.name.replace(/\.[^.]+$/, '');
      if (input.file.size > MAX_PLAYLIST_BYTES) throw new AppError('too-large');
      parsed = await parseText(await input.file.text(), id);
      epgUrl = input.epgUrl;
      break;
    case 'm3u':
      type = 'm3u-url'; name = input.name;
      secret = { type: 'm3u-url', url: input.url.trim() };
      parsed = await loadFromSecret(secret, id);
      epgUrl = input.epgUrl;
      break;
    case 'xtream':
      type = 'xtream'; name = input.name;
      if (!input.username.trim() || !input.password) throw new AppError('auth');
      secret = { type: 'xtream', server: input.server.trim(), username: input.username.trim(), password: input.password };
      parsed = await loadFromSecret(secret, id);
      break;
  }

  if (!parsed.channels.length && !parsed.movies.length && !parsed.series.length) throw new AppError('empty');
  const guide = epgUrl?.trim() || parsed.epgUrl;
  if (guide) { try { epgUrl = validateSourceUrl(guide).toString(); } catch { epgUrl = undefined; } }

  const now = Date.now();
  const playlist: Playlist = {
    id, type, name: sanitizeText(name, 60) || 'My playlist', createdAt: now, updatedAt: now, epgUrl,
    counts: { channels: parsed.channels.length, movies: parsed.movies.length, series: parsed.series.length },
    secret: secret ? await seal(secret) : undefined,
  };
  const library: Library = { playlistId: id, channels: parsed.channels, movies: parsed.movies, series: parsed.series };
  await Promise.all([db.put('playlists', playlist), db.put('libraries', library)]);
  return { playlist, library, secret };
}
