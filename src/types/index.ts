/**
 * Core domain model for the Secure Workload Policy Visualiser.
 *
 * Design notes
 * ------------
 * The canonical model is deliberately decoupled from any single vendor export.
 * Importers (see `services/importers`) translate a raw source document into a
 * `Dataset`, so Cisco Secure Workload, Palo Alto, ASA, AWS SG or Azure NSG
 * exports can be added later without touching the analysis engine or the UI.
 *
 * Connectivity is always modelled as the 5-tuple:
 *   SOURCE -> DESTINATION -> PROTOCOL -> PORT -> ACTION
 * Two flows are identical only when all five match. Direction matters.
 */

export type ServerRole =
  | 'WEB'
  | 'APP'
  | 'DB'
  | 'API'
  | 'FILE'
  | 'MONITORING'
  | 'MANAGEMENT'
  | 'UNKNOWN';

export type Environment = 'PROD' | 'UAT' | 'DEV' | 'UNKNOWN';

export type Protocol = string;

export type RuleAction = 'ALLOW' | 'DENY';

/** A contiguous, inclusive port range. ANY is modelled as 0-65535. */
export interface PortRange {
  from: number;
  to: number;
}

/** A server / workload node. */
export interface Server {
  id: string;
  name: string;
  ip: string;
  role: ServerRole;
  /** The role exactly as written in the source document, for display/debug. */
  rawRole: string;
  environment: Environment;
  rawEnvironment: string;
  os: string;
  zone: string;
  /**
   * True when this node was absent from the source `servers` collection and was
   * synthesised because a rule referenced it (for example `dns-service`).
   * These are surfaced as validation warnings, never silently hidden.
   */
  synthetic?: boolean;
  /** Passthrough of any unrecognised source fields. */
  raw?: Record<string, unknown>;
}

/** A policy rule. */
export interface Rule {
  id: string;
  name: string;
  /** Canonical server id of the consumer / source. */
  source: string;
  /** Canonical server id of the provider / destination. */
  destination: string;
  protocol: Protocol;
  /** Normalised, merged, sorted port ranges. Empty means no ports declared. */
  ports: PortRange[];
  /** Verbatim port tokens from the source document, for display. */
  rawPorts: (string | number)[];
  action: RuleAction;
  description: string;
  /** Disabled rules stay in the dataset but contribute no connectivity. */
  disabled?: boolean;
  raw?: Record<string, unknown>;
}

export interface DatasetMetadata {
  product?: string;
  exportType?: string;
  notes?: string;
  /** Which importer produced this dataset. */
  importer: string;
  importedAt: string;
  sourceName?: string;
  declaredServerCount?: number;
  declaredRuleCount?: number;
}

export interface Dataset {
  metadata: DatasetMetadata;
  servers: Server[];
  rules: Rule[];
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCode =
  | 'MALFORMED_DOCUMENT'
  | 'MISSING_SERVERS_COLLECTION'
  | 'MISSING_RULES_COLLECTION'
  | 'DUPLICATE_SERVER_ID'
  | 'DUPLICATE_RULE_ID'
  | 'DUPLICATE_IP'
  | 'MISSING_SERVER_FIELD'
  | 'MISSING_RULE_FIELD'
  | 'UNKNOWN_SOURCE'
  | 'UNKNOWN_DESTINATION'
  | 'MALFORMED_PORT'
  | 'UNKNOWN_PROTOCOL'
  | 'UNKNOWN_ACTION'
  | 'UNKNOWN_ROLE'
  | 'UNKNOWN_ENVIRONMENT'
  | 'INVALID_IP'
  | 'SELF_REFERENCING_RULE';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  /** Plain-English explanation aimed at non-specialist stakeholders. */
  detail?: string;
  entity?: 'server' | 'rule' | 'document';
  entityId?: string;
  field?: string;
}

export interface ValidationReport {
  ok: boolean;
  serversDetected: number;
  rulesDetected: number;
  syntheticServers: number;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ImportResult {
  dataset: Dataset | null;
  validation: ValidationReport;
}

/* ------------------------------------------------------------------ *
 * Graph
 * ------------------------------------------------------------------ */

/** A directed, protocol + port + action qualified connection derived from a rule. */
export interface Connection {
  /** Stable composite key: src|dst|proto|ports|action|ruleId */
  id: string;
  ruleId: string;
  source: string;
  destination: string;
  protocol: Protocol;
  ports: PortRange[];
  action: RuleAction;
}

export interface GraphNode {
  id: string;
  server: Server;
  inbound: string[];
  outbound: string[];
  degree: number;
}

export interface PolicyGraph {
  nodes: Map<string, GraphNode>;
  connections: Connection[];
  /** Connections indexed by source server id. */
  bySource: Map<string, Connection[]>;
  /** Connections indexed by destination server id. */
  byDestination: Map<string, Connection[]>;
  rulesById: Map<string, Rule>;
  serversById: Map<string, Server>;
}

/* ------------------------------------------------------------------ *
 * Analysis findings
 * ------------------------------------------------------------------ */

export type IssueCategory =
  | 'EXACT_DUPLICATE'
  | 'POTENTIAL_DUPLICATE'
  | 'ALLOW_DENY_CONFLICT'
  | 'PORT_OVERLAP'
  | 'REDUNDANT_RULE'
  | 'MISSING_SERVER'
  | 'INVALID_PORT'
  | 'UNKNOWN_PROTOCOL'
  | 'ORPHANED_RULE'
  | 'OVERLY_BROAD_RULE'
  | 'ISOLATED_SERVER'
  | 'POTENTIAL_BROKEN_PATH';

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface PolicyIssue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  /** Plain-English explanation of the finding. */
  explanation: string;
  ruleIds: string[];
  serverIds: string[];
  /** Deterministic facts backing the finding, shown alongside any rating. */
  evidence: string[];
}

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

