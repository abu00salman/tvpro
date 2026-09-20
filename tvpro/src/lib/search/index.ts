import type { Channel, ItemKind, Movie, Series } from '@/types';

export interface SearchHit {
  kind: ItemKind | 'category';
  id: string;
  name: string;
  group: string;
  logo?: string;
  score: number;
}

interface Entry { kind: ItemKind; id: string; name: string; group: string; logo?: string; norm: string }

/** Lowercase, strip Latin diacritics and unify Arabic letter variants so "احمد" finds "أحمد". */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function fuzzy(query: string, target: string): boolean {
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) if (target[i] === query[qi]) qi++;
  return qi === query.length;
}

export class SearchIndex {
  private entries: Entry[] = [];
  private groups: Array<{ name: string; norm: string }> = [];

  constructor(channels: Channel[], movies: Movie[], series: Series[]) {
    const groups = new Set<string>();
    for (const list of [channels, movies, series] as const) {
      for (const it of list) {
        this.entries.push({ kind: it.kind, id: it.id, name: it.name, group: it.group, logo: it.logo, norm: normalize(it.name) });
        if (it.group) groups.add(it.group);
      }
    }
    this.groups = Array.from(groups, (name) => ({ name, norm: normalize(name) }));
  }

  /** Pre-normalised linear scan: ~2–4 ms for 20k entries, so results feel instant. */
  search(rawQuery: string, limitPerKind = 24): SearchHit[] {
    const q = normalize(rawQuery);
    if (!q) return [];
    const hits: SearchHit[] = [];
    const counts: Record<string, number> = {};
    const tokens = q.split(' ');

    for (const e of this.entries) {
      let score = 0;
      if (e.norm.startsWith(q)) score = 100;
      else if (e.norm.includes(' ' + q)) score = 70;
      else if (e.norm.includes(q)) score = 50;
      else if (tokens.length > 1 && tokens.every((t) => e.norm.includes(t))) score = 40;
      else if (q.length >= 3 && q.length <= 12 && fuzzy(q, e.norm)) score = 10;
      if (!score) continue;
      score -= Math.min(e.norm.length, 40) / 10; // shorter names rank first
      hits.push({ kind: e.kind, id: e.id, name: e.name, group: e.group, logo: e.logo, score });
    }
    for (const g of this.groups) {
      if (g.norm.includes(q)) hits.push({ kind: 'category', id: g.name, name: g.name, group: '', score: g.norm.startsWith(q) ? 90 : 45 });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.filter((h) => (counts[h.kind] = (counts[h.kind] ?? 0) + 1) <= limitPerKind);
  }
}
