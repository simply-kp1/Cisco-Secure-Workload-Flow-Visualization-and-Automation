import type { PolicyGraph, PolicyIssue, PortRange, Rule } from '@/types';
import {
  formatPorts,
  intersectRanges,
  isAnyPort,
  protocolCovers,
  protocolsOverlap,
  rangesCover,
  rangesEqual,
  subtractRanges,
} from './ports';
import { flowKey, serverName } from './graph';

/**
 * Rules are comparable only when they describe the same directed pair.
 * Reverse-direction rules are deliberately never treated as duplicates.
 */
function samePair(a: Rule, b: Rule): boolean {
  return a.source === b.source && a.destination === b.destination;
}

/** Effective port coverage: an empty declaration means "all ports". */
export function effectivePorts(rule: Rule): PortRange[] {
  return rule.ports.length === 0 ? [{ from: 0, to: 65535 }] : rule.ports;
}

function activeRules(rules: Rule[]): Rule[] {
  return rules.filter((rule) => !rule.disabled);
}

function label(graph: PolicyGraph | null, serverId: string): string {
  return graph ? serverName(graph, serverId) : serverId;
}

function describe(graph: PolicyGraph | null, rule: Rule): string {
  return `${label(graph, rule.source)} → ${label(graph, rule.destination)} ${rule.protocol} ${formatPorts(
    effectivePorts(rule),
  )} ${rule.action}`;
}

/* ------------------------------------------------------------------ *
 * Exact duplicates
 * ------------------------------------------------------------------ */

/**
 * Exact duplicates: identical source, destination, protocol, port set and
 * action. Rule id, name and description are ignored — they do not change what
 * traffic is permitted.
 */
export function findDuplicates(rules: Rule[], graph: PolicyGraph | null = null): PolicyIssue[] {
  const groups = new Map<string, Rule[]>();
  for (const rule of activeRules(rules)) {
    const key = flowKey({ ...rule, ports: effectivePorts(rule) });
    const group = groups.get(key);
    if (group) group.push(rule);
    else groups.set(key, [rule]);
  }

  const issues: PolicyIssue[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [first] = group;
    issues.push({
      id: `dup:${key}`,
      category: 'EXACT_DUPLICATE',
      severity: 'medium',
      title: `${group.length} identical rules for ${label(graph, first.source)} → ${label(graph, first.destination)}`,
      explanation: `${group.length} rules describe exactly the same traffic: ${describe(graph, first)}. Only one of them is needed. Removing the extras does not change what is permitted.`,
      ruleIds: group.map((rule) => rule.id),
      serverIds: [first.source, first.destination],
      evidence: group.map((rule) => `${rule.id} — "${rule.name}"`),
    });
  }
  return issues;
}

/**
 * Would adding `candidate` duplicate an existing rule exactly?
 * Used live by the Rule Builder.
 */
export function findExactDuplicatesOf(candidate: Rule, rules: Rule[]): Rule[] {
  const key = flowKey({ ...candidate, ports: effectivePorts(candidate) });
  return activeRules(rules).filter(
    (rule) => rule.id !== candidate.id && flowKey({ ...rule, ports: effectivePorts(rule) }) === key,
  );
}

/* ------------------------------------------------------------------ *
 * Overlaps
 * ------------------------------------------------------------------ */

export interface OverlapDetail {
  other: Rule;
  /** Ports covered by both rules. */
  sharedPorts: PortRange[];
  /** True when `other` covers every port and protocol of the subject rule. */
  otherCoversSubject: boolean;
  /** True when the subject covers every port and protocol of `other`. */
  subjectCoversOther: boolean;
  sameAction: boolean;
}

/**
 * Find rules whose traffic overlaps the subject rule: same directed pair,
 * compatible protocol, and at least one port in common.
 */
export function findOverlapsOf(subject: Rule, rules: Rule[]): OverlapDetail[] {
  const subjectPorts = effectivePorts(subject);
  const details: OverlapDetail[] = [];

  for (const other of activeRules(rules)) {
    if (other.id === subject.id) continue;
    if (!samePair(subject, other)) continue;
    if (!protocolsOverlap(subject.protocol, other.protocol)) continue;

    const otherPorts = effectivePorts(other);
    const shared = intersectRanges(subjectPorts, otherPorts);
    if (shared.length === 0) continue;

    details.push({
      other,
      sharedPorts: shared,
      otherCoversSubject:
        protocolCovers(other.protocol, subject.protocol) && rangesCover(otherPorts, subjectPorts),
      subjectCoversOther:
        protocolCovers(subject.protocol, other.protocol) && rangesCover(subjectPorts, otherPorts),
      sameAction: subject.action === other.action,
    });
  }
  return details;
}

/**
 * Dataset-wide overlap scan. Reports pairs that share ports without being
 * exact duplicates (those are reported separately and would otherwise appear
 * twice).
 */
