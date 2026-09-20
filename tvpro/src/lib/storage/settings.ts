import type { UserSettings } from '@/types';

const KEY = 'tvpro:settings';

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  language: 'en',
  engine: 'auto',
  quality: 'auto',
  autoPlay: true,
  pictureInPicture: true,
  epg: true,
  developerMode: false,
  volume: 1,
  muted: false,
};

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota: settings stay in memory */
  }
}
