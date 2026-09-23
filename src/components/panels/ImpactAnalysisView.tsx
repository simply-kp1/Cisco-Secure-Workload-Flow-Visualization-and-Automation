import { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  DoorOpen,
  DoorClosed,
  Info,
  Route,
  ShieldAlert,
  Users,
  Zap,
} from 'lucide-react';
import type { ChangeAnalysis, PolicyGraph } from '@/types';
import { formatPorts } from '@/services/ports';
import { describePath } from '@/services/paths';
import { groupByLevel, IMPACT_LEVEL_DESCRIPTION, IMPACT_LEVEL_LABEL } from '@/services/impact';
import { Badge, Callout, Card, CardHeader } from '@/components/ui';
import { cx, IMPACT_STYLES, RISK_STYLES, roleStyle } from '@/lib/design';

/**
 * The impact analysis for a proposed change.
 *
 * Every section states facts before conclusions, and the language throughout is
 * conditional — this dataset describes network policy, not application
 * dependencies, so "may affect" is the strongest honest claim.
 */
export function ImpactAnalysisView({
  analysis,
  graph,
  onSelectServer,
}: {
  analysis: ChangeAnalysis;
  graph: PolicyGraph;
  onSelectServer?: (serverId: string) => void;
}) {
  const name = (id: string): string => graph.serversById.get(id)?.name ?? id;
  const grouped = groupByLevel(analysis.affectedServers);

  return (
    <div className="space-y-4">
      <RiskCard analysis={analysis} />

      {/* ---------------- headline counts ---------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile
          label="Connections added"
          value={analysis.connectionsAdded.length}
          icon={ArrowUpRight}
          tone="positive"
        />
        <CountTile
          label="Connections removed"
          value={analysis.connectionsRemoved.length}
          icon={ArrowDownRight}
          tone={analysis.connectionsRemoved.length > 0 ? 'danger' : 'neutral'}
        />
        <CountTile
          label="Connections modified"
          value={analysis.connectionsModified.length}
          icon={Zap}
          tone={analysis.connectionsModified.length > 0 ? 'warning' : 'neutral'}
        />
        <CountTile
          label="Servers in blast radius"
          value={analysis.affectedServers.length}
          icon={Users}
          tone={analysis.affectedServers.length > 8 ? 'warning' : 'neutral'}
        />
      </div>

      {/* ---------------- potential service impact ---------------- */}
      {analysis.breakage.length > 0 ? (
        <Card>
          <CardHeader
            title="Potential service impact"
            subtitle="Permitted connectivity that this change removes, and whether equivalent access remains."
            icon={AlertTriangle}
          />
          <div className="space-y-3 border-t border-ink-100 px-5 py-4">
            {analysis.breakage.map((finding) => (
              <div
                key={finding.connectionId}
                className={cx(
                  'rounded-xl border px-4 py-3',
                  finding.alternativeAvailable
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-rose-200 bg-rose-50/50',
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  {finding.alternativeAvailable ? (
                    <Badge className="bg-amber-100 text-amber-800">Connectivity remains</Badge>
                  ) : (
                    <Badge className="bg-rose-100 text-rose-800">No alternative path detected</Badge>
                  )}
                  <span className="mono text-[11.5px] text-ink-500">
                    {name(finding.source)} → {name(finding.destination)} · {finding.protocol}{' '}
                    {formatPorts(finding.ports)}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-ink-700">{finding.summary}</p>

                {finding.alternativeRuleIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] font-semibold text-ink-500">Provided by:</span>
                    {finding.alternativeRuleIds.map((ruleId) => (
                      <span
                        key={ruleId}
                        className="mono rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-200"
                      >
                        {graph.rulesById.get(ruleId)?.name ?? ruleId}
                      </span>
                    ))}
                  </div>
                ) : null}

                {finding.dependentPaths.length > 0 ? (
                  <Collapsible
                    className="mt-2.5"
                    label={`${finding.dependentPaths.length} existing network path${finding.dependentPaths.length === 1 ? '' : 's'} use this connection`}
                  >
                    <div className="space-y-1">
                      {finding.dependentPaths.map((path, index) => (
                        <div key={index} className="flex items-center gap-2 text-[12.5px] text-ink-600">
                          <Route className="h-3 w-3 shrink-0 text-ink-400" />
                          <span className="truncate">{describePath(graph, path)}</span>
                        </div>
                      ))}
                    </div>
                  </Collapsible>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Callout tone="success" title="No permitted connectivity is removed" icon={CheckCircle2}>
          This change does not remove any existing allowed connection.
        </Callout>
      )}

      {/* ---------------- blast radius ---------------- */}
      <Card>
        <CardHeader
          title="Blast radius"
          subtitle="Servers that could be affected, and why each one is listed. Reachability is measured through permitted connections only."
          icon={Users}
        />
        <div className="space-y-3 border-t border-ink-100 px-5 py-4">
          {(['DIRECT', 'ONE_HOP', 'TWO_HOP', 'DOWNSTREAM'] as const).map((level) => {
            const servers = grouped[level];
            if (servers.length === 0) return null;
            return (
              <div key={level}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge className={IMPACT_STYLES[level].chip}>{IMPACT_LEVEL_LABEL[level]}</Badge>
                  <span className="text-[11.5px] text-ink-400">{IMPACT_LEVEL_DESCRIPTION[level]}</span>
                  <span className="ml-auto text-[11.5px] font-bold tabular-nums text-ink-500">
                    {servers.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {servers.map((affected) => {
                    const server = graph.serversById.get(affected.serverId);
                    return (
                      <button
                        key={affected.serverId}
                        type="button"
                        onClick={() => onSelectServer?.(affected.serverId)}
                        disabled={!onSelectServer}
                        className={cx(
                          'flex w-full items-start gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-left',
                          onSelectServer && 'transition-colors hover:border-brand-300 hover:bg-brand-50/40',
                        )}
                      >
                        <span
                          className={cx(
                            'mt-1 h-2 w-2 shrink-0 rounded-full',
                            server ? roleStyle(server.role).dot : 'bg-ink-300',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-semibold text-ink-800">
                            {name(affected.serverId)}
                            {server ? (
                              <span className="ml-1.5 font-normal text-ink-400">
                                {server.role} · {server.environment}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">
                            {affected.reasons[0]}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ---------------- connectivity changes ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DeltaCard
          title="Connections added"
          icon={ArrowUpRight}
          tone="positive"
          items={analysis.connectionsAdded.map((delta) => delta.description)}
          emptyMessage="No new connections."
        />
        <DeltaCard
          title="Connections removed"
          icon={ArrowDownRight}
          tone="danger"
          items={analysis.connectionsRemoved.map((delta) => delta.description)}
          emptyMessage="No connections removed."
        />
        <DeltaCard
          title="Connections modified"
          icon={Zap}
          tone="warning"
          items={analysis.connectionsModified.map((delta) => delta.description)}
          emptyMessage="No connections modified."
        />
        <DeltaCard
          title="Paths created and removed"
          icon={Route}
          tone="neutral"
          items={[
            ...analysis.pathsCreated.map(
              (path) => `New permitted route: ${describePath(graph, path)} (${path.hopCount} hops)`,
            ),
            ...analysis.pathsRemoved.map(
              (path) => `Route no longer permitted: ${describePath(graph, path)} (${path.hopCount} hops)`,
            ),
          ]}
          emptyMessage="No multi-hop routes are created or removed."
        />
        <DeltaCard
          title="Ports opened"
          icon={DoorOpen}
          tone="warning"
          items={analysis.portsOpened.map(
            (delta) =>
              `${name(delta.serverId)} accepts ${delta.protocol} ${formatPorts([delta.port])} from ${name(delta.peerId)}`,
          )}
          emptyMessage="No ports opened."
        />
        <DeltaCard
          title="Ports closed"
          icon={DoorClosed}
          tone="neutral"
          items={analysis.portsClosed.map(
            (delta) =>
              `${name(delta.serverId)} no longer accepts ${delta.protocol} ${formatPorts([delta.port])} from ${name(delta.peerId)}`,
          )}
          emptyMessage="No ports closed."
        />
      </div>

      {/* ---------------- rule hygiene ---------------- */}
      {analysis.duplicates.length > 0 ||
      analysis.conflicts.length > 0 ||
      analysis.overlaps.length > 0 ||
      analysis.redundancies.length > 0 ? (
        <Card>
          <CardHeader title="Rule checks" subtitle="How this rule relates to the policy that already exists." icon={Copy} />
          <div className="space-y-2 border-t border-ink-100 px-5 py-4">
            {[...analysis.conflicts, ...analysis.duplicates, ...analysis.overlaps, ...analysis.redundancies].map(
              (issue) => (
                <Callout
                  key={issue.id}
                  tone={
                    issue.category === 'ALLOW_DENY_CONFLICT'
                      ? 'danger'
                      : issue.category === 'EXACT_DUPLICATE'
                        ? 'warning'
                        : 'neutral'
                  }
                  title={issue.title}
                >
                  <p>{issue.explanation}</p>
                  {issue.evidence.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {issue.evidence.map((line, index) => (
                        <li key={index} className="mono text-[11.5px] opacity-80">
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Callout>
              ),
            )}
          </div>
        </Card>
      ) : null}

      {/* ---------------- exposure ---------------- */}
      {analysis.exposure.length > 0 ? (
        <Card>
          <CardHeader
            title="Security exposure introduced"
            subtitle="Access that is conventionally treated as sensitive."
            icon={ShieldAlert}
          />
          <ul className="space-y-1.5 border-t border-ink-100 px-5 py-4">
            {analysis.exposure.map((note, index) => (
              <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-ink-700">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2.2} />
                {note}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---------------- recommendations ---------------- */}
      <Card>
        <CardHeader title="Recommendation notes" icon={Info} />
        <ul className="space-y-2 border-t border-ink-100 px-5 py-4">
          {analysis.recommendations.map((note, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-ink-700">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              {note}
            </li>
          ))}
        </ul>
        <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-3">
          <p className="text-[12px] leading-relaxed text-ink-500">
            This analysis covers network policy only. It identifies where connectivity changes and where service
            impact is possible; it does not include application dependency information and cannot confirm that an
            application will or will not be affected.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Risk
 * ------------------------------------------------------------------ */

export function RiskCard({ analysis }: { analysis: ChangeAnalysis }) {
  const style = RISK_STYLES[analysis.risk.rating];
  const [showFacts, setShowFacts] = useState(true);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Change risk</p>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span className={cx('chip px-3 py-1.5 text-sm font-extrabold tracking-wide', style.chip)}>
              {analysis.risk.rating}
            </span>
            <span className="text-[12.5px] text-ink-500">
              deterministic score {analysis.risk.score}
            </span>
          </div>
        </div>

        <div className="ml-auto flex-1 basis-[240px]">
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div
              className={cx('h-full rounded-full transition-all duration-500', style.bar)}
              style={{ width: `${Math.min((analysis.risk.score / 16) * 100, 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] font-medium text-ink-400">
            <span>Low</span>
            <span>Medium (3)</span>
            <span>High (7)</span>
            <span>Critical (13)</span>
          </div>
        </div>
      </div>

      <div className="border-t border-ink-100 px-5 py-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-400">Why this rating</p>
        <div className="space-y-1.5">
          {analysis.risk.factors.map((factor, index) => (
            <div key={index} className="flex items-start gap-2.5 rounded-lg bg-ink-50 px-3 py-2">
              <span
                className={cx(
                  'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-extrabold tabular-nums',
                  factor.points > 0 ? 'bg-ink-800 text-white' : 'bg-ink-200 text-ink-500',
                )}
              >
                {factor.points > 0 ? `+${factor.points}` : '0'}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink-800">{factor.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{factor.detail}</span>
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowFacts((value) => !value)}
          className="mt-3 flex items-center gap-1 text-[12px] font-semibold text-ink-500 transition-colors hover:text-ink-700"
        >
          <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', showFacts && 'rotate-180')} />
          Raw facts behind the rating
        </button>

        {showFacts ? (
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3">
            {Object.entries(analysis.risk.facts).map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-2 border-b border-dotted border-ink-200 py-1"
              >
                <span className="text-[11.5px] text-ink-500">{humanise(key)}</span>
                <span className="text-[12.5px] font-bold tabular-nums text-ink-800">{value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Small parts
 * ------------------------------------------------------------------ */

function CountTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Zap;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'text-ink-700 bg-ink-100',
    positive: 'text-emerald-600 bg-emerald-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-rose-600 bg-rose-50',
  };
  const [text, bg] = tones[tone].split(' ');

  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <div className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', bg, text)}>
        <Icon className="h-4 w-4" strokeWidth={2.3} />
      </div>
      <div className="min-w-0">
        <div className={cx('text-xl font-bold leading-none tabular-nums', text)}>{value}</div>
        <div className="mt-1 truncate text-[11.5px] font-medium text-ink-500">{label}</div>
      </div>
    </div>
  );
}

function DeltaCard({
  title,
  icon: Icon,
  tone,
  items,
  emptyMessage,
}: {
  title: string;
  icon: typeof Zap;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
  items: string[];
  emptyMessage: string;
}) {
  const dots = {
    neutral: 'bg-ink-300',
    positive: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
  };

  return (
    <Card>
      <CardHeader
        title={title}
        icon={Icon}
        action={
          <span className="text-[13px] font-bold tabular-nums text-ink-400">{items.length}</span>
        }
      />
      <div className="max-h-56 overflow-y-auto border-t border-ink-100 px-5 py-3">
        {items.length === 0 ? (
          <p className="py-2 text-[13px] text-ink-400">{emptyMessage}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, index) => (
              <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-700">
                <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dots[tone])} />
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Collapsible({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-[12px] font-semibold text-ink-600 transition-colors hover:text-ink-800"
      >
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        {label}
      </button>
      {open ? <div className="mt-1.5 pl-4">{children}</div> : null}
    </div>
  );
}

function humanise(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}
