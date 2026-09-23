import type {
  Dataset,
  Environment,
  Rule,
  RuleAction,
  Server,
  ServerRole,
  ValidationIssue,
} from '@/types';
import { normaliseProtocol, parsePorts } from '@/services/ports';
import type { DatasetImporter, ImportContext, ImporterOutput } from './types';

/* ------------------------------------------------------------------ *
 * Field aliases
 *
 * The sample export uses `consumer` / `provider`; genuine Cisco Secure Workload
 * exports and other vendors use different spellings. Rather than hard-coding
 * one, each canonical field lists the source keys it accepts, in priority
 * order. Extending support for a near-neighbour format is usually just adding
 * an alias here.
 * ------------------------------------------------------------------ */

const SERVER_COLLECTION_KEYS = ['servers', 'workloads', 'hosts', 'inventory', 'nodes', 'assets'];
const RULE_COLLECTION_KEYS = ['rules', 'policies', 'policy', 'flows', 'intents', 'acl'];

const FIELD_ALIASES = {
  serverId: ['id', 'server_id', 'serverId', 'uuid', 'host_id', 'hostId', 'workload_id'],
  serverName: ['name', 'hostname', 'host_name', 'server_name', 'serverName', 'label'],
  ip: ['ip', 'ip_address', 'ipAddress', 'address', 'primary_ip', 'ipv4'],
  role: ['role', 'tier', 'function', 'app_tier', 'category', 'server_role'],
  environment: ['environment', 'env', 'lifecycle', 'stage'],
  os: ['os', 'operating_system', 'operatingSystem', 'platform', 'os_name'],
  zone: ['zone', 'site', 'datacenter', 'data_centre', 'location', 'region', 'vrf'],
  ruleId: ['id', 'rule_id', 'ruleId', 'policy_id', 'uuid'],
  ruleName: ['name', 'rule_name', 'ruleName', 'title', 'label'],
  source: ['consumer', 'source', 'src', 'from', 'consumer_filter', 'sourceServer', 'source_server'],
  destination: [
    'provider',
    'destination',
    'dst',
    'to',
    'provider_filter',
    'destinationServer',
    'destination_server',
    'target',
  ],
  protocol: ['protocol', 'proto', 'ip_protocol', 'l4_proto'],
  ports: ['ports', 'port', 'port_ranges', 'portRanges', 'dst_ports', 'destination_ports', 'service'],
  action: ['action', 'verdict', 'decision', 'policy_action', 'effect'],
  description: ['description', 'comment', 'notes', 'remark', 'summary'],
  disabled: ['disabled', 'inactive', 'is_disabled', 'enabled'],
} as const;

