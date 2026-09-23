import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Search, X } from 'lucide-react';
import type { Dataset, Environment, PolicyGraph, Rule, RuleAction, ServerRole } from '@/types';
import { formatPorts, parsePorts } from '@/services/ports';
import { Badge, Select, TextInput } from '@/components/ui';
import { cx, ENVIRONMENT_STYLES, roleStyle } from '@/lib/design';

/** Draft shape — strings while editing, parsed on the way out. */
export interface RuleDraft {
  id: string;
  name: string;
  source: string;
  destination: string;
  protocol: string;
  portsText: string;
  action: RuleAction;
  description: string;
}

export function draftFromRule(rule: Rule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    source: rule.source,
    destination: rule.destination,
    protocol: rule.protocol,
    portsText: rule.ports.length === 0 ? '' : formatPorts(rule.ports),
    action: rule.action,
    description: rule.description,
  };
}

export function emptyDraft(): RuleDraft {
  return {
    id: `rule-new-${Date.now().toString(36)}`,
    name: '',
    source: '',
    destination: '',
    protocol: 'TCP',
    portsText: '',
    action: 'ALLOW',
    description: '',
  };
}

export interface DraftValidation {
  valid: boolean;
  errors: Partial<Record<keyof RuleDraft, string>>;
  invalidPortTokens: string[];
}

export function validateDraft(draft: RuleDraft, dataset: Dataset): DraftValidation {
  const errors: DraftValidation['errors'] = {};
  const serverIds = new Set(dataset.servers.map((server) => server.id));

  if (!draft.name.trim()) errors.name = 'Give the rule a name so it can be identified later.';
  if (!draft.source) errors.source = 'Choose a source server.';
  else if (!serverIds.has(draft.source)) errors.source = 'This source is not in the server inventory.';
  if (!draft.destination) errors.destination = 'Choose a destination server.';
  else if (!serverIds.has(draft.destination)) errors.destination = 'This destination is not in the inventory.';
  if (draft.source && draft.source === draft.destination) {
    errors.destination = 'The source and destination are the same server.';
  }

  const parsed = parsePorts(draft.portsText || 'ANY');
  if (parsed.invalid.length > 0) {
    errors.portsText = `Could not read: ${parsed.invalid.join(', ')}. Use 443, 1400-1500, or ANY.`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    invalidPortTokens: parsed.invalid,
  };
}

export function ruleFromDraft(draft: RuleDraft): Rule {
  const parsed = parsePorts(draft.portsText.trim() || 'ANY');
  return {
    id: draft.id,
    name: draft.name.trim() || draft.id,
    source: draft.source,
    destination: draft.destination,
    protocol: draft.protocol.trim().toUpperCase() || 'ANY',
    ports: parsed.ranges,
    rawPorts: draft.portsText
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
    action: draft.action,
    description: draft.description.trim(),
  };
}

/* ------------------------------------------------------------------ *
 * Builder
 * ------------------------------------------------------------------ */

