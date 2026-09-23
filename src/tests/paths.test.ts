import { describe, expect, it } from 'vitest';
import { buildGraph, isolatedServers, neighboursOf } from '@/services/graph';
import { describePath, findAllowedPaths, findAlternativePaths, pathsUsingConnection } from '@/services/paths';
import { dataset, rule, server, threeTierDataset } from './fixtures';

describe('buildGraph', () => {
  it('indexes connections by source and destination', () => {
    const graph = buildGraph(threeTierDataset());
    expect(graph.connections).toHaveLength(2);
    expect(graph.bySource.get('web01')).toHaveLength(1);
    expect(graph.byDestination.get('db01')).toHaveLength(1);
    expect(graph.nodes.get('app01')?.degree).toBe(2);
  });

  it('excludes disabled rules from connectivity but keeps them addressable', () => {
    const base = threeTierDataset();
    const withDisabled = {
      ...base,
      rules: base.rules.map((item) => (item.id === 'r-app-db' ? { ...item, disabled: true } : item)),
    };
    const graph = buildGraph(withDisabled);
    expect(graph.connections).toHaveLength(1);
    expect(graph.rulesById.has('r-app-db')).toBe(true);
  });

  it('drops rules whose endpoints do not resolve to a server', () => {
    const data = dataset([server('a')], [rule('r1', 'a', 'ghost', 'TCP', [443])]);
    expect(buildGraph(data).connections).toHaveLength(0);
  });

  it('identifies isolated servers', () => {
    const data = dataset(
      [server('a'), server('b'), server('lonely')],
      [rule('r1', 'a', 'b', 'TCP', [443])],
    );
    expect(isolatedServers(buildGraph(data))).toEqual(['lonely']);
  });

  it('returns neighbours, optionally restricted to permitted traffic', () => {
    const data = dataset(
      [server('a'), server('b'), server('c')],
      [rule('r1', 'a', 'b', 'TCP', [443]), rule('r2', 'a', 'c', 'TCP', [443], 'DENY')],
    );
    const graph = buildGraph(data);
    expect([...neighboursOf(graph, 'a')].sort()).toEqual(['b', 'c']);
    expect([...neighboursOf(graph, 'a', { allowedOnly: true })]).toEqual(['b']);
  });
});

describe('findAllowedPaths', () => {
  it('finds a multi-hop permitted path', () => {
    const graph = buildGraph(threeTierDataset());
    const paths = findAllowedPaths(graph, 'web01', 'db01');
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['web01', 'app01', 'db01']);
    expect(paths[0].hopCount).toBe(2);
    expect(paths[0].permitted).toBe(true);
    expect(describePath(graph, paths[0])).toBe('web-srv-01 → app-srv-01 → db-srv-01');
  });

  it('returns no path when the only route is a DENY rule', () => {
    const data = dataset(
      [server('a'), server('b')],
      [rule('r1', 'a', 'b', 'TCP', [443], 'DENY')],
    );
    expect(findAllowedPaths(buildGraph(data), 'a', 'b')).toHaveLength(0);
  });

  it('traverses DENY connections when allowedRulesOnly is false, marking them non-permitted', () => {
    const data = dataset(
      [server('a'), server('b')],
      [rule('r1', 'a', 'b', 'TCP', [443], 'DENY')],
    );
    const paths = findAllowedPaths(buildGraph(data), 'a', 'b', { allowedRulesOnly: false });
    expect(paths).toHaveLength(1);
    expect(paths[0].permitted).toBe(false);
  });

  it('respects direction: a reverse rule does not create a forward path', () => {
    const data = dataset([server('a'), server('b')], [rule('r1', 'b', 'a', 'TCP', [443])]);
    expect(findAllowedPaths(buildGraph(data), 'a', 'b')).toHaveLength(0);
  });

  it('returns one path per distinct rule between the same pair', () => {
    const data = dataset(
      [server('a'), server('b')],
      [rule('r1', 'a', 'b', 'TCP', [443]), rule('r2', 'a', 'b', 'TCP', [8443])],
    );
    expect(findAllowedPaths(buildGraph(data), 'a', 'b')).toHaveLength(2);
  });

  it('honours the maximum hop count', () => {
    const graph = buildGraph(threeTierDataset());
    expect(findAllowedPaths(graph, 'web01', 'db01', { maxHops: 1 })).toHaveLength(0);
    expect(findAllowedPaths(graph, 'web01', 'db01', { maxHops: 2 })).toHaveLength(1);
  });

  it('does not loop on cyclic policies', () => {
    const data = dataset(
      [server('a'), server('b'), server('c')],
      [
        rule('r1', 'a', 'b', 'TCP', [443]),
        rule('r2', 'b', 'c', 'TCP', [443]),
        rule('r3', 'c', 'a', 'TCP', [443]),
      ],
    );
    const paths = findAllowedPaths(buildGraph(data), 'a', 'c', { maxHops: 5 });
    expect(paths.every((path) => new Set(path.nodes).size === path.nodes.length)).toBe(true);
    expect(paths).toHaveLength(1);
  });

  it('returns nothing for an unknown or self-referencing endpoint', () => {
    const graph = buildGraph(threeTierDataset());
    expect(findAllowedPaths(graph, 'web01', 'ghost')).toHaveLength(0);
    expect(findAllowedPaths(graph, 'web01', 'web01')).toHaveLength(0);
  });
});

