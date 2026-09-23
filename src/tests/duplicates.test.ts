import { describe, expect, it } from 'vitest';
import {
  calculateRuleCoverage,
  checkCandidateRule,
  findDuplicates,
  findExactDuplicatesOf,
  findOverlaps,
  findOverlyBroadRules,
  findRedundantRules,
} from '@/services/duplicates';
import { findConflicts, findConflictsOf } from '@/services/conflicts';
import { rule } from './fixtures';

describe('exact duplicate detection', () => {
  it('flags two rules with an identical 5-tuple', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [1433]),
      rule('r2', 'app01', 'db01', 'TCP', [1433]),
    ];
    const issues = findDuplicates(rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('EXACT_DUPLICATE');
    expect(issues[0].ruleIds).toEqual(['r1', 'r2']);
  });

  it('does not flag rules with different ports', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [1433]),
      rule('r2', 'app01', 'db01', 'TCP', [5432]),
    ];
    expect(findDuplicates(rules)).toHaveLength(0);
  });

  it('does not flag rules with different protocols', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [53]),
      rule('r2', 'app01', 'db01', 'UDP', [53]),
    ];
    expect(findDuplicates(rules)).toHaveLength(0);
  });

  it('does not flag the reverse direction as a duplicate', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [1433]),
      rule('r2', 'db01', 'app01', 'TCP', [1433]),
    ];
    expect(findDuplicates(rules)).toHaveLength(0);
  });

  it('does not flag rules with different actions', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [1433], 'ALLOW'),
      rule('r2', 'app01', 'db01', 'TCP', [1433], 'DENY'),
    ];
    expect(findDuplicates(rules)).toHaveLength(0);
  });

  it('treats port order and equivalent ranges as identical', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [8443, 8080]),
      rule('r2', 'app01', 'db01', 'TCP', [8080, 8443]),
    ];
    expect(findDuplicates(rules)).toHaveLength(1);
  });

  it('ignores disabled rules', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [1433]),
      rule('r2', 'app01', 'db01', 'TCP', [1433], 'ALLOW', { disabled: true }),
    ];
    expect(findDuplicates(rules)).toHaveLength(0);
  });

  it('finds exact duplicates of one candidate rule', () => {
    const existing = [rule('r1', 'app01', 'db01', 'TCP', [1433])];
    const candidate = rule('new', 'app01', 'db01', 'TCP', [1433]);
    expect(findExactDuplicatesOf(candidate, existing).map((match) => match.id)).toEqual(['r1']);
  });
});

