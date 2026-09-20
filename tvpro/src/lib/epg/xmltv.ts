import type { EPGProgram } from '@/types';

export type EpgIndex = Record<string, EPGProgram[]>;

const PROGRAMME_RE = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (s: string): string =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, ent: string) => {
      if (ent[0] === '#') {
        const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[ent] ?? all;
    })
    .trim();

/** "20260920183000 +0300" → epoch ms */
function parseTime(value: string | undefined): number {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  if (!m[7]) return utc;
  const sign = m[7][0] === '-' ? -1 : 1;
  return utc - sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5))) * 60_000;
}

const attr = (attrs: string, name: string): string | undefined =>
  attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];

/**
 * Streaming-friendly XMLTV reader (regex based so it also runs inside a Web Worker,
 * where DOMParser does not exist). Only keeps a rolling window to bound memory.
 */
export function parseXMLTV(xml: string, now = Date.now()): EpgIndex {
  const from = now - 6 * 3_600_000;
  const to = now + 36 * 3_600_000;
  const index: EpgIndex = {};
  PROGRAMME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROGRAMME_RE.exec(xml))) {
    const channelId = attr(m[1], 'channel');
    const start = parseTime(attr(m[1], 'start'));
    const end = parseTime(attr(m[1], 'stop'));
    if (!channelId || !Number.isFinite(start) || !Number.isFinite(end) || end < from || start > to) continue;
    const title = m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    if (!title) continue;
    const desc = m[2].match(/<desc[^>]*>([\s\S]*?)<\/desc>/)?.[1];
    (index[channelId] ??= []).push({
      channelId, start, end, title: decode(title).slice(0, 160),
      description: desc ? decode(desc).slice(0, 400) : undefined,
    });
  }
  for (const id in index) index[id].sort((a, b) => a.start - b.start);
  return index;
}
