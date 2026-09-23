import { describe, expect, it } from 'vitest';
import { parseImport, serialiseDataset } from '@/services/parseImport';
import { buildGraph } from '@/services/graph';
import { findAllIssues } from '@/services/issues';
import { calculateStats, portUsage, summariseAllServers } from '@/services/statistics';
import sampleDocument from '@/data/sampleDataset.json';

const now = () => new Date('2026-01-01T00:00:00.000Z');

describe('parseImport — malformed input', () => {
  it('reports invalid JSON without throwing', () => {
    const result = parseImport('{ not json');
    expect(result.dataset).toBeNull();
    expect(result.validation.ok).toBe(false);
    expect(result.validation.issues[0].code).toBe('MALFORMED_DOCUMENT');
  });

  it('reports an unrecognised structure', () => {
    const result = parseImport(JSON.stringify({ totally: 'unrelated' }));
    expect(result.dataset).toBeNull();
    expect(result.validation.issues[0].message).toContain('No importer recognised');
  });

  it('survives a document with servers but no rules', () => {
    const result = parseImport({ servers: [{ id: 'a', name: 'a' }] }, { now });
    expect(result.dataset?.servers).toHaveLength(1);
    expect(result.validation.issues.some((issue) => issue.code === 'MISSING_RULES_COLLECTION')).toBe(true);
  });

  it('survives servers missing most fields', () => {
    const result = parseImport({ servers: [{ name: 'lonely' }], rules: [] }, { now });
    const [serverEntry] = result.dataset!.servers;
    expect(serverEntry.id).toBe('lonely');
    expect(serverEntry.role).toBe('UNKNOWN');
    expect(serverEntry.environment).toBe('UNKNOWN');
    expect(result.validation.issues.some((issue) => issue.code === 'MISSING_SERVER_FIELD')).toBe(true);
  });

  it('reports duplicate server ids and keeps both entries', () => {
    const result = parseImport(
      { servers: [{ id: 'a', name: 'first' }, { id: 'a', name: 'second' }], rules: [] },
      { now },
    );
    expect(result.dataset!.servers).toHaveLength(2);
    expect(result.validation.issues.some((issue) => issue.code === 'DUPLICATE_SERVER_ID')).toBe(true);
  });

  it('reports duplicate rule ids and keeps both rules', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
        rules: [
          { id: 'r1', consumer: 'a', provider: 'b', protocol: 'TCP', ports: [443], action: 'ALLOW' },
          { id: 'r1', consumer: 'a', provider: 'b', protocol: 'TCP', ports: [80], action: 'ALLOW' },
        ],
      },
      { now },
    );
    expect(result.dataset!.rules).toHaveLength(2);
    expect(result.validation.issues.some((issue) => issue.code === 'DUPLICATE_RULE_ID')).toBe(true);
  });

  it('reports malformed ports but keeps the valid ones', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
        rules: [{ id: 'r1', consumer: 'a', provider: 'b', protocol: 'TCP', ports: [443, 'banana', 99999], action: 'ALLOW' }],
      },
      { now },
    );
    expect(result.dataset!.rules[0].ports).toEqual([{ from: 443, to: 443 }]);
    const issue = result.validation.issues.find((item) => item.code === 'MALFORMED_PORT');
    expect(issue?.message).toContain('banana');
  });

  it('reports an unknown protocol but keeps the rule', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
        rules: [{ id: 'r1', consumer: 'a', provider: 'b', protocol: 'SCTP', ports: [443], action: 'ALLOW' }],
      },
      { now },
    );
    expect(result.dataset!.rules[0].protocol).toBe('SCTP');
    expect(result.validation.issues.some((issue) => issue.code === 'UNKNOWN_PROTOCOL')).toBe(true);
  });

  it('reports an unknown action and keeps the rule visible as ALLOW', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
        rules: [{ id: 'r1', consumer: 'a', provider: 'b', protocol: 'TCP', ports: [443], action: 'MAYBE' }],
      },
      { now },
    );
    expect(result.dataset!.rules[0].action).toBe('ALLOW');
    expect(result.validation.issues.some((issue) => issue.code === 'UNKNOWN_ACTION')).toBe(true);
  });

  it('synthesises an unresolved endpoint rather than dropping the rule', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }],
        rules: [{ id: 'r1', consumer: 'a', provider: 'external-service', protocol: 'UDP', ports: [53], action: 'ALLOW' }],
      },
      { now },
    );
    expect(result.dataset!.rules).toHaveLength(1);
    const synthetic = result.dataset!.servers.find((item) => item.synthetic);
    expect(synthetic?.id).toBe('external-service');
    expect(result.validation.syntheticServers).toBe(1);
    expect(result.validation.issues.some((issue) => issue.code === 'UNKNOWN_DESTINATION')).toBe(true);
  });

  it('drops a rule with no source or destination but explains why', () => {
    const result = parseImport(
      { servers: [{ id: 'a', name: 'a' }], rules: [{ id: 'r1', protocol: 'TCP', ports: [443], action: 'ALLOW' }] },
      { now },
    );
    expect(result.dataset!.rules).toHaveLength(0);
    expect(result.validation.issues.filter((issue) => issue.code === 'MISSING_RULE_FIELD')).toHaveLength(2);
  });

  it('flags an invalid IP address', () => {
    const result = parseImport(
      { servers: [{ id: 'a', name: 'a', ip: '10.10.999.1' }], rules: [] },
      { now },
    );
    expect(result.validation.issues.some((issue) => issue.code === 'INVALID_IP')).toBe(true);
  });

  it('flags duplicate IP addresses across servers', () => {
    const result = parseImport(
      {
        servers: [
          { id: 'a', name: 'a', ip: '10.0.0.1' },
          { id: 'b', name: 'b', ip: '10.0.0.1' },
        ],
        rules: [],
      },
      { now },
    );
    expect(result.validation.issues.some((issue) => issue.code === 'DUPLICATE_IP')).toBe(true);
  });
});

