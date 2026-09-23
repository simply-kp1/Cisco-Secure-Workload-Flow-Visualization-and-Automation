import { useMemo } from 'react';
import { GitCompare, Info, Route } from 'lucide-react';
import type { PolicyGraph } from '@/types';
import { formatPorts, serviceForPort, enumeratePorts } from '@/services/ports';
import { pathsUsingConnection } from '@/services/paths';
import { describePath } from '@/services/paths';
import { connectionFromRule } from '@/services/graph';
import { useAppStore } from '@/store/useAppStore';
import { Badge, Button, Callout, Field, Section, SidePanel } from '@/components/ui';
import { ACTION_STYLES, cx, roleStyle } from '@/lib/design';

/**
 * Details for one connection (i.e. one rule drawn on the map).
 *
 * Shows the full 5-tuple, the rule metadata, and — because it is the question
 * people actually have — which longer permitted paths run through it.
 */
export function ConnectionDetailsPanel({
  ruleId,
  graph,
  onClose,
  onAnalyse,
}: {
  ruleId: string | null;
  graph: PolicyGraph;
  onClose: () => void;
  onAnalyse?: (ruleId: string) => void;
}) {
  const selectServer = useAppStore((state) => state.selectServer);
  const rule = ruleId ? graph.rulesById.get(ruleId) : null;

  const dependentPaths = useMemo(() => {
    if (!rule || rule.disabled) return [];
    return pathsUsingConnection(graph, connectionFromRule(rule), { maxHops: 3, maxResults: 12 });
  }, [rule, graph]);

  if (!rule) return null;

  const source = graph.serversById.get(rule.source);
  const destination = graph.serversById.get(rule.destination);
  const action = ACTION_STYLES[rule.action];
  const ports = enumeratePorts(rule.ports, 24);

  return (
    <SidePanel
      open={Boolean(ruleId)}
      onClose={onClose}
      width="w-[440px]"
      title="Connection"
      subtitle={rule.name}
      footer={
        onAnalyse ? (
          <Button variant="primary" size="sm" icon={GitCompare} onClick={() => onAnalyse(rule.id)} className="w-full">
            Analyse a change to this rule
          </Button>
        ) : undefined
      }
    >
      <div className="mb-5 rounded-xl border border-ink-200 bg-gradient-to-br from-white to-ink-50 p-4">
        <div className="flex items-center gap-2.5">
          <EndpointChip
            name={source?.name ?? rule.source}
            role={source ? roleStyle(source.role).short : '?'}
            color={source ? roleStyle(source.role).border : '#94a3b8'}
            onClick={() => selectServer(rule.source)}
          />
          <div className="flex flex-1 flex-col items-center">
            <span
              className={cx(
                'chip mb-1 text-[10px]',
                rule.action === 'ALLOW'
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                  : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
              )}
            >
              {rule.action}
            </span>
            <svg width="100%" height="10" viewBox="0 0 80 10" preserveAspectRatio="none" aria-hidden>
              <line
                x1="0"
                y1="5"
                x2="70"
                y2="5"
                stroke={action.color}
                strokeWidth="2.5"
                strokeDasharray={rule.action === 'DENY' ? '5 4' : undefined}
              />
              <polygon points="70,1 80,5 70,9" fill={action.color} />
            </svg>
            <span className="mono mt-1 text-[10.5px] font-semibold text-ink-500">
              {rule.protocol} {formatPorts(rule.ports)}
            </span>
          </div>
          <EndpointChip
            name={destination?.name ?? rule.destination}
            role={destination ? roleStyle(destination.role).short : '?'}
            color={destination ? roleStyle(destination.role).border : '#94a3b8'}
            onClick={() => selectServer(rule.destination)}
          />
        </div>
      </div>

      {rule.disabled ? (
        <Callout tone="neutral" className="mb-4">
          This rule is disabled, so it currently permits and blocks nothing. It is excluded from connectivity
          analysis until it is re-enabled.
        </Callout>
      ) : null}

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
            <Badge className={action.chip}>{rule.action}</Badge>
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

      {ports.length > 0 ? (
        <Section title="Services">
          <div className="space-y-1">
            {ports.map((port) => {
              const service = serviceForPort(port);
              return (
                <div
                  key={port}
                  className="flex items-center justify-between rounded-lg border border-ink-200 bg-white px-2.5 py-1.5"
                >
                  <span className="mono font-semibold text-ink-800">{port}</span>
                  <span className="text-[12px] text-ink-500">
                    {service ? (
                      <>
                        <span className="font-semibold text-ink-700">{service.name}</span> — {service.description}
                      </>
                    ) : (
                      <span className="text-ink-400">Not a widely recognised service port</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section title={`Paths using this connection (${dependentPaths.length})`}>
        {dependentPaths.length === 0 ? (
          <Callout tone="neutral" icon={Info}>
            No longer permitted route runs through this connection. Removing it would affect only the direct
            connection between these two servers.
          </Callout>
        ) : (
          <>
            <p className="mb-2 text-[12.5px] leading-relaxed text-ink-500">
              This connection forms part of {dependentPaths.length} longer permitted route
              {dependentPaths.length === 1 ? '' : 's'}. Removing it may affect connectivity along
              {dependentPaths.length === 1 ? ' it' : ' them'}.
            </p>
            <div className="space-y-1">
              {dependentPaths.map((path, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5"
                >
                  <Route className="h-3.5 w-3.5 shrink-0 text-brand-500" strokeWidth={2.2} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-700">
                    {describePath(graph, path)}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-400">
                    {path.hopCount} hops
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>
    </SidePanel>
  );
}

function EndpointChip({
  name,
  role,
  color,
  onClick,
}: {
  name: string;
  role: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[118px] shrink-0 flex-col items-center gap-1 rounded-xl border border-ink-200 bg-white px-2 py-2.5 transition-all duration-150 hover:border-brand-300 hover:shadow-sm active:scale-95"
    >
      <span
        className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold"
        style={{ color, backgroundColor: `${color}1a` }}
      >
        {role}
      </span>
      <span className="w-full truncate text-center text-[12px] font-semibold text-ink-800">{name}</span>
    </button>
  );
}
