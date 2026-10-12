import type { Channel, EPGProgram, Episode, Movie, PlaylistSecret, Season, Series, XtreamRef } from '@/types';
import { AppError } from '../errors';
import { hash } from '../utils';
import { safeImageUrl, sanitizeText } from '../security/url';
import { fetchSource } from './http';
import type { ParsedLibrary } from '../m3u/parser';

/**
 * Client for servers that expose the common "player_api" login
 * (Server URL + Username + Password). For use with sources the user is authorised to access.
 */
type XtreamSecret = Extract<PlaylistSecret, { type: 'xtream' }>;
type Row = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

const base = (s: XtreamSecret): string => s.server.replace(/\/+$/, '');

function apiUrl(s: XtreamSecret, action?: string, extra = ''): string {
  const q = `username=${encodeURIComponent(s.username)}&password=${encodeURIComponent(s.password)}`;
  return `${base(s)}/player_api.php?${q}${action ? `&action=${action}` : ''}${extra}`;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetchSource(url);
  try {
    return await res.json();
  } catch {
    throw new AppError('network');
  }
}

export function buildStreamUrl(s: XtreamSecret, ref: XtreamRef): string {
  const u = encodeURIComponent(s.username);
  const p = encodeURIComponent(s.password);
  return `${base(s)}/${ref.kind}/${u}/${p}/${ref.id}.${ref.ext}`;
}

export async function fetchXtreamLibrary(s: XtreamSecret, playlistId: string): Promise<ParsedLibrary> {
  const login = (await getJson(apiUrl(s))) as { user_info?: { auth?: unknown } } | null;
  if (!login?.user_info || Number(login.user_info.auth) === 0) throw new AppError('auth');

  const [liveCats, live, vodCats, vod, seriesCats, shows] = await Promise.all(
    ['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series']
      .map((a) => getJson(apiUrl(s, a)).catch(() => [])),
  );
  const catMap = (list: unknown) =>
    new Map(rows(list).map((c) => [str(c.category_id) ?? '', sanitizeText(str(c.category_name) ?? '', 80)]));
  const lc = catMap(liveCats), vc = catMap(vodCats), sc = catMap(seriesCats);

  const channels: Channel[] = rows(live).flatMap((r, i) => {
    const id = str(r.stream_id);
    if (!id) return [];
    return [{
      kind: 'channel' as const, id: hash(`${playlistId}:l:${id}`), playlistId,
      name: sanitizeText(str(r.name) ?? `Channel ${i + 1}`), group: lc.get(str(r.category_id) ?? '') ?? '',
      logo: safeImageUrl(str(r.stream_icon)), number: num(r.num) ?? i + 1,
      tvgId: str(r.epg_channel_id) || undefined, xt: { kind: 'live' as const, id, ext: 'm3u8' },
    }];
  });

  const movies: Movie[] = rows(vod).flatMap((r) => {
    const id = str(r.stream_id);
    if (!id) return [];
    return [{
      kind: 'movie' as const, id: hash(`${playlistId}:m:${id}`), playlistId,
      name: sanitizeText(str(r.name) ?? ''), group: vc.get(str(r.category_id) ?? '') ?? '',
      logo: safeImageUrl(str(r.stream_icon)), rating: num(r.rating), addedAt: num(r.added),
      xt: { kind: 'movie' as const, id, ext: str(r.container_extension) ?? 'mp4' },
    }];
  });

  const series: Series[] = rows(shows).flatMap((r) => {
    const id = str(r.series_id);
    if (!id) return [];
    const backdrop = Array.isArray(r.backdrop_path) ? str(r.backdrop_path[0]) : str(r.backdrop_path);
    return [{
      kind: 'series' as const, id: hash(`${playlistId}:s:${id}`), playlistId, xtSeriesId: id, seasons: [],
      name: sanitizeText(str(r.name) ?? ''), group: sc.get(str(r.category_id) ?? '') ?? '',
      logo: safeImageUrl(str(r.cover)), plot: str(r.plot) || undefined, genre: str(r.genre) || undefined,
      rating: num(r.rating), year: num(str(r.releaseDate)?.slice(0, 4)), backdrop: safeImageUrl(backdrop),
      addedAt: num(r.last_modified),
    }];
  });

  return { channels, movies, series };
}

export async function fetchSeriesSeasons(s: XtreamSecret, seriesId: string): Promise<Season[]> {
  const data = (await getJson(apiUrl(s, 'get_series_info', `&series_id=${encodeURIComponent(seriesId)}`))) as
    { episodes?: Record<string, unknown> } | null;
  const seasons: Season[] = [];
  for (const [seasonKey, list] of Object.entries(data?.episodes ?? {})) {
    const episodes: Episode[] = rows(list).flatMap((r) => {
      const id = str(r.id);
      if (!id) return [];
      const info = (r.info ?? {}) as Row;
      return [{
        id: hash(`ep:${seriesId}:${id}`), season: Number(seasonKey) || 1, number: num(r.episode_num) ?? 0,
        title: sanitizeText(str(r.title) ?? ''), thumbnail: safeImageUrl(str(info.movie_image)),
        duration: num(info.duration_secs), xt: { kind: 'series' as const, id, ext: str(r.container_extension) ?? 'mp4' },
      }];
    });
    if (episodes.length) seasons.push({ number: Number(seasonKey) || 1, episodes });
  }
  return seasons.sort((a, b) => a.number - b.number);
}

export async function fetchMovieDetails(s: XtreamSecret, vodId: string): Promise<Partial<Movie>> {
  const data = (await getJson(apiUrl(s, 'get_vod_info', `&vod_id=${encodeURIComponent(vodId)}`))) as { info?: Row } | null;
  const info = data?.info ?? {};
  const backdrop = Array.isArray(info.backdrop_path) ? str(info.backdrop_path[0]) : str(info.backdrop_path);
  return {
    plot: str(info.plot) || str(info.description) || undefined, genre: str(info.genre) || undefined,
    duration: num(info.duration_secs), backdrop: safeImageUrl(backdrop),
    year: num(str(info.releasedate)?.slice(0, 4)),
  };
}

const b64 = (v: string): string => {
  try {
    return decodeURIComponent(escape(atob(v)));
  } catch {
    return v;
  }
};

/** Lightweight now/next lookup for a single channel — never blocks playback. */
export async function fetchShortEpg(s: XtreamSecret, streamId: string, channelId: string): Promise<EPGProgram[]> {
  const data = (await getJson(apiUrl(s, 'get_short_epg', `&stream_id=${encodeURIComponent(streamId)}&limit=6`))) as
    { epg_listings?: unknown } | null;
  return rows(data?.epg_listings).flatMap((r) => {
    const start = num(r.start_timestamp), end = num(r.stop_timestamp), title = str(r.title);
    if (!start || !end || !title) return [];
    return [{ channelId, title: b64(title), description: str(r.description) ? b64(str(r.description)!) : undefined, start: start * 1000, end: end * 1000 }];
  });
}
