import { useCallback } from 'react';
import type { Language } from '@/types';
import { app } from '@/store/app';
import { useStore } from '@/store/createStore';
import { ar } from './ar';
import { en, type Dictionary, type MessageKey } from './en';

/** Add a language: create `<code>.ts` typed as Dictionary (the compiler lists missing keys) and register it here. */
const DICTIONARIES: Record<Language, Dictionary> = { en, ar };
export const LOCALES: Record<Language, string> = { en: 'en', ar: 'ar' };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translate(lang: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[lang][key] ?? en[key];
  return params ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? '')) : template;
}

export function useI18n(): { t: Translate; lang: Language; locale: string; rtl: boolean } {
  const lang = useStore(app, (s) => s.settings.language);
  const t = useCallback<Translate>((key, params) => translate(lang, key, params), [lang]);
  return { t, lang, locale: LOCALES[lang], rtl: lang === 'ar' };
}
