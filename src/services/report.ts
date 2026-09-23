import type { ChangeAnalysis, PolicyGraph, Rule } from '@/types';
import { formatPorts } from './ports';
import { serverName } from './graph';
import { describePath } from './paths';
import { IMPACT_LEVEL_LABEL } from './impact';

export interface ImpactReport {
  generatedAt: string;
  changeId: string;
  changeType: string;
  changeSummary: string;
  originalRule: Rule | null;
  proposedRule: Rule | null;
  risk: ChangeAnalysis['risk'];
  serversAffected: { server: string; level: string; reasons: string[] }[];
  connectionsAdded: string[];
  connectionsRemoved: string[];
  connectionsModified: string[];
  portsOpened: string[];
  portsClosed: string[];
  potentialBrokenPaths: {
    summary: string;
    alternativeAvailable: boolean;
    alternativeRules: string[];
    dependentPaths: string[];
  }[];
  alternativePaths: string[];
  duplicateRules: string[];
  conflictingRules: string[];
  redundantRules: string[];
  securityExposure: string[];
  riskReasons: string[];
  recommendations: string[];
}

export function buildImpactReport(analysis: ChangeAnalysis, graph: PolicyGraph): ImpactReport {
  const name = (id: string): string => serverName(graph, id);

  return {
    generatedAt: analysis.generatedAt,
    changeId: analysis.changeId,
    changeType: analysis.type,
    changeSummary: summariseChange(analysis, graph),
    originalRule: analysis.originalRule,
    proposedRule: analysis.proposedRule,
    risk: analysis.risk,
    serversAffected: analysis.affectedServers.map((affected) => ({
      server: name(affected.serverId),
      level: IMPACT_LEVEL_LABEL[affected.level],
      reasons: affected.reasons,
    })),
    connectionsAdded: analysis.connectionsAdded.map((delta) => delta.description),
    connectionsRemoved: analysis.connectionsRemoved.map((delta) => delta.description),
    connectionsModified: analysis.connectionsModified.map((delta) => delta.description),
    portsOpened: analysis.portsOpened.map(
      (delta) => `${name(delta.peerId)} → ${name(delta.serverId)} ${delta.protocol} ${formatPorts([delta.port])}`,
    ),
    portsClosed: analysis.portsClosed.map(
      (delta) => `${name(delta.peerId)} → ${name(delta.serverId)} ${delta.protocol} ${formatPorts([delta.port])}`,
    ),
    potentialBrokenPaths: analysis.breakage.map((finding) => ({
      summary: finding.summary,
      alternativeAvailable: finding.alternativeAvailable,
      alternativeRules: finding.alternativeRuleIds.map(
        (id) => graph.rulesById.get(id)?.name ?? id,
      ),
      dependentPaths: finding.dependentPaths.map((path) => describePath(graph, path)),
    })),
    alternativePaths: analysis.breakage
      .filter((finding) => finding.alternativeAvailable)
      .map((finding) => finding.summary),
    duplicateRules: analysis.duplicates.map((issue) => issue.title),
    conflictingRules: analysis.conflicts.map((issue) => issue.title),
    redundantRules: analysis.redundancies.map((issue) => issue.title),
    securityExposure: analysis.exposure,
    riskReasons: analysis.risk.factors.map((factor) => `${factor.label} (+${factor.points}) — ${factor.detail}`),
    recommendations: analysis.recommendations,
  };
}

