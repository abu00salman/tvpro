'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import type { Route } from '@/types';
import { app, init, navigate } from '@/store/app';
import { useStore } from '@/store/createStore';
import { Shell } from '@/components/navigation/Shell';
import { Home } from '@/components/home/Home';
import { ConnectCard } from '@/components/onboarding/ConnectCard';
import { ErrorBoundary } from '@/components/system/ErrorBoundary';
import { GlobalKeys } from '@/components/system/GlobalKeys';
import { OfflineBanner } from '@/components/system/OfflineBanner';
import { ServiceWorker } from '@/components/system/ServiceWorker';
import { Splash, ViewSkeleton } from '@/components/system/Splash';

/* Each screen is its own chunk: first paint only pays for the shell and Home. */
const grid = () => <ViewSkeleton />;
const list = () => <ViewSkeleton variant="list" />;
const Onboarding = dynamic(() => import('@/components/onboarding/Onboarding').then((m) => m.Onboarding), { ssr: false, loading: Splash });
const LiveTV = dynamic(() => import('@/components/channels/LiveTV').then((m) => m.LiveTV), { ssr: false, loading: list });
const VodGrid = dynamic(() => import('@/components/movies/VodGrid').then((m) => m.VodGrid), { ssr: false, loading: grid });
const MovieDetail = dynamic(() => import('@/components/movies/MovieDetail').then((m) => m.MovieDetail), { ssr: false, loading: list });
const SeriesDetail = dynamic(() => import('@/components/series/SeriesDetail').then((m) => m.SeriesDetail), { ssr: false, loading: list });
const Collection = dynamic(() => import('@/components/favorites/Collection').then((m) => m.Collection), { ssr: false, loading: grid });
const SearchView = dynamic(() => import('@/components/search/SearchView').then((m) => m.SearchView), { ssr: false, loading: list });
const Guide = dynamic(() => import('@/components/epg/Guide').then((m) => m.Guide), { ssr: false, loading: list });
const PlaylistManager = dynamic(() => import('@/components/playlists/PlaylistManager').then((m) => m.PlaylistManager), { ssr: false, loading: list });
const Settings = dynamic(() => import('@/components/settings/Settings').then((m) => m.Settings), { ssr: false, loading: list });
const Watch = dynamic(() => import('@/components/player/Watch').then((m) => m.Watch), { ssr: false });

const FLUSH: ReadonlySet<Route['view']> = new Set<Route['view']>(['live', 'guide']);

function Screen({ route }: { route: Route }) {
  switch (route.view) {
    case 'live': return <LiveTV initialCategory={route.id} />;
    case 'movies': return <VodGrid key="movie" kind="movie" initialCategory={route.id} />;
    case 'series': return <VodGrid key="series" kind="series" initialCategory={route.id} />;
    case 'movie': return route.id ? <MovieDetail key={route.id} id={route.id} /> : <VodGrid kind="movie" />;
    case 'show': return route.id ? <SeriesDetail key={route.id} id={route.id} /> : <VodGrid kind="series" />;
    case 'favorites': return <Collection key="favorites" source="favorites" />;
    case 'recent': return <Collection key="recent" source="recent" />;
    case 'search': return <SearchView initialQuery={route.id} />;
    case 'guide': return <Guide />;
    case 'playlists': return <PlaylistManager />;
    case 'settings': return <Settings />;
    case 'connect':
      return <div className="grid min-h-full place-items-center pb-28 lg:pb-10"><ConnectCard onDone={() => navigate('home')} /></div>;
    default: return <Home />;
  }
}

export default function Page() {
  const ready = useStore(app, (s) => s.ready);
  const hasPlaylists = useStore(app, (s) => s.playlists.length > 0);
  const route = useStore(app, (s) => s.route);

  useEffect(() => { void init(); }, []);

  let content;
  if (!ready) content = <Splash />;
  else if (!hasPlaylists) content = <Onboarding />;
  else if (route.view === 'watch' && route.id) content = <Watch key={route.id} id={route.id} />;
  else content = <Shell flush={FLUSH.has(route.view)}><ErrorBoundary resetKey={`${route.view}/${route.id ?? ''}`}><Screen route={route} /></ErrorBoundary></Shell>;

  return (
    <ErrorBoundary>
      {content}
      <OfflineBanner />
      <GlobalKeys />
      <ServiceWorker />
    </ErrorBoundary>
  );
}
