import type { Channel, Episode, Movie, Series } from '@/types';
import { hash } from '../utils';
import { safeImageUrl, sanitizeText } from '../security/url';

export interface ParsedLibrary {
  channels: Channel[];
  movies: Movie[];
  series: Series[];
  epgUrl?: string;
}

const ATTR_RE = /([\w-]+)="([^"]*)"/g;
const VOD_EXT_RE = /\.(mp4|mkv|avi|mov|m4v|webm|flv|wmv|mpg|mpeg)(\?|$)/i;
const EPISODE_RE = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})(?:[\s._-]+(.*))?$/i;
const YEAR_RE = /[([](19\d{2}|20\d{2})[)\]]\s*$/;

interface ExtInf {
  attrs: Record<string, string>;
  name: string;
  duration: number;
}

function parseExtInf(line: string): ExtInf {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2];

  // The display name follows the first comma that is outside quotes.
  let inQuotes = false;
  let comma = -1;
  for (let i = 8; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 34) inQuotes = !inQuotes;
    else if (c === 44 && !inQuotes) { comma = i; break; }
  }
  const name = comma >= 0 ? line.slice(comma + 1) : '';
  const duration = parseFloat(line.slice(8)) || -1;
  return { attrs, name, duration };
}

/**
 * Tolerant M3U / M3U8 playlist parser.
 * - single pass, index based (no giant line arrays) so 20k+ entries stay cheap
 * - unknown tags are ignored, broken entries are skipped, never throws on content
 * - classifies entries into live channels, movies and series episodes
 */
export function parseM3U(text: string, playlistId: string): ParsedLibrary {
  const channels: Channel[] = [];
  const movies: Movie[] = [];
  const seriesMap = new Map<string, Series>();
  const seen = new Set<string>();
  let epgUrl: string | undefined;
  let pending: ExtInf | null = null;
  let pendingGroup: string | undefined;

  const len = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (pos < len) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = len;
    const line = text.slice(pos, end).trim();
    pos = end + 1;
    if (!line) continue;

    if (line.charCodeAt(0) === 35 /* # */) {
      if (line.startsWith('#EXTINF:')) pending = parseExtInf(line);
      else if (line.startsWith('#EXTGRP:')) pendingGroup = line.slice(8).trim();
      else if (line.startsWith('#EXTM3U')) {
        const header = parseExtInf(line).attrs;
        epgUrl = header['url-tvg'] || header['x-tvg-url'] || undefined;
      }
      continue;
    }

    // A URL line. Without a preceding #EXTINF we still accept it with a fallback name.
    const url = line;
    const info: ExtInf = pending ?? { attrs: {}, name: '', duration: -1 };
    pending = null;
    if (!/^(https?|rtmp|rtsp|udp|rtp):\/\//i.test(url)) { pendingGroup = undefined; continue; }
    if (seen.has(url)) { pendingGroup = undefined; continue; }
    seen.add(url);

    const name = sanitizeText(info.name || info.attrs['tvg-name'] || '') || `Channel ${channels.length + 1}`;
    const group = sanitizeText(info.attrs['group-title'] || pendingGroup || '', 80);
    const logo = safeImageUrl(info.attrs['tvg-logo']);
    pendingGroup = undefined;

    const path = url.split('?')[0];
    const episode = name.match(EPISODE_RE);
    const isSeriesPath = /\/series\//i.test(path);
    const isVod = VOD_EXT_RE.test(path) || /\/movie\//i.test(path);

    if (episode && (isSeriesPath || isVod)) {
      const title = sanitizeText(episode[1].replace(/[\s._-]+$/, '')) || name;
      const key = `${group}\u0000${title.toLowerCase()}`;
      let show = seriesMap.get(key);
      if (!show) {
        show = { kind: 'series', id: hash(playlistId + key), playlistId, name: title, group, logo, seasons: [] };
        seriesMap.set(key, show);
      }
      const seasonNo = Number(episode[2]);
      const ep: Episode = {
        id: hash(url), season: seasonNo, number: Number(episode[3]),
        title: sanitizeText(episode[4] ?? ''), url, thumbnail: logo,
        duration: info.duration > 0 ? info.duration : undefined,
      };
      let season = show.seasons.find((s) => s.number === seasonNo);
      if (!season) { season = { number: seasonNo, episodes: [] }; show.seasons.push(season); }
      season.episodes.push(ep);
    } else if (isVod || isSeriesPath) {
      const year = name.match(YEAR_RE);
      movies.push({
        kind: 'movie', id: hash(url), playlistId, url, logo, group,
        name: year ? name.replace(YEAR_RE, '').trim() : name,
        year: year ? Number(year[1]) : undefined,
        duration: info.duration > 0 ? info.duration : undefined,
      });
    } else {
      channels.push({
        kind: 'channel', id: hash(url), playlistId, url, logo, group, name,
        number: Number(info.attrs['tvg-chno']) || channels.length + 1,
        tvgId: info.attrs['tvg-id'] || undefined,
      });
    }
  }

  const series = Array.from(seriesMap.values());
  for (const show of series) {
    show.seasons.sort((a, b) => a.number - b.number);
    for (const season of show.seasons) season.episodes.sort((a, b) => a.number - b.number);
  }
  return { channels, movies, series, epgUrl };
}
