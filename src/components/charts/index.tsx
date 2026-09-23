import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CountPoint } from '@/services/statistics';
import { ACTION_STYLES, CHART_COLORS, ENVIRONMENT_STYLES, ROLE_STYLES } from '@/lib/design';
import type { Environment, ServerRole } from '@/types';

const AXIS_STYLE = { fontSize: 11, fill: '#6b7488', fontFamily: 'Inter, sans-serif' };

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
}: {
  active?: boolean;
  payload?: { value?: number; name?: string; payload?: CountPoint }[];
  label?: string;
  valueLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0];
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 shadow-lift">
      <p className="text-[12px] font-semibold text-ink-800">{label ?? point.payload?.label}</p>
      <p className="text-[12px] text-ink-500">
        <span className="font-bold tabular-nums text-ink-700">{point.value}</span> {valueLabel}
      </p>
    </div>
  );
}

export function HorizontalBarChart({
  data,
  valueLabel,
  colorFor,
  height = 210,
  onSelect,
}: {
  data: CountPoint[];
  valueLabel: string;
  colorFor?: (point: CountPoint, index: number) => string;
  height?: number;
  onSelect?: (point: CountPoint) => void;
}) {
  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={AXIS_STYLE}
          axisLine={false}
          tickLine={false}
          width={112}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: 'rgba(53, 99, 244, 0.06)' }}
          content={<ChartTooltip valueLabel={valueLabel} />}
        />
        <Bar
          dataKey="value"
          radius={[0, 5, 5, 0]}
          maxBarSize={20}
          onClick={(entry) => onSelect?.(entry.payload as CountPoint)}
          cursor={onSelect ? 'pointer' : undefined}
        >
          {data.map((point, index) => (
            <Cell key={point.key ?? point.label} fill={colorFor?.(point, index) ?? CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VerticalBarChart({
  data,
  valueLabel,
  colorFor,
  height = 210,
}: {
  data: CountPoint[];
  valueLabel: string;
  colorFor?: (point: CountPoint, index: number) => string;
  height?: number;
}) {
  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <XAxis
          dataKey="label"
          tick={AXIS_STYLE}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={data.length > 6 ? -28 : 0}
          textAnchor={data.length > 6 ? 'end' : 'middle'}
          height={data.length > 6 ? 54 : 26}
        />
        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'rgba(53, 99, 244, 0.06)' }} content={<ChartTooltip valueLabel={valueLabel} />} />
        <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={44}>
          {data.map((point, index) => (
            <Cell key={point.key ?? point.label} fill={colorFor?.(point, index) ?? CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  valueLabel,
  colorFor,
  height = 210,
  centerLabel,
  centerValue,
}: {
  data: CountPoint[];
  valueLabel: string;
  colorFor?: (point: CountPoint, index: number) => string;
  height?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((point, index) => (
              <Cell
                key={point.key ?? point.label}
                fill={colorFor?.(point, index) ?? CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueLabel={valueLabel} />} />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span className="text-[11.5px] text-ink-600">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined ? (
        <div
          className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
          style={{ top: height * 0.34 }}
        >
          <span className="text-2xl font-bold leading-none tabular-nums text-ink-800">{centerValue}</span>
          {centerLabel ? <span className="mt-1 text-[11px] font-medium text-ink-400">{centerLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-ink-200 text-[13px] text-ink-400"
      style={{ height }}
    >
      No data to chart.
    </div>
  );
}

/* Shared colour resolvers so charts stay consistent with the topology. */
export const roleColor = (point: CountPoint): string =>
  ROLE_STYLES[(point.key as ServerRole) ?? 'UNKNOWN']?.color ?? CHART_COLORS[0];

export const environmentColor = (point: CountPoint): string =>
  ENVIRONMENT_STYLES[(point.key as Environment) ?? 'UNKNOWN']?.color ?? CHART_COLORS[0];

export const actionColor = (point: CountPoint): string =>
  point.key === 'DENY' ? ACTION_STYLES.DENY.color : ACTION_STYLES.ALLOW.color;
