'use client';

import { useMemo } from 'react';
import type { Channel, Movie, Series } from '@/types';
import { app, navigate } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useLibraryMaps } from '@/hooks/useLibrary';
import { useI18n } from '@/lib/i18n';
import { ChannelCard } from '../home/ChannelCard';
import { openChannel } from '../home/Home';
import { EmptyState, PageHeader } from '../ui/controls';
import { PosterCard } from '../ui/PosterCard';

/** Favorites and Recently watched are the same screen fed by a different list. */
export function Collection({ source }: { source: 'favorites' | 'recent' }) {
  const { t } = useI18n();
  const favorites = useStore(app, (s) => s.favorites);
  const history = useStore(app, (s) => s.history);
  const maps = useLibraryMaps();

  const items = useMemo(() => {
    const keys = source === 'favorites'
      ? Object.values(favorites).sort((a, b) => b.addedAt - a.addedAt).map((f) => f.key)
      : Object.values(history).sort((a, b) => b.updatedAt - a.updatedAt).map((h) => h.key);
    return keys.flatMap((key): Array<Channel | Movie | Series> => {
      const id = key.slice(2);
      const item = key[0] === 'c' ? maps.channels.get(id) : key[0] === 'm' ? maps.movies.get(id) : maps.series.get(id);
      return item ? [item] : [];
    });
  }, [source, favorites, history, maps]);

  const channels = items.filter((i): i is Channel => i.kind === 'channel');
  const titles = items.filter((i): i is Movie | Series => i.kind !== 'channel');
  const title = t(source === 'favorites' ? 'nav.favorites' : 'nav.recent');

  if (!items.length) {
    return source === 'favorites'
      ? <EmptyState icon="heart" title={t('empty.favorites')} body={t('empty.favoritesBody')} />
      : <EmptyState icon="clock" title={t('empty.recent')} body={t('empty.recentBody')} />;
  }
  return (
    <div className="pb-28 lg:pb-10">
      <PageHeader title={title} meta={t('count.items', { n: items.length })} />
      {channels.length > 0 && (
        <section className="mb-10">
          <h2 className="eyebrow mb-3">{t('search.channels')}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {channels.map((c) => <div key={c.id} className="[&>button]:w-full"><ChannelCard channel={c} onOpen={() => openChannel(c.id)} /></div>)}
          </div>
        </section>
      )}
      {titles.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">{t('search.movies')} · {t('search.series')}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.25rem,1fr))] gap-5">
            {titles.map((i) => <PosterCard key={i.id} name={i.name} poster={i.logo} meta={i.year ? String(i.year) : i.group} onOpen={() => navigate(i.kind === 'movie' ? 'movie' : 'show', i.id)} />)}
          </div>
        </section>
      )}
    </div>
  );
}
