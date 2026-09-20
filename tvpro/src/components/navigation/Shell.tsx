'use client';

import { useState, type ReactNode } from 'react';
import type { View } from '@/types';
import { app, navigate } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import { cx } from '@/lib/utils';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { LanguageSwitch, ThemeSwitch } from './switches';

interface NavItem { view: View; label: MessageKey; icon: IconName }
const PRIMARY: NavItem[] = [
  { view: 'home', label: 'nav.home', icon: 'home' },
  { view: 'live', label: 'nav.live', icon: 'live' },
  { view: 'movies', label: 'nav.movies', icon: 'movies' },
  { view: 'series', label: 'nav.series', icon: 'series' },
];
const LIBRARY: NavItem[] = [
  { view: 'guide', label: 'nav.guide', icon: 'guide' },
  { view: 'favorites', label: 'nav.favorites', icon: 'heart' },
  { view: 'recent', label: 'nav.recent', icon: 'clock' },
  { view: 'search', label: 'nav.search', icon: 'search' },
];
const SYSTEM: NavItem[] = [
  { view: 'playlists', label: 'nav.playlists', icon: 'playlists' },
  { view: 'settings', label: 'nav.settings', icon: 'settings' },
];
/** Detail screens highlight their parent section. */
const PARENT: Partial<Record<View, View>> = { movie: 'movies', show: 'series', connect: 'playlists' };

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useI18n();
  return (
    <a
      href={`#/${item.view}`} aria-current={active ? 'page' : undefined} title={t(item.label)}
      className={cx('flex h-11 items-center gap-3 rounded-md px-3 text-[0.9rem] transition-colors duration-150 lg:max-xl:justify-center lg:max-xl:px-0',
        active ? 'bg-raised font-medium text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg')}
    >
      <Icon name={item.icon} size={20} className={active ? 'text-accent' : undefined} filled={active && item.icon === 'heart'} />
      <span className="truncate lg:max-xl:sr-only">{t(item.label)}</span>
    </a>
  );
}

export function Shell({ children, flush }: { children: ReactNode; flush?: boolean }) {
  const { t } = useI18n();
  const view = useStore(app, (s) => s.route.view);
  const current = PARENT[view] ?? view;
  const [more, setMore] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-white">{t('nav.skip')}</a>

      {/* Sidebar — icon rail on laptops, full labels on wide screens and TVs */}
      <aside className="hidden w-[4.5rem] shrink-0 flex-col border-e border-line bg-surface/60 px-3 pb-4 lg:flex xl:w-60">
        <a href="#/home" className="flex h-16 items-center rounded-md px-1.5 lg:max-xl:justify-center" aria-label="TV Pro">
          <span className="xl:hidden"><Logo className="[&>span:last-child]:hidden" /></span>
          <span className="hidden xl:inline"><Logo /></span>
        </a>
        <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {PRIMARY.map((i) => <SideLink key={i.view} item={i} active={current === i.view} />)}
          <span className="my-3 h-px bg-line" />
          {LIBRARY.map((i) => <SideLink key={i.view} item={i} active={current === i.view} />)}
          <span className="flex-1" />
          {SYSTEM.map((i) => <SideLink key={i.view} item={i} active={current === i.view} />)}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe z-30 shrink-0 border-b border-line bg-base/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-2 px-4 lg:h-16 lg:px-8">
            <a href="#/home" className="rounded-md lg:hidden" aria-label="TV Pro"><Logo size={26} /></a>
            <button
              type="button" onClick={() => navigate('search')}
              className="ms-auto hidden h-10 w-full max-w-sm items-center gap-2.5 rounded-md border border-line bg-surface px-3.5 text-start text-sm text-faint transition-colors hover:border-line-strong sm:flex lg:ms-0"
            >
              <Icon name="search" size={16} /> {t('search.placeholder')}
            </button>
            <span className="flex-1 max-sm:hidden" />
            <span className="ms-auto flex items-center gap-0.5 sm:ms-0">
              <span className="sm:hidden"><button type="button" onClick={() => navigate('search')} aria-label={t('nav.search')} className="grid h-10 w-10 place-items-center rounded-md text-muted"><Icon name="search" /></button></span>
              <LanguageSwitch /><ThemeSwitch />
            </span>
          </div>
        </header>

        <main id="main" tabIndex={-1} className={cx('min-h-0 flex-1', flush ? 'overflow-hidden lg:p-5 lg:pb-0' : 'overflow-y-auto overscroll-contain px-4 pt-4 lg:px-8 lg:pt-6')}>
          <div key={current} className={cx('view-enter', flush ? 'h-full' : 'mx-auto h-full max-w-[110rem]')}>{children}</div>
        </main>
      </div>

      {/* Phone / tablet navigation */}
      <nav aria-label={t('nav.main')} className="glass pb-safe fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 lg:hidden landscape:max-lg:hidden">
        {more && (
          <div className="pop-enter grid grid-cols-3 gap-1 border-b border-line p-2" data-focus-scope>
            {[...LIBRARY.filter((i) => i.view !== 'search'), ...SYSTEM].map((i) => (
              <a key={i.view} href={`#/${i.view}`} onClick={() => setMore(false)} className={cx('flex flex-col items-center gap-1 rounded-md py-3 text-[0.7rem]', current === i.view ? 'text-accent' : 'text-muted')}>
                <Icon name={i.icon} size={20} />{t(i.label)}
              </a>
            ))}
          </div>
        )}
        <div className="grid h-14 grid-cols-5">
          {PRIMARY.map((i) => (
            <a key={i.view} href={`#/${i.view}`} onClick={() => setMore(false)} aria-current={current === i.view ? 'page' : undefined}
              className={cx('flex flex-col items-center justify-center gap-0.5 text-[0.65rem] transition-colors', current === i.view && !more ? 'text-accent' : 'text-muted')}>
              <Icon name={i.icon} size={21} />{t(i.label)}
            </a>
          ))}
          <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)}
            className={cx('flex flex-col items-center justify-center gap-0.5 text-[0.65rem]', more || ![...PRIMARY].some((i) => i.view === current) ? 'text-accent' : 'text-muted')}>
            <Icon name="more" size={21} />{t('nav.more')}
          </button>
        </div>
      </nav>
    </div>
  );
}