export interface PathHop {
  from: string;
  to: string;
  ruleId: string;
  protocol: Protocol;
  ports: PortRange[];
  action: RuleAction;
}

export interface NetworkPath {
  /** Ordered server ids, starting at the source and ending at the destination. */
  nodes: string[];
  hops: PathHop[];
  hopCount: number;
  /** True when every hop is an ALLOW rule. */
  permitted: boolean;
}

export interface PathQueryOptions {
  maxHops?: number;
  /** When false, DENY connections are traversable too and marked non-permitted. */
  allowedRulesOnly?: boolean;
  maxResults?: number;
}

/* ------------------------------------------------------------------ *
 * Change sets and impact analysis
 * ------------------------------------------------------------------ */

export type ChangeType = 'ADD_RULE' | 'MODIFY_RULE' | 'DELETE_RULE' | 'DISABLE_RULE' | 'ENABLE_RULE';

export interface ChangeSet {
  changeId: string;
  type: ChangeType;
  createdAt: string;
  label: string;
  originalRule: Rule | null;
  proposedRule: Rule | null;
  analysis: ChangeAnalysis | null;
}

export type ImpactLevel = 'DIRECT' | 'ONE_HOP' | 'TWO_HOP' | 'DOWNSTREAM';

export interface AffectedServer {
  serverId: string;
  level: ImpactLevel;
  /** Human-readable justification for why this server is listed. */
  reasons: string[];
}

export interface ConnectionDelta {
  connection: Connection;
  kind: 'ADDED' | 'REMOVED' | 'MODIFIED';
  before?: Connection;
  description: string;
}

export interface PortDelta {
  serverId: string;
  peerId: string;
  protocol: Protocol;
  port: PortRange;
  direction: 'OPENED' | 'CLOSED';
}

export interface BreakageFinding {
  connectionId: string;
  source: string;
  destination: string;
  protocol: Protocol;
  ports: PortRange[];
  /** Plain-English, deliberately non-absolute wording. */
  summary: string;
  alternativeRuleIds: string[];
  alternativeAvailable: boolean;
  /** Existing multi-hop permitted paths that traverse this connection. */
  dependentPaths: NetworkPath[];
}

export type RiskRating = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskFactor {
  label: string;
  /** Points contributed to the deterministic score. */
  points: number;
  detail: string;
}

export interface RiskAssessment {
  rating: RiskRating;
  score: number;
  factors: RiskFactor[];
  /** The raw counts behind the rating, shown so users need not trust the label. */
  facts: Record<string, number>;
}

export interface ChangeAnalysis {
  changeId: string;
  type: ChangeType;
  generatedAt: string;
  originalRule: Rule | null;
  proposedRule: Rule | null;
  affectedServers: AffectedServer[];
  connectionsAdded: ConnectionDelta[];
  connectionsRemoved: ConnectionDelta[];
  connectionsModified: ConnectionDelta[];
  portsOpened: PortDelta[];
  portsClosed: PortDelta[];
  pathsCreated: NetworkPath[];
  pathsRemoved: NetworkPath[];
  breakage: BreakageFinding[];
  duplicates: PolicyIssue[];
  overlaps: PolicyIssue[];
  conflicts: PolicyIssue[];
  redundancies: PolicyIssue[];
  exposure: string[];
  risk: RiskAssessment;
  recommendations: string[];
}

export interface PolicyComparison {
  addedConnections: Connection[];
  removedConnections: Connection[];
  modifiedConnections: { before: Connection; after: Connection }[];
  unchangedConnectionIds: string[];
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: string;
  at: string;
  type: ChangeType;
  label: string;
  ruleId: string;
  before: Rule | null;
  after: Rule | null;
  impactSummary: string;
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

export type ConnectionDirection = 'ANY' | 'INBOUND' | 'OUTBOUND';

export interface TopologyFilters {
  serverIds: string[];
  roles: ServerRole[];
  environments: Environment[];
  zones: string[];
  protocols: Protocol[];
  actions: RuleAction[];
  /** Free text matched against server name / IP. */
  ipQuery: string;
  /** Single port, or a range such as 8000-8100. Empty means no port filter. */
  portQuery: string;
  ruleNameQuery: string;
  direction: ConnectionDirection;
  /** When set, filters are applied relative to this server. */
  focusServerId: string | null;
  hideIsolated: boolean;
}

export const EMPTY_FILTERS: TopologyFilters = {
  serverIds: [],
  roles: [],
  environments: [],
  zones: [],
  protocols: [],
  actions: [],
  ipQuery: '',
  portQuery: '',
  ruleNameQuery: '',
  direction: 'ANY',
  focusServerId: null,
  hideIsolated: false,
};

export type TopologyLayout =
  | 'force'
  | 'hierarchical'
  | 'circular'
  | 'grouped-role'
  | 'grouped-environment'
  | 'grouped-zone';

export type TopologyMode = 'CURRENT' | 'PROPOSED' | 'DIFFERENCE';

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export type SearchResultKind = 'server' | 'rule' | 'port' | 'connection';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  serverIds: string[];
  ruleIds: string[];
  score: number;
}
