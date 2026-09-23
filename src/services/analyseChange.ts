import type {
  AffectedServer,
  ChangeAnalysis,
  ChangeSet,
  ChangeType,
  Dataset,
  NetworkPath,
  PolicyGraph,
  RiskAssessment,
  RiskFactor,
  Rule,
} from '@/types';
import { buildGraph } from './graph';
import { findConflicts } from './conflicts';
import {
  effectivePorts,
  findDuplicates,
  findOverlaps,
  findRedundantRules,
} from './duplicates';
import { calculateAffectedServers, calculateBlastRadius } from './impact';
import { calculatePortDeltas, comparePolicies, describeComparison, detectPotentialBreakage } from './compare';
import { findAllowedPaths } from './paths';
import {
  formatPorts,
  isAnyPort,
  rangesIncludeDatabasePort,
  rangesIncludeSensitivePort,
  serviceLabel,
} from './ports';

/** Apply a change set to a rule list, returning a new array. Never mutates. */
export function applyChange(rules: Rule[], change: Pick<ChangeSet, 'type' | 'originalRule' | 'proposedRule'>): Rule[] {
  switch (change.type) {
    case 'ADD_RULE':
      return change.proposedRule ? [...rules, change.proposedRule] : rules;
    case 'MODIFY_RULE':
      if (!change.proposedRule || !change.originalRule) return rules;
      return rules.map((rule) => (rule.id === change.originalRule!.id ? change.proposedRule! : rule));
    case 'DELETE_RULE':
      if (!change.originalRule) return rules;
      return rules.filter((rule) => rule.id !== change.originalRule!.id);
    case 'DISABLE_RULE':
      if (!change.originalRule) return rules;
      return rules.map((rule) => (rule.id === change.originalRule!.id ? { ...rule, disabled: true } : rule));
    case 'ENABLE_RULE':
      if (!change.originalRule) return rules;
      return rules.map((rule) => (rule.id === change.originalRule!.id ? { ...rule, disabled: false } : rule));
    default:
      return rules;
  }
}

export interface AnalyseChangeOptions {
  maxHops?: number;
  blastRadiusDepth?: number;
  changeId?: string;
  now?: () => Date;
}

/**
 * Full before/after analysis of a proposed change.
 *
 * The original dataset is never mutated: a proposed rule list is derived, a
 * second graph is built from it, and the two graphs are compared.
 */
