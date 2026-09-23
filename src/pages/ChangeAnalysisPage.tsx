import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, FileJson, FileSpreadsheet, GitCompare, Network, Printer, X } from 'lucide-react';
import type { ChangeType, Rule } from '@/types';
import { formatPorts } from '@/services/ports';
import { buildImpactReport, reportToCsv, reportToHtml, reportToJson, summariseChange } from '@/services/report';
import { applyChange } from '@/services/analyseChange';
import { buildGraph } from '@/services/graph';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useGraph } from '@/store/selectors';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Select,
  Tabs,
  useToast,
} from '@/components/ui';
import {
  RuleBuilder,
  draftFromRule,
  emptyDraft,
  ruleFromDraft,
  validateDraft,
  type RuleDraft,
} from '@/components/panels/RuleBuilder';
import { ImpactAnalysisView } from '@/components/panels/ImpactAnalysisView';
import { NetworkCanvas, type DiffState } from '@/components/topology/NetworkCanvas';
import { Legend } from '@/components/topology/Legend';
import { cx, DIFF_COLORS } from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

const CHANGE_TYPES: { value: ChangeType; label: string; description: string }[] = [
  { value: 'ADD_RULE', label: 'Add a rule', description: 'Introduce new connectivity.' },
  { value: 'MODIFY_RULE', label: 'Modify a rule', description: 'Change an existing rule.' },
  { value: 'DELETE_RULE', label: 'Delete a rule', description: 'Remove a rule entirely.' },
  { value: 'DISABLE_RULE', label: 'Disable a rule', description: 'Keep the rule but stop it taking effect.' },
];

