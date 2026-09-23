import { describe, expect, it } from 'vitest';
import { analyseChange, applyChange } from '@/services/analyseChange';
import { buildGraph } from '@/services/graph';
import { comparePolicies, detectPotentialBreakage } from '@/services/compare';
import { calculateAffectedServers, calculateBlastRadius } from '@/services/impact';
import { dataset, rule, server, threeTierDataset } from './fixtures';

describe('applyChange', () => {
  it('never mutates the original rule list', () => {
    const base = threeTierDataset();
    const before = JSON.stringify(base.rules);
    applyChange(base.rules, {
      type: 'DELETE_RULE',
      originalRule: base.rules[0],
      proposedRule: null,
    });
    expect(JSON.stringify(base.rules)).toBe(before);
  });

  it('adds, modifies, deletes, disables and enables', () => {
    const base = threeTierDataset();
    const extra = rule('r-new', 'web01', 'db01', 'TCP', [1433]);

    expect(applyChange(base.rules, { type: 'ADD_RULE', originalRule: null, proposedRule: extra })).toHaveLength(3);
    expect(
      applyChange(base.rules, { type: 'DELETE_RULE', originalRule: base.rules[0], proposedRule: null }),
    ).toHaveLength(1);

    const modified = { ...base.rules[1], ports: [{ from: 5432, to: 5432 }] };
    const afterModify = applyChange(base.rules, {
      type: 'MODIFY_RULE',
      originalRule: base.rules[1],
      proposedRule: modified,
    });
    expect(afterModify.find((item) => item.id === 'r-app-db')?.ports).toEqual([{ from: 5432, to: 5432 }]);

    const afterDisable = applyChange(base.rules, {
      type: 'DISABLE_RULE',
      originalRule: base.rules[1],
      proposedRule: null,
    });
    expect(afterDisable.find((item) => item.id === 'r-app-db')?.disabled).toBe(true);

    const afterEnable = applyChange(afterDisable, {
      type: 'ENABLE_RULE',
      originalRule: afterDisable[1],
      proposedRule: null,
    });
    expect(afterEnable.find((item) => item.id === 'r-app-db')?.disabled).toBe(false);
  });
});

describe('comparePolicies', () => {
  it('classifies an edited rule as modified rather than as an add plus a remove', () => {
    const base = threeTierDataset();
    const before = buildGraph(base);
    const proposed = { ...base.rules[1], ports: [{ from: 5432, to: 5432 }] };
    const after = buildGraph({ ...base, rules: applyChange(base.rules, {
      type: 'MODIFY_RULE',
      originalRule: base.rules[1],
      proposedRule: proposed,
    }) });

    const comparison = comparePolicies(before, after);
    expect(comparison.modifiedConnections).toHaveLength(1);
    expect(comparison.addedConnections).toHaveLength(0);
    expect(comparison.removedConnections).toHaveLength(0);
    expect(comparison.unchangedConnectionIds).toHaveLength(1);
  });

  it('classifies a new rule as added and a deleted rule as removed', () => {
    const base = threeTierDataset();
    const before = buildGraph(base);

    const added = buildGraph({ ...base, rules: [...base.rules, rule('r-new', 'web01', 'db01', 'TCP', [1433])] });
    expect(comparePolicies(before, added).addedConnections).toHaveLength(1);

    const removed = buildGraph({ ...base, rules: base.rules.slice(0, 1) });
    expect(comparePolicies(before, removed).removedConnections).toHaveLength(1);
  });
});

