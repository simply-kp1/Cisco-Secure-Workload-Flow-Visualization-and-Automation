import type { Dataset, ValidationIssue, ValidationReport } from '@/types';

/**
 * Validate a canonical dataset.
 *
 * Importer-level issues are passed in and merged, so a caller gets a single
 * report covering both "this file was odd" and "this policy set is odd".
 * Validation never mutates or rejects the dataset — the application is expected
 * to work with imperfect data and simply explain what it found.
 */
export function validateDataset(dataset: Dataset, importerIssues: ValidationIssue[] = []): ValidationReport {
  const issues: ValidationIssue[] = [...importerIssues];

  /* Duplicate IP addresses across distinct servers. */
  const ipOwners = new Map<string, string[]>();
  for (const server of dataset.servers) {
    if (!server.ip || server.synthetic) continue;
    const owners = ipOwners.get(server.ip) ?? [];
    owners.push(server.name);
    ipOwners.set(server.ip, owners);
  }
  for (const [ip, owners] of ipOwners) {
    if (owners.length > 1) {
      issues.push({
        code: 'DUPLICATE_IP',
        severity: 'warning',
        entity: 'server',
        entityId: ip,
        field: 'ip',
        message: `IP address ${ip} is assigned to ${owners.length} servers: ${owners.join(', ')}.`,
        detail:
          'Rules that reference this address by IP cannot be attributed to a single server with confidence.',
      });
    }
  }

  const serverIds = new Set(dataset.servers.map((server) => server.id));
  for (const rule of dataset.rules) {
    if (!serverIds.has(rule.source)) {
      issues.push({
        code: 'UNKNOWN_SOURCE',
        severity: 'error',
        entity: 'rule',
        entityId: rule.id,
        field: 'source',
        message: `Rule "${rule.name}" points at a source "${rule.source}" that does not exist in the dataset.`,
      });
    }
    if (!serverIds.has(rule.destination)) {
      issues.push({
        code: 'UNKNOWN_DESTINATION',
        severity: 'error',
        entity: 'rule',
        entityId: rule.id,
        field: 'destination',
        message: `Rule "${rule.name}" points at a destination "${rule.destination}" that does not exist in the dataset.`,
      });
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;

  return {
    ok: errorCount === 0,
    serversDetected: dataset.servers.filter((server) => !server.synthetic).length,
    rulesDetected: dataset.rules.length,
    syntheticServers: dataset.servers.filter((server) => server.synthetic).length,
    issues,
    errorCount,
    warningCount,
    infoCount,
  };
}
