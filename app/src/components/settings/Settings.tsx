'use client';

import { useState, type ReactNode } from 'react';
import type { EnginePreference, Language, QualityPreference, ThemeMode } from '@/types';
import { app, clearCache, clearHistory, navigate, reloadGuide, updateSettings } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { LogoMark } from '../ui/Logo';
import { Icon } from '../ui/Icon';
import { PageHeader, Segmented, Toggle } from '../ui/controls';

export const APP_VERSION = '1.0.0';

const PIP_SUPPORTED = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="eyebrow mb-2.5 px-1">{title}</h2>
      <div className="card divide-y divide-line">{children}</div>
    </section>
  );
}

function Item({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[3.75rem] flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="text-[0.925rem] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[0.8rem] leading-relaxed text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A destructive-ish action that confirms itself by briefly turning into a check mark. */
function ClearButton({ action }: { action: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const run = async () => { await action(); setDone(true); setTimeout(() => setDone(false), 1800); };
  return (
    <button type="button" className="btn-quiet h-9 min-w-[5.5rem] gap-1.5 px-4 text-sm" onClick={() => void run()} disabled={done}>
      {done ? <><Icon name="check" size={15} className="text-accent" />{t('settings.cleared')}</> : t('settings.clear')}
    </button>
  );
}

export function Settings() {
  const { t } = useI18n();
  const s = useStore(app, (state) => state.settings);

  const themes: ReadonlyArray<{ value: ThemeMode; label: string; icon: 'sun' | 'moon' | 'system' }> = [
    { value: 'light', label: t('settings.light'), icon: 'sun' },
    { value: 'dark', label: t('settings.dark'), icon: 'moon' },
    { value: 'system', label: t('settings.system'), icon: 'system' },
  ];
  const languages: ReadonlyArray<{ value: Language; label: string }> = [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }];
  const engines: ReadonlyArray<{ value: EnginePreference; label: string }> = [
    { value: 'auto', label: t('settings.engine.auto') }, { value: 'hlsjs', label: t('settings.engine.hlsjs') }, { value: 'native', label: t('settings.engine.native') },
  ];
  const qualities: ReadonlyArray<{ value: QualityPreference; label: string }> = [
    { value: 'auto', label: t('player.auto') }, { value: 2160, label: '4K' }, { value: 1080, label: '1080p' }, { value: 720, label: '720p' }, { value: 480, label: '480p' },
  ];

  return (
    <div className="mx-auto max-w-3xl pb-28 lg:pb-10">
      <PageHeader title={t('nav.settings')} />

      <Section title={t('settings.appearance')}>
        <Item label={t('settings.theme')}><Segmented label={t('settings.theme')} value={s.theme} options={themes} onChange={(theme) => updateSettings({ theme })} /></Item>
        <Item label={t('settings.language')}><Segmented label={t('settings.language')} value={s.language} options={languages} onChange={(language) => updateSettings({ language })} /></Item>
      </Section>

      <Section title={t('settings.playback')}>
        <Item label={t('settings.engine')}><Segmented label={t('settings.engine')} value={s.engine} options={engines} onChange={(engine) => updateSettings({ engine })} /></Item>
        <Item label={t('settings.quality')}><Segmented label={t('settings.quality')} value={s.quality} options={qualities} onChange={(quality) => updateSettings({ quality })} /></Item>
        <Item label={t('settings.autoPlay')} hint={t('settings.autoPlayHint')}><Toggle label={t('settings.autoPlay')} checked={s.autoPlay} onChange={(autoPlay) => updateSettings({ autoPlay })} /></Item>
        {PIP_SUPPORTED && (
          <Item label={t('settings.pip')}><Toggle label={t('settings.pip')} checked={s.pictureInPicture} onChange={(pictureInPicture) => updateSettings({ pictureInPicture })} /></Item>
        )}
        <Item label={t('settings.epg')} hint={t('settings.epgHint')}>
          <Toggle label={t('settings.epg')} checked={s.epg} onChange={(epg) => { updateSettings({ epg }); if (epg) reloadGuide(); }} />
        </Item>
        <Item label={t('settings.parental')} hint={t('settings.parentalHint')}>
          <span className="rounded-full border border-line px-2.5 py-1 text-[0.7rem] font-medium text-faint">{t('settings.soon')}</span>
        </Item>
      </Section>

      <Section title={t('settings.data')}>
        <Item label={t('settings.managePlaylists')}>
          <button type="button" className="btn-quiet h-9 gap-1 px-4 text-sm" onClick={() => navigate('playlists')}>
            {t('nav.playlists')}<Icon name="chevron" size={15} className="rtl:-scale-x-100" />
          </button>
        </Item>
        <Item label={t('settings.clearHistory')}><ClearButton action={clearHistory} /></Item>
        <Item label={t('settings.clearCache')}><ClearButton action={clearCache} /></Item>
        <Item label={t('settings.developer')} hint={t('settings.developerHint')}>
          <Toggle label={t('settings.developer')} checked={s.developerMode} onChange={(developerMode) => updateSettings({ developerMode })} />
        </Item>
      </Section>

      <Section title={t('settings.about')}>
        <div className="px-4 py-5 sm:px-5">
          <div className="flex items-center gap-3.5">
            <LogoMark size={44} />
            <div>
              <p className="text-base font-semibold tracking-tight">TV Pro</p>
              <p className="text-[0.8rem] text-muted">{t('brand.tagline')}<span className="mx-1.5 text-faint">·</span><span className="font-mono text-xs text-faint">{t('settings.version', { v: APP_VERSION })}</span></p>
            </div>
          </div>
          <p className="mt-5 flex gap-2.5 text-sm leading-relaxed text-muted"><Icon name="lock" size={16} className="mt-0.5 shrink-0 text-accent" />{t('settings.privacy')}</p>
          <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-faint">
            <p>{t('legal.provider')}</p>
            <p>{t('legal.player')}</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
