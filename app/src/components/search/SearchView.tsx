'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@/store/app';
import { useSearchIndex } from '@/hooks/useLibrary';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import type { SearchHit } from '@/lib/search';
import { openChannel } from '../home/Home';
import { Artwork } from '../ui/Artwork';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/controls';

const SECTIONS: Array<{ kind: SearchHit['kind']; label: MessageKey }> = [
  { kind: 'channel', label: 'search.channels' },
  { kind: 'movie', label: 'search.movies' },
  { kind: 'series', label: 'search.series' },
  { kind: 'category', label: 'search.categories' },
];

function open(hit: SearchHit): void {
  if (hit.kind === 'channel') openChannel(hit.id);
  else if (hit.kind === 'category') navigate('live', hit.id);
  else navigate(hit.kind === 'movie' ? 'movie' : 'show', hit.id);
}

export function SearchView({ initialQuery = '' }: { initialQuery?: string }) {
  const { t } = useI18n();
  const index = useSearchIndex();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Short debounce keeps typing fluid on TVs and low-end phones; the scan itself takes a few ms.
  useEffect(() => { const id = setTimeout(() => setQuery(text), 90); return () => clearTimeout(id); }, [text]);

  const hits = useMemo(() => index.search(query), [index, query]);

  return (
    <div className="mx-auto max-w-3xl pb-28 lg:pb-10">
      <label className="relative block">
        <Icon name="search" size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search.placeholder')} aria-label={t('nav.search')}
          autoComplete="off" spellCheck={false} enterKeyHint="search"
          className="field h-14 rounded-lg bg-surface ps-12 text-base [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      <div aria-live="polite" className="mt-6">
        {!query.trim() && <p className="py-16 text-center text-sm text-muted">{t('search.start')}</p>}
        {query.trim() && !hits.length && <EmptyState icon="search" title={t('search.none')} body={t('search.noneBody')} />}
        {SECTIONS.map(({ kind, label }) => {
          const list = hits.filter((h) => h.kind === kind);
          if (!list.length) return null;
          return (
            <section key={kind} className="mb-7">
              <h2 className="eyebrow mb-1.5 px-2">{t(label)}</h2>
              <ul>
                {list.map((hit) => (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <button type="button" onClick={() => open(hit)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start transition-colors hover:bg-raised">
                      {kind === 'category'
                        ? <span className="grid h-10 w-10 place-items-center rounded-md bg-raised text-faint"><Icon name="guide" size={18} /></span>
                        : <Artwork variant="logo" src={hit.logo} name={hit.name} className={kind === 'channel' ? 'h-10 w-10' : 'h-14 w-10 [&>img]:object-cover [&>img]:p-0'} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{hit.name || t('live.uncategorized')}</span>
                        {hit.group && <span className="block truncate text-xs text-muted">{hit.group}</span>}
                      </span>
                      <Icon name="chevron" size={16} className="text-faint rtl:-scale-x-100" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