describe('detectPotentialBreakage', () => {
  it('detects removal of the only permitted connection and finds no alternative', () => {
    const base = threeTierDataset();
    const before = buildGraph(base);
    const remaining = base.rules.filter((item) => item.id !== 'r-web-app');
    const after = buildGraph({ ...base, rules: remaining });

    const findings = detectPotentialBreakage(before, remaining, comparePolicies(before, after));
    expect(findings).toHaveLength(1);
    expect(findings[0].alternativeAvailable).toBe(false);
    expect(findings[0].summary).toContain('would no longer have a permitted TCP 8080 connection');
    expect(findings[0].summary).toContain('No alternative network path detected');
  });

  it('reports remaining connectivity when an equivalent rule exists', () => {
    const rules = [
      rule('ruleA', 'app01', 'db01', 'TCP', [1433]),
      rule('ruleB', 'app01', 'db01', 'TCP', [1433]),
    ];
    const base = dataset([server('app01'), server('db01')], rules);
    const before = buildGraph(base);
    const remaining = rules.filter((item) => item.id !== 'ruleA');
    const after = buildGraph({ ...base, rules: remaining });

    const findings = detectPotentialBreakage(before, remaining, comparePolicies(before, after));
    expect(findings).toHaveLength(1);
    expect(findings[0].alternativeAvailable).toBe(true);
    expect(findings[0].alternativeRuleIds).toEqual(['ruleB']);
    expect(findings[0].summary).toContain('Connectivity remains available through another rule');
  });

  it('lists the longer paths that use the removed connection', () => {
    const base = threeTierDataset();
    const before = buildGraph(base);
    const remaining = base.rules.filter((item) => item.id !== 'r-app-db');
    const after = buildGraph({ ...base, rules: remaining });

    const findings = detectPotentialBreakage(before, remaining, comparePolicies(before, after));
    expect(findings[0].dependentPaths).toHaveLength(1);
    expect(findings[0].summary).toContain('used within 1 existing network path');
  });

  it('detects the port half of a port change as lost connectivity', () => {
    const base = threeTierDataset();
    const before = buildGraph(base);
    const proposed = { ...base.rules[1], ports: [{ from: 5432, to: 5432 }] };
    const remaining = applyChange(base.rules, {
      type: 'MODIFY_RULE',
      originalRule: base.rules[1],
      proposedRule: proposed,
    });
    const after = buildGraph({ ...base, rules: remaining });

    const findings = detectPotentialBreakage(before, remaining, comparePolicies(before, after));
    expect(findings).toHaveLength(1);
    expect(findings[0].ports).toEqual([{ from: 1433, to: 1433 }]);
  });

  it('does not report a removed DENY rule as lost connectivity', () => {
    const rules = [rule('deny', 'a', 'b', 'TCP', [1433], 'DENY')];
    const base = dataset([server('a'), server('b')], rules);
    const before = buildGraph(base);
    const after = buildGraph({ ...base, rules: [] });
    expect(detectPotentialBreakage(before, [], comparePolicies(before, after))).toHaveLength(0);
  });

  it('never claims an application will definitely break', () => {
    const base = threeTierDataset();
    const before = buildGraph(base);
    const remaining = base.rules.filter((item) => item.id !== 'r-web-app');
    const after = buildGraph({ ...base, rules: remaining });
    const [finding] = detectPotentialBreakage(before, remaining, comparePolicies(before, after));
    expect(finding.summary).not.toMatch(/will break|will fail|definitely|outage/i);
  });
});

