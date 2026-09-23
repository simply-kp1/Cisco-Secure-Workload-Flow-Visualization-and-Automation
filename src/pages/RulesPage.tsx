import { useMemo, useState } from 'react';
import {
  Ban,
  Copy,
  GitCompare,
  ListTree,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Rule, RuleAction } from '@/types';
import { formatPorts } from '@/services/ports';
import { checkCandidateRule } from '@/services/duplicates';
import { findConflictsOf } from '@/services/conflicts';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useGraph, useProtocols } from '@/store/selectors';
import {
  Badge,
  Button,
  Callout,
  Card,
  DataTable,
  Field,
  Modal,
  PillGroup,
  SearchInput,
  Section,
  SidePanel,
  sortRows,
  useToast,
  type Column,
} from '@/components/ui';
import {
  RuleBuilder,
  draftFromRule,
  emptyDraft,
  ruleFromDraft,
  validateDraft,
  type RuleDraft,
} from '@/components/panels/RuleBuilder';
import { ACTION_STYLES, cx, roleStyle } from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

export function RulesPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const dataset = useDataset();
  const graph = useGraph();
  const protocols = useProtocols();
  const store = useAppStore();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [protocolFilter, setProtocolFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'id',
    direction: 'asc',
  });
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit' | 'clone'; draft: RuleDraft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Rule | null>(null);

  const rows = useMemo(() => {
    if (!dataset || !graph) return [];
    const lower = query.trim().toLowerCase();
    return dataset.rules.filter((rule) => {
      if (actions.length > 0 && !actions.includes(rule.action)) return false;
      if (protocolFilter.length > 0 && !protocolFilter.includes(rule.protocol)) return false;
      if (!lower) return true;
      const source = graph.serversById.get(rule.source)?.name ?? rule.source;
      const destination = graph.serversById.get(rule.destination)?.name ?? rule.destination;
      return (
        rule.id.toLowerCase().includes(lower) ||
        rule.name.toLowerCase().includes(lower) ||
        rule.description.toLowerCase().includes(lower) ||
        source.toLowerCase().includes(lower) ||
        destination.toLowerCase().includes(lower) ||
        formatPorts(rule.ports).includes(lower) ||
        rule.protocol.toLowerCase().includes(lower)
      );
    });
  }, [dataset, graph, query, actions, protocolFilter]);

  const columns = useMemo<Column<Rule>[]>(() => {
    if (!graph) return [];
    const name = (id: string): string => graph.serversById.get(id)?.name ?? id;
    const dot = (id: string): string => {
      const server = graph.serversById.get(id);
      return server ? roleStyle(server.role).dot : 'bg-ink-300';
    };

    return [
      {
        key: 'id',
        header: 'Rule ID',
        width: '110px',
        sortable: true,
        sortValue: (rule) => rule.id,
        render: (rule) => <span className="mono text-ink-500">{rule.id}</span>,
      },
      {
        key: 'name',
        header: 'Rule name',
        sortable: true,
        sortValue: (rule) => rule.name,
        render: (rule) => (
          <span className={cx('font-semibold text-ink-800', rule.disabled && 'line-through opacity-50')}>
            {rule.name}
          </span>
        ),
      },
      {
        key: 'source',
        header: 'Source',
        sortable: true,
        sortValue: (rule) => name(rule.source),
        render: (rule) => <EndpointCell label={name(rule.source)} dotClass={dot(rule.source)} />,
      },
      {
        key: 'destination',
        header: 'Destination',
        sortable: true,
        sortValue: (rule) => name(rule.destination),
        render: (rule) => <EndpointCell label={name(rule.destination)} dotClass={dot(rule.destination)} />,
      },
      {
        key: 'protocol',
        header: 'Protocol',
        width: '90px',
        sortable: true,
        sortValue: (rule) => rule.protocol,
        render: (rule) => <span className="mono font-semibold text-ink-600">{rule.protocol}</span>,
      },
      {
        key: 'ports',
        header: 'Ports',
        width: '130px',
        sortable: true,
        sortValue: (rule) => formatPorts(rule.ports),
        render: (rule) => <span className="mono text-ink-600">{formatPorts(rule.ports)}</span>,
      },
      {
        key: 'action',
        header: 'Action',
        width: '96px',
        sortable: true,
        sortValue: (rule) => rule.action,
        render: (rule) => (
          <div className="flex items-center gap-1.5">
            <Badge className={ACTION_STYLES[rule.action].chip}>{rule.action}</Badge>
            {rule.disabled ? <Badge>Off</Badge> : null}
          </div>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        sortable: true,
        sortValue: (rule) => rule.description,
        render: (rule) => (
          <span className="line-clamp-1 text-ink-500" title={rule.description}>
            {rule.description || '—'}
          </span>
        ),
      },
    ];
  }, [graph]);

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);
  const selectedRule = store.selectedRuleId ? (dataset?.rules.find((rule) => rule.id === store.selectedRuleId) ?? null) : null;

  if (!dataset || !graph) return null;

  const openEditor = (mode: 'add' | 'edit' | 'clone', rule?: Rule): void => {
    if (mode === 'add') {
      setEditing({ mode, draft: emptyDraft() });
      return;
    }
    if (!rule) return;
    const draft = draftFromRule(rule);
    if (mode === 'clone') {
      draft.id = `${rule.id}-copy-${Date.now().toString(36).slice(-4)}`;
      draft.name = `${rule.name} (copy)`;
    }
    setEditing({ mode, draft });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search rules by name, ID, server, port or protocol…"
            className="min-w-[280px] flex-1"
          />
          <PillGroup<RuleAction>
            label="Action"
            options={[
              { value: 'ALLOW', label: 'ALLOW' },
              { value: 'DENY', label: 'DENY' },
            ]}
            selected={actions}
            onChange={setActions}
          />
          <PillGroup<string>
            label="Protocol"
            options={protocols.map((protocol) => ({ value: protocol, label: protocol }))}
            selected={protocolFilter}
            onChange={setProtocolFilter}
          />
          <Button variant="primary" icon={Plus} onClick={() => openEditor('add')}>
            New rule
          </Button>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-500">
          Showing {sorted.length} of {dataset.rules.length} rules. Click a row to open its details.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={sorted}
          rowKey={(rule) => rule.id}
          sort={sort}
          onSortChange={setSort}
          onRowClick={(rule) => store.selectRule(rule.id)}
          activeRowKey={store.selectedRuleId}
          dense
          pageSize={200}
          itemNoun="rules"
          maxHeight="max-h-[calc(100vh-310px)]"
          emptyState="No rules match the current search and filters."
        />
      </Card>

      {/* ---------------- rule details ---------------- */}
      <RuleDetailPanel
        rule={selectedRule}
        onClose={() => store.selectRule(null)}
        onEdit={() => {
          if (!selectedRule) return;
          openEditor('edit', selectedRule);
          store.selectRule(null);
        }}
        onClone={() => {
          if (!selectedRule) return;
          openEditor('clone', selectedRule);
          store.selectRule(null);
        }}
        onToggleDisabled={() => {
          if (!selectedRule) return;
          store.applyImmediate(
            selectedRule.disabled ? 'ENABLE_RULE' : 'DISABLE_RULE',
            selectedRule,
            null,
          );
          toast(
            selectedRule.disabled
              ? `"${selectedRule.name}" re-enabled.`
              : `"${selectedRule.name}" disabled. It now permits and blocks nothing.`,
            'info',
          );
        }}
        onDelete={() => {
          if (!selectedRule) return;
          setConfirmDelete(selectedRule);
          store.selectRule(null);
        }}
        onAnalyse={() => {
          if (!selectedRule) return;
          store.proposeChange('MODIFY_RULE', selectedRule, { ...selectedRule });
          store.selectRule(null);
          onNavigate('change');
        }}
      />

      {/* ---------------- rule editor ---------------- */}
      {editing ? (
        <RuleEditorModal
          mode={editing.mode}
          draft={editing.draft}
          onChangeDraft={(draft) => setEditing({ ...editing, draft })}
          onClose={() => setEditing(null)}
          onAnalyse={(rule) => {
            const original = editing.mode === 'edit' ? dataset.rules.find((item) => item.id === rule.id) ?? null : null;
            store.proposeChange(editing.mode === 'edit' ? 'MODIFY_RULE' : 'ADD_RULE', original, rule);
            setEditing(null);
            onNavigate('change');
          }}
        />
      ) : null}

      {/* ---------------- delete confirmation ---------------- */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this rule?"
        subtitle={confirmDelete?.name}
        size="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              icon={GitCompare}
              onClick={() => {
                if (!confirmDelete) return;
                store.proposeChange('DELETE_RULE', confirmDelete, null);
                setConfirmDelete(null);
                onNavigate('change');
              }}
            >
              Analyse first
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                if (!confirmDelete) return;
                store.applyImmediate('DELETE_RULE', confirmDelete, null);
                toast(`Deleted "${confirmDelete.name}". Use Undo in the top bar to restore it.`, 'warning');
                setConfirmDelete(null);
              }}
            >
              Delete now
            </Button>
          </>
        }
      >
        {confirmDelete ? (
          <DeletePreview rule={confirmDelete} />
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-components
 * ------------------------------------------------------------------ */

/**
 * Rendered once per cell on a table that can hold hundreds of rows, so it
 * takes the values it needs as props rather than reaching for the graph.
 */
function EndpointCell({ label, dotClass }: { label: string; dotClass: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx('h-2 w-2 shrink-0 rounded-full', dotClass)} />
      <span className="truncate text-ink-700">{label}</span>
    </span>
  );
}

function RuleDetailPanel({
  rule,
  onClose,
  onEdit,
  onClone,
  onToggleDisabled,
  onDelete,
  onAnalyse,
}: {
  rule: Rule | null;
  onClose: () => void;
  onEdit: () => void;
  onClone: () => void;
  onToggleDisabled: () => void;
  onDelete: () => void;
  onAnalyse: () => void;
}) {
  const dataset = useDataset();
  const graph = useGraph();

  const analysis = useMemo(() => {
    if (!rule || !dataset || !graph) return null;
    const others = dataset.rules.filter((item) => item.id !== rule.id);
    return {
      check: checkCandidateRule(rule, others, graph),
      conflicts: findConflictsOf(rule, others),
    };
  }, [rule, dataset, graph]);

  if (!rule || !graph) return null;

  const source = graph.serversById.get(rule.source);
  const destination = graph.serversById.get(rule.destination);

  return (
    <SidePanel
      open={Boolean(rule)}
      onClose={onClose}
      width="w-[440px]"
      title={rule.name}
      subtitle={`${source?.name ?? rule.source} → ${destination?.name ?? rule.destination}`}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="primary" icon={GitCompare} onClick={onAnalyse}>
            Analyse a change
          </Button>
          <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>
            Edit rule
          </Button>
          <Button size="sm" variant="secondary" icon={Copy} onClick={onClone}>
            Clone rule
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={rule.disabled ? Play : Ban}
            onClick={onToggleDisabled}
          >
            {rule.disabled ? 'Enable' : 'Disable'}
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={onDelete} className="col-span-2">
            Delete rule
          </Button>
        </div>
      }
    >
      <Section title="Rule">
        <div className="panel px-3.5 py-1">
          <Field label="Rule ID" mono>
            {rule.id}
          </Field>
          <Field label="Rule name">{rule.name}</Field>
          <Field label="Source">{source?.name ?? rule.source}</Field>
          <Field label="Destination">{destination?.name ?? rule.destination}</Field>
          <Field label="Protocol" mono>
            {rule.protocol}
          </Field>
          <Field label="Ports" mono>
            {formatPorts(rule.ports)}
          </Field>
          <Field label="Action">
            <Badge className={ACTION_STYLES[rule.action].chip}>{rule.action}</Badge>
          </Field>
          <Field label="Status">
            {rule.disabled ? <Badge>Disabled</Badge> : <Badge className={ACTION_STYLES.ALLOW.chip}>Active</Badge>}
          </Field>
        </div>
      </Section>

      {rule.description ? (
        <Section title="Description">
          <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-[13px] leading-relaxed text-ink-600">
            {rule.description}
          </p>
        </Section>
      ) : null}

      {analysis ? (
        <Section title="Rule analysis">
          <div className="space-y-2">
            <Callout
              tone={
                analysis.check.verdict === 'EXACT_DUPLICATE'
                  ? 'warning'
                  : analysis.check.verdict === 'FULLY_COVERED'
                    ? 'warning'
                    : 'neutral'
              }
              title={
                analysis.check.verdict === 'EXACT_DUPLICATE'
                  ? 'Duplicate rule'
                  : analysis.check.verdict === 'FULLY_COVERED'
                    ? 'Already covered'
                    : analysis.check.verdict === 'PARTIAL_OVERLAP'
                      ? 'Partial overlap'
                      : 'Unique access'
              }
            >
              {analysis.check.summary}
            </Callout>

            {analysis.conflicts.length > 0 ? (
              <Callout tone="danger" title={`${analysis.conflicts.length} conflicting rule(s)`}>
                {analysis.conflicts.map((conflict) => (
                  <div key={conflict.id} className="mt-1 first:mt-0">
                    <strong>{conflict.name}</strong> ({conflict.id}) targets the same traffic with action{' '}
                    {conflict.action}. Rule precedence must be checked.
                  </div>
                ))}
              </Callout>
            ) : null}
          </div>
        </Section>
      ) : null}
    </SidePanel>
  );
}

