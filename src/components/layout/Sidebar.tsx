import {
  AlertTriangle,
  Download,
  GitCompare,
  History,
  LayoutDashboard,
  ListTree,
  Network,
  Plug,
  Route,
  Server,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '@/lib/design';

export type PageId =
  | 'dashboard'
  | 'network'
  | 'servers'
  | 'rules'
  | 'ports'
  | 'paths'
  | 'change'
  | 'conflicts'
  | 'history'
  | 'import'
  | 'settings';

export interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
  group: 'Analyse' | 'Explore' | 'Change' | 'System';
  badgeKey?: 'conflicts' | 'proposed';
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Analyse' },
  { id: 'network', label: 'Network Map', icon: Network, group: 'Analyse' },
  { id: 'servers', label: 'Servers', icon: Server, group: 'Explore' },
  { id: 'rules', label: 'Rules', icon: ListTree, group: 'Explore' },
  { id: 'ports', label: 'Ports', icon: Plug, group: 'Explore' },
  { id: 'paths', label: 'Path Explorer', icon: Route, group: 'Explore' },
  { id: 'change', label: 'Change Analysis', icon: GitCompare, group: 'Change', badgeKey: 'proposed' },
  { id: 'conflicts', label: 'Conflicts', icon: AlertTriangle, group: 'Change', badgeKey: 'conflicts' },
  { id: 'history', label: 'Change History', icon: History, group: 'Change' },
  { id: 'import', label: 'Import / Export', icon: Download, group: 'System' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'System' },
];

const GROUP_ORDER: NavItem['group'][] = ['Analyse', 'Explore', 'Change', 'System'];

export function Sidebar({
  page,
  onNavigate,
  issueCount,
  hasProposedChange,
  collapsed,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  issueCount: number;
  hasProposedChange: boolean;
  collapsed: boolean;
}) {
  return (
    <nav
      className={cx(
        'flex shrink-0 flex-col border-r border-ink-200 bg-white transition-all duration-200',
        collapsed ? 'w-[68px]' : 'w-[232px]',
      )}
      aria-label="Main navigation"
    >
      <div className={cx('flex items-center gap-2.5 px-4 py-4', collapsed && 'justify-center px-0')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
          <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.4} />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-bold leading-tight tracking-tight text-ink-800">
              Secure Workload
            </div>
            <div className="truncate text-[11px] font-medium text-ink-400">Policy Visualiser</div>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {GROUP_ORDER.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group);
          return (
            <div key={group}>
              {!collapsed ? (
                <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">{group}</p>
              ) : (
                <div className="mx-auto mb-2 h-px w-6 bg-ink-200" />
              )}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.id === page;
                  const badge =
                    item.badgeKey === 'conflicts' && issueCount > 0
                      ? issueCount > 99
                        ? '99+'
                        : String(issueCount)
                      : item.badgeKey === 'proposed' && hasProposedChange
                        ? '1'
                        : null;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-all duration-150',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-brand-50 font-semibold text-brand-700'
                          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-800',
                      )}
                    >
                      {active ? (
                        <span className="absolute left-0 h-5 w-[3px] rounded-r-full bg-brand-600" aria-hidden />
                      ) : null}
                      <item.icon
                        className={cx('h-[17px] w-[17px] shrink-0', active ? 'text-brand-600' : 'text-ink-400')}
                        strokeWidth={2.1}
                      />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {badge && !collapsed ? (
                        <span
                          className={cx(
                            'ml-auto rounded-md px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums',
                            item.badgeKey === 'proposed'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700',
                          )}
                        >
                          {badge}
                        </span>
                      ) : null}
                      {badge && collapsed ? (
                        <span
                          className={cx(
                            'absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full',
                            item.badgeKey === 'proposed' ? 'bg-amber-500' : 'bg-rose-500',
                          )}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
