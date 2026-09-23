import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react';
import type { ValidationCode, ValidationReport, ValidationSeverity } from '@/types';
import { Badge, Card, CardHeader, Tabs } from '@/components/ui';
import { cx } from '@/lib/design';

const SEVERITY_META: Record<ValidationSeverity, { icon: typeof Info; chip: string; label: string }> = {
  error: { icon: AlertCircle, chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', label: 'Error' },
  warning: {
    icon: AlertTriangle,
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    label: 'Warning',
  },
  info: { icon: Info, chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200', label: 'Info' },
};

/** Plain-English headings for each validation code, grouped in the report. */
const CODE_LABELS: Record<ValidationCode, string> = {
  MALFORMED_DOCUMENT: 'Malformed file',
  MISSING_SERVERS_COLLECTION: 'No server list found',
  MISSING_RULES_COLLECTION: 'No rule list found',
  DUPLICATE_SERVER_ID: 'Duplicate server IDs',
  DUPLICATE_RULE_ID: 'Duplicate rule IDs',
  DUPLICATE_IP: 'Duplicate IP addresses',
  MISSING_SERVER_FIELD: 'Missing server fields',
  MISSING_RULE_FIELD: 'Missing rule fields',
  UNKNOWN_SOURCE: 'Unknown sources',
  UNKNOWN_DESTINATION: 'Unknown destinations',
  MALFORMED_PORT: 'Malformed ports',
  UNKNOWN_PROTOCOL: 'Unknown protocols',
  UNKNOWN_ACTION: 'Unrecognised actions',
  UNKNOWN_ROLE: 'Unrecognised roles',
  UNKNOWN_ENVIRONMENT: 'Unrecognised environments',
  INVALID_IP: 'Invalid IP addresses',
  SELF_REFERENCING_RULE: 'Self-referencing rules',
};

export function ValidationReportView({ report }: { report: ValidationReport }) {
  const [filter, setFilter] = useState<'all' | ValidationSeverity>('all');

  const grouped = useMemo(() => {
    const visible = report.issues.filter((issue) => filter === 'all' || issue.severity === filter);
    const map = new Map<ValidationCode, typeof visible>();
    for (const issue of visible) {
      const list = map.get(issue.code) ?? [];
      list.push(issue);
      map.set(issue.code, list);
    }
    const order: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
    return [...map.entries()].sort((a, b) => order[a[1][0].severity] - order[b[1][0].severity]);
  }, [report.issues, filter]);

  const clean = report.issues.length === 0;

  return (
    <Card>
      <CardHeader
        title="Import validation"
        subtitle={
          clean
            ? 'Every server and rule was read without any problems.'
            : `${report.serversDetected} servers and ${report.rulesDetected} rules were read. ${report.issues.length} thing${report.issues.length === 1 ? '' : 's'} worth checking.`
        }
        icon={clean ? CheckCircle2 : AlertTriangle}
        action={
          <div className="flex items-center gap-1.5">
            {report.errorCount > 0 ? (
              <Badge className={SEVERITY_META.error.chip}>{report.errorCount} errors</Badge>
            ) : null}
            {report.warningCount > 0 ? (
              <Badge className={SEVERITY_META.warning.chip}>{report.warningCount} warnings</Badge>
            ) : null}
            {report.infoCount > 0 ? (
              <Badge className={SEVERITY_META.info.chip}>{report.infoCount} notes</Badge>
            ) : null}
          </div>
        }
      />

      <div className="border-t border-ink-100 px-5 py-4">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Summary label="Servers detected" value={report.serversDetected} />
          <Summary label="Rules detected" value={report.rulesDetected} />
          <Summary
            label="Unresolved endpoints"
            value={report.syntheticServers}
            tone={report.syntheticServers > 0 ? 'warning' : 'neutral'}
          />
          <Summary
            label="Issues found"
            value={report.issues.length}
            tone={report.errorCount > 0 ? 'danger' : report.warningCount > 0 ? 'warning' : 'positive'}
          />
        </div>

        {clean ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.4} />
            <p className="text-[13px] text-emerald-800">
              No validation problems. Every rule resolved to a known server, and all ports and protocols were
              understood.
            </p>
          </div>
        ) : (
          <>
            <Tabs
              className="mb-3"
              value={filter}
              onChange={setFilter}
              tabs={[
                { value: 'all', label: 'All', count: report.issues.length },
                { value: 'error', label: 'Errors', count: report.errorCount },
                { value: 'warning', label: 'Warnings', count: report.warningCount },
                { value: 'info', label: 'Notes', count: report.infoCount },
              ]}
            />
            <div className="space-y-2">
              {grouped.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-400">Nothing in this category.</p>
              ) : (
                grouped.map(([code, issues]) => <IssueGroup key={code} code={code} issues={issues} />)
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function IssueGroup({
  code,
  issues,
}: {
  code: ValidationCode;
  issues: ValidationReport['issues'];
}) {
  const [open, setOpen] = useState(issues[0].severity === 'error');
  const meta = SEVERITY_META[issues[0].severity];
  const Icon = meta.icon;
  const detail = issues.find((issue) => issue.detail)?.detail;

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 bg-white px-3.5 py-2.5 text-left transition-colors hover:bg-ink-50"
      >
        <Icon
          className={cx(
            'h-4 w-4 shrink-0',
            issues[0].severity === 'error'
              ? 'text-rose-500'
              : issues[0].severity === 'warning'
                ? 'text-amber-500'
                : 'text-sky-500',
          )}
          strokeWidth={2.2}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-ink-800">{CODE_LABELS[code] ?? code}</span>
          {detail ? <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{detail}</span> : null}
        </span>
        <Badge className={meta.chip}>{issues.length}</Badge>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <ul className="max-h-64 space-y-1 overflow-y-auto border-t border-ink-100 bg-ink-50/60 px-3.5 py-2.5">
          {issues.slice(0, 60).map((issue, index) => (
            <li key={`${issue.entityId}-${index}`} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-600">
              {issue.entityId ? (
                <code className="mono shrink-0 rounded bg-white px-1.5 py-0.5 font-semibold text-ink-500">
                  {issue.entityId}
                </code>
              ) : null}
              <span className="min-w-0">{issue.message}</span>
            </li>
          ))}
          {issues.length > 60 ? (
            <li className="pt-1 text-[12px] font-medium text-ink-400">
              …and {issues.length - 60} more of the same kind.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function Summary({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'text-ink-800',
    positive: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-rose-600',
  };
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2.5">
      <div className={cx('text-xl font-bold leading-none tabular-nums', tones[tone])}>{value}</div>
      <div className="mt-1.5 text-[11.5px] font-medium text-ink-500">{label}</div>
    </div>
  );
}
