'use client';

import type { ThemeMode } from '@/types';
import { app, updateSettings } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { IconButton } from '../ui/controls';

const NEXT_THEME: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: 'system', light: 'sun', dark: 'moon' } as const;

/** Cycles System → Light → Dark. Applied instantly, remembered, and restored before first paint. */
export function ThemeSwitch() {
  const { t } = useI18n();
  const theme = useStore(app, (s) => s.settings.theme);
  return <IconButton icon={THEME_ICON[theme]} label={`${t('common.theme')} · ${t(`settings.${theme}`)}`} onClick={() => updateSettings({ theme: NEXT_THEME[theme] })} />;
}

export function LanguageSwitch() {
  const { t, lang } = useI18n();
  return (
    <button
      type="button" aria-label={t('common.language')} title={t('common.language')} onClick={() => updateSettings({ language: lang === 'en' ? 'ar' : 'en' })}
      className="h-10 rounded-md px-2.5 text-[0.8rem] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
    >
      <span className={lang === 'ar' ? 'text-fg' : undefined}>ع</span><span className="mx-1.5 text-faint">|</span><span className={lang === 'en' ? 'text-fg' : undefined}>EN</span>
    </button>
  );
}