describe('port overlap detection', () => {
  it('flags a narrow rule overlapping a wide range with the same action', () => {
    const rules = [
      rule('wide', 'app01', 'db01', 'TCP', ['1400-1500']),
      rule('narrow', 'app01', 'db01', 'TCP', [1433]),
    ];
    const issues = findOverlaps(rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('PORT_OVERLAP');
  });

  it('does not report disjoint ranges', () => {
    const rules = [
      rule('a', 'app01', 'db01', 'TCP', ['1400-1500']),
      rule('b', 'app01', 'db01', 'TCP', ['5000-5100']),
    ];
    expect(findOverlaps(rules)).toHaveLength(0);
  });

  it('reports ANY protocol as overlapping a specific protocol', () => {
    const rules = [
      rule('any', 'app01', 'db01', 'ANY', [1433]),
      rule('tcp', 'app01', 'db01', 'TCP', ['1400-1500']),
    ];
    expect(findOverlaps(rules)).toHaveLength(1);
  });

  it('leaves opposing actions to conflict detection rather than reporting an overlap', () => {
    const rules = [
      rule('a', 'app01', 'db01', 'TCP', ['1400-1500'], 'ALLOW'),
      rule('b', 'app01', 'db01', 'TCP', [1433], 'DENY'),
    ];
    expect(findOverlaps(rules)).toHaveLength(0);
    expect(findConflicts(rules)).toHaveLength(1);
  });
});

describe('ALLOW/DENY conflict detection', () => {
  it('flags identical traffic with opposing actions', () => {
    const rules = [
      rule('allow', 'app01', 'db01', 'TCP', [1433], 'ALLOW'),
      rule('deny', 'app01', 'db01', 'TCP', [1433], 'DENY'),
    ];
    const issues = findConflicts(rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('ALLOW_DENY_CONFLICT');
    expect(issues[0].explanation).toContain('Rule precedence must be checked');
  });

  it('does not decide which rule wins', () => {
    const rules = [
      rule('allow', 'app01', 'db01', 'TCP', [1433], 'ALLOW'),
      rule('deny', 'app01', 'db01', 'TCP', [1433], 'DENY'),
    ];
    const [issue] = findConflicts(rules);
    expect(issue.explanation).not.toMatch(/\bwins\b|\btakes precedence\b|\boverrides\b/i);
  });

  it('flags a partial port overlap with opposing actions', () => {
    const rules = [
      rule('allow', 'app01', 'db01', 'TCP', ['1400-1500'], 'ALLOW'),
      rule('deny', 'app01', 'db01', 'TCP', [1433], 'DENY'),
    ];
    expect(findConflicts(rules)).toHaveLength(1);
  });

  it('does not flag opposing actions on different ports', () => {
    const rules = [
      rule('allow', 'app01', 'db01', 'TCP', [1433], 'ALLOW'),
      rule('deny', 'app01', 'db01', 'TCP', [5432], 'DENY'),
    ];
    expect(findConflicts(rules)).toHaveLength(0);
  });

  it('does not flag opposing actions in opposite directions', () => {
    const rules = [
      rule('allow', 'app01', 'db01', 'TCP', [1433], 'ALLOW'),
      rule('deny', 'db01', 'app01', 'TCP', [1433], 'DENY'),
    ];
    expect(findConflicts(rules)).toHaveLength(0);
  });

  it('finds conflicts for a single candidate rule', () => {
    const existing = [rule('deny', 'app01', 'db01', 'TCP', ['1400-1500'], 'DENY')];
    const candidate = rule('new', 'app01', 'db01', 'TCP', [1433], 'ALLOW');
    expect(findConflictsOf(candidate, existing).map((match) => match.id)).toEqual(['deny']);
  });
});

describe('rule coverage', () => {
  it('reports a narrow rule as fully covered by a wider one', () => {
    const subject = rule('narrow', 'app01', 'db01', 'TCP', [1433]);
    const others = [rule('wide', 'app01', 'db01', 'TCP', ['1400-1500'])];
    const coverage = calculateRuleCoverage(subject, others);
    expect(coverage.fullyCovered).toBe(true);
    expect(coverage.singleCoveringRuleId).toBe('wide');
    expect(coverage.uniquePorts).toEqual([]);
  });

  it('recognises coverage provided collectively by several rules', () => {
    const subject = rule('broad', 'app01', 'db01', 'TCP', ['8000-8100']);
    const others = [
      rule('a', 'app01', 'db01', 'TCP', ['8000-8050']),
      rule('b', 'app01', 'db01', 'TCP', ['8051-8100']),
    ];
    const coverage = calculateRuleCoverage(subject, others);
    expect(coverage.fullyCovered).toBe(true);
    expect(coverage.coveringRuleIds.sort()).toEqual(['a', 'b']);
    expect(coverage.singleCoveringRuleId).toBeNull();
  });

  it('reports the ports only the subject provides', () => {
    const subject = rule('subject', 'app01', 'db01', 'TCP', ['8000-8100']);
    const others = [rule('partial', 'app01', 'db01', 'TCP', ['8000-8050'])];
    const coverage = calculateRuleCoverage(subject, others);
    expect(coverage.fullyCovered).toBe(false);
    expect(coverage.uniquePorts).toEqual([{ from: 8051, to: 8100 }]);
  });

  it('ignores rules for a different pair, protocol or action', () => {
    const subject = rule('subject', 'app01', 'db01', 'TCP', [1433]);
    const others = [
      rule('other-pair', 'app02', 'db01', 'TCP', [1433]),
      rule('other-proto', 'app01', 'db01', 'UDP', [1433]),
      rule('other-action', 'app01', 'db01', 'TCP', [1433], 'DENY'),
    ];
    expect(calculateRuleCoverage(subject, others).fullyCovered).toBe(false);
  });
});

describe('redundancy detection', () => {
  it('flags a rule covered by a strictly broader rule', () => {
    const rules = [
      rule('narrow', 'app01', 'db01', 'TCP', [1433]),
      rule('wide', 'app01', 'db01', 'TCP', ['1400-1500']),
    ];
    const issues = findRedundantRules(rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleIds[0]).toBe('narrow');
    expect(issues[0].explanation).toContain('may therefore no longer be necessary');
  });

  it('flags a TCP rule covered by an ANY-protocol rule on the same ports', () => {
    const rules = [
      rule('tcp', 'app01', 'db01', 'TCP', [1433]),
      rule('any', 'app01', 'db01', 'ANY', [1433]),
    ];
    expect(findRedundantRules(rules)).toHaveLength(1);
  });

  it('does not flag equal rules in both directions (they are duplicates, not redundancies)', () => {
    const rules = [
      rule('r1', 'app01', 'db01', 'TCP', [1433]),
      rule('r2', 'app01', 'db01', 'TCP', [1433]),
    ];
    expect(findRedundantRules(rules)).toHaveLength(0);
  });
});

describe('overly broad rules', () => {
  it('flags an ALLOW rule covering every port and protocol', () => {
    const rules = [rule('broad', 'mgmt01', 'db01', 'ANY', ['ANY'])];
    const issues = findOverlyBroadRules(rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('high');
  });

  it('does not flag a narrow ALLOW rule or any DENY rule', () => {
    expect(findOverlyBroadRules([rule('narrow', 'app01', 'db01', 'TCP', [1433])])).toHaveLength(0);
    expect(findOverlyBroadRules([rule('deny', 'a', 'b', 'ANY', ['ANY'], 'DENY')])).toHaveLength(0);
  });
});

describe('candidate rule check', () => {
  it('reports an exact duplicate verdict', () => {
    const existing = [rule('r1', 'app01', 'db01', 'TCP', [1433])];
    const check = checkCandidateRule(rule('new', 'app01', 'db01', 'TCP', [1433]), existing);
    expect(check.verdict).toBe('EXACT_DUPLICATE');
    expect(check.summary).toContain('identical rule already exists');
  });

  it('reports a fully covered verdict for a port range overlap', () => {
    const existing = [rule('wide', 'app01', 'db01', 'TCP', ['1400-1500'])];
    const check = checkCandidateRule(rule('new', 'app01', 'db01', 'TCP', [1433]), existing);
    expect(check.verdict).toBe('FULLY_COVERED');
  });

  it('reports a partial overlap verdict', () => {
    const existing = [rule('partial', 'app01', 'db01', 'TCP', ['8000-8050'])];
    const check = checkCandidateRule(rule('new', 'app01', 'db01', 'TCP', ['8000-8100']), existing);
    expect(check.verdict).toBe('PARTIAL_OVERLAP');
  });

  it('reports new access when nothing comparable exists', () => {
    const existing = [rule('other', 'app01', 'db01', 'TCP', [5432])];
    const check = checkCandidateRule(rule('new', 'app01', 'db01', 'TCP', [1433]), existing);
    expect(check.verdict).toBe('NEW_ACCESS');
  });
});
