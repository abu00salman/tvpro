import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '../ui/Icon';

interface Props {
  title: string;
  onSeeAll?: () => void;
  children: ReactNode;
}

/** A horizontally scrolling shelf. Scroll-snap + native scrolling: nothing to download, nothing to jank. */
export function Row({ title, onSeeAll, children }: Props) {
  const { t } = useI18n();
  return (
    <section className="mb-9" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="inline-flex items-center gap-0.5 rounded-sm text-sm text-muted transition-colors hover:text-fg">
            {t('home.seeAll')} <Icon name="chevron" size={14} className="rtl:-scale-x-100" />
          </button>
        )}
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 lg:-mx-8 lg:scroll-px-8 lg:px-8 [&>*]:shrink-0 [&>*]:snap-start">{children}</div>
    </section>
  );
}
