import { memo } from 'react';
import { cx } from '@/lib/utils';
import { Artwork } from './Artwork';
import { ProgressBar } from './controls';

interface Props {
  name: string;
  poster?: string;
  meta?: string;
  progress?: number;
  onOpen: () => void;
  className?: string;
}

/** Poster tile used by movies, series, rows and search. A real <button>: works with touch, mouse, keyboard and remote. */
export const PosterCard = memo(function PosterCard({ name, poster, meta, progress, onOpen, className }: Props) {
  return (
    <button type="button" onClick={onOpen} className={cx('group block w-full text-start transition-transform duration-200 ease-out active:scale-[0.98]', className)}>
      <span className="relative block overflow-hidden rounded-md border border-line transition duration-200 ease-out group-hover:border-line-strong group-focus-visible:border-accent">
        <Artwork variant="poster" src={poster} name={name} className="aspect-[2/3] w-full transition-transform duration-300 ease-out group-hover:scale-[1.03]" />
        {progress !== undefined && progress > 0 && <ProgressBar value={progress} className="absolute inset-x-2 bottom-2 bg-black/50" />}
      </span>
      <span dir="auto" className="mt-2 block truncate ltr:text-left rtl:text-right text-sm font-medium">{name}</span>
      {meta && <span className="block truncate text-xs text-muted">{meta}</span>}
    </button>
  );
});

export function PosterSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton aspect-[2/3] w-full" />
      <div className="skeleton mt-2 h-3.5 w-3/4" />
    </div>
  );
}
