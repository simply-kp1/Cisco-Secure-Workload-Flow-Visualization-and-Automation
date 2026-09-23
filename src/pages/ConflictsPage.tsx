import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Network, ShieldCheck } from 'lucide-react';
import type { IssueCategory, PolicyIssue } from '@/types';
import { ISSUE_CATEGORY_LABEL } from '@/services/issues';
import { formatPorts } from '@/services/ports';
import { useAppStore } from '@/store/useAppStore';
import { useGraph, useIssues } from '@/store/selectors';
import { Badge, Button, Card, EmptyState, SearchInput } from '@/components/ui';
import { cx, SEVERITY_STYLES } from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

/**
 * Automatically generated issues list. Every entry is clickable and highlights
 * the servers and rules it concerns on the topology.
 */
export function ConflictsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const issues = useIssues();
  const graph = useGraph();
  const store = useAppStore();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | IssueCategory>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<IssueCategory, number>();
    for (const issue of issues) map.set(issue.category, (map.get(issue.category) ?? 0) + 1);
    return map;
  }, [issues]);

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return issues.filter((issue) => {
      if (category !== 'all' && issue.category !== category) return false;
      if (!lower) return true;
      return (
        issue.title.toLowerCase().includes(lower) ||
        issue.explanation.toLowerCase().includes(lower) ||
        issue.ruleIds.some((id) => id.toLowerCase().includes(lower)) ||
        issue.serverIds.some((id) => id.toLowerCase().includes(lower))
      );
    });
  }, [issues, query, category]);

  const severityCounts = useMemo(() => {
    const map = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const issue of issues) map[issue.severity] += 1;
    return map;
  }, [issues]);

  if (!graph) return null;

  const showOnMap = (issue: PolicyIssue): void => {
    store.highlight(issue.serverIds, issue.ruleIds);
    onNavigate('network');
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search issues, rules or servers…"
            className="min-w-[260px] flex-1"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {severityCounts.high + severityCounts.critical > 0 ? (
              <Badge className={SEVERITY_STYLES.high.chip}>
                {severityCounts.critical + severityCounts.high} high
              </Badge>
            ) : null}
            {severityCounts.medium > 0 ? (
              <Badge className={SEVERITY_STYLES.medium.chip}>{severityCounts.medium} medium</Badge>
            ) : null}
            {severityCounts.low > 0 ? (
              <Badge className={SEVERITY_STYLES.low.chip}>{severityCounts.low} low</Badge>
            ) : null}
            {severityCounts.info > 0 ? (
              <Badge className={SEVERITY_STYLES.info.chip}>{severityCounts.info} notes</Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <CategoryPill
            label="All issues"
            count={issues.length}
            active={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key, count]) => (
              <CategoryPill
                key={key}
                label={ISSUE_CATEGORY_LABEL[key]}
                count={count}
                active={category === key}
                onClick={() => setCategory(key)}
              />
            ))}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={issues.length === 0 ? CheckCircle2 : AlertTriangle}
            title={issues.length === 0 ? 'No issues detected' : 'Nothing matches this filter'}
            description={
              issues.length === 0
                ? 'No duplicate, conflicting, redundant or overly broad rules were found, and every rule resolved to a known server.'
                : 'Try a different category or clear the search.'
            }
            action={
              issues.length > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCategory('all');
                    setQuery('');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              expanded={expanded === issue.id}
              onToggle={() => setExpanded(expanded === issue.id ? null : issue.id)}
              onShowOnMap={() => showOnMap(issue)}
              onOpenRule={(ruleId) => {
                store.selectRule(ruleId);
                onNavigate('rules');
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-95',
        active ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50',
      )}
    >
      {label}
      <span
        className={cx(
          'rounded px-1 text-[10.5px] font-bold tabular-nums',
          active ? 'bg-white/25' : 'bg-ink-100 text-ink-500',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function IssueCard({
  issue,
  expanded,
  onToggle,
  onShowOnMap,
  onOpenRule,
}: {
  issue: PolicyIssue;
  expanded: boolean;
  onToggle: () => void;
  onShowOnMap: () => void;
  onOpenRule: (ruleId: string) => void;
}) {
  const graph = useGraph();
  const severity = SEVERITY_STYLES[issue.severity];

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink-50/70"
      >
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: severity.color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold tracking-tight text-ink-800">{issue.title}</span>
            <Badge className={severity.chip}>{severity.label}</Badge>
            <Badge>{ISSUE_CATEGORY_LABEL[issue.category]}</Badge>
          </span>
          <span className={cx('mt-1 block text-[13px] leading-relaxed text-ink-600', !expanded && 'line-clamp-2')}>
            {issue.explanation}
          </span>
        </span>
        <ChevronDown
          className={cx('mt-1 h-4 w-4 shrink-0 text-ink-400 transition-transform', expanded && 'rotate-180')}
        />
      </button>

      {expanded ? (
        <div className="space-y-4 border-t border-ink-100 bg-ink-50/40 px-5 py-4">
          {issue.evidence.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-400">Evidence</p>
              <ul className="space-y-1">
                {issue.evidence.map((line, index) => (
                  <li key={index} className="mono rounded bg-white px-2.5 py-1.5 text-[11.5px] text-ink-600">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {issue.ruleIds.length > 0 && graph ? (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-400">
                Rules involved ({issue.ruleIds.length})
              </p>
              <div className="space-y-1">
                {issue.ruleIds.slice(0, 12).map((ruleId) => {
                  const rule = graph.rulesById.get(ruleId);
                  if (!rule) return null;
                  return (
                    <button
                      key={ruleId}
                      type="button"
                      onClick={() => onOpenRule(ruleId)}
                      className="flex w-full items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span
                        className={cx(
                          'h-6 w-1 shrink-0 rounded-full',
                          rule.action === 'ALLOW' ? 'bg-emerald-500' : 'bg-rose-500',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-ink-800">{rule.name}</span>
                        <span className="mono block truncate text-[11px] text-ink-500">
                          {graph.serversById.get(rule.source)?.name ?? rule.source} →{' '}
                          {graph.serversById.get(rule.destination)?.name ?? rule.destination} · {rule.protocol}{' '}
                          {formatPorts(rule.ports)} {rule.action}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {issue.ruleIds.length > 12 ? (
                  <p className="pt-1 text-[12px] text-ink-400">…and {issue.ruleIds.length - 12} more.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Network} onClick={onShowOnMap}>
              Highlight on the topology
            </Button>
            {issue.category === 'ALLOW_DENY_CONFLICT' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-ink-500 ring-1 ring-inset ring-ink-200">
                <ShieldCheck className="h-3.5 w-3.5 text-ink-400" />
                Rule precedence is not present in this export and cannot be determined here.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