export function RuleBuilder({
  draft,
  onChange,
  dataset,
  graph,
  validation,
}: {
  draft: RuleDraft;
  onChange: (draft: RuleDraft) => void;
  dataset: Dataset;
  graph: PolicyGraph;
  validation: DraftValidation;
}) {
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]): void =>
    onChange({ ...draft, [key]: value });

  /* Auto-name the rule from its endpoints until the user types their own name. */
  const [nameTouched, setNameTouched] = useState(draft.name.length > 0);
  useEffect(() => {
    if (nameTouched || !draft.source || !draft.destination) return;
    const source = graph.serversById.get(draft.source)?.name ?? draft.source;
    const destination = graph.serversById.get(draft.destination)?.name ?? draft.destination;
    onChange({ ...draft, name: `${source}-to-${destination}` });
    // Only react to endpoint changes; `draft` identity churns on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.source, draft.destination, nameTouched]);

  const protocols = useMemo(
    () => [...new Set(['TCP', 'UDP', 'ICMP', 'ANY', ...dataset.rules.map((rule) => rule.protocol)])],
    [dataset.rules],
  );

  return (
    <div className="space-y-4">
      <TextInput
        label="Rule name"
        value={draft.name}
        placeholder="web-srv-01-to-app-srv-03"
        error={validation.errors.name}
        onChange={(event) => {
          setNameTouched(true);
          set('name', event.target.value);
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <ServerPicker
          label="Source (consumer)"
          value={draft.source}
          onChange={(value) => set('source', value)}
          dataset={dataset}
          error={validation.errors.source}
        />
        <ServerPicker
          label="Destination (provider)"
          value={draft.destination}
          onChange={(value) => set('destination', value)}
          dataset={dataset}
          error={validation.errors.destination}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Protocol" value={draft.protocol} onChange={(event) => set('protocol', event.target.value)}>
          {protocols.map((protocol) => (
            <option key={protocol} value={protocol}>
              {protocol}
            </option>
          ))}
        </Select>

        <TextInput
          label="Ports"
          className="sm:col-span-2"
          value={draft.portsText}
          placeholder="443, 8080, 1400-1500 or ANY"
          error={validation.errors.portsText}
          hint={
            validation.errors.portsText
              ? undefined
              : `Interpreted as ${formatPorts(parsePorts(draft.portsText || 'ANY').ranges)}`
          }
          onChange={(event) => set('portsText', event.target.value)}
        />
      </div>

      <div>
        <span className="label">Action</span>
        <div className="grid grid-cols-2 gap-2">
          {(['ALLOW', 'DENY'] as const).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => set('action', action)}
              className={cx(
                'rounded-lg border px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.98]',
                draft.action === action
                  ? action === 'ALLOW'
                    ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100'
                    : 'border-rose-400 bg-rose-50 ring-2 ring-rose-100'
                  : 'border-ink-200 bg-white hover:border-ink-300',
              )}
            >
              <span
                className={cx(
                  'block text-[13px] font-bold',
                  draft.action === action
                    ? action === 'ALLOW'
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                    : 'text-ink-600',
                )}
              >
                {action}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">
                {action === 'ALLOW' ? 'Permit this traffic' : 'Explicitly block this traffic'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Description</span>
        <textarea
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
          rows={2}
          placeholder="Why does this connection need to exist?"
          className="input resize-y"
        />
      </div>

      <BulkHelper dataset={dataset} onPick={(serverId, field) => set(field, serverId)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Server picker with autocomplete
 * ------------------------------------------------------------------ */

function ServerPicker({
  label,
  value,
  onChange,
  dataset,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  dataset: Dataset;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = dataset.servers.find((server) => server.id === value);

  const matches = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const pool = dataset.servers.filter((server) => !server.synthetic);
    if (!lower) return pool.slice(0, 40);
    return pool
      .filter(
        (server) =>
          server.name.toLowerCase().includes(lower) ||
          server.ip.includes(lower) ||
          server.role.toLowerCase() === lower ||
          server.environment.toLowerCase() === lower ||
          server.zone.toLowerCase() === lower,
      )
      .slice(0, 40);
  }, [dataset.servers, query]);

  return (
    <div className="relative">
      <span className="label">{label}</span>

      {selected ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            setOpen(true);
          }}
          className={cx(
            'flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-left transition-colors hover:border-ink-300',
            error ? 'border-rose-300' : 'border-ink-200',
          )}
        >
          <span className={cx('h-2 w-2 shrink-0 rounded-full', roleStyle(selected.role).dot)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink-800">{selected.name}</span>
            <span className="mono block truncate text-[11px] text-ink-500">
              {selected.ip} · {selected.role} · {selected.environment}
            </span>
          </span>
          <X className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 140)}
            placeholder="Type a name, IP, role or environment…"
            className={cx('input pl-9', error && 'border-rose-300')}
          />
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        </div>
      )}

      {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}

      {open && !selected ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-ink-400">No server matched “{query}”.</p>
          ) : (
            matches.map((server) => (
              <button
                key={server.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(server.id);
                  setQuery('');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-brand-50"
              >
                <span className={cx('h-2 w-2 shrink-0 rounded-full', roleStyle(server.role).dot)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-800">{server.name}</span>
                  <span className="mono block truncate text-[10.5px] text-ink-500">{server.ip}</span>
                </span>
                <Badge className={ENVIRONMENT_STYLES[server.environment].chip}>{server.environment}</Badge>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Selecting by group. Choosing a role, environment or zone lists the matching
 * servers so one can be dropped straight into the source or destination field.
 */
function BulkHelper({
  dataset,
  onPick,
}: {
  dataset: Dataset;
  onPick: (serverId: string, field: 'source' | 'destination') => void;
}) {
  const [group, setGroup] = useState<'none' | 'role' | 'environment' | 'zone'>('none');
  const [key, setKey] = useState('');

  const keys = useMemo(() => {
    if (group === 'role') return [...new Set(dataset.servers.map((server) => server.role))];
    if (group === 'environment') return [...new Set(dataset.servers.map((server) => server.environment))];
    if (group === 'zone') return [...new Set(dataset.servers.map((server) => server.zone).filter(Boolean))];
    return [];
  }, [group, dataset.servers]);

  const matching = useMemo(() => {
    if (group === 'none' || !key) return [];
    return dataset.servers.filter((server) => {
      if (group === 'role') return server.role === (key as ServerRole);
      if (group === 'environment') return server.environment === (key as Environment);
      return server.zone === key;
    });
  }, [group, key, dataset.servers]);

  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
      <p className="label">Pick by group</p>
      <div className="flex flex-wrap gap-2">
        <Select
          value={group}
          onChange={(event) => {
            setGroup(event.target.value as typeof group);
            setKey('');
          }}
          className="w-40"
        >
          <option value="none">Choose a grouping</option>
          <option value="role">By role</option>
          <option value="environment">By environment</option>
          <option value="zone">By zone</option>
        </Select>
        {group !== 'none' ? (
          <Select value={key} onChange={(event) => setKey(event.target.value)} className="w-40">
            <option value="">Select…</option>
            {keys.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {matching.length > 0 ? (
        <div className="mt-3 max-h-36 space-y-1 overflow-y-auto">
          <p className="text-[11.5px] text-ink-500">
            {matching.length} matching server{matching.length === 1 ? '' : 's'}. Add one as the source or
            destination:
          </p>
          {matching.map((server) => (
            <div
              key={server.id}
              className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2 py-1"
            >
              <span className={cx('h-2 w-2 shrink-0 rounded-full', roleStyle(server.role).dot)} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-700">{server.name}</span>
              <button
                type="button"
                onClick={() => onPick(server.id, 'source')}
                className="rounded px-1.5 py-0.5 text-[10.5px] font-bold text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700"
              >
                <Plus className="mr-0.5 inline h-2.5 w-2.5" />
                SRC
              </button>
              <button
                type="button"
                onClick={() => onPick(server.id, 'destination')}
                className="rounded px-1.5 py-0.5 text-[10.5px] font-bold text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700"
              >
                <Plus className="mr-0.5 inline h-2.5 w-2.5" />
                DST
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
