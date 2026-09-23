import { useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Focus,
  Globe2,
  Network,
  ShieldAlert,
} from 'lucide-react';
import type { PolicyGraph, Rule } from '@/types';
import { formatPorts, serviceLabel } from '@/services/ports';
import { summariseServer } from '@/services/statistics';
import { useAppStore } from '@/store/useAppStore';
import { useDataset } from '@/store/selectors';
import { Badge, Button, Callout, Field, SidePanel, Section } from '@/components/ui';
import { cx, environmentStyle, roleStyle } from '@/lib/design';

export function ServerDetailsPanel({
  serverId,
  graph,
  onClose,
  onOpenRule,
}: {
  serverId: string | null;
  graph: PolicyGraph;
  onClose: () => void;
  onOpenRule?: (ruleId: string) => void;
}) {
  const dataset = useDataset();
  const setFocusServer = useAppStore((state) => state.setFocusServer);
  const focusServerId = useAppStore((state) => state.focusServerId);
  const selectServer = useAppStore((state) => state.selectServer);

  const server = serverId ? graph.serversById.get(serverId) : null;

  const summary = useMemo(
    () => (server && dataset ? summariseServer(server.id, dataset) : null),
    [server, dataset],
  );

  const rules = useMemo(() => {
    if (!server || !dataset) return { inbound: [] as Rule[], outbound: [] as Rule[] };
    return {
      inbound: dataset.rules.filter((rule) => rule.destination === server.id),
      outbound: dataset.rules.filter((rule) => rule.source === server.id),
    };
  }, [server, dataset]);

  if (!server || !summary) return null;

  const style = roleStyle(server.role);
  const environment = environmentStyle(server.environment);
  const RoleIcon = style.icon;
  const focused = focusServerId === server.id;

  return (
    <SidePanel
      open={Boolean(serverId)}
      onClose={onClose}
      width="w-[440px]"
      title={
        <span className="flex items-center gap-2">
          <RoleIcon className="h-4 w-4" style={{ color: style.border }} strokeWidth={2.4} />
          {server.name}
        </span>
      }
      subtitle={`${style.label} · ${environment.label}${server.zone ? ` · ${server.zone}` : ''}`}
      footer={
        <div className="flex items-center gap-2">
          <Button
            variant={focused ? 'primary' : 'secondary'}
            size="sm"
            icon={Focus}
            onClick={() => setFocusServer(focused ? null : server.id)}
            className="flex-1"
          >
            {focused ? 'Clear focus' : 'Focus on this server'}
          </Button>
        </div>
      }
    >
      {server.synthetic ? (
        <Callout tone="warning" title="Endpoint not in the inventory" icon={ShieldAlert} className="mb-4">
          {server.name} is referenced by {summary.totalConnections} rule
          {summary.totalConnections === 1 ? '' : 's'} but does not appear in the server list. Its role, environment
          and owner cannot be confirmed from this dataset.
        </Callout>
      ) : null}

      <div className="mb-5 grid grid-cols-4 gap-2">
        <MiniStat label="Inbound" value={summary.inboundRules} icon={ArrowDownLeft} tone="text-sky-600" />
        <MiniStat label="Outbound" value={summary.outboundRules} icon={ArrowUpRight} tone="text-violet-600" />
        <MiniStat label="Allowed" value={summary.allowedConnections} icon={CheckCircle2} tone="text-emerald-600" />
        <MiniStat label="Denied" value={summary.deniedConnections} icon={Ban} tone="text-rose-600" />
      </div>

      <Section title="Details">
        <div className="panel px-3.5 py-1">
          <Field label="Server name">{server.name}</Field>
          <Field label="Server ID" mono>
            {server.id}
          </Field>
          <Field label="IP address" mono>
            {server.ip || '—'}
          </Field>
          <Field label="Role">
            <Badge className={style.chip} icon={RoleIcon}>
              {style.label}
            </Badge>
          </Field>
          <Field label="Operating system">{server.os || '—'}</Field>
          <Field label="Environment">
            <Badge className={environment.chip}>{server.environment}</Badge>
          </Field>
          <Field label="Zone">{server.zone || '—'}</Field>
        </div>
      </Section>

      <Section title={`Ports (${summary.anyPort ? 'includes ANY' : summary.ports.length})`}>
        {summary.anyPort || summary.ports.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {summary.anyPort ? (
              <Badge className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">ANY port</Badge>
            ) : null}
            {summary.ports.map((port) => {
              const service = serviceLabel(port);
              return (
                <span
                  key={port}
                  className="mono rounded-md bg-ink-100 px-2 py-1 font-semibold text-ink-700"
                  title={service ? `${port} — ${service}` : `Port ${port}`}
                >
                  {port}
                  {service ? <span className="ml-1 font-sans text-[10px] text-ink-400">{service}</span> : null}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ink-400">No ports referenced by any rule.</p>
        )}
      </Section>

      <Section title={`Neighbouring servers (${summary.neighbours.length})`}>
        {summary.neighbours.length === 0 ? (
          <p className="text-[13px] text-ink-400">This server has no connections in the current policy.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {summary.neighbours.map((neighbourId) => {
              const neighbour = graph.serversById.get(neighbourId);
              if (!neighbour) return null;
              const neighbourStyle = roleStyle(neighbour.role);
              return (
                <button
                  key={neighbourId}
                  type="button"
                  onClick={() => selectServer(neighbourId)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[12px] font-semibold text-ink-700 transition-all duration-150 hover:border-brand-300 hover:bg-brand-50 active:scale-95"
                >
                  <span className={cx('h-2 w-2 rounded-full', neighbourStyle.dot)} />
                  {neighbour.name}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title={`Outbound rules (${rules.outbound.length})`}>
        <RuleList rules={rules.outbound} graph={graph} direction="out" onOpenRule={onOpenRule} />
      </Section>

      <Section title={`Inbound rules (${rules.inbound.length})`}>
        <RuleList rules={rules.inbound} graph={graph} direction="in" onOpenRule={onOpenRule} />
      </Section>
    </SidePanel>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Network;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-2 py-2 text-center">
      <Icon className={cx('mx-auto h-3.5 w-3.5', tone)} strokeWidth={2.4} />
      <div className="mt-1 text-lg font-bold leading-none tabular-nums text-ink-800">{value}</div>
      <div className="mt-1 text-[10.5px] font-medium text-ink-400">{label}</div>
    </div>
  );
}

export function RuleList({
  rules,
  graph,
  direction,
  onOpenRule,
  emptyMessage,
}: {
  rules: Rule[];
  graph: PolicyGraph;
  direction: 'in' | 'out';
  onOpenRule?: (ruleId: string) => void;
  emptyMessage?: string;
}) {
  if (rules.length === 0) {
    return <p className="text-[13px] text-ink-400">{emptyMessage ?? 'No rules.'}</p>;
  }

  return (
    <div className="space-y-1">
      {rules.map((rule) => {
        const peerId = direction === 'out' ? rule.destination : rule.source;
        const peer = graph.serversById.get(peerId);
        const allow = rule.action === 'ALLOW';
        return (
          <button
            key={rule.id}
            type="button"
            onClick={() => onOpenRule?.(rule.id)}
            disabled={!onOpenRule}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-left transition-all duration-150',
              onOpenRule && 'hover:border-brand-300 hover:bg-brand-50/40 active:scale-[0.99]',
              rule.disabled && 'opacity-50',
            )}
          >
            <span
              className={cx('h-7 w-1 shrink-0 rounded-full', allow ? 'bg-emerald-500' : 'bg-rose-500')}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {direction === 'out' ? (
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-ink-400" strokeWidth={2.4} />
                ) : (
                  <ArrowDownLeft className="h-3 w-3 shrink-0 text-ink-400" strokeWidth={2.4} />
                )}
                <span className="truncate text-[12.5px] font-semibold text-ink-800">
                  {peer?.name ?? peerId}
                </span>
                {rule.disabled ? (
                  <span className="rounded bg-ink-200 px-1 text-[9.5px] font-bold uppercase text-ink-500">
                    Disabled
                  </span>
                ) : null}
              </span>
              <span className="mono mt-0.5 block truncate text-[11px] text-ink-500">
                {rule.protocol} {formatPorts(rule.ports)} · {rule.name}
              </span>
            </span>
            <span
              className={cx(
                'chip shrink-0 text-[10px]',
                allow
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                  : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
              )}
            >
              {rule.action}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ExternalEndpointHint() {
  return (
    <Callout tone="neutral" icon={Globe2}>
      Endpoints shown with a dashed outline were referenced by a rule but are not in the server inventory.
    </Callout>
  );
}