describe('affected servers and blast radius', () => {
  it('names the source and destination as directly affected, with a reason each', () => {
    const base = threeTierDataset();
    const graph = buildGraph(base);
    const direct = calculateAffectedServers(graph, base.rules[0], null);
    expect(direct.map((item) => item.serverId).sort()).toEqual(['app01', 'web01']);
    expect(direct.every((item) => item.reasons.length > 0)).toBe(true);
  });

  it('explains what changed when a rule is modified', () => {
    const base = threeTierDataset();
    const graph = buildGraph(base);
    const proposed = { ...base.rules[1], ports: [{ from: 5432, to: 5432 }] };
    const direct = calculateAffectedServers(graph, base.rules[1], proposed);
    expect(direct[0].reasons[0]).toContain('ports change from 1433 to 5432');
  });

  it('expands outward through permitted connectivity with levels and reasons', () => {
    const base = threeTierDataset();
    const graph = buildGraph(base);
    const direct = calculateAffectedServers(graph, base.rules[0], null);
    const radius = calculateBlastRadius(graph, direct);

    const db = radius.find((item) => item.serverId === 'db01');
    expect(db?.level).toBe('ONE_HOP');
    expect(db?.reasons[0]).toContain('one network hop from');
    expect(radius.filter((item) => item.level === 'DIRECT')).toHaveLength(2);
  });

  it('does not expand through DENY connections', () => {
    const rules = [
      rule('allow', 'a', 'b', 'TCP', [443]),
      rule('deny', 'b', 'c', 'TCP', [443], 'DENY'),
    ];
    const graph = buildGraph(dataset([server('a'), server('b'), server('c')], rules));
    const radius = calculateBlastRadius(graph, calculateAffectedServers(graph, rules[0], null));
    expect(radius.map((item) => item.serverId).sort()).toEqual(['a', 'b']);
  });

  it('respects the depth limit', () => {
    const rules = [
      rule('r1', 'a', 'b', 'TCP', [443]),
      rule('r2', 'b', 'c', 'TCP', [443]),
      rule('r3', 'c', 'd', 'TCP', [443]),
    ];
    const graph = buildGraph(dataset([server('a'), server('b'), server('c'), server('d')], rules));
    const seeds = calculateAffectedServers(graph, rules[0], null);
    expect(calculateBlastRadius(graph, seeds, { maxDepth: 1 }).map((item) => item.serverId).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('analyseChange', () => {
  const fixedNow = () => new Date('2026-03-01T12:00:00.000Z');

  it('produces a complete analysis for deleting the only allowed connection', () => {
    const base = threeTierDataset();
    const analysis = analyseChange(
      base,
      { type: 'DELETE_RULE', originalRule: base.rules[0], proposedRule: null },
      { now: fixedNow, changeId: 'chg-test' },
    );

    expect(analysis.connectionsRemoved).toHaveLength(1);
    expect(analysis.connectionsAdded).toHaveLength(0);
    expect(analysis.breakage).toHaveLength(1);
    expect(analysis.breakage[0].alternativeAvailable).toBe(false);
    expect(analysis.portsClosed).toHaveLength(1);
    expect(analysis.pathsRemoved.length).toBeGreaterThan(0);
    expect(analysis.risk.facts.permittedConnectionsRemoved).toBe(1);
    expect(analysis.risk.factors.length).toBeGreaterThan(0);
    expect(analysis.generatedAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('never mutates the source dataset', () => {
    const base = threeTierDataset();
    const snapshot = JSON.stringify(base);
    analyseChange(base, { type: 'DELETE_RULE', originalRule: base.rules[0], proposedRule: null });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('rates an isolated, narrow addition as LOW risk', () => {
    const base = dataset([server('a'), server('b')], []);
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('new', 'a', 'b', 'TCP', [9999]),
    });
    expect(analysis.risk.rating).toBe('LOW');
    expect(analysis.connectionsAdded).toHaveLength(1);
    expect(analysis.portsOpened).toHaveLength(1);
  });

  it('rates removal of a production database connection higher than a trivial addition', () => {
    const base = threeTierDataset();
    const removal = analyseChange(base, {
      type: 'DELETE_RULE',
      originalRule: base.rules[1],
      proposedRule: null,
    });
    const addition = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('new', 'web01', 'app01', 'TCP', [9999]),
    });
    expect(removal.risk.score).toBeGreaterThan(addition.risk.score);
    expect(removal.risk.facts.permittedConnectionsRemoved).toBe(1);
  });

  it('attributes every risk point to a named factor', () => {
    const base = threeTierDataset();
    const analysis = analyseChange(base, {
      type: 'DELETE_RULE',
      originalRule: base.rules[1],
      proposedRule: null,
    });
    const total = analysis.risk.factors.reduce((sum, factor) => sum + factor.points, 0);
    expect(total).toBe(analysis.risk.score);
  });

  it('flags a proposed exact duplicate', () => {
    const base = threeTierDataset();
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('copy', 'web01', 'app01', 'TCP', [8080]),
    });
    expect(analysis.duplicates).toHaveLength(1);
    expect(analysis.recommendations.join(' ')).toContain('identical rule already exists');
  });

  it('flags a proposed ALLOW that conflicts with an existing DENY', () => {
    const rules = [rule('deny', 'a', 'b', 'TCP', [1433], 'DENY')];
    const base = dataset([server('a'), server('b')], rules);
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('allow', 'a', 'b', 'TCP', [1433], 'ALLOW'),
    });
    expect(analysis.conflicts).toHaveLength(1);
    expect(analysis.recommendations.join(' ')).toContain('rule precedence');
  });

  it('reports the alternative rule when equivalent connectivity survives', () => {
    const rules = [
      rule('ruleA', 'app01', 'db01', 'TCP', [1433]),
      rule('ruleB', 'app01', 'db01', 'TCP', [1433]),
    ];
    const base = dataset([server('app01'), server('db01', { role: 'DB' })], rules);
    const analysis = analyseChange(base, {
      type: 'DELETE_RULE',
      originalRule: rules[0],
      proposedRule: null,
    });
    expect(analysis.breakage[0].alternativeAvailable).toBe(true);
    expect(analysis.breakage[0].alternativeRuleIds).toEqual(['ruleB']);
    expect(analysis.risk.facts.removalsWithoutAlternative).toBe(0);
  });

  it('records security exposure when administrative access is opened', () => {
    const base = dataset(
      [server('jump', { role: 'MANAGEMENT' }), server('db01', { role: 'DB' })],
      [],
    );
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('ssh', 'jump', 'db01', 'TCP', [22]),
    });
    expect(analysis.exposure.join(' ')).toContain('Administrative access is being opened');
  });

  it('records exposure when a rule crosses environments', () => {
    const base = dataset(
      [server('devbox', { environment: 'DEV' }), server('proddb', { environment: 'PROD', role: 'DB' })],
      [],
    );
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('x', 'devbox', 'proddb', 'TCP', [1433]),
    });
    expect(analysis.exposure.join(' ')).toContain('crosses environments');
  });

  it('records paths created when a new rule completes a route', () => {
    const rules = [rule('hop1', 'a', 'b', 'TCP', [443])];
    const base = dataset([server('a'), server('b'), server('c')], rules);
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('hop2', 'b', 'c', 'TCP', [443]),
    });
    expect(analysis.pathsCreated.length).toBeGreaterThan(0);
  });

  it('handles a disable as a removal of connectivity', () => {
    const base = threeTierDataset();
    const analysis = analyseChange(base, {
      type: 'DISABLE_RULE',
      originalRule: base.rules[0],
      proposedRule: null,
    });
    expect(analysis.connectionsRemoved).toHaveLength(1);
    expect(analysis.breakage).toHaveLength(1);
  });

  it('produces a harmless result for a change referencing an unknown server', () => {
    const base = threeTierDataset();
    const analysis = analyseChange(base, {
      type: 'ADD_RULE',
      originalRule: null,
      proposedRule: rule('ghost', 'web01', 'does-not-exist', 'TCP', [443]),
    });
    expect(analysis.connectionsAdded).toHaveLength(0);
    expect(analysis.risk.rating).toBe('LOW');
  });
});