describe('pathsUsingConnection', () => {
  it('lists longer paths that traverse a given connection', () => {
    const graph = buildGraph(threeTierDataset());
    const connection = graph.connections.find((item) => item.ruleId === 'r-app-db')!;
    const paths = pathsUsingConnection(graph, connection);
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['web01', 'app01', 'db01']);
  });

  it('returns nothing for a DENY connection', () => {
    const data = dataset([server('a'), server('b')], [rule('r1', 'a', 'b', 'TCP', [443], 'DENY')]);
    const graph = buildGraph(data);
    expect(pathsUsingConnection(graph, { ...graph.connections[0] })).toHaveLength(0);
  });
});

describe('findAlternativePaths', () => {
  it('detects an equivalent rule that preserves connectivity', () => {
    const rules = [
      rule('ruleA', 'app01', 'db01', 'TCP', [1433]),
      rule('ruleB', 'app01', 'db01', 'TCP', [1433]),
    ];
    const data = dataset([server('app01'), server('db01')], rules);
    const graph = buildGraph(data);
    const remaining = rules.filter((item) => item.id !== 'ruleA');

    const result = findAlternativePaths(
      graph,
      { source: 'app01', destination: 'db01', protocol: 'TCP', ports: [{ from: 1433, to: 1433 }] },
      remaining,
    );
    expect(result.fullyEquivalent).toBe(true);
    expect(result.equivalentRuleIds).toEqual(['ruleB']);
    expect(result.summary).toContain('Connectivity remains available through another rule');
  });

  it('detects a broader rule as equivalent cover', () => {
    const rules = [
      rule('narrow', 'app01', 'db01', 'TCP', [1433]),
      rule('wide', 'app01', 'db01', 'TCP', ['1400-1500']),
    ];
    const graph = buildGraph(dataset([server('app01'), server('db01')], rules));
    const result = findAlternativePaths(
      graph,
      { source: 'app01', destination: 'db01', protocol: 'TCP', ports: [{ from: 1433, to: 1433 }] },
      [rules[1]],
    );
    expect(result.fullyEquivalent).toBe(true);
    expect(result.equivalentRuleIds).toEqual(['wide']);
  });

  it('reports no alternative when nothing else permits the traffic', () => {
    const rules = [rule('only', 'app01', 'db01', 'TCP', [1433])];
    const graph = buildGraph(dataset([server('app01'), server('db01')], rules));
    const result = findAlternativePaths(
      graph,
      { source: 'app01', destination: 'db01', protocol: 'TCP', ports: [{ from: 1433, to: 1433 }] },
      [],
    );
    expect(result.fullyEquivalent).toBe(false);
    expect(result.summary).toContain('No alternative network path detected');
  });

  it('reports partial connectivity when the remaining rule covers only some ports', () => {
    const rules = [rule('partial', 'app01', 'db01', 'TCP', [1433])];
    const graph = buildGraph(dataset([server('app01'), server('db01')], rules));
    const result = findAlternativePaths(
      graph,
      {
        source: 'app01',
        destination: 'db01',
        protocol: 'TCP',
        ports: [
          { from: 1433, to: 1433 },
          { from: 5432, to: 5432 },
        ],
      },
      rules,
    );
    expect(result.fullyEquivalent).toBe(false);
    expect(result.lostPorts).toEqual([{ from: 5432, to: 5432 }]);
    expect(result.summary).toContain('Partial connectivity remains');
  });

  it('does not treat a DENY rule as alternative connectivity', () => {
    const rules = [rule('deny', 'app01', 'db01', 'TCP', [1433], 'DENY')];
    const graph = buildGraph(dataset([server('app01'), server('db01')], rules));
    const result = findAlternativePaths(
      graph,
      { source: 'app01', destination: 'db01', protocol: 'TCP', ports: [{ from: 1433, to: 1433 }] },
      rules,
    );
    expect(result.fullyEquivalent).toBe(false);
  });

  it('surfaces an indirect route when no direct rule remains', () => {
    const rules = [
      rule('direct', 'a', 'c', 'TCP', [443]),
      rule('hop1', 'a', 'b', 'TCP', [443]),
      rule('hop2', 'b', 'c', 'TCP', [443]),
    ];
    const graph = buildGraph(dataset([server('a'), server('b'), server('c')], rules));
    const result = findAlternativePaths(
      graph,
      { source: 'a', destination: 'c', protocol: 'TCP', ports: [{ from: 443, to: 443 }] },
      rules.filter((item) => item.id !== 'direct'),
    );
    expect(result.fullyEquivalent).toBe(false);
    expect(result.indirectPaths).toHaveLength(1);
    expect(result.summary).toContain('indirect permitted route');
  });
});
