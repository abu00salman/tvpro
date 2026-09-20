import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Options {
  count: number;
  /** Fixed row height in px, or a function of the computed column width (poster grids). */
  rowHeight: number | ((columnWidth: number) => number);
  /** Omit for a single-column list. */
  minColumnWidth?: number;
  gap?: number;
  overscan?: number;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Windowing for lists and grids. Only the rows near the viewport exist in the DOM,
 * so 20,000 channels cost the same as 20.
 */
export function useVirtualGrid({ count, rowHeight, minColumnWidth, gap = 0, overscan = 4 }: Options) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollTop(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  const columns = minColumnWidth ? Math.max(1, Math.floor((box.width + gap) / (minColumnWidth + gap))) : 1;
  const columnWidth = columns > 0 ? (box.width - gap * (columns - 1)) / columns : box.width;
  const rowSize = (typeof rowHeight === 'function' ? rowHeight(columnWidth) : rowHeight) + gap;
  const rows = Math.ceil(count / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowSize) - overscan);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + (box.height || 800)) / rowSize) + overscan);

  const scrollToIndex = useCallback((index: number) => {
    const el = ref.current;
    if (!el || index < 0) return;
    const top = Math.floor(index / columns) * rowSize;
    if (top < el.scrollTop || top + rowSize > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowSize / 2);
    }
  }, [columns, rowSize]);

  return {
    ref, columns, scrollToIndex,
    totalHeight: Math.max(0, rows * rowSize - gap),
    offsetTop: firstRow * rowSize,
    start: firstRow * columns,
    end: Math.min(count, lastRow * columns),
    rowSize: rowSize - gap,
  };
}
