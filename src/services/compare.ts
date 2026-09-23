import type {
  BreakageFinding,
  Connection,
  ConnectionDelta,
  PolicyComparison,
  PolicyGraph,
  PortDelta,
  Rule,
} from '@/types';
import { flowKey, serverName } from './graph';
import { formatPorts, subtractRanges } from './ports';
import { findAlternativePaths, pathsUsingConnection } from './paths';

/**
 * Compare two policy graphs and classify every connection as added, removed,
 * modified or unchanged.
 *
 * "Modified" is inferred where a rule id survives but its 5-tuple changed —
 * that is the case users care about (an edited port, a flipped action) and it
 * reads far better than an unrelated add plus remove.
 */
export function comparePolicies(before: PolicyGraph, after: PolicyGraph): PolicyComparison {
  const beforeByFlow = new Map<string, Connection>();
  const afterByFlow = new Map<string, Connection>();
  for (const connection of before.connections) beforeByFlow.set(connection.id, connection);
  for (const connection of after.connections) afterByFlow.set(connection.id, connection);

  const beforeByRule = new Map<string, Connection>();
  const afterByRule = new Map<string, Connection>();
  for (const connection of before.connections) beforeByRule.set(connection.ruleId, connection);
  for (const connection of after.connections) afterByRule.set(connection.ruleId, connection);

  const addedConnections: Connection[] = [];
  const removedConnections: Connection[] = [];
  const modifiedConnections: { before: Connection; after: Connection }[] = [];
  const unchangedConnectionIds: string[] = [];

  for (const [id, connection] of afterByFlow) {
    if (beforeByFlow.has(id)) {
      unchangedConnectionIds.push(id);
      continue;
    }
    const previous = beforeByRule.get(connection.ruleId);
    if (previous && flowKey(previous) !== flowKey(connection)) {
      modifiedConnections.push({ before: previous, after: connection });
    } else {
      addedConnections.push(connection);
    }
  }

  const modifiedBeforeIds = new Set(modifiedConnections.map((pair) => pair.before.id));
  for (const [id, connection] of beforeByFlow) {
    if (afterByFlow.has(id)) continue;
    if (modifiedBeforeIds.has(id)) continue;
    removedConnections.push(connection);
  }

  return { addedConnections, removedConnections, modifiedConnections, unchangedConnectionIds };
}

/** Render a comparison into user-facing deltas with plain-English descriptions. */
export function describeComparison(
  comparison: PolicyComparison,
  before: PolicyGraph,
  after: PolicyGraph,
): { added: ConnectionDelta[]; removed: ConnectionDelta[]; modified: ConnectionDelta[] } {
  const added = comparison.addedConnections.map<ConnectionDelta>((connection) => ({
    connection,
    kind: 'ADDED',
    description: `${serverName(after, connection.source)} will be ${connection.action === 'ALLOW' ? 'permitted to connect to' : 'explicitly blocked from'} ${serverName(after, connection.destination)} on ${connection.protocol} ${formatPorts(connection.ports)}.`,
  }));

  const removed = comparison.removedConnections.map<ConnectionDelta>((connection) => ({
    connection,
    kind: 'REMOVED',
    description: `${serverName(before, connection.source)} will no longer have ${connection.action === 'ALLOW' ? 'a permitted' : 'an explicitly blocked'} ${connection.protocol} ${formatPorts(connection.ports)} connection to ${serverName(before, connection.destination)}.`,
  }));

  const modified = comparison.modifiedConnections.map<ConnectionDelta>((pair) => ({
    connection: pair.after,
    before: pair.before,
    kind: 'MODIFIED',
    description: `${serverName(after, pair.after.source)} → ${serverName(after, pair.after.destination)} changes from ${pair.before.protocol} ${formatPorts(pair.before.ports)} ${pair.before.action} to ${pair.after.protocol} ${formatPorts(pair.after.ports)} ${pair.after.action}.`,
  }));

  return { added, removed, modified };
}

