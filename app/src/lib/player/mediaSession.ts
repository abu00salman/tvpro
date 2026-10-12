interface NowPlaying {
  title: string;
  subtitle?: string;
  artwork?: string;
  onPrevious?: () => void;
  onNext?: () => void;
}

/** Progressive enhancement only — silently does nothing where unsupported. */
export function announceNowPlaying({ title, subtitle, artwork, onPrevious, onNext }: NowPlaying): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: subtitle ?? 'TV Pro', album: 'TV Pro',
      artwork: artwork ? [{ src: artwork }] : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('previoustrack', onPrevious ?? null);
    navigator.mediaSession.setActionHandler('nexttrack', onNext ?? null);
  } catch {
    /* partial implementations throw on unknown actions */
  }
}

export function clearNowPlaying(): void {
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) navigator.mediaSession.metadata = null;
}
