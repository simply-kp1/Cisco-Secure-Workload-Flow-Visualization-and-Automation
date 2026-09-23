import { Eraser, Sparkles, X } from 'lucide-react';
import type { ConnectionDirection, Environment, RuleAction, ServerRole } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useProtocols, useZones } from '@/store/selectors';
import { FILTER_PRESETS, hasActiveFilters } from '@/services/filter';
import { Button, PillGroup, SearchInput, Select, TextInput } from '@/components/ui';
import { ENVIRONMENT_ORDER, ENVIRONMENT_STYLES, ROLE_ORDER, ROLE_STYLES } from '@/lib/design';

/**
 * The filter panel. Every criterion in the brief is represented, and the
 * presets exist because the common questions ("show me everything on TCP 443")
 * should take one click rather than four field edits.
 */
export function FilterPanel({ onClose }: { onClose: () => void }) {
  const filters = useAppStore((state) => state.filters);
  const setFilters = useAppStore((state) => state.setFilters);
  const resetFilters = useAppStore((state) => state.resetFilters);
  const dataset = useDataset();
  const zones = useZones();
  const protocols = useProtocols();

  const active = hasActiveFilters(filters);

  return (
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-r border-ink-200 bg-white">
      <header className="flex items-center justify-between border-b border-ink-200/80 px-4 py-3">
        <h3 className="text-[13px] font-bold uppercase tracking-wider text-ink-500">Filters</h3>
        <div className="flex items-center gap-1">
          {active ? (
            <Button size="sm" variant="ghost" icon={Eraser} onClick={resetFilters}>
              Clear
            </Button>
          ) : null}
          <button
            type="button"
            aria-label="Close filters"
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div>
          <p className="label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Quick filters
          </p>
          <div className="space-y-1">
            {FILTER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setFilters(preset.build(filters))}
                title={preset.description}
                className="block w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-left text-[12.5px] font-medium text-ink-700 transition-all duration-150 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-800 active:scale-[0.98]"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <PillGroup<ServerRole>
          label="Server role"
          options={ROLE_ORDER.map((role) => ({ value: role, label: ROLE_STYLES[role].short }))}
          selected={filters.roles}
          onChange={(roles) => setFilters({ roles })}
        />

        <PillGroup<Environment>
          label="Environment"
          options={ENVIRONMENT_ORDER.map((environment) => ({
            value: environment,
            label: environment,
            className: ENVIRONMENT_STYLES[environment].chip,
          }))}
          selected={filters.environments}
          onChange={(environments) => setFilters({ environments })}
        />

        {zones.length > 0 ? (
          <PillGroup<string>
            label="Zone"
            options={zones.map((zone) => ({ value: zone, label: zone }))}
            selected={filters.zones}
            onChange={(zoneValues) => setFilters({ zones: zoneValues })}
          />
        ) : null}

        <PillGroup<string>
          label="Protocol"
          options={protocols.map((protocol) => ({ value: protocol, label: protocol }))}
          selected={filters.protocols}
          onChange={(protocolValues) => setFilters({ protocols: protocolValues })}
        />

        <PillGroup<RuleAction>
          label="Action"
          options={[
            { value: 'ALLOW', label: 'ALLOW' },
            { value: 'DENY', label: 'DENY' },
          ]}
          selected={filters.actions}
          onChange={(actions) => setFilters({ actions })}
        />

        <TextInput
          label="Port"
          placeholder="443 or 8000-8100"
          value={filters.portQuery}
          onChange={(event) => setFilters({ portQuery: event.target.value })}
          hint="Shows every rule whose ports include this port or range."
        />

        <div>
          <span className="label">Server name or IP</span>
          <SearchInput
            value={filters.ipQuery}
            onChange={(ipQuery) => setFilters({ ipQuery })}
            placeholder="db-srv-03 or 10.10.30."
          />
        </div>

        <div>
          <span className="label">Rule name</span>
          <SearchInput
            value={filters.ruleNameQuery}
            onChange={(ruleNameQuery) => setFilters({ ruleNameQuery })}
            placeholder="web-srv-01-to-app"
          />
        </div>

        <Select
          label="Connection direction"
          value={filters.direction}
          onChange={(event) => setFilters({ direction: event.target.value as ConnectionDirection })}
          hint={
            filters.focusServerId
              ? 'Relative to the focused server.'
              : 'Relative to the servers matching the filters above.'
          }
        >
          <option value="ANY">Both directions</option>
          <option value="OUTBOUND">Outbound only</option>
          <option value="INBOUND">Inbound only</option>
        </Select>

        <Select
          label="Focus on a server"
          value={filters.focusServerId ?? ''}
          onChange={(event) => setFilters({ focusServerId: event.target.value || null })}
          hint="Fades everything except this server and its neighbours."
        >
          <option value="">No focus</option>
          {(dataset?.servers ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
        </Select>

        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink-700">
          <input
            type="checkbox"
            checked={filters.hideIsolated}
            onChange={(event) => setFilters({ hideIsolated: event.target.checked })}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
          />
          Hide servers with no connections
        </label>
      </div>
    </aside>
  );
}