describe('no-op changes', () => {
  it('does not propagate a blast radius when connectivity is unchanged', () => {
    const base = threeTierDataset();
    const unchanged = { ...base.rules[0], name: 'renamed but otherwise identical' };
    const analysis = analyseChange(base, {
      type: 'MODIFY_RULE',
      originalRule: base.rules[0],
      proposedRule: unchanged,
    });

    expect(analysis.connectionsAdded).toHaveLength(0);
    expect(analysis.connectionsRemoved).toHaveLength(0);
    expect(analysis.connectionsModified).toHaveLength(0);
    // Only the two servers the rule names, not everything reachable from them.
    expect(analysis.affectedServers.map((item) => item.serverId).sort()).toEqual(['app01', 'web01']);
    expect(analysis.affectedServers.every((item) => item.level === 'DIRECT')).toBe(true);
    expect(analysis.risk.rating).toBe('LOW');
    expect(analysis.risk.score).toBe(0);
  });

  it('still propagates the blast radius when connectivity does change', () => {
    const base = threeTierDataset();
    const analysis = analyseChange(base, {
      type: 'DELETE_RULE',
      originalRule: base.rules[0],
      proposedRule: null,
    });
    expect(analysis.affectedServers.length).toBeGreaterThan(2);
    expect(analysis.affectedServers.some((item) => item.level !== 'DIRECT')).toBe(true);
  });
});
