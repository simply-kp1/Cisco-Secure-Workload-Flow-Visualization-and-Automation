import { useMemo } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  Network,
  Plug,
  Server,
  ShieldAlert,
  Unlink,
  ListTree,
  ArrowRight,
} from 'lucide-react';
import {
  allowVsDeny,
  busiestServers,
  connectionsByRole,
  environmentDistribution,
  rulesByProtocol,
  topPorts,
} from '@/services/statistics';
import { useDataset, useGraph, useIssues, useStats } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { Button, Card, CardHeader, Callout, Stat } from '@/components/ui';
import {
  actionColor,
  DonutChart,
  environmentColor,
  HorizontalBarChart,
  roleColor,
  VerticalBarChart,
} from '@/components/charts';
import { MiniTopology } from '@/components/topology/MiniTopology';
import { CHART_COLORS } from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

export function DashboardPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const dataset = useDataset();
  const graph = useGraph();
  const stats = useStats();
  const issues = useIssues();
  const setFilters = useAppStore((state) => state.setFilters);
  const highlight = useAppStore((state) => state.highlight);

  const charts = useMemo(() => {
    if (!dataset || !graph) return null;
    return {
      byRole: connectionsByRole(dataset, graph),
      allowDeny: allowVsDeny(dataset),
      ports: topPorts(dataset, 8),
      busiest: busiestServers(dataset, graph, 8),
      protocols: rulesByProtocol(dataset),
      environments: environmentDistribution(dataset),
    };
  }, [dataset, graph]);

  if (!dataset || !graph || !stats || !charts) return null;

  const goToFiltered = (page: PageId, filters: Parameters<typeof setFilters>[0]): void => {
    setFilters(filters);
    onNavigate(page);
  };

  const isolated = issues.filter((issue) => issue.category === 'ISOLATED_SERVER');
  const criticalIssues = issues.filter(
    (issue) => issue.severity === 'critical' || issue.severity === 'high',
  );

  return (
    <div className="space-y-5">
      {criticalIssues.length > 0 ? (
        <Callout tone="warning" title={`${criticalIssues.length} policy issues need attention`} icon={AlertTriangle}>
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {criticalIssues
                .slice(0, 2)
                .map((issue) => issue.title)
                .join('; ')}
              {criticalIssues.length > 2 ? `, and ${criticalIssues.length - 2} more.` : '.'}
            </span>
            <Button size="sm" variant="secondary" iconRight={ArrowRight} onClick={() => onNavigate('conflicts')}>
              Review conflicts
            </Button>
          </div>
        </Callout>
      ) : null}

      {/* -------------------- statistics -------------------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Total servers"
          value={stats.totalServers}
          icon={Server}
          tone="brand"
          hint={stats.unresolvedEndpoints > 0 ? `+${stats.unresolvedEndpoints} unresolved endpoints` : undefined}
          onClick={() => onNavigate('servers')}
        />
        <Stat
          label="Total rules"
          value={stats.totalRules}
          icon={ListTree}
          hint={stats.disabledRules > 0 ? `${stats.disabledRules} disabled` : undefined}
          onClick={() => onNavigate('rules')}
        />
        <Stat
          label="Allowed connections"
          value={stats.allowedConnections}
          icon={CheckCircle2}
          tone="positive"
          onClick={() => goToFiltered('network', { actions: ['ALLOW'] })}
        />
        <Stat
          label="Denied connections"
          value={stats.deniedConnections}
          icon={Ban}
          tone="danger"
          onClick={() => goToFiltered('network', { actions: ['DENY'] })}
        />
        <Stat
          label="Unique ports"
          value={stats.uniquePorts}
          icon={Plug}
          onClick={() => onNavigate('ports')}
        />
        <Stat
          label="Potential conflicts"
          value={stats.potentialConflicts}
          icon={AlertTriangle}
          tone={stats.potentialConflicts > 0 ? 'warning' : 'neutral'}
          hint="ALLOW and DENY on the same traffic"
          onClick={() => onNavigate('conflicts')}
        />
        <Stat
          label="Duplicate rules"
          value={stats.duplicateRules}
          icon={Copy}
          tone={stats.duplicateRules > 0 ? 'warning' : 'neutral'}
          hint="Identical rules that add no access"
          onClick={() => onNavigate('conflicts')}
        />
        <Stat
          label="Isolated servers"
          value={stats.isolatedServers}
          icon={Unlink}
          hint="No rule references them"
          onClick={() => {
            highlight(isolated.flatMap((issue) => issue.serverIds), []);
            onNavigate('conflicts');
          }}
        />
        <Stat
          label="High-risk connections"
          value={stats.highRiskConnections}
          icon={ShieldAlert}
          tone={stats.highRiskConnections > 0 ? 'danger' : 'neutral'}
          hint="Admin ports, ANY access, or cross-tier database access"
          onClick={() => onNavigate('conflicts')}
        />
        <Stat
          label="Servers on the map"
          value={graph.nodes.size}
          icon={Network}
          hint="Including unresolved endpoints"
          onClick={() => onNavigate('network')}
        />
      </div>

      {/* -------------------- topology overview -------------------- */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Topology overview"
          subtitle="A small view of the whole policy. Open the Network Map for the full interactive diagram."
          icon={Network}
          action={
            <Button size="sm" variant="subtle" iconRight={ArrowRight} onClick={() => onNavigate('network')}>
              Open Network Map
            </Button>
          }
        />
        <div className="h-[320px] border-t border-ink-100">
          <MiniTopology graph={graph} onOpen={() => onNavigate('network')} />
        </div>
      </Card>

      {/* -------------------- charts -------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Connections by server role"
            subtitle="How many rules originate from each tier."
          />
          <div className="px-3 pb-4">
            <HorizontalBarChart
              data={charts.byRole}
              valueLabel="rules"
              colorFor={roleColor}
              onSelect={(point) => goToFiltered('network', { roles: [point.key as never] })}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Allow vs deny" subtitle="The balance of permissive and restrictive policy." />
          <div className="px-3 pb-4">
            <DonutChart
              data={charts.allowDeny}
              valueLabel="rules"
              colorFor={actionColor}
              centerValue={stats.totalRules}
              centerLabel="rules"
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Most commonly used ports"
            subtitle="Well-known services are named; uncommon ports are shown by number only."
          />
          <div className="px-3 pb-4">
            <HorizontalBarChart
              data={charts.ports}
              valueLabel="rules"
              onSelect={(point) => goToFiltered('network', { portQuery: point.key ?? '' })}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Servers with the most connections" subtitle="Inbound and outbound rules combined." />
          <div className="px-3 pb-4">
            <HorizontalBarChart
              data={charts.busiest}
              valueLabel="connections"
              colorFor={(_, index) => CHART_COLORS[index % CHART_COLORS.length]}
              onSelect={(point) => goToFiltered('network', { focusServerId: point.key ?? null })}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Rules by protocol" subtitle="ANY covers every protocol." />
          <div className="px-3 pb-4">
            <VerticalBarChart data={charts.protocols} valueLabel="rules" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Environment distribution" subtitle="Where the servers sit in the lifecycle." />
          <div className="px-3 pb-4">
            <DonutChart
              data={charts.environments}
              valueLabel="servers"
              colorFor={environmentColor}
              centerValue={stats.totalServers}
              centerLabel="servers"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
