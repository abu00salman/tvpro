'use client';

import { useMemo, useState } from 'react';
import type { Movie, Series } from '@/types';
import { app, navigate } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useVirtualGrid } from '@/hooks/useVirtualGrid';
import { groupCounts } from '@/hooks/useLibrary';
import { useI18n } from '@/lib/i18n';
import { cx, formatDuration, itemKey } from '@/lib/utils';
import { EmptyState, PageHeader } from '../ui/controls';
import { PosterCard, PosterSkeleton } from '../ui/PosterCard';

const ALL = '\u0000all';

function metaFor(item: Movie | Series, seasonsLabel: (n: number) => string): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  if (item.kind === 'movie' && item.duration) parts.push(formatDuration(item.duration));
  if (item.kind === 'series' && item.seasons.length) parts.push(seasonsLabel(item.seasons.length));
  if (item.rating) parts.push(`★ ${item.rating.toFixed(1)}`);
  return parts.join(' · ') || item.group;
}

/** One virtualised poster grid for both movies and series — identical behaviour, zero duplication. */
export function VodGrid({ kind, initialCategory }: { kind: 'movie' | 'series'; initialCategory?: string }) {
  const { t } = useI18n();
  const items = useStore(app, (s) => (kind === 'movie' ? s.movies : s.series)) as Array<Movie | Series>;
  const history = useStore(app, (s) => s.history);
  const loading = useStore(app, (s) => s.libraryLoading);
  const [category, setCategory] = useState(initialCategory ?? ALL);

  const groups = useMemo(() => groupCounts(items).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const visible = useMemo(() => (category === ALL ? items : items.filter((i) => i.group === category)), [items, category]);
  const grid = useVirtualGrid({ count: visible.length, minColumnWidth: 148, gap: 20, rowHeight: (w) => w * 1.5 + 50, overscan: 2 });

  if (!loading && !items.length) return <EmptyState icon={kind === 'movie' ? 'movies' : 'series'} title={t(kind === 'movie' ? 'empty.movies' : 'empty.series')} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t(kind === 'movie' ? 'nav.movies' : 'nav.series')} meta={t(kind === 'movie' ? 'count.movies' : 'count.series', { n: visible.length.toLocaleString() })} />
      {groups.length > 1 && (
        <div className="no-scrollbar -mx-4 mb-4 flex shrink-0 gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="group" aria-label={t('live.categories')}>
          {[{ name: ALL, count: items.length }, ...groups].map((g) => (
            <button
              key={g.name} type="button" aria-pressed={category === g.name} onClick={() => setCategory(g.name)}
              className={cx('h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors duration-150',
                category === g.name ? 'border-accent/40 bg-accent/10 font-medium text-accent' : 'border-line text-muted hover:bg-raised hover:text-fg')}
            >
              {g.name === ALL ? t('vod.allCategories') : g.name || t('live.uncategorized')}
            </button>
          ))}
        </div>
      )}
      <div ref={grid.ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-28 lg:pb-8">
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-5">{Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} />)}</div>
        ) : (
          <div style={{ height: grid.totalHeight, position: 'relative' }}>
            <div className="grid gap-5" style={{ transform: `translateY(${grid.offsetTop}px)`, gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}>
              {visible.slice(grid.start, grid.end).map((item) => {
                const h = history[itemKey(item.kind, item.id)];
                return (
                  <PosterCard
                    key={item.id} name={item.name} poster={item.logo} meta={metaFor(item, (n) => t('vod.seasons', { n }))}
                    progress={h?.duration ? h.position / h.duration : undefined}
                    onOpen={() => navigate(item.kind === 'movie' ? 'movie' : 'show', item.id)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