export function analyseChange(
  dataset: Dataset,
  change: Pick<ChangeSet, 'type' | 'originalRule' | 'proposedRule'>,
  options: AnalyseChangeOptions = {},
): ChangeAnalysis {
  const { maxHops = 3, blastRadiusDepth = 3, now = () => new Date() } = options;
  const changeId = options.changeId ?? `chg-${now().getTime().toString(36)}`;

  const beforeGraph = buildGraph(dataset);
  const proposedRules = applyChange(dataset.rules, change);
  const afterGraph = buildGraph({ ...dataset, rules: proposedRules });

  const comparison = comparePolicies(beforeGraph, afterGraph);
  const deltas = describeComparison(comparison, beforeGraph, afterGraph);
  const { opened, closed } = calculatePortDeltas(comparison);
  const breakage = detectPotentialBreakage(beforeGraph, proposedRules, comparison, { maxHops });

  /* --------------- affected servers & blast radius --------------- */
  const direct = calculateAffectedServers(beforeGraph, change.originalRule, change.proposedRule);

  // The blast radius is only meaningful when connectivity actually changes.
  // A no-op edit (renaming a rule, re-saving it unchanged) touches the two
  // named servers and nothing else — propagating outward there would report
  // dozens of "affected" servers for a change that alters nothing.
  const altersConnectivity =
    comparison.addedConnections.length > 0 ||
    comparison.removedConnections.length > 0 ||
    comparison.modifiedConnections.length > 0;

  const affectedServers = altersConnectivity
    ? calculateBlastRadius(beforeGraph, direct, {
        maxDepth: blastRadiusDepth,
        allowedOnly: true,
      })
    : direct.filter((affected) => beforeGraph.nodes.has(affected.serverId));

  /* --------------- paths created / removed --------------- */
  const pathsCreated: NetworkPath[] = [];
  const pathsRemoved: NetworkPath[] = [];
  const seenPairs = new Set<string>();

  const pairsToCheck = [
    ...comparison.addedConnections.map((c) => [c.source, c.destination] as const),
    ...comparison.removedConnections.map((c) => [c.source, c.destination] as const),
    ...comparison.modifiedConnections.map((p) => [p.before.source, p.before.destination] as const),
  ];

  for (const [source, destination] of pairsToCheck) {
    const key = `${source}|${destination}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);

    const beforePaths = findAllowedPaths(beforeGraph, source, destination, { maxHops, maxResults: 20 });
    const afterPaths = findAllowedPaths(afterGraph, source, destination, { maxHops, maxResults: 20 });

    const beforeKeys = new Set(beforePaths.map(pathKey));
    const afterKeys = new Set(afterPaths.map(pathKey));

    for (const path of afterPaths) if (!beforeKeys.has(pathKey(path))) pathsCreated.push(path);
    for (const path of beforePaths) if (!afterKeys.has(pathKey(path))) pathsRemoved.push(path);
  }

  /* --------------- rule hygiene against the proposed state --------------- */
  const candidate = change.proposedRule;
  const otherRules = proposedRules.filter((rule) => rule.id !== candidate?.id);

  const duplicates = candidate
    ? findDuplicates(proposedRules, afterGraph).filter((issue) => issue.ruleIds.includes(candidate.id))
    : [];
  const overlaps = candidate
    ? findOverlaps(proposedRules, afterGraph).filter((issue) => issue.ruleIds.includes(candidate.id))
    : [];
  const conflicts = candidate
    ? findConflicts(proposedRules, afterGraph).filter((issue) => issue.ruleIds.includes(candidate.id))
    : [];
  const redundancies = candidate
    ? findRedundantRules(proposedRules, afterGraph).filter((issue) => issue.ruleIds.includes(candidate.id))
    : [];

  /* --------------- security exposure --------------- */
  const exposure = calculateExposure(afterGraph, comparison, candidate, dataset);

  /* --------------- risk --------------- */
  const risk = assessRisk({
    affectedServers,
    connectionsAdded: deltas.added.length,
    connectionsRemoved: deltas.removed.length,
    connectionsModified: deltas.modified.length,
    pathsRemoved,
    breakage,
    conflicts: conflicts.length,
    duplicates: duplicates.length,
    exposure,
    change,
    dataset,
  });

  const recommendations = buildRecommendations({
    change,
    duplicates: duplicates.length,
    conflicts: conflicts.length,
    redundancies: redundancies.length,
    breakage,
    exposure,
    otherRules,
    candidate,
  });

  return {
    changeId,
    type: change.type,
    generatedAt: now().toISOString(),
    originalRule: change.originalRule,
    proposedRule: change.proposedRule,
    affectedServers,
    connectionsAdded: deltas.added,
    connectionsRemoved: deltas.removed,
    connectionsModified: deltas.modified,
    portsOpened: opened,
    portsClosed: closed,
    pathsCreated,
    pathsRemoved,
    breakage,
    duplicates,
    overlaps,
    conflicts,
    redundancies,
    exposure,
    risk,
    recommendations,
  };
}

function pathKey(path: NetworkPath): string {
  return path.hops.map((hop) => `${hop.from}>${hop.to}:${hop.ruleId}`).join('|');
}

/* ------------------------------------------------------------------ *
 * Security exposure
 * ------------------------------------------------------------------ */

function calculateExposure(
  graph: PolicyGraph,
  comparison: ReturnType<typeof comparePolicies>,
  candidate: Rule | null,
  dataset: Dataset,
): string[] {
  const notes: string[] = [];
  const newlyPermitted = [
    ...comparison.addedConnections.filter((connection) => connection.action === 'ALLOW'),
    ...comparison.modifiedConnections
      .filter((pair) => pair.after.action === 'ALLOW')
      .map((pair) => pair.after),
  ];

  for (const connection of newlyPermitted) {
    const source = graph.serversById.get(connection.source);
    const destination = graph.serversById.get(connection.destination);
    if (!source || !destination) continue;

    const sensitive = rangesIncludeSensitivePort(connection.ports);
    if (sensitive.length > 0) {
      const names = sensitive.map((port) => `${port}${serviceLabel(port) ? ` (${serviceLabel(port)})` : ''}`);
      notes.push(
        `Administrative access is being opened: ${source.name} would be permitted to reach ${destination.name} on ${names.join(', ')}.`,
      );
    }

    const databasePorts = rangesIncludeDatabasePort(connection.ports);
    if (databasePorts.length > 0 && destination.role === 'DB') {
      notes.push(
        `A database port is being opened: ${source.name} would be permitted to reach the database ${destination.name} on ${databasePorts.map((port) => `${port} (${serviceLabel(port)})`).join(', ')}.`,
      );
    }

    if (isAnyPort(connection.ports)) {
      notes.push(
        `Unrestricted port access: ${source.name} would be permitted to reach ${destination.name} on every port.`,
      );
    }
    if (connection.protocol === 'ANY') {
      notes.push(
        `Unrestricted protocol: the connection from ${source.name} to ${destination.name} applies to every protocol.`,
      );
    }

    if (
      source.environment !== 'UNKNOWN' &&
      destination.environment !== 'UNKNOWN' &&
      source.environment !== destination.environment
    ) {
      notes.push(
        `This change crosses environments: ${source.name} is ${source.environment} and ${destination.name} is ${destination.environment}.`,
      );
    }

    if (source.zone && destination.zone && source.zone !== destination.zone) {
      notes.push(
        `This change crosses zones: ${source.name} is in ${source.zone} and ${destination.name} is in ${destination.zone}.`,
      );
    }
  }

  if (candidate && candidate.action === 'ALLOW') {
    const destination = dataset.servers.find((server) => server.id === candidate.destination);
    if (destination?.synthetic) {
      notes.push(
        `The destination "${destination.name}" is not present in the server inventory, so the target of this permission cannot be verified from this dataset.`,
      );
    }
  }

  return [...new Set(notes)];
}

/* ------------------------------------------------------------------ *
 * Deterministic risk model
 *
 * Every point is attributable to a named factor, and the raw counts are
 * returned alongside the rating so the label never has to be taken on trust.
 * ------------------------------------------------------------------ */

interface RiskInput {
  affectedServers: AffectedServer[];
  connectionsAdded: number;
  connectionsRemoved: number;
  connectionsModified: number;
  pathsRemoved: NetworkPath[];
  breakage: ChangeAnalysis['breakage'];
  conflicts: number;
  duplicates: number;
  exposure: string[];
  change: Pick<ChangeSet, 'type' | 'originalRule' | 'proposedRule'>;
  dataset: Dataset;
}

export const RISK_THRESHOLDS = { MEDIUM: 3, HIGH: 7, CRITICAL: 13 } as const;

export function assessRisk(input: RiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];
  const directCount = input.affectedServers.filter((server) => server.level === 'DIRECT').length;
  const totalAffected = input.affectedServers.length;

  const add = (label: string, points: number, detail: string): void => {
    if (points > 0) factors.push({ label, points, detail });
  };

  /* Breadth of impact. Only counted when connectivity actually changes, so a
   * no-op change does not inherit a score from a densely connected neighbour. */
  const alters =
    input.connectionsAdded > 0 || input.connectionsRemoved > 0 || input.connectionsModified > 0;
  if (!alters) {
    // fall through with no breadth points
  } else if (totalAffected >= 20) {
    add(`${totalAffected} servers within the blast radius`, 3, 'Twenty or more servers are reachable from the servers named in this change.');
  } else if (totalAffected >= 8) {
    add(`${totalAffected} servers within the blast radius`, 2, 'Eight or more servers are reachable from the servers named in this change.');
  } else if (totalAffected >= 3) {
    add(`${totalAffected} servers within the blast radius`, 1, 'A small number of servers are reachable from the servers named in this change.');
  }

  /* Connectivity removed — the most consequential category. */
  const permittedRemoved = input.breakage.length;
  if (permittedRemoved > 0) {
    add(
      `${permittedRemoved} permitted connection${permittedRemoved === 1 ? '' : 's'} removed`,
      Math.min(permittedRemoved * 2, 6),
      'Existing allowed connectivity disappears when this change is applied.',
    );
  }

  const withoutAlternative = input.breakage.filter((finding) => !finding.alternativeAvailable);
  if (withoutAlternative.length > 0) {
    add(
      `No alternative path detected for ${withoutAlternative.length} removed connection${withoutAlternative.length === 1 ? '' : 's'}`,
      Math.min(withoutAlternative.length * 2, 5),
      'No remaining rule provides equivalent access for this traffic.',
    );
  }

  const databaseLosses = input.breakage.filter((finding) => {
    const destination = input.dataset.servers.find((server) => server.id === finding.destination);
    return destination?.role === 'DB' || rangesIncludeDatabasePort(finding.ports).length > 0;
  });
  if (databaseLosses.length > 0) {
    add(
      `${databaseLosses.length} database connection${databaseLosses.length === 1 ? '' : 's'} potentially lost`,
      2,
      'A connection to a database server or on a database port is being removed.',
    );
  }

  if (input.pathsRemoved.length > 0) {
    add(
      `${input.pathsRemoved.length} existing permitted path${input.pathsRemoved.length === 1 ? '' : 's'} removed`,
      Math.min(input.pathsRemoved.length, 4),
      'Multi-hop routes that exist today would no longer be permitted end to end.',
    );
  }

  const dependentPathCount = input.breakage.reduce((total, finding) => total + finding.dependentPaths.length, 0);
  if (dependentPathCount > 0) {
    add(
      `Removed connectivity is used within ${dependentPathCount} existing network path${dependentPathCount === 1 ? '' : 's'}`,
      Math.min(dependentPathCount, 3),
      'Other routes traverse the connection being removed.',
    );
  }

  /* Production weighting. Only applied when connectivity actually changes —
   * a change that alters nothing should not be weighted up for naming a
   * production server. */
  const changesConnectivity =
    input.connectionsAdded > 0 || input.connectionsRemoved > 0 || input.connectionsModified > 0;
  const prodAffected = changesConnectivity
    ? input.affectedServers.filter((affected) => {
        const server = input.dataset.servers.find((candidate) => candidate.id === affected.serverId);
        return server?.environment === 'PROD' && affected.level === 'DIRECT';
      }).length
    : 0;
  if (prodAffected > 0) {
    add(
      `${prodAffected} production server${prodAffected === 1 ? '' : 's'} directly affected`,
      2,
      'The rule names servers in the PROD environment.',
    );
  }

  /* Exposure introduced. */
  if (input.exposure.length > 0) {
    add(
      `${input.exposure.length} security exposure note${input.exposure.length === 1 ? '' : 's'}`,
      Math.min(input.exposure.length, 4),
      'The change opens administrative, database, cross-environment or unrestricted access.',
    );
  }

  /* Policy hygiene. */
  if (input.conflicts > 0) {
    add(
      `${input.conflicts} ALLOW/DENY conflict${input.conflicts === 1 ? '' : 's'} introduced`,
      3,
      'Another rule targets the same traffic with the opposite action, so the effective behaviour depends on rule precedence.',
    );
  }
  if (input.duplicates > 0) {
    add(
      `${input.duplicates} duplicate rule${input.duplicates === 1 ? '' : 's'}`,
      1,
      'An identical rule already exists, so this change may add no new access.',
    );
  }

  const score = factors.reduce((total, factor) => total + factor.points, 0);
  const rating: RiskAssessment['rating'] =
    score >= RISK_THRESHOLDS.CRITICAL
      ? 'CRITICAL'
      : score >= RISK_THRESHOLDS.HIGH
        ? 'HIGH'
        : score >= RISK_THRESHOLDS.MEDIUM
          ? 'MEDIUM'
          : 'LOW';

  if (factors.length === 0) {
    factors.push({
      label: 'No impact factors detected',
      points: 0,
      detail: 'This change removes no existing connectivity and opens no sensitive access.',
    });
  }

  return {
    rating,
    score,
    factors,
    facts: {
      directlyAffectedServers: directCount,
      totalAffectedServers: totalAffected,
      connectionsAdded: input.connectionsAdded,
      connectionsRemoved: input.connectionsRemoved,
      connectionsModified: input.connectionsModified,
      permittedConnectionsRemoved: permittedRemoved,
      removalsWithoutAlternative: withoutAlternative.length,
      pathsRemoved: input.pathsRemoved.length,
      dependentPaths: dependentPathCount,
      conflicts: input.conflicts,
      duplicates: input.duplicates,
      exposureNotes: input.exposure.length,
      productionServersDirectlyAffected: prodAffected,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Recommendations
 * ------------------------------------------------------------------ */

function buildRecommendations(input: {
  change: Pick<ChangeSet, 'type' | 'originalRule' | 'proposedRule'>;
  duplicates: number;
  conflicts: number;
  redundancies: number;
  breakage: ChangeAnalysis['breakage'];
  exposure: string[];
  otherRules: Rule[];
  candidate: Rule | null;
}): string[] {
  const notes: string[] = [];

  if (input.duplicates > 0) {
    notes.push(
      'An identical rule already exists. Consider whether this change is needed at all, or whether the existing rule should be edited instead of a second one added.',
    );
  }
  if (input.conflicts > 0) {
    notes.push(
      'This change creates traffic that is targeted by both an ALLOW and a DENY rule. Confirm the rule precedence in Secure Workload before applying it.',
    );
  }
  if (input.redundancies > 0) {
    notes.push(
      'A broader rule already covers this traffic. The narrower rule may be unnecessary, though it can still be useful as documentation of intent.',
    );
  }

  const noAlternative = input.breakage.filter((finding) => !finding.alternativeAvailable);
  if (noAlternative.length > 0) {
    notes.push(
      `No alternative network connection was detected for ${noAlternative.length} removed connection${noAlternative.length === 1 ? '' : 's'}. Confirm with the application owners whether this traffic is still required before applying the change.`,
    );
  }
  const withAlternative = input.breakage.filter((finding) => finding.alternativeAvailable);
  if (withAlternative.length > 0) {
    notes.push(
      `${withAlternative.length} removed connection${withAlternative.length === 1 ? '' : 's'} remain${withAlternative.length === 1 ? 's' : ''} available through another rule, so the effect on connectivity may be limited.`,
    );
  }

  if (input.exposure.length > 0) {
    notes.push(
      'This change opens access that is conventionally treated as sensitive. Consider narrowing the ports or restricting the source before applying it.',
    );
  }

  if (input.candidate && isAnyPort(effectivePorts(input.candidate)) && input.candidate.action === 'ALLOW') {
    notes.push(
      `Consider replacing the "any port" permission with the specific ports the application needs. The rule currently covers ${formatPorts(effectivePorts(input.candidate))}.`,
    );
  }

  if (notes.length === 0) {
    notes.push(
      'No duplicates, conflicts or connectivity losses were detected for this change. The analysis covers network policy only — application-level dependencies are not described in this dataset.',
    );
  }

  return notes;
}

/* ------------------------------------------------------------------ *
 * Change set helpers
 * ------------------------------------------------------------------ */

export function createChangeSet(
  type: ChangeType,
  originalRule: Rule | null,
  proposedRule: Rule | null,
  label?: string,
): ChangeSet {
  const changeId = `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    changeId,
    type,
    createdAt: new Date().toISOString(),
    label: label ?? defaultChangeLabel(type, originalRule, proposedRule),
    originalRule,
    proposedRule,
    analysis: null,
  };
}

export function defaultChangeLabel(
  type: ChangeType,
  originalRule: Rule | null,
  proposedRule: Rule | null,
): string {
  const name = proposedRule?.name ?? originalRule?.name ?? 'rule';
  switch (type) {
    case 'ADD_RULE':
      return `Add rule "${name}"`;
    case 'MODIFY_RULE':
      return `Modify rule "${name}"`;
    case 'DELETE_RULE':
      return `Delete rule "${name}"`;
    case 'DISABLE_RULE':
      return `Disable rule "${name}"`;
    case 'ENABLE_RULE':
      return `Enable rule "${name}"`;
    default:
      return `Change "${name}"`;
  }
}
