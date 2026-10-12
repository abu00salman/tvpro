'use client';

import { useState } from 'react';
import type { Playlist, PlaylistType } from '@/types';
import { app, activatePlaylist, navigate, refreshPlaylist, removePlaylist, renamePlaylist } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { AppError } from '@/lib/errors';
import { cx } from '@/lib/utils';
import { Icon, type IconName } from '../ui/Icon';
import { EmptyState, IconButton, PageHeader, Spinner } from '../ui/controls';

const TYPE_ICON: Record<PlaylistType, IconName> = { 'm3u-url': 'link', 'm3u-file': 'upload', xtream: 'server', demo: 'sparkle' };
const REFRESHABLE: ReadonlySet<PlaylistType> = new Set<PlaylistType>(['m3u-url', 'xtream']);

type RowMode = 'idle' | 'rename' | 'confirm' | 'busy';

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-sm tabular text-fg">{value.toLocaleString('en-US')}</span>
      <span className="text-xs text-faint">{label}</span>
    </span>
  );
}

function PlaylistItem({ playlist, active }: { playlist: Playlist; active: boolean }) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<RowMode>('idle');
  const [name, setName] = useState(playlist.name);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = async () => {
    setMode('busy'); setNotice(null);
    try {
      await refreshPlaylist(playlist.id);
      setNotice({ tone: 'ok', text: t('playlists.refreshed') });
    } catch (e) {
      setNotice({ tone: 'error', text: t(`err.${e instanceof AppError ? e.code : 'unknown'}`) });
    } finally { setMode('idle'); }
  };

  const save = async () => { await renamePlaylist(playlist.id, name); setMode('idle'); };
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(playlist.updatedAt);

  return (
    <li className={cx('card p-4 transition-colors sm:p-5', active && 'border-accent/40')}>
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-line bg-base text-muted">
          <Icon name={TYPE_ICON[playlist.type]} size={20} />
        </span>

        <div className="min-w-0 flex-1">
          {mode === 'rename' ? (
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <input
                autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={t('connect.playlistName')}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setName(playlist.name); setMode('idle'); } }}
                className="field h-10 min-w-0 flex-1"
              />
              <button type="submit" className="btn-primary h-10 px-4 text-sm">{t('playlists.save')}</button>
              <button type="button" className="btn-ghost h-10 text-sm" onClick={() => { setName(playlist.name); setMode('idle'); }}>{t('playlists.cancel')}</button>
            </form>
          ) : (
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-base font-semibold tracking-tight" dir="auto">{playlist.name}</h2>
              {active && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[0.7rem] font-medium text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />{t('playlists.active')}
                </span>
              )}
            </div>
          )}
          <p className="mt-1 text-xs text-faint">
            {t(`playlists.type.${playlist.type}`)}<span className="mx-1.5">·</span>{t('playlists.updated', { date: updated })}
          </p>
          <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1">
            <Count value={playlist.counts.channels} label={t('search.channels')} />
            <Count value={playlist.counts.movies} label={t('search.movies')} />
            <Count value={playlist.counts.series} label={t('search.series')} />
          </div>
        </div>

        {mode === 'busy' ? <Spinner size={20} className="m-2.5 text-muted" /> : mode !== 'rename' && (
          <div className="-me-1.5 -mt-1.5 flex shrink-0 items-center">
            {REFRESHABLE.has(playlist.type) && <IconButton icon="refresh" label={t('playlists.refresh')} onClick={() => void refresh()} />}
            <IconButton icon="edit" label={t('playlists.edit')} onClick={() => { setNotice(null); setMode('rename'); }} />
            <IconButton icon="trash" label={t('playlists.remove')} onClick={() => setMode('confirm')} />
          </div>
        )}
      </div>

      {mode === 'confirm' && (
        <div role="alertdialog" aria-label={t('playlists.remove')} data-focus-scope className="pop-enter mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-base p-3 ps-4">
          <p className="text-sm text-muted">{t('playlists.confirmRemove', { name: playlist.name })}</p>
          <span className="flex gap-2">
            <button type="button" autoFocus className="btn-ghost h-9 text-sm" onClick={() => setMode('idle')}>{t('playlists.cancel')}</button>
            <button type="button" className="btn h-9 bg-live/10 px-4 text-sm font-medium text-live hover:bg-live/20" onClick={() => void removePlaylist(playlist.id)}>{t('playlists.remove')}</button>
          </span>
        </div>
      )}

      {notice && <p role="status" className={cx('mt-3 text-sm', notice.tone === 'ok' ? 'text-muted' : 'text-live')}>{notice.text}</p>}

      {!active && mode === 'idle' && (
        <button type="button" className="btn-quiet mt-4 h-9 px-4 text-sm" onClick={() => void activatePlaylist(playlist.id).then(() => navigate('home'))}>
          {t('playlists.use')}
        </button>
      )}
    </li>
  );
}

export function PlaylistManager() {
  const { t } = useI18n();
  const playlists = useStore(app, (s) => s.playlists);
  const activeId = useStore(app, (s) => s.activePlaylistId);
  const hasSecrets = playlists.some((p) => p.secret);

  return (
    <div className="mx-auto max-w-3xl pb-28 lg:pb-10">
      <PageHeader title={t('playlists.title')}>
        <button type="button" className="btn-primary h-10 gap-2 px-4 text-sm" onClick={() => navigate('connect')}>
          <Icon name="plus" size={16} />{t('playlists.add')}
        </button>
      </PageHeader>

      {playlists.length === 0 ? (
        <EmptyState icon="playlists" title={t('empty.playlists')} body={t('empty.playlistsBody')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {playlists.map((p) => <PlaylistItem key={p.id} playlist={p} active={p.id === activeId} />)}
        </ul>
      )}

      {hasSecrets && (
        <p className="mt-5 flex items-center gap-2 text-xs text-faint"><Icon name="lock" size={14} />{t('playlists.credentials')}</p>
      )}
    </div>
  );
}
