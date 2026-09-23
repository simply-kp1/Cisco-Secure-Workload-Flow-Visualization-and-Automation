import type { Dataset, ImportResult, ValidationIssue } from '@/types';
import { selectImporter, getImporter } from './importers/registry';
import type { ImportContext } from './importers/types';
import { validateDataset } from './validateDataset';

export interface ParseImportOptions extends ImportContext {
  /** Force a specific importer instead of auto-detecting. */
  importerId?: string;
}

/**
 * Entry point for bringing an external document into the application.
 *
 * Accepts either a raw JSON string or an already-parsed value, picks an
 * importer, and returns the canonical dataset alongside a full validation
 * report. It never throws: malformed input produces a result with
 * `dataset: null` and an explanatory error.
 */
export function parseImport(input: string | unknown, options: ParseImportOptions = {}): ImportResult {
  let document: unknown;

  if (typeof input === 'string') {
    try {
      document = JSON.parse(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure({
        code: 'MALFORMED_DOCUMENT',
        severity: 'error',
        entity: 'document',
        message: 'The file is not valid JSON and could not be read.',
        detail: message,
      });
    }
  } else {
    document = input;
  }

  const importer = options.importerId ? getImporter(options.importerId) : selectImporter(document);

  if (!importer) {
    return failure({
      code: 'MALFORMED_DOCUMENT',
      severity: 'error',
      entity: 'document',
      message: 'No importer recognised the structure of this file.',
      detail:
        'The file should contain a list of servers and a list of rules. Each rule needs a source (consumer) and destination (provider).',
    });
  }

  let output;
  try {
    output = importer.parse(document, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure({
      code: 'MALFORMED_DOCUMENT',
      severity: 'error',
      entity: 'document',
      message: `The "${importer.label}" importer could not read this file.`,
      detail: message,
    });
  }

  const validation = validateDataset(output.dataset, output.issues);
  const usable = output.dataset.servers.length > 0 || output.dataset.rules.length > 0;

  return { dataset: usable ? output.dataset : null, validation };
}

function failure(issue: ValidationIssue): ImportResult {
  return {
    dataset: null,
    validation: {
      ok: false,
      serversDetected: 0,
      rulesDetected: 0,
      syntheticServers: 0,
      issues: [issue],
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
    },
  };
}

/** Re-export a dataset back to the canonical JSON shape. */
export function serialiseDataset(dataset: Dataset): string {
  return JSON.stringify(
    {
      export_metadata: {
        product: dataset.metadata.product ?? 'Secure Workload Policy Visualiser',
        export_type: 'visualiser_working_state',
        server_count: dataset.servers.filter((server) => !server.synthetic).length,
        rule_count: dataset.rules.length,
        exported_at: new Date().toISOString(),
        notes: dataset.metadata.notes,
      },
      servers: dataset.servers
        .filter((server) => !server.synthetic)
        .map((server) => ({
          id: server.id,
          name: server.name,
          ip: server.ip,
          role: server.rawRole,
          environment: server.rawEnvironment,
          os: server.os,
          zone: server.zone,
        })),
      rules: dataset.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        consumer: rule.source,
        provider: rule.destination,
        protocol: rule.protocol,
        ports: rule.ports.map((range) => (range.from === range.to ? range.from : `${range.from}-${range.to}`)),
        action: rule.action,
        description: rule.description,
        ...(rule.disabled ? { disabled: true } : {}),
      })),
    },
    null,
    2,
  );
}
