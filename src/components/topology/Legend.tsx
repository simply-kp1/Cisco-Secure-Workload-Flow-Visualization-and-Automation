import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ServerRole, TopologyMode } from '@/types';
import { ROLE_GEOMETRY, ROLE_SHAPE_LABEL } from '@/components/topology3d/roleGeometry';
import { cx, DIFF_COLORS, IMPACT_STYLES, ROLE_ORDER, ROLE_STYLES } from '@/lib/design';
import { IMPACT_LEVEL_DESCRIPTION, IMPACT_LEVEL_LABEL } from '@/services/impact';

/**
 * Floating legend. Roles are listed with both their icon and their code so the
 * map can be read without relying on colour, and each role doubles as a
 * show/hide toggle for that category.
 */
export function Legend({
  mode,
  hiddenRoles,
  onToggleRole,
  showImpact,
  is3d = false,
}: {
  mode: TopologyMode;
  hiddenRoles: ServerRole[];
  onToggleRole: (role: ServerRole) => void;
  showImpact: boolean;
  /** In 3D the role is carried by a solid silhouette rather than a flat shape. */
  is3d?: boolean;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-[220px] overflow-hidden rounded-xl border border-ink-200 bg-white/95 shadow-lift backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-500 transition-colors hover:bg-ink-50"
      >
        Legend
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="max-h-[52vh] space-y-3 overflow-y-auto border-t border-ink-100 px-3 py-2.5">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
              Server role — click to hide
            </p>
            <div className="space-y-0.5">
              {ROLE_ORDER.map((role) => {
                const style = ROLE_STYLES[role];
                const hidden = hiddenRoles.includes(role);
                const Icon = style.icon;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => onToggleRole(role)}
                    title={style.description}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-ink-50',
                      hidden && 'opacity-40',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} style={{ color: style.border }} />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: style.color, opacity: 0.35, border: `1.5px solid ${style.border}` }}
                    />
                    <span className="truncate text-[11.5px] font-semibold text-ink-700">{style.short}</span>
                    <span className="ml-auto truncate text-[10.5px] text-ink-400">
                      {is3d ? ROLE_SHAPE_LABEL[ROLE_GEOMETRY[role]] : style.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-ink-100 pt-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Connection</p>
            <div className="space-y-1.5">
              <LegendLine color="#10b981" dashed={false} label="ALLOW — permitted" />
              <LegendLine color="#f43f5e" dashed label="DENY — explicitly blocked" />
              <p className="pl-8 text-[10.5px] leading-snug text-ink-400">
                {is3d
                  ? 'Packets travel from source to destination. An arrowhead is ambiguous once the camera can look along a connection, so direction is shown by motion.'
                  : 'Arrows point from source to destination.'}
              </p>
            </div>
          </div>

          {mode === 'DIFFERENCE' ? (
            <div className="border-t border-ink-100 pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Difference</p>
              <div className="space-y-1.5">
                <LegendLine color={DIFF_COLORS.ADDED} dashed={false} label="Added" />
                <LegendLine color={DIFF_COLORS.REMOVED} dashed label="Removed" />
                <LegendLine color={DIFF_COLORS.MODIFIED} dashed={false} label="Modified" />
                <LegendLine color={DIFF_COLORS.UNCHANGED} dashed={false} label="Unchanged" />
              </div>
            </div>
          ) : null}

          {showImpact ? (
            <div className="border-t border-ink-100 pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Blast radius</p>
              <div className="space-y-1">
                {(['DIRECT', 'ONE_HOP', 'TWO_HOP', 'DOWNSTREAM'] as const).map((level) => (
                  <div key={level} className="flex items-center gap-2" title={IMPACT_LEVEL_DESCRIPTION[level]}>
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ border: `3px solid ${IMPACT_STYLES[level].ring}` }}
                    />
                    <span className="text-[11px] font-medium text-ink-600">{IMPACT_LEVEL_LABEL[level]}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LegendLine({ color, dashed, label }: { color: string; dashed: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="24" height="10" className="shrink-0" aria-hidden>
        <line
          x1="0"
          y1="5"
          x2="17"
          y2="5"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
        <polygon points="17,1.5 24,5 17,8.5" fill={color} />
      </svg>
      <span className="text-[11px] font-medium text-ink-600">{label}</span>
    </div>
  );
}
