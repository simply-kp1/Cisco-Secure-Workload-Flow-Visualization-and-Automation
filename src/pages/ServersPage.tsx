import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, LayoutGrid, Network, Rows3, Server as ServerIcon } from 'lucide-react';
import type { Environment, Server, ServerRole } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useGraph, useServerSummaries } from '@/store/selectors';
import type { ServerSummary } from '@/services/statistics';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PillGroup,
  SearchInput,
  Tabs,
  sortRows,
  type Column,
} from '@/components/ui';
import { ServerDetailsPanel } from '@/components/panels/ServerDetailsPanel';
import {
  cx,
  ENVIRONMENT_ORDER,
  ENVIRONMENT_STYLES,
  ROLE_ORDER,
  ROLE_STYLES,
  roleStyle,
} from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

type Row = { server: Server; summary: ServerSummary };

const CARD_PAGE_SIZE = 60;

export function ServersPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const dataset = useDataset();
  const graph = useGraph();
  const summaries = useServerSummaries();
  const store = useAppStore();

  const [query, setQuery] = useState('');
  const [roles, setRoles] = useState<ServerRole[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'connections',
    direction: 'desc',
  });
  /**
   * Cards are heavier than table rows, so the grid grows on demand. A
   * thousand-server estate rendered in one pass locks the main thread.
   */
  const [visibleCards, setVisibleCards] = useState(CARD_PAGE_SIZE);

  const rows = useMemo<Row[]>(() => {
    if (!dataset) return [];
    const lower = query.trim().toLowerCase();
    return dataset.servers
      .filter((server) => {
        if (roles.length > 0 && !roles.includes(server.role)) return false;
        if (environments.length > 0 && !environments.includes(server.environment)) return false;
        if (!lower) return true;
        return (
          server.name.toLowerCase().includes(lower) ||
          server.ip.toLowerCase().includes(lower) ||
          server.id.toLowerCase().includes(lower) ||
          server.os.toLowerCase().includes(lower) ||
          server.zone.toLowerCase().includes(lower)
        );
      })
      .map((server) => ({
        server,
        summary: summaries.get(server.id) ?? emptySummary(server.id),
      }));
  }, [dataset, summaries, query, roles, environments]);

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: 'name',
        header: 'Server',
        sortable: true,
        sortValue: (row) => row.server.name,
        render: (row) => (
          <div className="flex items-center gap-2">
            <span className={cx('h-2 w-2 shrink-0 rounded-full', roleStyle(row.server.role).dot)} />
            <span className="font-semibold text-ink-800">{row.server.name}</span>
            {row.server.synthetic ? (
              <Badge className="bg-ink-100 text-ink-500 ring-1 ring-inset ring-ink-200">Unresolved</Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: 'ip',
        header: 'IP',
        sortable: true,
        sortValue: (row) => row.server.ip,
        render: (row) => <span className="mono text-ink-600">{row.server.ip || '—'}</span>,
      },
      {
        key: 'role',
        header: 'Role',
        sortable: true,
        sortValue: (row) => row.server.role,
        render: (row) => {
          const style = roleStyle(row.server.role);
          return <Badge className={style.chip}>{style.short}</Badge>;
        },
      },
      {
        key: 'environment',
        header: 'Environment',
        sortable: true,
        sortValue: (row) => row.server.environment,
        render: (row) => (
          <Badge className={ENVIRONMENT_STYLES[row.server.environment].chip}>{row.server.environment}</Badge>
        ),
      },
      {
        key: 'os',
        header: 'OS',
        sortable: true,
        sortValue: (row) => row.server.os,
        render: (row) => <span className="text-ink-600">{row.server.os || '—'}</span>,
      },
      {
        key: 'zone',
        header: 'Zone',
        sortable: true,
        sortValue: (row) => row.server.zone,
        render: (row) => <span className="text-ink-600">{row.server.zone || '—'}</span>,
      },
      {
        key: 'inbound',
        header: 'Inbound',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.summary.inboundRules,
        render: (row) => <span className="tabular-nums">{row.summary.inboundRules}</span>,
      },
      {
        key: 'outbound',
        header: 'Outbound',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.summary.outboundRules,
        render: (row) => <span className="tabular-nums">{row.summary.outboundRules}</span>,
      },
      {
        key: 'connections',
        header: 'Total',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.summary.totalConnections,
        render: (row) => (
          <span className="font-semibold tabular-nums text-ink-800">{row.summary.totalConnections}</span>
        ),
      },
    ],
    [],
  );

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  // Narrowing the search should start the card grid again from the top.
  const [lastRowCount, setLastRowCount] = useState(sorted.length);
  if (sorted.length !== lastRowCount) {
    setLastRowCount(sorted.length);
    setVisibleCards(CARD_PAGE_SIZE);
  }

  if (!dataset || !graph) return null;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name, IP, OS or zone…"
            className="min-w-[260px] flex-1"
          />
          <PillGroup<ServerRole>
            label="Role"
            options={ROLE_ORDER.map((role) => ({ value: role, label: ROLE_STYLES[role].short }))}
            selected={roles}
            onChange={setRoles}
          />
          <PillGroup<Environment>
            label="Environment"
            options={ENVIRONMENT_ORDER.map((environment) => ({ value: environment, label: environment }))}
            selected={environments}
            onChange={setEnvironments}
          />
          <Tabs
            value={viewMode}
            onChange={setViewMode}
            tabs={[
              { value: 'cards', label: 'Cards', icon: LayoutGrid },
              { value: 'table', label: 'Table', icon: Rows3 },
            ]}
          />
        </div>
        <p className="mt-3 text-[12.5px] text-ink-500">
          Showing {sorted.length} of {dataset.servers.length} servers.
        </p>
      </Card>

      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={ServerIcon}
            title="No servers match these filters"
            description="Try clearing the search or widening the role and environment filters."
          />
        </Card>
      ) : viewMode === 'table' ? (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={sorted}
            rowKey={(row) => row.server.id}
            sort={sort}
            onSortChange={setSort}
            onRowClick={(row) => store.selectServer(row.server.id)}
            activeRowKey={store.selectedServerId}
            pageSize={200}
            itemNoun="servers"
            maxHeight="max-h-[calc(100vh-330px)]"
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {sorted.slice(0, visibleCards).map((row) => (
              <ServerCard
                key={row.server.id}
                row={row}
                onOpen={() => store.selectServer(row.server.id)}
                onFocus={() => {
                  store.setFocusServer(row.server.id);
                  onNavigate('network');
                }}
              />
            ))}
          </div>
          {sorted.length > visibleCards ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <p className="text-[12.5px] text-ink-500">
                Showing {visibleCards.toLocaleString()} of {sorted.length.toLocaleString()} servers.
              </p>
              <Button
                variant="secondary"
                onClick={() => setVisibleCards((value) => value + CARD_PAGE_SIZE)}
              >
                Show {Math.min(CARD_PAGE_SIZE, sorted.length - visibleCards).toLocaleString()} more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ServerDetailsPanel
        serverId={store.selectedServerId}
        graph={graph}
        onClose={() => store.selectServer(null)}
        onOpenRule={(ruleId) => {
          store.selectServer(null);
          store.selectRule(ruleId);
          onNavigate('rules');
        }}
      />
    </div>
  );
}

