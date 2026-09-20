'use client';

import { useMemo } from 'react';
import { app } from '@/store/app';
import { epgKey, epgStore } from '@/store/epg';
import { useStore } from '@/store/createStore';
import { useNow } from '@/hooks/useNow';
import { useVirtualGrid } from '@/hooks/useVirtualGrid';
import { useI18n } from '@/lib/i18n';
import { cx, formatHour } from '@/lib/utils';
import { openChannel } from '../home/Home';
import { Artwork } from '../ui/Artwork';
import { EmptyState, PageHeader } from '../ui/controls';

const ROW = 60;
const PX_PER_MIN = 5;
const HOURS = 8;
const LABEL_W = 184;

/** Timeline guide. Rows are virtualised; each row only draws programmes inside the window. */
export function Guide() {
  const { t, locale } = useI18n();
  const channels = useStore(app, (s) => s.channels);
  const index = useStore(epgStore, (s) => s.index);
  const loading = useStore(epgStore, (s) => s.loading);
  const now = useNow();

  const rows = useMemo(() => channels.filter((c) => index[epgKey(c)]?.length), [channels, index]);
  const from = useMemo(() => Math.floor(now / 1_800_000) * 1_800_000 - 1_800_000, [Math.floor(now / 1_800_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const to = from + HOURS * 3_600_000;
  const width = HOURS * 60 * PX_PER_MIN;
  const x = (ts: number) => ((Math.min(Math.max(ts, from), to) - from) / 60_000) * PX_PER_MIN;
  const grid = useVirtualGrid({ count: rows.length, rowHeight: ROW, overscan: 4 });

  if (!rows.length) return loading ? <p className="py-20 text-center text-sm text-muted">{t('guide.loading')}</p> : <EmptyState icon="guide" title={t('empty.guide')} body={t('empty.guideBody')} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('nav.guide')} meta={new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} />
      <div ref={grid.ref} dir="ltr" className="card min-h-0 flex-1 overflow-auto overscroll-contain pb-24 lg:pb-0">
        <div style={{ width: width + LABEL_W, minHeight: '100%' }} className="relative">
          <div className="sticky top-0 z-20 flex h-9 border-b border-line bg-surface/95 backdrop-blur">
            <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: LABEL_W }} />
            {Array.from({ length: HOURS * 2 }, (_, i) => (
              <span key={i} className="shrink-0 border-l border-line px-2 pt-2.5 font-mono text-[0.7rem] text-faint tabular" style={{ width: 30 * PX_PER_MIN }}>
                {formatHour(from + i * 1_800_000, locale)}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-0 top-9 z-10 w-px bg-accent" style={{ left: LABEL_W + x(now) }} aria-hidden="true" />
          <div style={{ height: grid.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${grid.offsetTop}px)` }}>
              {rows.slice(grid.start, grid.end).map((c) => (
                <div key={c.id} className="flex border-b border-line" style={{ height: ROW }}>
                  <button type="button" onClick={() => openChannel(c.id)} className="sticky left-0 z-[5] flex shrink-0 items-center gap-2.5 border-r border-line bg-surface px-3 text-start hover:bg-raised focus-visible:-outline-offset-2" style={{ width: LABEL_W }}>
                    <Artwork variant="logo" src={c.logo} name={c.name} className="h-8 w-8" />
                    <span className="truncate text-sm font-medium" dir="auto">{c.name}</span>
                  </button>
                  <div className="relative" style={{ width }}>
                    {index[epgKey(c)].filter((p) => p.end > from && p.start < to).map((p) => {
                      const live = p.start <= now && p.end > now;
                      return (
                        <button
                          key={p.start} type="button" onClick={() => openChannel(c.id)} title={`${p.title} · ${formatHour(p.start, locale)}–${formatHour(p.end, locale)}`}
                          className={cx('absolute inset-y-1 overflow-hidden rounded-sm border px-2.5 text-start transition-colors focus-visible:-outline-offset-2',
                            live ? 'border-accent/30 bg-accent/10' : 'border-line bg-base hover:bg-raised', p.end <= now && 'opacity-50')}
                          style={{ left: x(p.start) + 2, width: Math.max(x(p.end) - x(p.start) - 4, 8) }}
                        >
                          <span className="block truncate text-[0.8rem] font-medium" dir="auto">{p.title}</span>
                          <span className="block truncate font-mono text-[0.68rem] text-faint tabular">{formatHour(p.start, locale)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
