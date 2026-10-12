'use client';

import { useMemo } from 'react';
import type { Channel, Movie, Series, WatchHistory } from '@/types';
import { app, navigate, playChannel } from '@/store/app';
import { epgKey, epgStore, nowAndNext } from '@/store/epg';
import { useStore } from '@/store/createStore';
import { groupCounts, useLibraryMaps } from '@/hooks/useLibrary';
import { useNow } from '@/hooks/useNow';
import { useI18n } from '@/lib/i18n';
import { PosterCard } from '../ui/PosterCard';
import { ChannelCard } from './ChannelCard';
import { Row } from './Row';

const SHELF = 14;

export function openChannel(id: string): void {
  navigate('live');
  void playChannel(id);
}

export function Home() {
  const { t } = useI18n();
  const channels = useStore(app, (s) => s.channels);
  const movies = useStore(app, (s) => s.movies);
  const series = useStore(app, (s) => s.series);
  const favorites = useStore(app, (s) => s.favorites);
  const history = useStore(app, (s) => s.history);
  const playlistName = useStore(app, (s) => s.playlists.find((p) => p.id === s.activePlaylistId)?.name);
  const epg = useStore(epgStore, (s) => s.index);
  const maps = useLibraryMaps();
  const now = useNow(60_000);

  const recent = useMemo(() => Object.values(history).sort((a, b) => b.updatedAt - a.updatedAt), [history]);
  const continueWatching = recent.filter((h) => h.kind !== 'channel' && h.duration > 0 && h.position / h.duration < 0.95 && (maps.movies.has(h.itemId) || maps.series.has(h.itemId))).slice(0, SHELF);
  const recentChannels = recent.filter((h) => h.kind === 'channel').flatMap((h) => maps.channels.get(h.itemId) ?? []).slice(0, SHELF);
  const liveNow = useMemo(() => (recentChannels.length >= 4 ? [] : channels.slice(0, SHELF)), [channels, recentChannels.length]);

  const favs = useMemo(() => Object.values(favorites).sort((a, b) => b.addedAt - a.addedAt).flatMap((f): Array<Channel | Movie | Series> => {
    const id = f.key.slice(2);
    const item = f.kind === 'channel' ? maps.channels.get(id) : f.kind === 'movie' ? maps.movies.get(id) : maps.series.get(id);
    return item ? [item] : [];
  }).slice(0, SHELF), [favorites, maps]);

  const recentlyAdded = useMemo(() => {
    const dated = [...movies, ...series].filter((i) => i.addedAt);
    return dated.length ? dated.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, SHELF) : [...movies.slice(-7), ...series.slice(-7)].reverse();
  }, [movies, series]);

  const categories = useMemo(() => groupCounts(channels).filter((g) => g.name).sort((a, b) => b.count - a.count).slice(0, 8), [channels]);

  const openItem = (item: Channel | Movie | Series | WatchHistory) => {
    const id = 'itemId' in item ? item.itemId : item.id;
    if (item.kind === 'channel') openChannel(id);
    else navigate(item.kind === 'movie' ? 'movie' : 'show', id);
  };
  const program = (c: Channel) => nowAndNext(epg[epgKey(c)], now).current?.title;

  return (
    <div className="pb-28 lg:pb-10">
      <header className="pb-8 pt-2">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em] lg:text-4xl">{t('home.greeting')}</h1>
        <p className="mt-1.5 font-mono text-xs text-faint tabular">
          {[playlistName, channels.length && t('count.channels', { n: channels.length.toLocaleString() }), movies.length && t('count.movies', { n: movies.length.toLocaleString() }), series.length && t('count.series', { n: series.length.toLocaleString() })].filter(Boolean).join('  ·  ')}
        </p>
      </header>

      {continueWatching.length > 0 && (
        <Row title={t('home.continue')}>
          {continueWatching.map((h) => (
            <PosterCard key={h.key} className="!w-36 lg:!w-40" name={h.title} poster={h.logo} meta={h.episodeLabel} progress={h.position / h.duration} onOpen={() => openItem(h)} />
          ))}
        </Row>
      )}
      {(recentChannels.length > 0 || liveNow.length > 0) && (
        <Row title={t('home.liveNow')} onSeeAll={() => navigate('live')}>
          {(recentChannels.length >= 4 ? recentChannels : liveNow).map((c) => <ChannelCard key={c.id} channel={c} program={program(c)} onOpen={() => openChannel(c.id)} />)}
        </Row>
      )}
      {favs.length > 0 && (
        <Row title={t('nav.favorites')} onSeeAll={() => navigate('favorites')}>
          {favs.map((item) => item.kind === 'channel'
            ? <ChannelCard key={item.id} channel={item} program={program(item)} onOpen={() => openItem(item)} />
            : <PosterCard key={item.id} className="!w-36 lg:!w-40" name={item.name} poster={item.logo} onOpen={() => openItem(item)} />)}
        </Row>
      )}
      {categories.length > 1 && (
        <Row title={t('home.categories')}>
          {categories.map((g) => (
            <button key={g.name} type="button" onClick={() => navigate('live', g.name)} className="card w-44 p-4 text-start transition duration-200 hover:border-line-strong active:scale-[0.98]">
              <span className="block truncate text-sm font-medium">{g.name}</span>
              <span className="mt-1 block font-mono text-xs text-faint tabular">{t('count.channels', { n: g.count.toLocaleString() })}</span>
            </button>
          ))}
        </Row>
      )}
      {recentlyAdded.length > 0 && (
        <Row title={t('home.recentlyAdded')} onSeeAll={() => navigate(movies.length ? 'movies' : 'series')}>
          {recentlyAdded.map((item) => <PosterCard key={item.id} className="!w-36 lg:!w-40" name={item.name} poster={item.logo} meta={item.year ? String(item.year) : item.group} onOpen={() => openItem(item)} />)}
        </Row>
      )}
    </div>
  );
}
