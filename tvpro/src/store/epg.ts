import type { Channel, EPGProgram, Playlist, PlaylistSecret } from '@/types';
import type { EpgIndex } from '@/lib/epg/xmltv';
import { buildDemoEpg } from '@/lib/iptv/demo';
import { fetchSource, readText } from '@/lib/iptv/http';
import { parseXMLTVAsync } from '@/lib/iptv/workerClient';
import { db } from '@/lib/storage/db';
import { createStore } from './createStore';

/** The guide is a separate module with its own store: it can fail or be slow without touching playback. */
interface EpgState { index: EpgIndex; loading: boolean }
export const epgStore = createStore<EpgState>({ index: {}, loading: false });

const MAX_AGE = 6 * 3_600_000;
interface CachedEpg { savedAt: number; index: EpgIndex }

export const epgKey = (channel: Pick<Channel, 'id' | 'tvgId'>): string => channel.tvgId || channel.id;

export async function loadEpg(playlist: Playlist, secret?: PlaylistSecret): Promise<void> {
  if (playlist.type === 'demo') return epgStore.set({ index: buildDemoEpg() });
  const url = playlist.epgUrl ?? (secret?.type === 'xtream'
    ? `${secret.server.replace(/\/+$/, '')}/xmltv.php?username=${encodeURIComponent(secret.username)}&password=${encodeURIComponent(secret.password)}`
    : undefined);
  if (!url) return epgStore.set({ index: {} });

  const cacheKey = `epg:${playlist.id}`;
  epgStore.set({ loading: true });
  try {
    const cached = await db.get<CachedEpg>('kv', cacheKey);
    if (cached && Date.now() - cached.savedAt < MAX_AGE) return epgStore.set({ index: cached.index, loading: false });
    const index = await parseXMLTVAsync(await readText(await fetchSource(url, 60_000), url));
    epgStore.set({ index, loading: false });
    void db.put<CachedEpg>('kv', { savedAt: Date.now(), index }, cacheKey);
  } catch {
    epgStore.set({ loading: false }); // guide is optional: fail quietly
  }
}

export function mergePrograms(key: string, programs: EPGProgram[]): void {
  if (programs.length) epgStore.set((s) => ({ index: { ...s.index, [key]: programs } }));
}

export function nowAndNext(programs: EPGProgram[] | undefined, now: number): { current?: EPGProgram; next?: EPGProgram } {
  if (!programs?.length) return {};
  const i = programs.findIndex((p) => p.start <= now && p.end > now);
  return i < 0 ? { next: programs.find((p) => p.start > now) } : { current: programs[i], next: programs[i + 1] };
}
