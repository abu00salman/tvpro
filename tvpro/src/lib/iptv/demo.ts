import type { Channel, Movie, Series } from '@/types';
import type { ParsedLibrary } from '../m3u/parser';

/**
 * Demo mode: public HLS reference streams published for player testing and
 * Creative-Commons open movies from the Blender Foundation. No commercial channels.
 * Delete this file and the "Explore demo" button to remove sample data entirely.
 */
export const DEMO_PLAYLIST_ID = 'demo';

const BBB = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const SINTEL = 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8';
const TEARS = 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8';

export function buildDemoLibrary(): ParsedLibrary {
  const p = DEMO_PLAYLIST_ID;
  const channels: Channel[] = [
    { kind: 'channel', id: 'demo-c1', playlistId: p, number: 1, name: 'Live Test Signal', group: 'Reference', url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8' },
    { kind: 'channel', id: 'demo-c2', playlistId: p, number: 2, name: 'Bip-Bop Multi-Bitrate', group: 'Reference', url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8' },
    { kind: 'channel', id: 'demo-c3', playlistId: p, number: 3, name: 'Open Movies Loop', group: 'Open Movies', url: BBB },
    { kind: 'channel', id: 'demo-c4', playlistId: p, number: 4, name: 'Sintel Channel', group: 'Open Movies', url: SINTEL },
  ];
  const movies: Movie[] = [
    { kind: 'movie', id: 'demo-m1', playlistId: p, name: 'Sintel', group: 'Open Movies', year: 2010, genre: 'Animation · Fantasy', plot: 'A lonely young woman searches the world for the baby dragon she once rescued. An open movie by the Blender Foundation (CC BY 3.0).', url: SINTEL },
    { kind: 'movie', id: 'demo-m2', playlistId: p, name: 'Tears of Steel', group: 'Open Movies', year: 2012, genre: 'Sci-Fi · Short', plot: 'In a future Amsterdam, a group of warriors and scientists attempt to rescue the world from destructive robots. Blender Foundation (CC BY 3.0).', url: TEARS },
    { kind: 'movie', id: 'demo-m3', playlistId: p, name: 'Big Buck Bunny', group: 'Open Movies', year: 2008, genre: 'Animation · Comedy', plot: 'A gentle giant rabbit finally loses patience with three bullying rodents. Blender Foundation (CC BY 3.0).', url: BBB },
  ];
  const series: Series[] = [{
    kind: 'series', id: 'demo-s1', playlistId: p, name: 'Blender Open Movies', group: 'Open Movies',
    plot: 'The open-source short films, collected as one season.',
    seasons: [{ number: 1, episodes: [
      { id: 'demo-e1', season: 1, number: 1, title: 'Big Buck Bunny', url: BBB },
      { id: 'demo-e2', season: 1, number: 2, title: 'Sintel', url: SINTEL },
      { id: 'demo-e3', season: 1, number: 3, title: 'Tears of Steel', url: TEARS },
    ] }],
  }];
  return { channels, movies, series };
}

/** A small looping schedule so the guide can be explored in demo mode. */
export function buildDemoEpg(now = Date.now()): Record<string, import('@/types').EPGProgram[]> {
  const titles: Record<string, string[]> = {
    'demo-c1': ['Test Signal'],
    'demo-c2': ['Bip-Bop Reference', 'Bitrate Ladder Check'],
    'demo-c3': ['Big Buck Bunny', 'Tears of Steel', 'Sintel'],
    'demo-c4': ['Sintel', 'Sintel — Making Of'],
  };
  const slot = 30 * 60_000;
  const first = Math.floor(now / slot) * slot - 2 * slot;
  const out: Record<string, import('@/types').EPGProgram[]> = {};
  for (const [channelId, list] of Object.entries(titles)) {
    out[channelId] = Array.from({ length: 24 }, (_, i) => ({
      channelId, title: list[i % list.length], start: first + i * slot, end: first + (i + 1) * slot,
    }));
  }
  return out;
}
