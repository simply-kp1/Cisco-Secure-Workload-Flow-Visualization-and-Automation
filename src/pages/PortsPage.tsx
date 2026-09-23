import { useMemo, useState } from 'react';
import { Plug, ShieldAlert } from 'lucide-react';
import type { PortUsage } from '@/services/statistics';
import { isDatabasePort, isSensitivePort } from '@/services/ports';
import { useAppStore } from '@/store/useAppStore';
import { useGraph, usePortUsage } from '@/store/selectors';
import {
  Badge,
  Button,
  Card,
  DataTable,
  SearchInput,
  Section,
  SidePanel,
  Tabs,
  sortRows,
  type Column,
} from '@/components/ui';
import { cx, roleStyle } from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

/**
 * Port Explorer. One row per port actually referenced by the policy; rules
 * covering every port are collapsed into a single "ANY" row rather than
 * expanding into 65,536 entries.
 */
export function PortsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const usage = usePortUsage();
  const graph = useGraph();
  const store = useAppStore();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'named' | 'sensitive' | 'database'>('all');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'rules',
    direction: 'desc',
  });
  const [selected, setSelected] = useState<PortUsage | null>(null);

  const rows = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return usage.filter((entry) => {
      if (filter === 'named' && !entry.service) return false;
      if (filter === 'sensitive' && !(entry.port > 0 && isSensitivePort(entry.port))) return false;
      if (filter === 'database' && !(entry.port > 0 && isDatabasePort(entry.port))) return false;
      if (!lower) return true;
      return (
        String(entry.port).includes(lower) ||
        (entry.service ?? '').toLowerCase().includes(lower) ||
        entry.protocols.some((protocol) => protocol.toLowerCase().includes(lower))
      );
    });
  }, [usage, query, filter]);

  const columns = useMemo<Column<PortUsage>[]>(
    () => [
      {
        key: 'port',
        header: 'Port',
        width: '90px',
        sortable: true,
        sortValue: (row) => row.port,
        render: (row) => (
          <span className="mono font-bold text-ink-800">{row.port === -1 ? 'ANY' : row.port}</span>
        ),
      },
      {
        key: 'service',
        header: 'Service',
        sortable: true,
        sortValue: (row) => row.service ?? '',
        render: (row) => (
          <div className="flex items-center gap-1.5">
            {row.service ? (
              <span className="font-semibold text-ink-700">{row.service}</span>
            ) : (
              <span className="text-ink-400">Not a widely recognised service</span>
            )}
            {row.port > 0 && isSensitivePort(row.port) ? (
              <Badge className="bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" icon={ShieldAlert}>
                Admin
              </Badge>
            ) : null}
            {row.port > 0 && isDatabasePort(row.port) ? (
              <Badge className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">Database</Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: 'protocols',
        header: 'Protocol',
        width: '120px',
        sortable: true,
        sortValue: (row) => row.protocols.join(','),
        render: (row) => <span className="mono text-ink-600">{row.protocols.join(', ')}</span>,
      },
      {
        key: 'rules',
        header: 'Rules',
        align: 'right',
        width: '80px',
        sortable: true,
        sortValue: (row) => row.ruleCount,
        render: (row) => <span className="font-semibold tabular-nums text-ink-800">{row.ruleCount}</span>,
      },
      {
        key: 'servers',
        header: 'Servers',
        align: 'right',
        width: '90px',
        sortable: true,
        sortValue: (row) => row.serverCount,
        render: (row) => <span className="tabular-nums">{row.serverCount}</span>,
      },
      {
        key: 'allow',
        header: 'Allow',
        align: 'right',
        width: '80px',
        sortable: true,
        sortValue: (row) => row.allowCount,
        render: (row) => <span className="tabular-nums font-semibold text-emerald-600">{row.allowCount}</span>,
      },
      {
        key: 'deny',
        header: 'Deny',
        align: 'right',
        width: '80px',
        sortable: true,
        sortValue: (row) => row.denyCount,
        render: (row) => (
          <span className={cx('tabular-nums font-semibold', row.denyCount > 0 ? 'text-rose-600' : 'text-ink-300')}>
            {row.denyCount}
          </span>
        ),
      },
    ],
    [],
  );

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  if (!graph) return null;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by port number, service or protocol…"
            className="min-w-[260px] flex-1"
          />
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'All ports', count: usage.length },
              { value: 'named', label: 'Known services' },
              { value: 'sensitive', label: 'Administrative' },
              { value: 'database', label: 'Database' },
            ]}
          />
        </div>
        <p className="mt-3 text-[12.5px] text-ink-500">
          Showing {sorted.length} of {usage.length} ports referenced by the policy. Well-known service names are
          shown where the port is widely recognised; uncommon ports are left unnamed rather than guessed at.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={sorted}
          rowKey={(row) => String(row.port)}
          sort={sort}
          onSortChange={setSort}
          onRowClick={setSelected}
          activeRowKey={selected ? String(selected.port) : null}
          pageSize={200}
          itemNoun="ports"
          maxHeight="max-h-[calc(100vh-310px)]"
          emptyState="No ports match the current search."
        />
      </Card>

      <SidePanel
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width="w-[420px]"
        title={selected ? (selected.port === -1 ? 'ANY port' : `Port ${selected.port}`) : ''}
        subtitle={selected?.service ?? 'Not a widely recognised service port'}
        footer={
          selected ? (
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              icon={Plug}
              onClick={() => {
                store.setFilters({ portQuery: selected.port === -1 ? '' : String(selected.port) });
                store.highlight(selected.serverIds, selected.ruleIds);
                setSelected(null);
                onNavigate('network');
              }}
            >
              Show these connections on the map
            </Button>
          ) : undefined
        }
      >
        {selected ? (
          <>
            {selected.serviceDescription ? (
              <p className="mb-4 rounded-lg bg-ink-50 px-3 py-2.5 text-[13px] leading-relaxed text-ink-600">
                {selected.serviceDescription}
              </p>
            ) : null}

            <div className="mb-5 grid grid-cols-4 gap-2">
              <Tile label="Rules" value={selected.ruleCount} />
              <Tile label="Servers" value={selected.serverCount} />
              <Tile label="Allow" value={selected.allowCount} tone="text-emerald-600" />
              <Tile label="Deny" value={selected.denyCount} tone="text-rose-600" />
            </div>

            <Section title={`Servers using this port (${selected.serverIds.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {selected.serverIds.slice(0, 60).map((serverId) => {
                  const server = graph.serversById.get(serverId);
                  if (!server) return null;
                  return (
                    <button
                      key={serverId}
                      type="button"
                      onClick={() => {
                        store.selectServer(serverId);
                        setSelected(null);
                        onNavigate('network');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[12px] font-semibold text-ink-700 transition-all hover:border-brand-300 hover:bg-brand-50 active:scale-95"
                    >
                      <span className={cx('h-2 w-2 rounded-full', roleStyle(server.role).dot)} />
                      {server.name}
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title={`Rules referencing this port (${selected.ruleIds.length})`}>
              <div className="space-y-1">
                {[...new Set(selected.ruleIds)].slice(0, 60).map((ruleId) => {
                  const rule = graph.rulesById.get(ruleId);
                  if (!rule) return null;
                  return (
                    <div
                      key={ruleId}
                      className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5"
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
                          {graph.serversById.get(rule.destination)?.name ?? rule.destination}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          </>
        ) : null}
      </SidePanel>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-2 py-2 text-center">
      <div className={cx('text-lg font-bold leading-none tabular-nums', tone ?? 'text-ink-800')}>{value}</div>
      <div className="mt-1 text-[10.5px] font-medium text-ink-400">{label}</div>
    </div>
  );
}