export function summariseChange(analysis: ChangeAnalysis, graph: PolicyGraph): string {
  const rule = analysis.proposedRule ?? analysis.originalRule;
  if (!rule) return 'No rule associated with this change.';
  const source = serverName(graph, rule.source);
  const destination = serverName(graph, rule.destination);
  const descriptor = `${source} → ${destination} ${rule.protocol} ${formatPorts(rule.ports)} ${rule.action}`;

  switch (analysis.type) {
    case 'ADD_RULE':
      return `Add a new rule "${rule.name}": ${descriptor}.`;
    case 'MODIFY_RULE': {
      const before = analysis.originalRule;
      if (!before) return `Modify rule "${rule.name}": ${descriptor}.`;
      return `Modify rule "${before.name}" from ${serverName(graph, before.source)} → ${serverName(graph, before.destination)} ${before.protocol} ${formatPorts(before.ports)} ${before.action} to ${descriptor}.`;
    }
    case 'DELETE_RULE':
      return `Delete rule "${rule.name}": ${descriptor}.`;
    case 'DISABLE_RULE':
      return `Disable rule "${rule.name}": ${descriptor}.`;
    case 'ENABLE_RULE':
      return `Enable rule "${rule.name}": ${descriptor}.`;
    default:
      return descriptor;
  }
}

/* ------------------------------------------------------------------ *
 * Export formats
 * ------------------------------------------------------------------ */

