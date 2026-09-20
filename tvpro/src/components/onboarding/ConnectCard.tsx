'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { addPlaylist } from '@/store/app';
import { AppError } from '@/lib/errors';
import type { PlaylistInput } from '@/lib/iptv/importer';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import { cx } from '@/lib/utils';
import { Icon, type IconName } from '../ui/Icon';
import { Spinner } from '../ui/controls';

type Tab = 'm3u' | 'server' | 'file';
const TABS: Array<{ id: Tab; label: MessageKey; icon: IconName }> = [
  { id: 'm3u', label: 'connect.tab.m3u', icon: 'link' },
  { id: 'server', label: 'connect.tab.server', icon: 'server' },
  { id: 'file', label: 'connect.tab.file', icon: 'upload' },
];

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.8rem] font-medium text-muted">{label}</label>
      {children(id)}
    </div>
  );
}

/** The one form every viewer must pass through — so it gets the most care. */
export function ConnectCard({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('m3u');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [epgUrl, setEpgUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ready = tab === 'm3u' ? url.trim() : tab === 'server' ? server.trim() && username.trim() && password : file;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    const input: PlaylistInput =
      tab === 'm3u' ? { kind: 'm3u', name, url, epgUrl }
      : tab === 'server' ? { kind: 'xtream', name, server, username, password }
      : { kind: 'file', name, file: file!, epgUrl };
    setBusy(true);
    setError(null);
    try {
      await addPlaylist(input);
      setPassword('');
      onDone?.();
    } catch (err) {
      setError(`err.${err instanceof AppError ? err.code : 'unknown'}` as MessageKey);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card relative w-full max-w-md overflow-hidden p-6 shadow-soft sm:p-8" aria-busy={busy}>
      <div role="tablist" aria-label={t('connect.title')} className="mb-6 grid grid-cols-3 rounded-md border border-line bg-base p-0.5">
        {TABS.map((x) => (
          <button
            key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => { setTab(x.id); setError(null); }}
            className={cx('flex h-10 items-center justify-center gap-1.5 rounded-[8px] text-[0.8rem] transition-colors duration-150',
              tab === x.id ? 'bg-surface font-medium text-fg shadow-soft' : 'text-muted hover:text-fg')}
          >
            <Icon name={x.icon} size={15} className="hidden min-[380px]:block" /> {t(x.label)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <Field label={t(tab === 'server' ? 'connect.profileName' : 'connect.playlistName')}>
          {(id) => <input id={id} className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('connect.namePlaceholder')} maxLength={60} autoComplete="off" />}
        </Field>

        {tab === 'm3u' && (
          <Field label={t('connect.m3uUrl')}>
            {(id) => <input id={id} dir="ltr" className="field" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} autoCapitalize="off" />}
          </Field>
        )}

        {tab === 'server' && (
          <>
            <Field label={t('connect.serverUrl')}>
              {(id) => <input id={id} dir="ltr" className="field" type="url" inputMode="url" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} autoCapitalize="off" />}
            </Field>
            <Field label={t('connect.username')}>
              {(id) => <input id={id} dir="ltr" className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" />}
            </Field>
            <Field label={t('connect.password')}>
              {(id) => (
                <div className="relative">
                  <input id={id} dir="ltr" className="field pe-12" type={reveal ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                  <button type="button" onClick={() => setReveal((r) => !r)} aria-label={t(reveal ? 'connect.hidePassword' : 'connect.showPassword')} className="absolute end-1 top-1 grid h-10 w-10 place-items-center rounded-md text-faint hover:text-fg">
                    <Icon name={reveal ? 'eyeOff' : 'eye'} size={18} />
                  </button>
                </div>
              )}
            </Field>
          </>
        )}

        {tab === 'file' && (
          <button
            type="button" onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); setFile(e.dataTransfer.files[0] ?? null); }}
            className={cx('flex w-full flex-col items-center gap-1 rounded-md border border-dashed px-4 py-8 text-center transition-colors duration-150',
              dragging ? 'border-accent bg-accent/5' : 'border-line-strong hover:border-faint')}
          >
            <Icon name="upload" size={22} className="mb-1 text-faint" />
            <span className="max-w-full truncate text-sm font-medium">{file ? file.name : t('connect.chooseFile')}</span>
            <span className="text-xs text-faint">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : t('connect.dropFile')}</span>
            <input ref={fileRef} type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl" className="sr-only" tabIndex={-1} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </button>
        )}

        {tab !== 'server' && (
          <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-[0.8rem] text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              <Icon name="chevron" size={14} className="transition-transform duration-150 group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:rotate-90" /> {t('connect.advanced')}
            </summary>
            <div className="pt-3">
              <Field label={t('connect.epgUrl')}>
                {(id) => <input id={id} dir="ltr" className="field" type="url" inputMode="url" value={epgUrl} onChange={(e) => setEpgUrl(e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} />}
              </Field>
              <p className="mt-1.5 text-xs text-faint">{t('connect.epgHint')}</p>
            </div>
          </details>
        )}
      </div>

      {error && <p role="alert" className="mt-4 rounded-md border border-live/25 bg-live/5 px-3.5 py-2.5 text-sm leading-relaxed text-fg">{t(error)}</p>}

      <button type="submit" disabled={!ready || busy} className="btn-primary mt-6 h-12 w-full text-[0.95rem]">{t('connect.submit')}</button>
      <p className="mt-4 text-center text-xs text-faint">{t('connect.authorized')}</p>

      {busy && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface/90 backdrop-blur-sm" role="status">
          <div className="flex flex-col items-center gap-4 text-accent">
            <Spinner size={32} />
            <p className="text-sm font-medium text-fg">{t('connect.connecting')}</p>
          </div>
        </div>
      )}
    </form>
  );
}
