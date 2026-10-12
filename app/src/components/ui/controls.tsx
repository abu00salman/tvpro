import type { ReactNode } from 'react';
import { app, toggleFavorite } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { cx, itemKey } from '@/lib/utils';
import type { ItemKind } from '@/types';
import { Icon, type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  filled?: boolean;
  size?: number;
  className?: string;
  tone?: 'default' | 'onVideo';
}

/** Icon-only action with an accessible name and a native tooltip. */
export function IconButton({ icon, label, onClick, active, filled, size = 20, className, tone = 'default' }: IconButtonProps) {
  return (
    <button
      type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick}
      className={cx(
        'grid h-10 w-10 shrink-0 place-items-center rounded-md transition duration-150 ease-out active:scale-95',
        tone === 'onVideo' ? 'text-white/85 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-raised hover:text-fg',
        active && (tone === 'onVideo' ? 'text-white' : 'text-accent'),
        className,
      )}
    >
      <Icon name={icon} size={size} filled={filled} />
    </button>
  );
}

export function FavoriteButton({ kind, id, tone, className }: { kind: ItemKind; id: string; tone?: 'default' | 'onVideo'; className?: string }) {
  const { t } = useI18n();
  const on = useStore(app, (s) => Boolean(s.favorites[itemKey(kind, id)]));
  return (
    <IconButton
      icon="heart" filled={on} active={on} tone={tone} className={className}
      label={t(on ? 'player.unfavorite' : 'player.favorite')}
      onClick={() => toggleFavorite(kind, id)}
    />
  );
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: IconName }>;
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-base p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-sm transition-colors duration-150',
            o.value === value ? 'bg-surface font-medium text-fg shadow-soft' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow-soft transition-all duration-200 ease-out', checked ? 'start-6' : 'start-1')} />
    </button>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center">
      <span className="mb-5 grid h-14 w-14 place-items-center rounded-xl border border-line bg-surface text-faint">
        <Icon name={icon} size={24} />
      </span>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {body && <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status" aria-live="polite" className={cx('inline-block rounded-full border-2 border-current border-t-transparent opacity-80', className)}
      style={{ width: size, height: size, animation: 'spin 0.8s linear infinite' }}
    />
  );
}

export function PageHeader({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] lg:text-[1.75rem]">{title}</h1>
        {meta && <p className="mt-1 font-mono text-xs text-faint tabular">{meta}</p>}
      </div>
      {children}
    </header>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('block h-[3px] overflow-hidden rounded-full bg-line-strong', className)} aria-hidden="true">
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </span>
  );
}
