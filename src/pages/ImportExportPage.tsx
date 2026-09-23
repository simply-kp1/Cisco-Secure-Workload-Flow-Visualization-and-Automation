import { useMemo } from 'react';
import {
  Cloud,
  Database,
  FileJson,
  FileSpreadsheet,
  Info,
  Plug,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react';
import { serialiseDataset } from '@/services/parseImport';
import { listImporters } from '@/services/importers/registry';
import { formatPorts } from '@/services/ports';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useIssues } from '@/store/selectors';
import { Badge, Button, Callout, Card, CardHeader, Field, useToast } from '@/components/ui';
import { UploadDropzone } from '@/components/upload/UploadDropzone';
import { ValidationReportView } from '@/components/upload/ValidationReportView';

/** Formats that could be added later. Listed so the architecture is legible. */
const PLANNED_SOURCES = [
  { label: 'Cisco Secure Workload API', icon: Cloud, note: 'Live policy pull via the OpenAPI endpoint.' },
  { label: 'Cisco Secure Workload native export', icon: Database, note: 'The full vendor JSON schema.' },
  { label: 'Palo Alto security policy', icon: ServerIcon, note: 'Firewall rule export.' },
  { label: 'Cisco ASA / ACI', icon: ServerIcon, note: 'Access lists and contracts.' },
  { label: 'AWS Security Groups', icon: Cloud, note: 'Ingress and egress rules per group.' },
  { label: 'Azure Network Security Groups', icon: Cloud, note: 'NSG rule sets.' },
  { label: 'ServiceNow change requests', icon: Plug, note: 'Proposed changes pulled from a CR.' },
];

export function ImportExportPage() {
  const dataset = useDataset();
  const validation = useAppStore((state) => state.validation);
  const clearDataset = useAppStore((state) => state.clearDataset);
  const history = useAppStore((state) => state.history);
  const issues = useIssues();
  const toast = useToast();

  const importers = useMemo(() => listImporters(), []);

  const download = (filename: string, content: string, type: string): void => {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPolicyJson = (): void => {
    if (!dataset) return;
    download(`policy-${new Date().toISOString().slice(0, 10)}.json`, serialiseDataset(dataset), 'application/json');
    toast('Working policy exported as JSON.', 'success');
  };

  const exportRulesCsv = (): void => {
    if (!dataset) return;
    const rows = [
      ['Rule ID', 'Rule name', 'Source', 'Destination', 'Protocol', 'Ports', 'Action', 'Disabled', 'Description'],
      ...dataset.rules.map((rule) => [
        rule.id,
        rule.name,
        rule.source,
        rule.destination,
        rule.protocol,
        formatPorts(rule.ports),
        rule.action,
        rule.disabled ? 'yes' : 'no',
        rule.description,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
      .join('\r\n');
    download(`rules-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    toast('Rules exported as CSV.', 'success');
  };

  const exportServersCsv = (): void => {
    if (!dataset) return;
    const rows = [
      ['Server ID', 'Name', 'IP', 'Role', 'Environment', 'OS', 'Zone', 'In inventory'],
      ...dataset.servers.map((server) => [
        server.id,
        server.name,
        server.ip,
        server.rawRole,
        server.rawEnvironment,
        server.os,
        server.zone,
        server.synthetic ? 'no' : 'yes',
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
      .join('\r\n');
    download(`servers-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    toast('Servers exported as CSV.', 'success');
  };

  const exportIssuesCsv = (): void => {
    const rows = [
      ['Category', 'Severity', 'Title', 'Explanation', 'Rules', 'Servers'],
      ...issues.map((issue) => [
        issue.category,
        issue.severity,
        issue.title,
        issue.explanation,
        issue.ruleIds.join(' '),
        issue.serverIds.join(' '),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
      .join('\r\n');
    download(`policy-issues-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    toast('Issues exported as CSV.', 'success');
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            title="Import a policy"
            subtitle="Everything is processed in the browser. No data leaves this machine."
            icon={FileJson}
          />
          <div className="border-t border-ink-100 px-5 py-4">
            <UploadDropzone
              onLoaded={(ok, message) => toast(message, ok ? 'success' : 'danger')}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Supported formats" subtitle="Importers registered in this build." icon={Plug} />
          <div className="border-t border-ink-100 px-5 py-4">
            {importers.map((importer) => (
              <div key={importer.id} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">Active</Badge>
                  <span className="text-[13.5px] font-semibold text-ink-800">{importer.label}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{importer.description}</p>
              </div>
            ))}

            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-400">
                Designed to accept later
              </p>
              <div className="space-y-1.5">
                {PLANNED_SOURCES.map((source) => (
                  <div key={source.label} className="flex items-start gap-2">
                    <source.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" strokeWidth={2.2} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-ink-600">{source.label}</p>
                      <p className="text-[11.5px] text-ink-400">{source.note}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Callout tone="neutral" icon={Info} className="mt-3">
                New formats are added by registering an importer that maps the source document onto the canonical
                model. The analysis engine and the interface are unchanged by that work.
              </Callout>
            </div>
          </div>
        </Card>
      </div>

      {validation ? <ValidationReportView report={validation} /> : null}

      {dataset ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Imported file" subtitle="Metadata recorded at import time." />
            <div className="border-t border-ink-100 px-5 py-2">
              <Field label="Source file">{dataset.metadata.sourceName ?? '—'}</Field>
              <Field label="Product">{dataset.metadata.product ?? 'Not stated'}</Field>
              <Field label="Export type">{dataset.metadata.exportType ?? 'Not stated'}</Field>
              <Field label="Importer used" mono>
                {dataset.metadata.importer}
              </Field>
              <Field label="Imported at">{new Date(dataset.metadata.importedAt).toLocaleString()}</Field>
              <Field label="Servers">{dataset.servers.filter((server) => !server.synthetic).length}</Field>
              <Field label="Rules">{dataset.rules.length}</Field>
              <Field label="Changes applied this session">{history.length}</Field>
            </div>
            {dataset.metadata.notes ? (
              <div className="border-t border-ink-100 px-5 py-3">
                <p className="text-[12.5px] italic leading-relaxed text-ink-500">{dataset.metadata.notes}</p>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Export"
              subtitle="The working policy, including any changes applied this session."
              icon={FileSpreadsheet}
            />
            <div className="space-y-2 border-t border-ink-100 px-5 py-4">
              <Button variant="primary" icon={FileJson} className="w-full" onClick={exportPolicyJson}>
                Export working policy (JSON)
              </Button>
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={exportRulesCsv}>
                  Rules
                </Button>
                <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={exportServersCsv}>
                  Servers
                </Button>
                <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={exportIssuesCsv}>
                  Issues
                </Button>
              </div>

              <Callout tone="neutral" className="mt-3" icon={Info}>
                The exported JSON uses the same shape as the imported file, so it can be re-imported here. The
                original imported data is never modified in place — it is kept separately so Revert all can always
                restore it.
              </Callout>

              <Button
                variant="danger"
                icon={Trash2}
                className="w-full"
                onClick={() => {
                  clearDataset();
                  toast('Dataset cleared.', 'info');
                }}
              >
                Clear the loaded dataset
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