type AliasKey = keyof typeof FIELD_ALIASES;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, key: AliasKey): unknown {
  for (const alias of FIELD_ALIASES[key]) {
    const value = record[alias];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** Which alias actually matched — used to invert `enabled` into `disabled`. */
function pickKey(record: Record<string, unknown>, key: AliasKey): string | undefined {
  for (const alias of FIELD_ALIASES[key]) {
    const value = record[alias];
    if (value !== undefined && value !== null && value !== '') return alias;
  }
  return undefined;
}

function findCollection(document: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = document[key];
    if (Array.isArray(value)) return value;
  }
  // Some exports nest the payload one level down, e.g. { data: { servers: [] } }.
  for (const nestedKey of ['data', 'result', 'results', 'payload', 'export']) {
    const nested = document[nestedKey];
    if (isRecord(nested)) {
      for (const key of keys) {
        const value = nested[key];
        if (Array.isArray(value)) return value;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Normalisers
 * ------------------------------------------------------------------ */

const ROLE_MAP: Record<string, ServerRole> = {
  WEB: 'WEB',
  WEBSERVER: 'WEB',
  FRONTEND: 'WEB',
  PRESENTATION: 'WEB',
  APP: 'APP',
  APPLICATION: 'APP',
  MIDDLEWARE: 'APP',
  DB: 'DB',
  DATABASE: 'DB',
  DATA: 'DB',
  API: 'API',
  SERVICE: 'API',
  GATEWAY: 'API',
  FILE: 'FILE',
  FILESERVER: 'FILE',
  STORAGE: 'FILE',
  NAS: 'FILE',
  MON: 'MONITORING',
  MONITOR: 'MONITORING',
  MONITORING: 'MONITORING',
  OBSERVABILITY: 'MONITORING',
  TELEMETRY: 'MONITORING',
  MGMT: 'MANAGEMENT',
  MANAGEMENT: 'MANAGEMENT',
  ADMIN: 'MANAGEMENT',
  JUMP: 'MANAGEMENT',
  BASTION: 'MANAGEMENT',
};

export function normaliseRole(input: unknown): { role: ServerRole; raw: string; known: boolean } {
  const raw = String(input ?? '').trim();
  const key = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const role = ROLE_MAP[key];
  return { role: role ?? 'UNKNOWN', raw: raw || 'UNKNOWN', known: Boolean(role) };
}

const ENV_MAP: Record<string, Environment> = {
  PROD: 'PROD',
  PRODUCTION: 'PROD',
  LIVE: 'PROD',
  UAT: 'UAT',
  STAGING: 'UAT',
  STAGE: 'UAT',
  PREPROD: 'UAT',
  QA: 'UAT',
  TEST: 'UAT',
  DEV: 'DEV',
  DEVELOPMENT: 'DEV',
  SANDBOX: 'DEV',
};

export function normaliseEnvironment(input: unknown): {
  environment: Environment;
  raw: string;
  known: boolean;
} {
  const raw = String(input ?? '').trim();
  const key = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const environment = ENV_MAP[key];
  return { environment: environment ?? 'UNKNOWN', raw: raw || 'UNKNOWN', known: Boolean(environment) };
}

const ALLOW_TOKENS = new Set(['ALLOW', 'PERMIT', 'ACCEPT', 'ALLOWED', 'TRUE', 'YES']);
const DENY_TOKENS = new Set(['DENY', 'DROP', 'BLOCK', 'REJECT', 'DENIED', 'FALSE', 'NO']);

export function normaliseAction(input: unknown): { action: RuleAction; known: boolean } {
  const raw = String(input ?? '').trim().toUpperCase();
  if (ALLOW_TOKENS.has(raw)) return { action: 'ALLOW', known: true };
  if (DENY_TOKENS.has(raw)) return { action: 'DENY', known: true };
  // Defaulting to DENY would silently invent a block; defaulting to ALLOW would
  // silently invent access. ALLOW is chosen because it keeps the connection
  // visible on the map, and the unknown action is always reported.
  return { action: 'ALLOW', known: false };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIp(value: string): boolean {
  const match = value.match(IPV4);
  if (match) return match.slice(1).every((octet) => Number(octet) <= 255);
  // Accept IPv6 loosely rather than flagging every non-IPv4 address.
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
}

/* ------------------------------------------------------------------ *
 * Importer
 * ------------------------------------------------------------------ */

export const genericImporter: DatasetImporter = {
  id: 'generic-json',
  label: 'Generic policy JSON',
  description:
    'Servers plus rules, with consumer/provider (or source/destination) references by id or name. Matches the supplied Secure Workload sample export.',

  detect(document: unknown): number {
    if (!isRecord(document)) return 0;
    const servers = findCollection(document, SERVER_COLLECTION_KEYS);
    const rules = findCollection(document, RULE_COLLECTION_KEYS);
    if (!servers && !rules) return 0;
    let score = 0.3;
    if (servers) score += 0.3;
    if (rules) score += 0.3;
    const first = rules?.find(isRecord);
    if (first && (pick(first, 'source') !== undefined || pick(first, 'destination') !== undefined)) {
      score += 0.1;
    }
    return Math.min(score, 1);
  },

  parse(document: unknown, context: ImportContext = {}): ImporterOutput {
    const now = context.now ?? (() => new Date());
    const issues: ValidationIssue[] = [];
    const servers: Server[] = [];
    const rules: Rule[] = [];

    if (!isRecord(document)) {
      issues.push({
        code: 'MALFORMED_DOCUMENT',
        severity: 'error',
        entity: 'document',
        message: 'The file does not contain a JSON object.',
        detail: 'Expected a JSON object with a "servers" list and a "rules" list.',
      });
      return { dataset: emptyDataset(now(), context.sourceName), issues };
    }

    const rawServers = findCollection(document, SERVER_COLLECTION_KEYS);
    const rawRules = findCollection(document, RULE_COLLECTION_KEYS);

    if (!rawServers) {
      issues.push({
        code: 'MISSING_SERVERS_COLLECTION',
        severity: 'error',
        entity: 'document',
        message: 'No server list was found in the file.',
        detail: `Looked for a list named one of: ${SERVER_COLLECTION_KEYS.join(', ')}.`,
      });
    }
    if (!rawRules) {
      issues.push({
        code: 'MISSING_RULES_COLLECTION',
        severity: 'error',
        entity: 'document',
        message: 'No rule list was found in the file.',
        detail: `Looked for a list named one of: ${RULE_COLLECTION_KEYS.join(', ')}.`,
      });
    }

    /* ---------------- servers ---------------- */
    const seenServerIds = new Set<string>();
    (rawServers ?? []).forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push({
          code: 'MALFORMED_DOCUMENT',
          severity: 'warning',
          entity: 'server',
          entityId: `#${index + 1}`,
          message: `Server entry ${index + 1} is not an object and was skipped.`,
        });
        return;
      }

      const rawName = pick(entry, 'serverName');
      const rawId = pick(entry, 'serverId');
      const name = String(rawName ?? rawId ?? `server-${index + 1}`).trim();
      let id = String(rawId ?? name).trim();

      if (rawId === undefined) {
        issues.push({
          code: 'MISSING_SERVER_FIELD',
          severity: 'warning',
          entity: 'server',
          entityId: id,
          field: 'id',
          message: `Server "${name}" has no id; its name is being used as the identifier.`,
        });
      }
      if (rawName === undefined) {
        issues.push({
          code: 'MISSING_SERVER_FIELD',
          severity: 'warning',
          entity: 'server',
          entityId: id,
          field: 'name',
          message: `Server "${id}" has no name; its id is being displayed instead.`,
        });
      }
      if (seenServerIds.has(id)) {
        const deduped = `${id}__dup${index}`;
        issues.push({
          code: 'DUPLICATE_SERVER_ID',
          severity: 'error',
          entity: 'server',
          entityId: id,
          message: `Duplicate server id "${id}".`,
          detail: `Two or more servers share this id. The later entry was renamed to "${deduped}" so both remain visible, but rules referencing "${id}" will resolve to the first entry only.`,
        });
        id = deduped;
      }
      seenServerIds.add(id);

      const { role, raw: rawRole, known: roleKnown } = normaliseRole(pick(entry, 'role'));
      if (!roleKnown && pick(entry, 'role') !== undefined) {
        issues.push({
          code: 'UNKNOWN_ROLE',
          severity: 'info',
          entity: 'server',
          entityId: id,
          field: 'role',
          message: `Server "${name}" has an unrecognised role "${rawRole}".`,
          detail: 'It is shown with a neutral icon and can still be filtered by its original label.',
        });
      }

      const {
        environment,
        raw: rawEnvironment,
        known: envKnown,
      } = normaliseEnvironment(pick(entry, 'environment'));
      if (!envKnown && pick(entry, 'environment') !== undefined) {
        issues.push({
          code: 'UNKNOWN_ENVIRONMENT',
          severity: 'info',
          entity: 'server',
          entityId: id,
          field: 'environment',
          message: `Server "${name}" has an unrecognised environment "${rawEnvironment}".`,
        });
      }

      const ip = String(pick(entry, 'ip') ?? '').trim();
      if (ip && !isValidIp(ip)) {
        issues.push({
          code: 'INVALID_IP',
          severity: 'warning',
          entity: 'server',
          entityId: id,
          field: 'ip',
          message: `Server "${name}" has an IP address that could not be parsed: "${ip}".`,
        });
      }

      servers.push({
        id,
        name: name || id,
        ip,
        role,
        rawRole,
        environment,
        rawEnvironment,
        os: String(pick(entry, 'os') ?? '').trim(),
        zone: String(pick(entry, 'zone') ?? '').trim(),
        raw: entry,
      });
    });

    /* ---------------- reference index ---------------- */
    // Rules may reference a server by id, name, or IP address.
    const byId = new Map<string, Server>();
    const byName = new Map<string, Server>();
    const byIp = new Map<string, Server>();
    for (const server of servers) {
      byId.set(server.id.toLowerCase(), server);
      byName.set(server.name.toLowerCase(), server);
      if (server.ip) byIp.set(server.ip.toLowerCase(), server);
    }
    const resolve = (reference: string): Server | undefined => {
      const key = reference.trim().toLowerCase();
      return byId.get(key) ?? byName.get(key) ?? byIp.get(key);
    };

    const synthetic = new Map<string, Server>();
    const synthesise = (reference: string): Server => {
      const key = reference.trim();
      const existing = synthetic.get(key.toLowerCase());
      if (existing) return existing;
      const node: Server = {
        id: key,
        name: key,
        ip: isValidIp(key) ? key : '',
        role: 'UNKNOWN',
        rawRole: 'UNRESOLVED',
        environment: 'UNKNOWN',
        rawEnvironment: 'UNKNOWN',
        os: '',
        zone: '',
        synthetic: true,
      };
      synthetic.set(key.toLowerCase(), node);
      return node;
    };

    /* ---------------- rules ---------------- */
    const seenRuleIds = new Set<string>();
    (rawRules ?? []).forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push({
          code: 'MALFORMED_DOCUMENT',
          severity: 'warning',
          entity: 'rule',
          entityId: `#${index + 1}`,
          message: `Rule entry ${index + 1} is not an object and was skipped.`,
        });
        return;
      }

      let id = String(pick(entry, 'ruleId') ?? `rule-${index + 1}`).trim();
      const name = String(pick(entry, 'ruleName') ?? id).trim();

      if (seenRuleIds.has(id)) {
        const deduped = `${id}__dup${index}`;
        issues.push({
          code: 'DUPLICATE_RULE_ID',
          severity: 'error',
          entity: 'rule',
          entityId: id,
          message: `Duplicate rule id "${id}".`,
          detail: `The later rule was re-identified as "${deduped}" so that both rules remain in the analysis.`,
        });
        id = deduped;
      }
      seenRuleIds.add(id);

      const rawSource = pick(entry, 'source');
      const rawDestination = pick(entry, 'destination');

      if (rawSource === undefined) {
        issues.push({
          code: 'MISSING_RULE_FIELD',
          severity: 'error',
          entity: 'rule',
          entityId: id,
          field: 'source',
          message: `Rule "${name}" has no source (consumer). It cannot be placed on the map.`,
        });
      }
      if (rawDestination === undefined) {
        issues.push({
          code: 'MISSING_RULE_FIELD',
          severity: 'error',
          entity: 'rule',
          entityId: id,
          field: 'destination',
          message: `Rule "${name}" has no destination (provider). It cannot be placed on the map.`,
        });
      }

      const sourceRef = String(rawSource ?? '').trim();
      const destinationRef = String(rawDestination ?? '').trim();
      if (!sourceRef || !destinationRef) return;

      const sourceServer = resolve(sourceRef);
      const destinationServer = resolve(destinationRef);

      if (!sourceServer) {
        issues.push({
          code: 'UNKNOWN_SOURCE',
          severity: 'warning',
          entity: 'rule',
          entityId: id,
          field: 'source',
          message: `Rule "${name}" refers to a source "${sourceRef}" that is not in the server list.`,
          detail:
            'An unresolved endpoint has been added to the map so the rule stays visible. Confirm whether this is an external service or a missing inventory entry.',
        });
      }
      if (!destinationServer) {
        issues.push({
          code: 'UNKNOWN_DESTINATION',
          severity: 'warning',
          entity: 'rule',
          entityId: id,
          field: 'destination',
          message: `Rule "${name}" refers to a destination "${destinationRef}" that is not in the server list.`,
          detail:
            'An unresolved endpoint has been added to the map so the rule stays visible. Confirm whether this is an external service or a missing inventory entry.',
        });
      }

      const source = (sourceServer ?? synthesise(sourceRef)).id;
      const destination = (destinationServer ?? synthesise(destinationRef)).id;

      if (source === destination) {
        issues.push({
          code: 'SELF_REFERENCING_RULE',
          severity: 'info',
          entity: 'rule',
          entityId: id,
          message: `Rule "${name}" has the same source and destination ("${source}").`,
          detail: 'It is shown as a self-loop and is excluded from path calculations.',
        });
      }

      const rawPortsValue = pick(entry, 'ports');
      const parsedPorts = parsePorts(rawPortsValue);
      if (parsedPorts.invalid.length > 0) {
        issues.push({
          code: 'MALFORMED_PORT',
          severity: 'warning',
          entity: 'rule',
          entityId: id,
          field: 'ports',
          message: `Rule "${name}" has port values that could not be read: ${parsedPorts.invalid.join(', ')}.`,
          detail:
            'These values are ignored in connectivity analysis. Valid formats are a number, "1400-1500", or "ANY".',
        });
      }
      if (rawPortsValue === undefined) {
        issues.push({
          code: 'MISSING_RULE_FIELD',
          severity: 'info',
          entity: 'rule',
          entityId: id,
          field: 'ports',
          message: `Rule "${name}" declares no ports; it is treated as covering all ports.`,
        });
      }

      const { protocol, known: protocolKnown } = normaliseProtocol(pick(entry, 'protocol'));
      if (!protocolKnown) {
        issues.push({
          code: 'UNKNOWN_PROTOCOL',
          severity: 'warning',
          entity: 'rule',
          entityId: id,
          field: 'protocol',
          message: `Rule "${name}" uses an unrecognised protocol "${protocol}".`,
          detail:
            'It is kept verbatim and matched literally against other rules using the same protocol.',
        });
      }

      const rawAction = pick(entry, 'action');
      const { action, known: actionKnown } = normaliseAction(rawAction);
      if (!actionKnown) {
        issues.push({
          code: 'UNKNOWN_ACTION',
          severity: 'warning',
          entity: 'rule',
          entityId: id,
          field: 'action',
          message: `Rule "${name}" has an action of "${String(rawAction ?? '(none)')}" which is neither ALLOW nor DENY.`,
          detail: 'It is treated as ALLOW so the connection stays visible. Verify the source data.',
        });
      }

      const disabledKey = pickKey(entry, 'disabled');
      const disabledRaw = disabledKey ? entry[disabledKey] : undefined;
      const disabled =
        disabledKey === 'enabled'
          ? disabledRaw === false || disabledRaw === 'false'
          : disabledRaw === true || disabledRaw === 'true';

      const rawPortTokens: (string | number)[] = Array.isArray(rawPortsValue)
        ? (rawPortsValue as (string | number)[])
        : rawPortsValue === undefined
          ? []
          : [rawPortsValue as string | number];

      rules.push({
        id,
        name: name || id,
        source,
        destination,
        protocol,
        ports: parsedPorts.ranges,
        rawPorts: rawPortTokens,
        action,
        description: String(pick(entry, 'description') ?? '').trim(),
        disabled,
        raw: entry,
      });
    });

    const metadataSource = isRecord(document.export_metadata)
      ? (document.export_metadata as Record<string, unknown>)
      : isRecord(document.metadata)
        ? (document.metadata as Record<string, unknown>)
        : {};

    const dataset: Dataset = {
      metadata: {
        product: metadataSource.product ? String(metadataSource.product) : undefined,
        exportType: metadataSource.export_type
          ? String(metadataSource.export_type)
          : metadataSource.exportType
            ? String(metadataSource.exportType)
            : undefined,
        notes: metadataSource.notes ? String(metadataSource.notes) : undefined,
        importer: genericImporter.id,
        importedAt: now().toISOString(),
        sourceName: context.sourceName,
        declaredServerCount:
          typeof metadataSource.server_count === 'number' ? metadataSource.server_count : undefined,
        declaredRuleCount:
          typeof metadataSource.rule_count === 'number' ? metadataSource.rule_count : undefined,
      },
      servers: [...servers, ...synthetic.values()],
      rules,
    };

    return { dataset, issues };
  },
};

function emptyDataset(now: Date, sourceName?: string): Dataset {
  return {
    metadata: { importer: genericImporter.id, importedAt: now.toISOString(), sourceName },
    servers: [],
    rules: [],
  };
}