export function findOverlaps(rules: Rule[], graph: PolicyGraph | null = null): PolicyIssue[] {
  const active = activeRules(rules);
  const issues: PolicyIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i += 1) {
    const a = active[i];
    const aPorts = effectivePorts(a);
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j];
      if (!samePair(a, b)) continue;
      if (!protocolsOverlap(a.protocol, b.protocol)) continue;

      const bPorts = effectivePorts(b);
      const shared = intersectRanges(aPorts, bPorts);
      if (shared.length === 0) continue;

      const identical =
        a.protocol === b.protocol && a.action === b.action && rangesEqual(aPorts, bPorts);
      if (identical) continue; // reported by findDuplicates

      const pairKey = [a.id, b.id].sort().join('~');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      // A different action on shared ports is a conflict, not a plain overlap.
      if (a.action !== b.action) continue;

      issues.push({
        id: `overlap:${pairKey}`,
        category: 'PORT_OVERLAP',
        severity: 'low',
        title: `Overlapping ${a.action} rules for ${label(graph, a.source)} → ${label(graph, a.destination)}`,
        explanation: `"${a.name}" and "${b.name}" both ${a.action === 'ALLOW' ? 'permit' : 'block'} ${formatPorts(shared)} between the same two servers. The overlap is not an error, but the two rules will need to be kept consistent with each other.`,
        ruleIds: [a.id, b.id],
        serverIds: [a.source, a.destination],
        evidence: [
          `${a.id}: ${describe(graph, a)}`,
          `${b.id}: ${describe(graph, b)}`,
          `Ports in common: ${formatPorts(shared)}`,
        ],
      });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * Coverage / redundancy
 * ------------------------------------------------------------------ */

export interface CoverageResult {
  /** True when other rules collectively permit everything this rule permits. */
  fullyCovered: boolean;
  /** Rules contributing to that coverage. */
  coveringRuleIds: string[];
  /** Ports this rule alone provides. */
  uniquePorts: PortRange[];
  /** A single rule that covers the subject entirely, when one exists. */
  singleCoveringRuleId: string | null;
}

/**
 * Determine how much of a rule's access is already provided by other rules.
 *
 * This is what makes "is this rule redundant?" and "is there an alternative
 * path?" answerable: coverage is computed as a set operation over ports, so a
 * combination of several narrow rules can collectively cover a broad one.
 */
export function calculateRuleCoverage(subject: Rule, rules: Rule[]): CoverageResult {
  const subjectPorts = effectivePorts(subject);
  let remaining = subjectPorts;
  const contributors: string[] = [];
  let singleCovering: string | null = null;

  for (const other of activeRules(rules)) {
    if (other.id === subject.id) continue;
    if (!samePair(subject, other)) continue;
    if (other.action !== subject.action) continue;
    // The other rule must carry at least the subject's protocol.
    if (!protocolCovers(other.protocol, subject.protocol)) continue;

    const otherPorts = effectivePorts(other);
    if (intersectRanges(remaining.length ? remaining : subjectPorts, otherPorts).length === 0) {
      // Still record a rule that fully covers the subject even if an earlier
      // contributor already consumed the remainder.
      if (rangesCover(otherPorts, subjectPorts) && !singleCovering) singleCovering = other.id;
      continue;
    }

    if (rangesCover(otherPorts, subjectPorts) && !singleCovering) singleCovering = other.id;
    contributors.push(other.id);
    remaining = subtractRanges(remaining, otherPorts);
    if (remaining.length === 0) break;
  }

  return {
    fullyCovered: remaining.length === 0,
    coveringRuleIds: contributors,
    uniquePorts: remaining,
    singleCoveringRuleId: singleCovering,
  };
}

/**
 * Rules that may no longer be needed because other rules already provide the
 * same access. Reported as "potentially redundant" — precedence and intent are
 * not visible in this data, so the finding is never stated as certain.
 */
export function findRedundantRules(rules: Rule[], graph: PolicyGraph | null = null): PolicyIssue[] {
  const active = activeRules(rules);
  const issues: PolicyIssue[] = [];
  // Track which rules have already been reported as the redundant half of a
  // pair, so an exact-duplicate pair does not report both directions.
  const reported = new Set<string>();

  for (const subject of active) {
    if (reported.has(subject.id)) continue;
    const subjectPorts = effectivePorts(subject);

    for (const other of active) {
      if (other.id === subject.id || reported.has(other.id)) continue;
      if (!samePair(subject, other)) continue;
      if (other.action !== subject.action) continue;
      if (!protocolCovers(other.protocol, subject.protocol)) continue;

      const otherPorts = effectivePorts(other);
      const strictlyBroader =
        rangesCover(otherPorts, subjectPorts) &&
        (!rangesEqual(otherPorts, subjectPorts) || other.protocol !== subject.protocol);
      if (!strictlyBroader) continue;

      reported.add(subject.id);
      issues.push({
        id: `redundant:${subject.id}:${other.id}`,
        category: 'REDUNDANT_RULE',
        severity: 'low',
        title: `"${subject.name}" may already be covered by "${other.name}"`,
        explanation: `"${other.name}" already ${subject.action === 'ALLOW' ? 'permits' : 'blocks'} ${subject.protocol} ${formatPorts(subjectPorts)} from ${label(graph, subject.source)} to ${label(graph, subject.destination)}, because it covers ${other.protocol} ${formatPorts(otherPorts)}. "${subject.name}" may therefore no longer be necessary. Check rule precedence and intent before removing it.`,
        ruleIds: [subject.id, other.id],
        serverIds: [subject.source, subject.destination],
        evidence: [
          `Narrower rule ${subject.id}: ${describe(graph, subject)}`,
          `Broader rule ${other.id}: ${describe(graph, other)}`,
        ],
      });
      break;
    }
  }
  return issues;
}

