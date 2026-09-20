import { useMemo } from 'react';
import type { Channel, Movie, Series } from '@/types';
import { app } from '@/store/app';
import { useStore } from '@/store/createStore';
import { SearchIndex } from '@/lib/search';

export interface LibraryMaps {
  channels: Map<string, Channel>;
  movies: Map<string, Movie>;
  series: Map<string, Series>;
}

export function useLibraryMaps(): LibraryMaps {
  const channels = useStore(app, (s) => s.channels);
  const movies = useStore(app, (s) => s.movies);
  const series = useStore(app, (s) => s.series);
  return useMemo(() => ({
    channels: new Map(channels.map((c) => [c.id, c])),
    movies: new Map(movies.map((m) => [m.id, m])),
    series: new Map(series.map((s) => [s.id, s])),
  }), [channels, movies, series]);
}

export function useSearchIndex(): SearchIndex {
  const channels = useStore(app, (s) => s.channels);
  const movies = useStore(app, (s) => s.movies);
  const series = useStore(app, (s) => s.series);
  return useMemo(() => new SearchIndex(channels, movies, series), [channels, movies, series]);
}

/** Groups with counts, largest first. */
export function groupCounts(items: ReadonlyArray<{ group: string }>): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.group, (counts.get(it.group) ?? 0) + 1);
  return Array.from(counts, ([name, count]) => ({ name, count }));
}