/** Ports opened and closed per server pair, derived from the comparison. */
export function calculatePortDeltas(comparison: PolicyComparison): {
  opened: PortDelta[];
  closed: PortDelta[];
} {
  const opened: PortDelta[] = [];
  const closed: PortDelta[] = [];

  for (const connection of comparison.addedConnections) {
    if (connection.action !== 'ALLOW') continue;
    for (const port of connection.ports) {
      opened.push({
        serverId: connection.destination,
        peerId: connection.source,
        protocol: connection.protocol,
        port,
        direction: 'OPENED',
      });
    }
  }

  for (const connection of comparison.removedConnections) {
    if (connection.action !== 'ALLOW') continue;
    for (const port of connection.ports) {
      closed.push({
        serverId: connection.destination,
        peerId: connection.source,
        protocol: connection.protocol,
        port,
        direction: 'CLOSED',
      });
    }
  }

  for (const pair of comparison.modifiedConnections) {
    const wasAllow = pair.before.action === 'ALLOW';
    const isAllow = pair.after.action === 'ALLOW';
    const beforePorts = wasAllow ? pair.before.ports : [];
    const afterPorts = isAllow ? pair.after.ports : [];

    for (const port of subtractRanges(afterPorts, beforePorts)) {
      opened.push({
        serverId: pair.after.destination,
        peerId: pair.after.source,
        protocol: pair.after.protocol,
        port,
        direction: 'OPENED',
      });
    }
    for (const port of subtractRanges(beforePorts, afterPorts)) {
      closed.push({
        serverId: pair.before.destination,
        peerId: pair.before.source,
        protocol: pair.before.protocol,
        port,
        direction: 'CLOSED',
      });
    }
  }

  return { opened, closed };
}

/**
 * Detect connectivity that a change would remove, and check whether equivalent
 * access would remain.
 *
 * Wording is deliberately conditional throughout. The dataset describes network
 * policy, not application dependencies, so the honest statement is that a
 * permitted connection disappears — never that an application will fail.
 */
export function detectPotentialBreakage(
  beforeGraph: PolicyGraph,
  afterRules: Rule[],
  comparison: PolicyComparison,
  options: { maxHops?: number } = {},
): BreakageFinding[] {
  const { maxHops = 3 } = options;
  const findings: BreakageFinding[] = [];

  const losses: { connection: Connection; lostPorts: Connection['ports'] }[] = [];

  for (const connection of comparison.removedConnections) {
    if (connection.action !== 'ALLOW') continue;
    losses.push({ connection, lostPorts: connection.ports });
  }

  for (const pair of comparison.modifiedConnections) {
    if (pair.before.action !== 'ALLOW') continue;
    const remainingPorts = pair.after.action === 'ALLOW' ? pair.after.ports : [];
    const samePair =
      pair.before.source === pair.after.source && pair.before.destination === pair.after.destination;
    const sameProtocol = pair.before.protocol === pair.after.protocol;
    const lost = samePair && sameProtocol ? subtractRanges(pair.before.ports, remainingPorts) : pair.before.ports;
    if (lost.length > 0) losses.push({ connection: pair.before, lostPorts: lost });
  }

  for (const { connection, lostPorts } of losses) {
    const alternative = findAlternativePaths(
      beforeGraph,
      {
        source: connection.source,
        destination: connection.destination,
        protocol: connection.protocol,
        ports: lostPorts,
      },
      afterRules,
      { maxHops },
    );

    const dependentPaths = pathsUsingConnection(beforeGraph, connection, { maxHops });
    const sourceLabel = serverName(beforeGraph, connection.source);
    const destinationLabel = serverName(beforeGraph, connection.destination);

    const parts: string[] = [
      `${sourceLabel} would no longer have a permitted ${connection.protocol} ${formatPorts(lostPorts)} connection to ${destinationLabel}.`,
      alternative.summary,
    ];
    if (dependentPaths.length > 0) {
      parts.push(
        `This connection is also used within ${dependentPaths.length} existing network path${dependentPaths.length === 1 ? '' : 's'}.`,
      );
    }

    findings.push({
      connectionId: connection.id,
      source: connection.source,
      destination: connection.destination,
      protocol: connection.protocol,
      ports: lostPorts,
      summary: parts.join(' '),
      alternativeRuleIds: alternative.equivalentRuleIds,
      alternativeAvailable: alternative.fullyEquivalent,
      dependentPaths,
    });
  }

  return findings;
}
