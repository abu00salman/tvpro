'use client';

import { useState } from 'react';
import { addPlaylist, navigate } from '@/store/app';
import { useI18n } from '@/lib/i18n';
import { Icon, type IconName } from '../ui/Icon';
import { Logo, LogoMark } from '../ui/Logo';
import { LanguageSwitch, ThemeSwitch } from '../navigation/switches';
import { ConnectCard } from './ConnectCard';
import type { MessageKey } from '@/lib/i18n/en';

const FEATURES: Array<{ icon: IconName; title: MessageKey; body: MessageKey }> = [
  { icon: 'bolt', title: 'landing.fast', body: 'landing.fastBody' },
  { icon: 'lock', title: 'landing.private', body: 'landing.privateBody' },
  { icon: 'sparkle', title: 'landing.beautiful', body: 'landing.beautifulBody' },
];

/** First run: a short landing, then the connect card. The product is the hero — no marketing scroll. */
export function Onboarding() {
  const { t } = useI18n();
  const [step, setStep] = useState<'landing' | 'connect'>('landing');
  const [demoBusy, setDemoBusy] = useState(false);

  const startDemo = async () => {
    setDemoBusy(true);
    try { await addPlaylist({ kind: 'demo' }); navigate('home'); } finally { setDemoBusy(false); }
  };

  return (
    <div className="pt-safe pb-safe relative flex min-h-dvh flex-col overflow-hidden">
      {/* a single, quiet light source behind the content */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-[30rem] left-1/2 h-[52rem] w-[52rem] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl" />

      <header className="relative z-10 flex items-center justify-between px-5 py-4 lg:px-8">
        <button type="button" onClick={() => setStep('landing')} aria-label="TV Pro" className="rounded-md"><Logo /></button>
        <div className="flex items-center gap-1"><LanguageSwitch /><ThemeSwitch /></div>
      </header>

      <main id="main" className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-8">
        {step === 'landing' ? (
          <div className="view-enter flex w-full max-w-3xl flex-col items-center text-center">
            <LogoMark size={56} className="mb-8 rounded-[27%] shadow-pop" />
            <h1 className="text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-7xl rtl:leading-[1.25] rtl:tracking-normal">
              {t('landing.line1')}<br /><span className="text-muted">{t('landing.line2')}</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted sm:text-lg">{t('landing.body')}</p>
            <div className="mt-9 flex flex-col items-center gap-2 sm:flex-row">
              <button type="button" data-autofocus className="btn-primary h-12 px-7 text-[0.95rem]" onClick={() => setStep('connect')}>{t('landing.cta')}</button>
              <button type="button" className="btn-ghost h-12 px-5 text-[0.95rem]" onClick={startDemo} disabled={demoBusy}>{t('landing.demo')}</button>
            </div>
            <ul className="mt-16 grid w-full gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="bg-surface p-5 text-start">
                  <Icon name={f.icon} size={18} className="mb-3 text-accent" />
                  <p className="text-sm font-semibold">{t(f.title)}</p>
                  <p className="mt-1 text-[0.8rem] leading-relaxed text-muted">{t(f.body)}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="view-enter flex w-full flex-col items-center">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{t('connect.title')}</h1>
            <p className="mb-7 mt-1.5 text-sm text-muted">{t('connect.subtitle')}</p>
            <ConnectCard onDone={() => navigate('home')} />
          </div>
        )}
      </main>

      <footer className="relative z-10 mx-auto max-w-2xl px-6 pb-6 text-center text-[0.7rem] leading-relaxed text-faint">
        <p>{t('legal.provider')}</p>
      </footer>
    </div>
  );
}