/**
 * Check a candidate rule against the existing policy the way the Rule Builder
 * needs it: exact duplicate, covered-by-combination, or overlapping.
 */
export interface DuplicateCheck {
  exactDuplicates: Rule[];
  coverage: CoverageResult;
  overlaps: OverlapDetail[];
  verdict: 'EXACT_DUPLICATE' | 'FULLY_COVERED' | 'PARTIAL_OVERLAP' | 'NEW_ACCESS';
  summary: string;
}

export function checkCandidateRule(
  candidate: Rule,
  rules: Rule[],
  graph: PolicyGraph | null = null,
): DuplicateCheck {
  const exactDuplicates = findExactDuplicatesOf(candidate, rules);
  const coverage = calculateRuleCoverage(candidate, rules);
  const overlaps = findOverlapsOf(candidate, rules);

  let verdict: DuplicateCheck['verdict'] = 'NEW_ACCESS';
  let summary = `This rule introduces ${candidate.action === 'ALLOW' ? 'access' : 'a block'} that no existing rule currently provides.`;

  if (exactDuplicates.length > 0) {
    verdict = 'EXACT_DUPLICATE';
    summary = `An identical rule already exists: "${exactDuplicates[0].name}" (${exactDuplicates[0].id}). Adding this rule would not change what is permitted.`;
  } else if (coverage.fullyCovered) {
    verdict = 'FULLY_COVERED';
    const names = coverage.coveringRuleIds
      .map((id) => rules.find((rule) => rule.id === id)?.name ?? id)
      .slice(0, 3);
    summary = `Every port this rule covers is already covered by ${coverage.coveringRuleIds.length} existing rule${coverage.coveringRuleIds.length === 1 ? '' : 's'} (${names.join(', ')}). This rule may be unnecessary.`;
  } else if (overlaps.length > 0) {
    verdict = 'PARTIAL_OVERLAP';
    summary = `This rule partially overlaps ${overlaps.length} existing rule${overlaps.length === 1 ? '' : 's'}. Ports only this rule would provide: ${formatPorts(coverage.uniquePorts)}.`;
  }

  return { exactDuplicates, coverage, overlaps, verdict, summary: summary + graphSuffix(graph, candidate) };
}

function graphSuffix(graph: PolicyGraph | null, rule: Rule): string {
  if (!graph) return '';
  const source = graph.serversById.get(rule.source);
  const destination = graph.serversById.get(rule.destination);
  if (!source || !destination) return '';
  return ` (${source.name} → ${destination.name})`;
}

/** Overly broad rules: ANY protocol, or a port span wide enough to be notable. */
export function findOverlyBroadRules(
  rules: Rule[],
  graph: PolicyGraph | null = null,
  portSpanThreshold = 1024,
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  for (const rule of activeRules(rules)) {
    if (rule.action !== 'ALLOW') continue;
    const ports = effectivePorts(rule);
    const any = isAnyPort(ports);
    const span = ports.reduce((total, range) => total + (range.to - range.from + 1), 0);
    const broadProtocol = rule.protocol === 'ANY';
    if (!any && span < portSpanThreshold && !broadProtocol) continue;

    const reasons: string[] = [];
    if (any) reasons.push('permits every port (0-65535)');
    else if (span >= portSpanThreshold) reasons.push(`permits ${span.toLocaleString()} ports`);
    if (broadProtocol) reasons.push('applies to every protocol');

    issues.push({
      id: `broad:${rule.id}`,
      category: 'OVERLY_BROAD_RULE',
      severity: any && broadProtocol ? 'high' : 'medium',
      title: `"${rule.name}" grants broad access`,
      explanation: `This rule ${reasons.join(' and ')} from ${label(graph, rule.source)} to ${label(graph, rule.destination)}. Broad permissions are harder to review and may grant more access than intended. Consider narrowing it to the ports actually required.`,
      ruleIds: [rule.id],
      serverIds: [rule.source, rule.destination],
      evidence: [describe(graph, rule), ...reasons.map((reason) => `Rule ${reason}`)],
    });
  }
  return issues;
}