export function reportToJson(report: ImpactReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportToCsv(report: ImpactReport): string {
  const rows: string[][] = [['Section', 'Item', 'Detail']];

  rows.push(['Change', 'Change ID', report.changeId]);
  rows.push(['Change', 'Type', report.changeType]);
  rows.push(['Change', 'Summary', report.changeSummary]);
  rows.push(['Change', 'Generated at', report.generatedAt]);
  rows.push(['Risk', 'Rating', report.risk.rating]);
  rows.push(['Risk', 'Score', String(report.risk.score)]);

  for (const [key, value] of Object.entries(report.risk.facts)) {
    rows.push(['Risk facts', humanise(key), String(value)]);
  }
  for (const reason of report.riskReasons) rows.push(['Risk reasons', reason, '']);
  for (const server of report.serversAffected) {
    rows.push(['Servers affected', server.server, `${server.level}: ${server.reasons.join(' ')}`]);
  }
  for (const item of report.connectionsAdded) rows.push(['Connections added', item, '']);
  for (const item of report.connectionsRemoved) rows.push(['Connections removed', item, '']);
  for (const item of report.connectionsModified) rows.push(['Connections modified', item, '']);
  for (const item of report.portsOpened) rows.push(['Ports opened', item, '']);
  for (const item of report.portsClosed) rows.push(['Ports closed', item, '']);
  for (const item of report.potentialBrokenPaths) {
    rows.push([
      'Potential service impact',
      item.summary,
      item.alternativeAvailable ? `Alternative: ${item.alternativeRules.join(', ')}` : 'No alternative detected',
    ]);
    for (const path of item.dependentPaths) rows.push(['Dependent paths', path, '']);
  }
  for (const item of report.duplicateRules) rows.push(['Duplicate rules', item, '']);
  for (const item of report.conflictingRules) rows.push(['Conflicting rules', item, '']);
  for (const item of report.redundantRules) rows.push(['Redundant rules', item, '']);
  for (const item of report.securityExposure) rows.push(['Security exposure', item, '']);
  for (const item of report.recommendations) rows.push(['Recommendations', item, '']);

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function humanise(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

/** Standalone printable HTML, opened in a new window for the browser print dialog. */
export function reportToHtml(report: ImpactReport): string {
  const section = (title: string, items: string[]): string => {
    if (items.length === 0) return '';
    return `<section><h2>${escapeHtml(title)}</h2><ul>${items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('')}</ul></section>`;
  };

  const ruleTable = (label: string, rule: Rule | null): string => {
    if (!rule) return '';
    return `<section><h2>${escapeHtml(label)}</h2><table>
      <tr><th>Rule ID</th><td>${escapeHtml(rule.id)}</td></tr>
      <tr><th>Name</th><td>${escapeHtml(rule.name)}</td></tr>
      <tr><th>Source</th><td>${escapeHtml(rule.source)}</td></tr>
      <tr><th>Destination</th><td>${escapeHtml(rule.destination)}</td></tr>
      <tr><th>Protocol</th><td>${escapeHtml(rule.protocol)}</td></tr>
      <tr><th>Ports</th><td>${escapeHtml(formatPorts(rule.ports))}</td></tr>
      <tr><th>Action</th><td>${escapeHtml(rule.action)}</td></tr>
      <tr><th>Description</th><td>${escapeHtml(rule.description || '—')}</td></tr>
    </table></section>`;
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Impact report — ${escapeHtml(report.changeId)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: 'Inter', -apple-system, system-ui, sans-serif; color: #1f2430; margin: 40px auto; max-width: 860px; line-height: 1.55; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: #5b6478; margin: 28px 0 8px; border-bottom: 1px solid #e4e7ee; padding-bottom: 6px; }
  .meta { color: #6b7488; font-size: 13px; margin-bottom: 20px; }
  .risk { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 13px; letter-spacing: .04em; }
  .LOW { background: #e6f6ed; color: #17663a; }
  .MEDIUM { background: #fff4e0; color: #8a5300; }
  .HIGH { background: #ffeae4; color: #96301a; }
  .CRITICAL { background: #fde7ee; color: #8d0f37; }
  ul { margin: 6px 0 0; padding-left: 20px; }
  li { margin-bottom: 5px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th { text-align: left; width: 150px; color: #5b6478; font-weight: 600; padding: 5px 8px 5px 0; vertical-align: top; }
  td { padding: 5px 0; }
  .facts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; font-size: 14px; }
  .facts div { display: flex; justify-content: space-between; border-bottom: 1px dotted #e4e7ee; padding: 3px 0; }
  .note { background: #f7f8fa; border-left: 3px solid #3563f4; padding: 10px 14px; font-size: 13px; color: #4d5567; margin-top: 24px; }
  @media print { body { margin: 0; max-width: none; } }
</style></head>
<body>
  <h1>Network change impact report</h1>
  <div class="meta">${escapeHtml(report.changeId)} · ${escapeHtml(report.changeType)} · generated ${escapeHtml(
    new Date(report.generatedAt).toLocaleString(),
  )}</div>
  <p><span class="risk ${report.risk.rating}">Change risk: ${report.risk.rating}</span></p>
  <section><h2>Change summary</h2><p>${escapeHtml(report.changeSummary)}</p></section>
  ${ruleTable('Original rule', report.originalRule)}
  ${ruleTable('Proposed rule', report.proposedRule)}
  <section><h2>Raw facts</h2><div class="facts">${Object.entries(report.risk.facts)
    .map(([key, value]) => `<div><span>${escapeHtml(humanise(key))}</span><strong>${value}</strong></div>`)
    .join('')}</div></section>
  ${section('Why this rating', report.riskReasons)}
  ${section(
    'Servers affected',
    report.serversAffected.map((server) => `${server.server} — ${server.level}. ${server.reasons.join(' ')}`),
  )}
  ${section('Connections added', report.connectionsAdded)}
  ${section('Connections removed', report.connectionsRemoved)}
  ${section('Connections modified', report.connectionsModified)}
  ${section('Ports opened', report.portsOpened)}
  ${section('Ports closed', report.portsClosed)}
  ${section(
    'Potential service impact',
    report.potentialBrokenPaths.flatMap((item) => [
      item.summary,
      ...item.dependentPaths.map((path) => `Path affected: ${path}`),
    ]),
  )}
  ${section('Alternative connectivity', report.alternativePaths)}
  ${section('Duplicate rules', report.duplicateRules)}
  ${section('Conflicting rules', report.conflictingRules)}
  ${section('Potentially redundant rules', report.redundantRules)}
  ${section('Security exposure', report.securityExposure)}
  ${section('Recommendation notes', report.recommendations)}
  <div class="note">This analysis describes network policy only. It does not include application dependency information, so it identifies where connectivity changes and where service impact is possible — it cannot confirm that an application will or will not be affected.</div>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
