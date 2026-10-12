import { LogoMark } from '../ui/Logo';
import { PosterSkeleton } from '../ui/PosterCard';

/** Shown for the few milliseconds it takes to read local storage. Identical on server and client. */
export function Splash() {
  return (
    <div className="grid h-dvh place-items-center" aria-busy="true">
      <LogoMark size={56} className="splash-pulse" />
    </div>
  );
}

/** Per-view placeholder while a lazily loaded screen arrives; keeps the shell interactive. */
export function ViewSkeleton({ variant = 'grid' }: { variant?: 'grid' | 'list' }) {
  return (
    <div aria-busy="true" className="pt-2">
      <div className="skeleton mb-6 h-8 w-44 rounded-md" />
      {variant === 'grid' ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} />)}
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
        </div>
      )}
    </div>
  );
}