function ServerCard({ row, onOpen, onFocus }: { row: Row; onOpen: () => void; onFocus: () => void }) {
  const { server, summary } = row;
  const style = roleStyle(server.role);
  const Icon = style.icon;

  return (
    <Card hoverable className="p-4" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${style.color}1f`, color: style.border }}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[14px] font-semibold tracking-tight text-ink-800">{server.name}</h3>
            {server.synthetic ? (
              <span className="shrink-0 rounded bg-ink-200 px-1 text-[9.5px] font-bold uppercase text-ink-600">
                Unresolved
              </span>
            ) : null}
          </div>
          <p className="mono mt-0.5 truncate text-[11.5px] text-ink-500">{server.ip || 'no IP recorded'}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge className={style.chip}>{style.short}</Badge>
        <Badge className={ENVIRONMENT_STYLES[server.environment].chip}>{server.environment}</Badge>
        {server.zone ? <Badge>{server.zone}</Badge> : null}
      </div>

      {server.os ? <p className="mt-2.5 truncate text-[12px] text-ink-500">{server.os}</p> : null}

      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-ink-100 pt-3">
        <MiniCount icon={ArrowDownLeft} label="In" value={summary.inboundRules} tone="text-sky-600" />
        <MiniCount icon={ArrowUpRight} label="Out" value={summary.outboundRules} tone="text-violet-600" />
        <MiniCount icon={Network} label="Total" value={summary.totalConnections} tone="text-ink-500" />
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onFocus();
        }}
        className="mt-3 w-full rounded-lg bg-ink-50 py-1.5 text-[12px] font-semibold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
      >
        Focus on the map
      </button>
    </Card>
  );
}

function MiniCount({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Network;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="text-center">
      <Icon className={cx('mx-auto h-3 w-3', tone)} strokeWidth={2.4} />
      <div className="mt-0.5 text-[15px] font-bold leading-none tabular-nums text-ink-800">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-ink-400">{label}</div>
    </div>
  );
}

function emptySummary(serverId: string): ServerSummary {
  return {
    serverId,
    inboundRules: 0,
    outboundRules: 0,
    totalConnections: 0,
    allowedConnections: 0,
    deniedConnections: 0,
    ports: [],
    anyPort: false,
    protocols: [],
    neighbours: [],
    ruleIds: [],
  };
}