/**
 * Rule editor. The impact panel re-runs on every keystroke so the consequences
 * of the rule are visible while it is still being written.
 */
function RuleEditorModal({
  mode,
  draft,
  onChangeDraft,
  onClose,
  onAnalyse,
}: {
  mode: 'add' | 'edit' | 'clone';
  draft: RuleDraft;
  onChangeDraft: (draft: RuleDraft) => void;
  onClose: () => void;
  onAnalyse: (rule: Rule) => void;
}) {
  const dataset = useDataset();
  const graph = useGraph();
  const store = useAppStore();
  const toast = useToast();

  const validation = useMemo(() => (dataset ? validateDraft(draft, dataset) : null), [draft, dataset]);

  const live = useMemo(() => {
    if (!dataset || !graph || !validation?.valid) return null;
    const rule = ruleFromDraft(draft);
    const others = dataset.rules.filter((item) => item.id !== rule.id);
    return {
      rule,
      check: checkCandidateRule(rule, others, graph),
      conflicts: findConflictsOf(rule, others),
    };
  }, [draft, dataset, graph, validation]);

  if (!dataset || !graph || !validation) return null;

  const titles = { add: 'New rule', edit: 'Edit rule', clone: 'Clone rule' };

  return (
    <Modal
      open
      onClose={onClose}
      size="max-w-4xl"
      title={titles[mode]}
      subtitle="Checks run as you type. Nothing is applied until you choose an action below."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            icon={GitCompare}
            disabled={!live}
            onClick={() => live && onAnalyse(live.rule)}
          >
            Run full change analysis
          </Button>
          <Button
            variant="primary"
            disabled={!live}
            onClick={() => {
              if (!live) return;
              const original = mode === 'edit' ? dataset.rules.find((item) => item.id === live.rule.id) ?? null : null;
              store.applyImmediate(mode === 'edit' ? 'MODIFY_RULE' : 'ADD_RULE', original, live.rule);
              toast(`"${live.rule.name}" ${mode === 'edit' ? 'updated' : 'added'}.`, 'success');
              onClose();
            }}
          >
            {mode === 'edit' ? 'Save rule' : 'Add rule'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <RuleBuilder
          draft={draft}
          onChange={onChangeDraft}
          dataset={dataset}
          graph={graph}
          validation={validation}
        />

        <aside className="space-y-3 lg:border-l lg:border-ink-100 lg:pl-5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Live checks</h4>

          {!validation.valid ? (
            <Callout tone="neutral" title="Complete the rule">
              Fill in the source, destination and a valid port to see the impact of this rule.
            </Callout>
          ) : live ? (
            <>
              <Callout
                tone={
                  live.check.verdict === 'EXACT_DUPLICATE' || live.check.verdict === 'FULLY_COVERED'
                    ? 'warning'
                    : 'success'
                }
                title="Duplicate check"
              >
                {live.check.summary}
              </Callout>

              <Callout
                tone={live.conflicts.length > 0 ? 'danger' : 'success'}
                title="Conflict check"
              >
                {live.conflicts.length === 0
                  ? 'No existing rule targets this traffic with the opposite action.'
                  : `${live.conflicts.length} rule(s) target this traffic with the opposite action: ${live.conflicts
                      .map((conflict) => conflict.name)
                      .join(', ')}. Rule precedence must be checked.`}
              </Callout>

              <Callout tone="info" title="Connectivity change">
                {live.check.verdict === 'EXACT_DUPLICATE'
                  ? 'Adding this rule would not change what is permitted.'
                  : `${graph.serversById.get(live.rule.source)?.name ?? live.rule.source} would ${
                      live.rule.action === 'ALLOW' ? 'be permitted to reach' : 'be explicitly blocked from'
                    } ${graph.serversById.get(live.rule.destination)?.name ?? live.rule.destination} on ${
                      live.rule.protocol
                    } ${formatPorts(live.rule.ports)}.`}
              </Callout>

              <p className="text-[12px] leading-relaxed text-ink-500">
                Run the full change analysis for the blast radius, affected servers, paths created or removed, and
                a risk rating with its reasons.
              </p>
            </>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}

function DeletePreview({ rule }: { rule: Rule }) {
  const graph = useGraph();
  if (!graph) return null;
  const source = graph.serversById.get(rule.source)?.name ?? rule.source;
  const destination = graph.serversById.get(rule.destination)?.name ?? rule.destination;

  return (
    <div className="space-y-3">
      <Callout tone="warning" title="What this removes" icon={ListTree}>
        {rule.action === 'ALLOW' ? (
          <>
            {source} will no longer have a permitted {rule.protocol} {formatPorts(rule.ports)} connection to{' '}
            {destination}.
          </>
        ) : (
          <>
            The explicit block on {rule.protocol} {formatPorts(rule.ports)} from {source} to {destination} will be
            removed. Whether that traffic then becomes permitted depends on the other rules in the policy.
          </>
        )}
      </Callout>
      <p className="text-[13px] leading-relaxed text-ink-600">
        Choose <strong>Analyse first</strong> to see the full impact — alternative connectivity, affected servers,
        and any longer paths that use this connection — before committing.
      </p>
    </div>
  );
}
