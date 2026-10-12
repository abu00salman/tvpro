import { cx } from '@/lib/utils';

/** The mark: a screen, a play head, a stand. Reads at 16px (favicon) and at 10 feet (TV). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className} style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}>
      <rect width="32" height="32" rx="8.5" fill="rgb(var(--accent))" />
      <path d="M13 9.200v9.600a1 1 0 0 0 1.520.85l7.700-4.800a1 1 0 0 0 0-1.700l-7.700-4.800A1 1 0 0 0 13 9.200z" fill="#fff" />
      <rect x="11" y="23.200" width="10" height="1.900" rx=".95" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)} dir="ltr">
      <LogoMark size={size} />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-fg" style={{ fontSize: `${size / 26}rem`, fontFamily: "'Geist', system-ui, sans-serif" }}>
        TV<span className="ms-[0.22em] font-normal text-muted">Pro</span>
      </span>
    </span>
  );
}