describe('parseImport — field flexibility', () => {
  it('accepts source/destination as an alternative to consumer/provider', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
        rules: [{ id: 'r1', source: 'a', destination: 'b', protocol: 'tcp', ports: '443', action: 'permit' }],
      },
      { now },
    );
    const [ruleEntry] = result.dataset!.rules;
    expect(ruleEntry.source).toBe('a');
    expect(ruleEntry.destination).toBe('b');
    expect(ruleEntry.protocol).toBe('TCP');
    expect(ruleEntry.action).toBe('ALLOW');
  });

  it('resolves endpoint references by name and by IP address', () => {
    const result = parseImport(
      {
        servers: [
          { id: 'srv-1', name: 'web-01', ip: '10.0.0.1' },
          { id: 'srv-2', name: 'db-01', ip: '10.0.0.2' },
        ],
        rules: [{ id: 'r1', consumer: 'web-01', provider: '10.0.0.2', protocol: 'TCP', ports: [1433], action: 'ALLOW' }],
      },
      { now },
    );
    expect(result.dataset!.rules[0].source).toBe('srv-1');
    expect(result.dataset!.rules[0].destination).toBe('srv-2');
  });

  it('maps role and environment synonyms onto the canonical values', () => {
    const result = parseImport(
      {
        servers: [
          { id: 'a', name: 'a', tier: 'frontend', env: 'production' },
          { id: 'b', name: 'b', tier: 'database', env: 'staging' },
          { id: 'c', name: 'c', tier: 'bastion', env: 'sandbox' },
        ],
        rules: [],
      },
      { now },
    );
    expect(result.dataset!.servers.map((item) => item.role)).toEqual(['WEB', 'DB', 'MANAGEMENT']);
    expect(result.dataset!.servers.map((item) => item.environment)).toEqual(['PROD', 'UAT', 'DEV']);
  });

  it('inverts an "enabled: false" flag into a disabled rule', () => {
    const result = parseImport(
      {
        servers: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }],
        rules: [{ id: 'r1', consumer: 'a', provider: 'b', protocol: 'TCP', ports: [443], action: 'ALLOW', enabled: false }],
      },
      { now },
    );
    expect(result.dataset!.rules[0].disabled).toBe(true);
  });

  it('finds collections nested one level down', () => {
    const result = parseImport(
      { data: { servers: [{ id: 'a', name: 'a' }], rules: [] } },
      { now },
    );
    expect(result.dataset!.servers).toHaveLength(1);
  });
});

describe('the supplied 50-server sample', () => {
  const result = parseImport(sampleDocument, { now, sourceName: 'sample.json' });
  const data = result.dataset!;
  const graph = buildGraph(data);

  it('imports every server and rule', () => {
    expect(result.validation.serversDetected).toBe(50);
    expect(result.validation.rulesDetected).toBe(149);
    expect(data.metadata.product).toBe('Cisco Secure Workload');
  });

  it('surfaces the unresolved dns-service endpoint as a warning', () => {
    const unknown = result.validation.issues.filter((issue) => issue.code === 'UNKNOWN_DESTINATION');
    expect(unknown.length).toBeGreaterThan(0);
    expect(data.servers.filter((item) => item.synthetic).map((item) => item.id).sort()).toEqual([
      'dns-service',
      'ntp-service',
    ]);
  });

  it('builds a connected graph', () => {
    expect(graph.connections).toHaveLength(149);
    expect(graph.nodes.size).toBe(52); // 50 servers + dns-service + ntp-service
  });

  it('detects the duplicate DENY rule pair present in the data', () => {
    const issues = findAllIssues(data, graph, result.validation);
    const duplicates = issues.filter((issue) => issue.category === 'EXACT_DUPLICATE');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].ruleIds).toHaveLength(2);
  });

  it('produces dashboard statistics', () => {
    const stats = calculateStats(data, graph, findAllIssues(data, graph, result.validation));
    expect(stats.totalServers).toBe(50);
    expect(stats.totalRules).toBe(149);
    expect(stats.allowedConnections + stats.deniedConnections).toBe(149);
    expect(stats.deniedConnections).toBe(24);
    expect(stats.uniquePorts).toBeGreaterThan(10);
  });

  it('produces port usage with friendly names for well-known ports', () => {
    const usage = portUsage(data, graph);
    const sql = usage.find((entry) => entry.port === 1433);
    expect(sql?.service).toBe('SQL Server');
    expect(sql!.ruleCount).toBeGreaterThan(0);
  });

  it('summarises every server', () => {
    const summaries = summariseAllServers(data);
    expect(summaries.size).toBe(52);
    const total = [...summaries.values()].reduce((sum, item) => sum + item.outboundRules, 0);
    expect(total).toBe(149);
  });

  it('round-trips through serialisation without losing rules', () => {
    const reimported = parseImport(serialiseDataset(data), { now });
    expect(reimported.validation.rulesDetected).toBe(149);
    expect(reimported.validation.serversDetected).toBe(50);
  });
});