export function ChangeAnalysisPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const dataset = useDataset();
  const graph = useGraph();
  const store = useAppStore();
  const toast = useToast();

  const { proposedChange, proposedAnalysis } = store;

  const [changeType, setChangeType] = useState<ChangeType>('MODIFY_RULE');
  const [targetRuleId, setTargetRuleId] = useState('');
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft());
  const [tab, setTab] = useState<'impact' | 'topology'>('impact');
  const [mode, setMode] = useState<'CURRENT' | 'PROPOSED' | 'DIFFERENCE'>('DIFFERENCE');

  /* Adopt whatever change was proposed from another page (the Rules table, the
   * connection panel). Adjusting state during render rather than in an effect
   * keeps the form in step with the store without a second render pass. */
  const [adoptedChangeId, setAdoptedChangeId] = useState<string | null>(null);
  if (proposedChange && proposedChange.changeId !== adoptedChangeId) {
    setAdoptedChangeId(proposedChange.changeId);
    setChangeType(proposedChange.type);
    setTargetRuleId(proposedChange.originalRule?.id ?? '');
    const seed = proposedChange.proposedRule ?? proposedChange.originalRule;
    if (seed) setDraft(draftFromRule(seed));
  }

  const validation = useMemo(() => (dataset ? validateDraft(draft, dataset) : null), [draft, dataset]);
  const targetRule = useMemo(
    () => dataset?.rules.find((rule) => rule.id === targetRuleId) ?? null,
    [dataset, targetRuleId],
  );

  /* Re-run the analysis as the draft changes — the builder is continuously live. */
  const needsDraft = changeType === 'ADD_RULE' || changeType === 'MODIFY_RULE';
  useEffect(() => {
    if (!dataset || !proposedChange) return;
    if (!needsDraft || !validation?.valid) return;
    const rule = ruleFromDraft(draft);
    if (rulesEqual(rule, proposedChange.proposedRule)) return;
    store.updateProposedRule(rule);
    // Re-runs only when the draft actually changes shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, validation?.valid, needsDraft]);

  const proposedRules = useMemo(() => {
    if (!dataset || !proposedChange) return null;
    return applyChange(dataset.rules, proposedChange);
  }, [dataset, proposedChange]);

  const proposedGraph = useMemo(
    () => (dataset && proposedRules ? buildGraph({ ...dataset, rules: proposedRules }) : null),
    [dataset, proposedRules],
  );

  const diff = useMemo<DiffState | null>(() => {
    if (!proposedAnalysis) return null;
    return {
      added: new Set(proposedAnalysis.connectionsAdded.map((delta) => delta.connection.ruleId)),
      removed: new Set(proposedAnalysis.connectionsRemoved.map((delta) => delta.connection.ruleId)),
      modified: new Set(proposedAnalysis.connectionsModified.map((delta) => delta.connection.ruleId)),
    };
  }, [proposedAnalysis]);

  if (!dataset || !graph) return null;

  const start = (): void => {
    if (changeType === 'ADD_RULE') {
      if (!validation?.valid) {
        toast('Complete the rule before analysing it.', 'warning');
        return;
      }
      store.proposeChange('ADD_RULE', null, ruleFromDraft(draft));
      return;
    }
    if (!targetRule) {
      toast('Choose the rule you want to change.', 'warning');
      return;
    }
    if (changeType === 'MODIFY_RULE') {
      const next = validation?.valid ? ruleFromDraft(draft) : { ...targetRule };
      store.proposeChange('MODIFY_RULE', targetRule, next);
      return;
    }
    store.proposeChange(changeType, targetRule, null);
  };

  const exportReport = (format: 'json' | 'csv' | 'print'): void => {
    if (!proposedAnalysis) return;
    const report = buildImpactReport(proposedAnalysis, graph);

    if (format === 'print') {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast('The browser blocked the report window. Allow pop-ups for this page and try again.', 'warning');
        return;
      }
      printWindow.document.write(reportToHtml(report));
      printWindow.document.close();
      printWindow.focus();
      window.setTimeout(() => printWindow.print(), 260);
      return;
    }

    const content = format === 'json' ? reportToJson(report) : reportToCsv(report);
    const type = format === 'json' ? 'application/json' : 'text/csv';
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `impact-report-${report.changeId}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    toast(`Impact report exported as ${format.toUpperCase()}.`, 'success');
  };

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[400px_1fr]">
      {/* ---------------- proposal builder ---------------- */}
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <Card>
          <CardHeader
            title="Propose a change"
            subtitle="Nothing here changes the active policy until you apply it."
            icon={GitCompare}
          />
          <div className="space-y-4 border-t border-ink-100 px-5 py-4">
            <div>
              <span className="label">Change type</span>
              <div className="grid grid-cols-2 gap-2">
                {CHANGE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setChangeType(type.value)}
                    className={cx(
                      'rounded-lg border px-2.5 py-2 text-left transition-all duration-150 active:scale-[0.98]',
                      changeType === type.value
                        ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                        : 'border-ink-200 bg-white hover:border-ink-300',
                    )}
                  >
                    <span
                      className={cx(
                        'block text-[12.5px] font-bold',
                        changeType === type.value ? 'text-brand-700' : 'text-ink-700',
                      )}
                    >
                      {type.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{type.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {changeType !== 'ADD_RULE' ? (
              <Select
                label="Rule to change"
                value={targetRuleId}
                onChange={(event) => {
                  setTargetRuleId(event.target.value);
                  const rule = dataset.rules.find((item) => item.id === event.target.value);
                  if (rule) setDraft(draftFromRule(rule));
                }}
              >
                <option value="">Select a rule…</option>
                {dataset.rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name} — {rule.protocol} {formatPorts(rule.ports)} {rule.action}
                  </option>
                ))}
              </Select>
            ) : null}

            {changeType === 'MODIFY_RULE' && targetRule ? (
              <BeforeAfterRule before={targetRule} after={validation?.valid ? ruleFromDraft(draft) : null} />
            ) : null}

            {needsDraft && validation ? (
              <RuleBuilder
                draft={draft}
                onChange={setDraft}
                dataset={dataset}
                graph={graph}
                validation={validation}
              />
            ) : null}

            <div className="flex gap-2">
              <Button variant="primary" icon={GitCompare} onClick={start} className="flex-1">
                {proposedChange ? 'Re-run analysis' : 'Analyse this change'}
              </Button>
              {proposedChange ? (
                <Button variant="ghost" icon={X} onClick={store.discardProposedChange}>
                  Discard
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        {proposedChange && proposedAnalysis ? (
          <Card>
            <CardHeader title="Apply or export" icon={CheckCheck} />
            <div className="space-y-2 border-t border-ink-100 px-5 py-4">
              <Callout tone="neutral">{summariseChange(proposedAnalysis, graph)}</Callout>
              <Button
                variant="primary"
                icon={CheckCheck}
                className="w-full"
                onClick={() => {
                  store.commitProposedChange();
                  toast('Change applied to the working policy. Use Undo in the top bar to reverse it.', 'success');
                }}
              >
                Apply this change
              </Button>
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="secondary" icon={FileJson} onClick={() => exportReport('json')}>
                  JSON
                </Button>
                <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={() => exportReport('csv')}>
                  CSV
                </Button>
                <Button size="sm" variant="secondary" icon={Printer} onClick={() => exportReport('print')}>
                  Print
                </Button>
              </div>
              <p className="text-[11.5px] leading-relaxed text-ink-400">
                Applying a change updates the in-browser working policy only. The imported file is never modified
                and can be restored with Revert all.
              </p>
            </div>
          </Card>
        ) : null}
      </div>

      {/* ---------------- analysis ---------------- */}
      <div className="flex min-h-0 flex-col">
        {!proposedChange || !proposedAnalysis ? (
          <Card className="flex min-h-0 flex-1 items-center">
            <EmptyState
              icon={GitCompare}
              className="w-full"
              title="No change proposed yet"
              description="Choose a change type on the left, complete the rule, and run the analysis. You will see exactly what connectivity changes, which systems could be affected, whether equivalent access already exists, and whether a rule is being duplicated — all before anything is applied."
              action={
                <Button variant="secondary" icon={Network} onClick={() => onNavigate('rules')}>
                  Pick a rule from the Rules page
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'impact', label: 'Impact analysis' },
                  { value: 'topology', label: 'Before / after topology' },
                ]}
              />
              {tab === 'topology' ? (
                <Tabs
                  value={mode}
                  onChange={setMode}
                  tabs={[
                    { value: 'CURRENT', label: 'Current' },
                    { value: 'PROPOSED', label: 'Proposed' },
                    { value: 'DIFFERENCE', label: 'Difference' },
                  ]}
                />
              ) : null}
              <Badge className="ml-auto bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
                Proposed — not applied
              </Badge>
            </div>

            {tab === 'impact' ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ImpactAnalysisView
                  analysis={proposedAnalysis}
                  graph={graph}
                  onSelectServer={(serverId) => {
                    store.selectServer(serverId);
                    onNavigate('network');
                  }}
                />
              </div>
            ) : (
              <BeforeAfterTopology
                mode={mode}
                currentGraph={graph}
                proposedGraph={proposedGraph}
                diff={diff}
                impact={proposedAnalysis.affectedServers}
                removedRule={proposedChange.originalRule}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Before / after rule comparison
 * ------------------------------------------------------------------ */

function BeforeAfterRule({ before, after }: { before: Rule; after: Rule | null }) {
  const graph = useGraph();
  if (!graph) return null;

  const row = (label: string, left: string, right: string) => {
    const changed = left !== right;
    return (
      <div className="grid grid-cols-[76px_1fr_1fr] items-center gap-2 border-b border-ink-100 py-1.5 last:border-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
        <span className={cx('mono truncate text-[12px]', changed ? 'text-rose-600 line-through' : 'text-ink-600')}>
          {left}
        </span>
        <span className={cx('mono truncate text-[12px] font-semibold', changed ? 'text-emerald-700' : 'text-ink-600')}>
          {right}
        </span>
      </div>
    );
  };

  const name = (id: string): string => graph.serversById.get(id)?.name ?? id;
  const target = after ?? before;

  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3.5 py-2.5">
      <div className="mb-1.5 grid grid-cols-[76px_1fr_1fr] gap-2">
        <span />
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400">Current</span>
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-brand-600">Proposed</span>
      </div>
      {row('Source', name(before.source), name(target.source))}
      {row('Dest', name(before.destination), name(target.destination))}
      {row('Protocol', before.protocol, target.protocol)}
      {row('Ports', formatPorts(before.ports), formatPorts(target.ports))}
      {row('Action', before.action, target.action)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Before / after topology
 * ------------------------------------------------------------------ */

function BeforeAfterTopology({
  mode,
  currentGraph,
  proposedGraph,
  diff,
  impact,
  removedRule,
}: {
  mode: 'CURRENT' | 'PROPOSED' | 'DIFFERENCE';
  currentGraph: ReturnType<typeof buildGraph>;
  proposedGraph: ReturnType<typeof buildGraph> | null;
  diff: DiffState | null;
  impact: ReturnType<typeof useAppStore.getState>['proposedAnalysis'] extends null
    ? never
    : NonNullable<ReturnType<typeof useAppStore.getState>['proposedAnalysis']>['affectedServers'];
  removedRule: Rule | null;
}) {
  const store = useAppStore();
  const settings = store.settings;

  /* Only the immediate neighbourhood of the change is drawn. The full blast
   * radius can reach most of a densely connected estate, and rendering all of
   * it buries the one or two edges that actually changed. The complete list
   * stays available on the Impact analysis tab. */
  const { rules, serverIds, graph } = useMemo(() => {
    const active = mode === 'CURRENT' ? currentGraph : (proposedGraph ?? currentGraph);
    const focusIds = new Set(
      impact
        .filter((affected) => affected.level === 'DIRECT' || affected.level === 'ONE_HOP')
        .map((affected) => affected.serverId),
    );

    const relevant = [...active.rulesById.values()].filter((rule) => {
      if (rule.disabled) return false;
      return focusIds.has(rule.source) || focusIds.has(rule.destination);
    });

    if (mode === 'DIFFERENCE' && removedRule && !relevant.some((rule) => rule.id === removedRule.id)) {
      relevant.push(removedRule);
    }

    const ids = new Set(focusIds);
    for (const rule of relevant) {
      ids.add(rule.source);
      ids.add(rule.destination);
    }
    return { rules: relevant, serverIds: ids, graph: active };
  }, [mode, currentGraph, proposedGraph, impact, removedRule]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
      <NetworkCanvas
        graph={graph}
        rules={rules}
        serverIds={serverIds}
        layout="force"
        selectedServerId={null}
        selectedServerIds={[]}
        selectedConnectionId={null}
        focusServerId={null}
        highlightedServerIds={[]}
        highlightedRuleIds={[]}
        diff={mode === 'DIFFERENCE' ? diff : null}
        impact={impact}
        activePath={null}
        labelZoomThreshold={0}
        showEdgeLabels
        performanceThreshold={settings.performanceThreshold}
        animateLayout={settings.animateLayout}
        onSelectServer={() => {}}
        onToggleServer={() => {}}
        onSelectConnection={() => {}}
      />

      <Legend mode={mode} hiddenRoles={[]} onToggleRole={() => {}} showImpact />

      <div className="absolute right-3 top-3 rounded-xl border border-ink-200 bg-white/95 px-3 py-2 text-[11.5px] shadow-lift backdrop-blur">
        {mode === 'DIFFERENCE' ? (
          <div className="space-y-1">
            <DiffKey color={DIFF_COLORS.ADDED} label="Added" />
            <DiffKey color={DIFF_COLORS.REMOVED} label="Removed" />
            <DiffKey color={DIFF_COLORS.MODIFIED} label="Modified" />
            <DiffKey color={DIFF_COLORS.UNCHANGED} label="Unchanged" />
          </div>
        ) : (
          <p className="font-semibold text-ink-600">
            {mode === 'CURRENT' ? 'Policy as it stands today' : 'Policy if this change were applied'}
          </p>
        )}
      </div>
    </div>
  );
}

function DiffKey({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-0.5 w-5 rounded" style={{ backgroundColor: color }} />
      <span className="font-medium text-ink-600">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function rulesEqual(a: Rule, b: Rule | null): boolean {
  if (!b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.source === b.source &&
    a.destination === b.destination &&
    a.protocol === b.protocol &&
    a.action === b.action &&
    a.description === b.description &&
    formatPorts(a.ports) === formatPorts(b.ports)
  );
}
