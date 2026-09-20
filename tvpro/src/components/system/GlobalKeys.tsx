'use client';

import { useEffect } from 'react';
import { goBack } from '@/store/app';
import { directionFor, isBackKey, moveFocus } from '@/lib/navigation/spatial';

/**
 * Remote / D-pad support for the whole app: arrows move focus geometrically, Back goes back.
 * Runs in the bubble phase, so anything that already handled the key (the player, a text field) wins.
 */
export function GlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isBackKey(e)) { e.preventDefault(); goBack(); return; }
      if (e.key === 'Escape' && !document.fullscreenElement) {
        const el = e.target as HTMLElement | null;
        if (el instanceof HTMLInputElement && el.value) return; // let search fields clear first
        goBack();
        return;
      }
      const dir = directionFor(e);
      if (dir && moveFocus(dir)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
