import type { ReactNode } from 'react';
import { goBack } from '@/store/app';
import { useI18n } from '@/lib/i18n';
import type { ItemKind } from '@/types';
import { Artwork } from '../ui/Artwork';
import { FavoriteButton, IconButton } from '../ui/controls';

interface Props {
  kind: ItemKind;
  id: string;
  title: string;
  poster?: string;
  backdrop?: string;
  /** Only facts the source actually provided. */
  facts: string[];
  description?: string;
  actions: ReactNode;
}

/** Shared detail header for movies and series. Missing metadata simply leaves no trace. */
export function DetailHero({ kind, id, title, poster, backdrop, facts, description, actions }: Props) {
  const { t } = useI18n();
  return (
    <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-8 pt-4 lg:-mx-8 lg:-mt-6 lg:px-8 lg:pt-6">
      {(backdrop || poster) && (
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          <img src={backdrop ?? poster} alt="" referrerPolicy="no-referrer" className={backdrop ? 'h-full w-full object-cover opacity-30' : 'h-full w-full scale-125 object-cover opacity-25 blur-3xl'} />
          <div className="absolute inset-0 bg-gradient-to-t from-base via-base/70 to-base/20" />
        </div>
      )}
      <IconButton icon="back" label={t('common.back')} onClick={goBack} className="-ms-2 mb-4 rtl:-scale-x-100" />
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end lg:gap-8">
        <Artwork variant="poster" src={poster} name={title} className="aspect-[2/3] w-36 shrink-0 rounded-lg border border-line shadow-soft sm:w-44 lg:w-52" />
        <div className="min-w-0 max-w-2xl pb-1">
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.025em] lg:text-[2.5rem]">{title}</h1>
          {facts.length > 0 && <p className="mt-2.5 text-sm text-muted">{facts.join('  ·  ')}</p>}
          {description?.trim() && <p className="mt-4 line-clamp-5 text-[0.95rem] leading-relaxed text-muted">{description}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {actions}
            <FavoriteButton kind={kind} id={id} className="h-11 w-11 border border-line-strong" />
          </div>
        </div>
      </div>
    </div>
  );
}
