'use client';

import { useEffect } from 'react';
import { app, ensureMovieDetails, navigate } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { formatDuration, itemKey } from '@/lib/utils';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/controls';
import { DetailHero } from './DetailHero';

export function MovieDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const movie = useStore(app, (s) => s.movies.find((m) => m.id === id));
  const progress = useStore(app, (s) => s.history[itemKey('movie', id)]);

  useEffect(() => { if (movie) void ensureMovieDetails(movie).catch(() => undefined); }, [movie]);
  if (!movie) return <EmptyState icon="movies" title={t('vod.notFound')} />;

  const facts = [movie.year && String(movie.year), movie.genre, movie.duration && formatDuration(movie.duration), movie.rating && `★ ${movie.rating.toFixed(1)}`, movie.group]
    .filter((f): f is string => Boolean(f));
  const resumable = progress && progress.duration > 0 && progress.position > 30 && progress.position / progress.duration < 0.95;

  return (
    <DetailHero
      kind="movie" id={movie.id} title={movie.name} poster={movie.logo} backdrop={movie.backdrop} facts={facts} description={movie.plot}
      actions={
        <>
          <button type="button" data-autofocus className="btn-primary" onClick={() => navigate('watch', `m:${movie.id}`)}>
            <Icon name="play" size={16} filled /> {t(resumable ? 'vod.resume' : 'vod.play')}
          </button>
          {resumable && <button type="button" className="btn-quiet" onClick={() => navigate('watch', `m:${movie.id}:restart`)}>{t('vod.restart')}</button>}
        </>
      }
    />
  );
}
