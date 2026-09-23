import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, ListTree, Plug, Search, Server as ServerIcon } from 'lucide-react';
import type { SearchResult } from '@/types';
import { globalSearch } from '@/services/search';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useGraph } from '@/store/selectors';
import { cx } from '@/lib/design';
import type { PageId } from './Sidebar';

const KIND_ICON = {
  server: ServerIcon,
  rule: ListTree,
  port: Plug,
  connection: ListTree,
};

/**
 * Global search. Understands shorthand (`TCP 1433`, `APP -> DB`, `DENY`, a bare
 * IP or port) and, on selection, highlights the matching objects on the
 * topology rather than just navigating to a list.
 */
export function GlobalSearch({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dataset = useDataset();
  const graph = useGraph();
  const highlight = useAppStore((state) => state.highlight);
  const selectServer = useAppStore((state) => state.selectServer);
  const selectRule = useAppStore((state) => state.selectRule);

  const results = useMemo(() => {
    if (!dataset || !graph || query.trim().length === 0) return [];
    return globalSearch(query, dataset, graph, 12);
  }, [query, dataset, graph]);

  /* Reset the keyboard cursor when the query changes. Adjusting state during
   * render (rather than in an effect) avoids a second render pass. */
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }

  /* Cmd/Ctrl-K focuses the field from anywhere. */
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const choose = (result: SearchResult): void => {
    highlight(result.serverIds, result.ruleIds);
    if (result.kind === 'server') {
      selectServer(result.id);
      onNavigate('network');
    } else if (result.kind === 'rule') {
      selectRule(result.id);
      onNavigate('rules');
    } else if (result.kind === 'port') {
      onNavigate('ports');
    }
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        disabled={!dataset}
        placeholder="Search servers, IPs, ports, rules…  try “TCP 1433” or “WEB → DB”"
        className="h-9 w-full rounded-lg border border-ink-200 bg-ink-50/70 pl-9 pr-16 text-[13px] text-ink-800 placeholder:text-ink-400 transition-colors hover:border-ink-300 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink-400">
        ⌘K
      </kbd>

      {open && query.trim().length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[420px] animate-slide-up overflow-y-auto rounded-xl border border-ink-200 bg-white p-1.5 shadow-pop">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-ink-400">
              Nothing matched “{query}”.
            </p>
          ) : (
            results.map((result, index) => {
              const Icon = KIND_ICON[result.kind];
              return (
                <button
                  key={`${result.kind}:${result.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(result)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    index === activeIndex ? 'bg-brand-50' : 'hover:bg-ink-50',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={2.2} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink-800">{result.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-500">{result.subtitle}</span>
                  </span>
                  {result.badge ? (
                    <span
                      className={cx(
                        'chip shrink-0 text-[10px]',
                        result.badge === 'ALLOW'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                          : result.badge === 'DENY'
                            ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                            : 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
                      )}
                    >
                      {result.badge}
                    </span>
                  ) : null}
                  {index === activeIndex ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-300" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
