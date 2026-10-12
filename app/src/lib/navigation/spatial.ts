/**
 * Geometry-based directional focus for TV remotes and keyboards.
 * Works with any layout (and with RTL) because it only looks at where things are on screen.
 */
type Direction = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]';
const KEYS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function candidates(): HTMLElement[] {
  const scopes = document.querySelectorAll<HTMLElement>('[data-focus-scope]');
  const root: ParentNode = scopes.length ? scopes[scopes.length - 1] : document;
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.getAttribute('aria-hidden') !== 'true';
  });
}

export function moveFocus(direction: Direction): boolean {
  const active = document.activeElement as HTMLElement | null;
  const list = candidates();
  if (!list.length) return false;
  if (!active || active === document.body || !list.includes(active)) {
    (document.querySelector<HTMLElement>('[data-autofocus]') ?? list[0]).focus();
    return true;
  }
  const from = active.getBoundingClientRect();
  const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - fx, dy = r.top + r.height / 2 - fy;
    const ahead =
      direction === 'up' ? r.bottom <= from.top + 4 : direction === 'down' ? r.top >= from.bottom - 4 :
      direction === 'left' ? r.right <= from.left + 4 : r.left >= from.right - 4;
    if (!ahead) continue;
    const vertical = direction === 'up' || direction === 'down';
    const primary = Math.abs(vertical ? dy : dx);
    const cross = Math.abs(vertical ? dx : dy);
    const overlaps = vertical ? r.right > from.left && r.left < from.right : r.bottom > from.top && r.top < from.bottom;
    const score = primary + cross * (overlaps ? 0.3 : 2.5);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  best.focus({ preventScroll: false });
  best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Returns a direction when the key should move focus, leaving text editing alone. */
export function directionFor(event: KeyboardEvent): Direction | null {
  const dir = KEYS[event.key];
  if (!dir || event.altKey || event.ctrlKey || event.metaKey) return null;
  const t = event.target as HTMLElement | null;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return null;
  if (t instanceof HTMLInputElement) {
    if (t.type === 'range') return dir === 'up' || dir === 'down' ? dir : null;
    if (dir === 'left' || dir === 'right') return null; // caret movement
  }
  return dir;
}

/** Hardware "Back" on TV platforms (Tizen 10009, webOS 461) plus browser equivalents. */
export const isBackKey = (e: KeyboardEvent): boolean =>
  e.key === 'BrowserBack' || e.key === 'GoBack' || e.keyCode === 10009 || e.keyCode === 461;
