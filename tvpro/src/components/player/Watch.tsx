'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  app, ensureSeasons, goBack, navigate, recordEpisodeProgress, recordMovieProgress, resolveStreamUrl,
} from '@/store/app';
import { useStore } from '@/store/createStore';
import { playback } from '@/lib/player/controller';
import { announceNowPlaying, clearNowPlaying } from '@/lib/player/mediaSession';
import { useI18n } from '@/lib/i18n';
import { itemKey } from '@/lib/utils';
import { EmptyState } from '../ui/controls';
import { Player } from './Player';

/** Full-window playback for movies and episodes. Route id: `m:<movieId>[:restart]` or `e:<seriesId>:<episodeId>`. */
export function Watch({ id }: { id: string }) {
  const { t } = useI18n();
  const [type, a, b] = id.split(':');
  const movie = useStore(app, (s) => (type === 'm' ? s.movies.find((m) => m.id === a) : undefined));
  const show = useStore(app, (s) => (type === 'e' ? s.series.find((x) => x.id === a) : undefined));
  const episodes = useMemo(() => show?.seasons.flatMap((s) => s.episodes) ?? [], [show]);
  const episode = episodes.find((e) => e.id === b);
  const target = movie ?? episode;

  useEffect(() => { if (show && !show.seasons.length) void ensureSeasons(show).catch(() => undefined); }, [show]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const h = app.get().history;
    const saved = movie ? h[itemKey('movie', movie.id)] : h[itemKey('series', a)]?.episodes?.[b];
    const resume = saved && saved.duration > 0 && saved.position / saved.duration < 0.95 && b !== 'restart' ? saved.position : 0;
    void resolveStreamUrl(target, (movie ?? show)!.playlistId).then((url) => {
      if (!cancelled && url) playback.load({ url, live: false, startAt: resume > 30 ? resume - 3 : undefined });
    });
    announceNowPlaying({ title: movie?.name ?? episode?.title ?? '', subtitle: show?.name, artwork: (movie ?? show)?.logo });
    return () => { cancelled = true; clearNowPlaying(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  const onProgress = useCallback((position: number, duration: number) => {
    if (movie) recordMovieProgress(movie, position, duration);
    else if (show && episode) recordEpisodeProgress(show, episode, position, duration);
  }, [movie, show, episode]);

  const onEnded = useCallback(() => {
    const next = episode ? episodes[episodes.indexOf(episode) + 1] : undefined;
    if (show && next) navigate('watch', `e:${show.id}:${next.id}`);
    else goBack();
  }, [episode, episodes, show]);

  if (!target) return <div className="grid h-dvh place-items-center"><EmptyState icon="movies" title={t('vod.notFound')} /></div>;

  return (
    <Player
      className="fixed inset-0 z-50 h-dvh w-screen"
      title={movie?.name ?? show?.name ?? ''}
      subtitle={episode ? `S${episode.season} · E${episode.number}${episode.title ? ` — ${episode.title}` : ''}` : movie?.year ? String(movie.year) : undefined}
      bannerKey={target.id} favorite={movie ? { kind: 'movie', id: movie.id } : show ? { kind: 'series', id: show.id } : undefined}
      onBack={goBack} onProgress={onProgress} onEnded={onEnded}
    />
  );
}
