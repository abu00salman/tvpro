import { memo, useState } from 'react';
import { cx, initials } from '@/lib/utils';

interface Props {
  src?: string;
  name: string;
  /** 'logo' keeps the image contained on a tile; 'poster' covers and falls back to a typographic tile. */
  variant: 'logo' | 'poster';
  className?: string;
}

/** Artwork is never required: missing or broken images degrade to a designed placeholder. */
export const Artwork = memo(function Artwork({ src, name, variant, className }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const show = src && !failed;

  if (variant === 'logo') {
    return (
      <span className={cx('relative grid shrink-0 place-items-center overflow-hidden rounded-md bg-raised text-[0.7rem] font-semibold text-muted', className)}>
        {show ? (
          <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-1" />
        ) : (
          <span aria-hidden="true">{initials(name)}</span>
        )}
      </span>
    );
  }
  return (
    <span className={cx('relative block overflow-hidden bg-raised', className)}>
      <span className="absolute inset-0 flex flex-col justify-end p-3" aria-hidden="true">
        <span className="mb-2 h-0.5 w-5 rounded bg-accent" />
        <span className="line-clamp-3 text-sm font-medium leading-snug text-muted">{name}</span>
      </span>
      {show && (
        <img
          src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </span>
  );
});
