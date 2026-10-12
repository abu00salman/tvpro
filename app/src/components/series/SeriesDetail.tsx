'use client';

import { useEffect, useState } from 'react';
import type { Episode } from '@/types';
import { app, ensureSeasons, navigate } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { cx, formatDuration, itemKey } from '@/lib/utils';
import { DetailHero } from '../movies/DetailHero';
import { Artwork } from '../ui/Artwork';
import { Icon } from '../ui/Icon';
import { EmptyState, ProgressBar } from '../ui/controls';

export function SeriesDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const show = useStore(app, (s) => s.series.find((x) => x.id === id));
  const progress = useStore(app, (s) => s.history[itemKey('series', id)]);
  const [season, setSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show || show.seasons.length) return;
    setLoading(true);
    ensureSeasons(show).catch(() => undefined).finally(() => setLoading(false));
  }, [show]);

  if (!show) return <EmptyState icon="series" title={t('vod.notFound')} />;

  const all: Episode[] = show.seasons.flatMap((s) => s.episodes);
  const resume = all.find((e) => e.id === progress?.episodeId);
  const next = resume ?? all[0];
  const activeSeason = show.seasons.find((s) => s.number === (season ?? resume?.season)) ?? show.seasons[0];
  const facts = [show.year && String(show.year), show.genre, show.seasons.length > 0 && t('vod.seasons', { n: show.seasons.length }), show.rating && `★ ${show.rating.toFixed(1)}`]
    .filter((f): f is string => Boolean(f));

  return (
    <div className="pb-28 lg:pb-10">
      <DetailHero
        kind="series" id={show.id} title={show.name} poster={show.logo} backdrop={show.backdrop} facts={facts} description={show.plot}
        actions={next && (
          <button type="button" data-autofocus className="btn-primary" onClick={() => navigate('watch', `e:${show.id}:${next.id}`)}>
            <Icon name="play" size={16} filled /> {resume ? `${t('vod.resume')} · ${progress?.episodeLabel ?? ''}` : t('vod.play')}
          </button>
        )}
      />

      {loading && <p className="py-6 text-sm text-muted">{t('vod.loadingEpisodes')}</p>}
      {!loading && !all.length && <p className="py-6 text-sm text-muted">{t('vod.noEpisodes')}</p>}

      {show.seasons.length > 1 && (
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto" role="tablist">
          {show.seasons.map((s) => (
            <button
              key={s.number} type="button" role="tab" aria-selected={s === activeSeason} onClick={() => setSeason(s.number)}
              className={cx('h-9 shrink-0 rounded-full border px-4 text-sm transition-colors', s === activeSeason ? 'border-accent/40 bg-accent/10 font-medium text-accent' : 'border-line text-muted hover:text-fg')}
            >
              {t('vod.season', { n: s.number })}
            </button>
          ))}
        </div>
      )}

      <ol className="divide-y divide-line">
        {activeSeason?.episodes.map((ep) => {
          const p = progress?.episodes?.[ep.id];
          return (
            <li key={ep.id}>
              <button type="button" onClick={() => navigate('watch', `e:${show.id}:${ep.id}`)} className="group flex w-full items-center gap-4 rounded-md px-2 py-3 text-start transition-colors hover:bg-raised">
                <span className="w-7 shrink-0 text-center font-mono text-sm text-faint tabular">{ep.number}</span>
                {ep.thumbnail && <Artwork variant="poster" src={ep.thumbnail} name="" className="hidden aspect-video w-32 shrink-0 rounded-sm sm:block" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{ep.title || t('vod.episode', { n: ep.number })}</span>
                  {ep.duration && <span className="block text-xs text-muted">{formatDuration(ep.duration)}</span>}
                  {p && p.duration > 0 && <ProgressBar value={p.position / p.duration} className="mt-2 max-w-[14rem]" />}
                </span>
                <Icon name="play" size={18} filled className="me-2 text-faint transition-colors group-hover:text-accent" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
