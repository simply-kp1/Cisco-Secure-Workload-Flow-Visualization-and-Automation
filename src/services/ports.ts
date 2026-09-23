import type { PortRange, Protocol } from '@/types';

export const MIN_PORT = 0;
export const MAX_PORT = 65535;

/** The range used to represent "any port". */
export const ANY_PORTS: PortRange = { from: MIN_PORT, to: MAX_PORT };

export interface PortParseResult {
  ranges: PortRange[];
  /** Tokens that could not be understood, reported to the user rather than dropped. */
  invalid: string[];
  /** True when the declaration covers the whole port space. */
  isAny: boolean;
}

const ANY_TOKENS = new Set(['any', '*', 'all', '-', '']);

/**
 * Parse a single port token. Accepts:
 *   443          -> { from: 443, to: 443 }
 *   "443"        -> { from: 443, to: 443 }
 *   "1400-1500"  -> { from: 1400, to: 1500 }
 *   "1400..1500" -> { from: 1400, to: 1500 }
 *   "8080/tcp"   -> { from: 8080, to: 8080 }  (protocol suffix ignored here)
 *   "ANY"/"*"    -> full range
 */
export function parsePortToken(token: string | number): PortRange | null {
  if (typeof token === 'number') {
    if (!Number.isFinite(token) || !Number.isInteger(token)) return null;
    if (token < MIN_PORT || token > MAX_PORT) return null;
    return { from: token, to: token };
  }
  const raw = String(token).trim();
  const lower = raw.toLowerCase();
  if (ANY_TOKENS.has(lower)) return { ...ANY_PORTS };

  // Strip a trailing protocol qualifier such as "8080/tcp".
  const stripped = lower.replace(/\/(tcp|udp|icmp|any)$/i, '');
  const rangeMatch = stripped.match(/^(\d{1,5})\s*(?:-|\.\.|to|:)\s*(\d{1,5})$/);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]);
    const to = Number(rangeMatch[2]);
    if (!inBounds(from) || !inBounds(to)) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  const single = stripped.match(/^(\d{1,5})$/);
  if (single) {
    const value = Number(single[1]);
    if (!inBounds(value)) return null;
    return { from: value, to: value };
  }
  return null;
}

function inBounds(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT;
}

/**
 * Parse a port declaration of any shape the importers encounter: a number, a
 * string, a comma-separated string, or an array of either. Invalid tokens are
 * collected and reported rather than silently discarded.
 */
export function parsePorts(input: unknown): PortParseResult {
  const invalid: string[] = [];
  const ranges: PortRange[] = [];

  const tokens: (string | number)[] = [];
  const collect = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === 'number') {
      tokens.push(value);
      return;
    }
    if (typeof value === 'string') {
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .forEach((part) => tokens.push(part));
      return;
    }
    invalid.push(String(value));
  };
  collect(input);

  for (const token of tokens) {
    const parsed = parsePortToken(token);
    if (parsed) ranges.push(parsed);
    else invalid.push(String(token));
  }

  const merged = mergeRanges(ranges);
  const isAny = merged.some((range) => range.from === MIN_PORT && range.to === MAX_PORT);
  return { ranges: isAny ? [{ ...ANY_PORTS }] : merged, invalid, isAny };
}

/** Merge overlapping / adjacent ranges into a minimal sorted set. */
export function mergeRanges(ranges: PortRange[]): PortRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: PortRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = out[out.length - 1];
    if (current.from <= last.to + 1) {
      last.to = Math.max(last.to, current.to);
    } else {
      out.push({ ...current });
    }
  }
  return out;
}

export function rangesOverlap(a: PortRange, b: PortRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** Intersection of two port range sets; empty when disjoint. */
export function intersectRanges(a: PortRange[], b: PortRange[]): PortRange[] {
  const out: PortRange[] = [];
  for (const left of a) {
    for (const right of b) {
      if (rangesOverlap(left, right)) {
        out.push({ from: Math.max(left.from, right.from), to: Math.min(left.to, right.to) });
      }
    }
  }
  return mergeRanges(out);
}

/** True when every port in `subset` is present in `superset`. */
export function rangesCover(superset: PortRange[], subset: PortRange[]): boolean {
  if (subset.length === 0) return true;
  const merged = mergeRanges(superset);
  return subset.every((needle) =>
    merged.some((range) => range.from <= needle.from && range.to >= needle.to),
  );
}

/** Exact set equality after normalisation. */
export function rangesEqual(a: PortRange[], b: PortRange[]): boolean {
  const left = mergeRanges(a);
  const right = mergeRanges(b);
  if (left.length !== right.length) return false;
  return left.every((range, i) => range.from === right[i].from && range.to === right[i].to);
}

/** Set subtraction: ports in `a` that are not in `b`. */
export function subtractRanges(a: PortRange[], b: PortRange[]): PortRange[] {
  let remaining = mergeRanges(a);
  for (const cut of mergeRanges(b)) {
    const next: PortRange[] = [];
    for (const range of remaining) {
      if (!rangesOverlap(range, cut)) {
        next.push(range);
        continue;
      }
      if (range.from < cut.from) next.push({ from: range.from, to: cut.from - 1 });
      if (range.to > cut.to) next.push({ from: cut.to + 1, to: range.to });
    }
    remaining = next;
  }
  return mergeRanges(remaining);
}

export function rangeContains(ranges: PortRange[], port: number): boolean {
  return ranges.some((range) => port >= range.from && port <= range.to);
}

export function countPorts(ranges: PortRange[]): number {
  return mergeRanges(ranges).reduce((total, range) => total + (range.to - range.from + 1), 0);
}

export function isAnyPort(ranges: PortRange[]): boolean {
  return ranges.some((range) => range.from === MIN_PORT && range.to === MAX_PORT);
}

export function formatRange(range: PortRange): string {
  if (range.from === MIN_PORT && range.to === MAX_PORT) return 'ANY';
  return range.from === range.to ? String(range.from) : `${range.from}-${range.to}`;
}

export function formatPorts(ranges: PortRange[]): string {
  if (ranges.length === 0) return '—';
  return mergeRanges(ranges).map(formatRange).join(', ');
}

/**
 * Enumerate discrete ports for display / indexing purposes. Bounded so that a
 * wide range (or ANY) never explodes the UI.
 */
export function enumeratePorts(ranges: PortRange[], limit = 64): number[] {
  const out: number[] = [];
  for (const range of mergeRanges(ranges)) {
    for (let port = range.from; port <= range.to; port += 1) {
      out.push(port);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Well-known services
 * ------------------------------------------------------------------ */

/**
 * Friendly names for widely recognised ports only. Uncommon ports are
 * deliberately left unnamed rather than guessed at.
 */
const WELL_KNOWN_PORTS: Record<number, { name: string; description: string }> = {
  20: { name: 'FTP Data', description: 'File Transfer Protocol (data channel)' },
  21: { name: 'FTP', description: 'File Transfer Protocol (control channel)' },
  22: { name: 'SSH', description: 'Secure Shell remote administration' },
  23: { name: 'Telnet', description: 'Unencrypted remote terminal' },
  25: { name: 'SMTP', description: 'Mail transfer' },
  53: { name: 'DNS', description: 'Domain name resolution' },
  67: { name: 'DHCP Server', description: 'Dynamic host configuration' },
  68: { name: 'DHCP Client', description: 'Dynamic host configuration' },
  80: { name: 'HTTP', description: 'Unencrypted web traffic' },
  88: { name: 'Kerberos', description: 'Authentication' },
  110: { name: 'POP3', description: 'Mail retrieval' },
  123: { name: 'NTP', description: 'Network time synchronisation' },
  135: { name: 'MS RPC', description: 'Windows RPC endpoint mapper' },
  137: { name: 'NetBIOS Name', description: 'Windows name service' },
  139: { name: 'NetBIOS Session', description: 'Windows session service' },
  143: { name: 'IMAP', description: 'Mail retrieval' },
  161: { name: 'SNMP', description: 'Network monitoring' },
  162: { name: 'SNMP Trap', description: 'Monitoring notifications' },
  389: { name: 'LDAP', description: 'Directory services' },
  443: { name: 'HTTPS', description: 'Encrypted web traffic' },
  445: { name: 'SMB', description: 'Windows file and printer sharing' },
  465: { name: 'SMTPS', description: 'Encrypted mail transfer' },
  514: { name: 'Syslog', description: 'Log forwarding' },
  587: { name: 'SMTP Submission', description: 'Mail submission' },
  636: { name: 'LDAPS', description: 'Encrypted directory services' },
  873: { name: 'rsync', description: 'File synchronisation' },
  989: { name: 'FTPS Data', description: 'Encrypted file transfer (data)' },
  990: { name: 'FTPS', description: 'Encrypted file transfer (control)' },
  993: { name: 'IMAPS', description: 'Encrypted mail retrieval' },
  995: { name: 'POP3S', description: 'Encrypted mail retrieval' },
  1433: { name: 'SQL Server', description: 'Microsoft SQL Server database' },
  1521: { name: 'Oracle DB', description: 'Oracle database listener' },
  2049: { name: 'NFS', description: 'Network file system' },
  2375: { name: 'Docker', description: 'Docker daemon (unencrypted)' },
  2376: { name: 'Docker TLS', description: 'Docker daemon (encrypted)' },
  3000: { name: 'HTTP Alt', description: 'Common application HTTP port' },
  3268: { name: 'Global Catalog', description: 'Active Directory global catalog' },
  3306: { name: 'MySQL', description: 'MySQL / MariaDB database' },
  3389: { name: 'RDP', description: 'Windows Remote Desktop' },
  4444: { name: 'HTTP Alt', description: 'Common application port' },
  5432: { name: 'PostgreSQL', description: 'PostgreSQL database' },
  5601: { name: 'Kibana', description: 'Log analytics interface' },
  5672: { name: 'AMQP', description: 'Message queuing' },
  5985: { name: 'WinRM HTTP', description: 'Windows Remote Management' },
  5986: { name: 'WinRM HTTPS', description: 'Windows Remote Management (encrypted)' },
  6379: { name: 'Redis', description: 'In-memory data store' },
  8080: { name: 'HTTP Alternative', description: 'Common alternative web port' },
  8081: { name: 'HTTP Alt', description: 'Common alternative web port' },
  8443: { name: 'HTTPS Alternative', description: 'Common alternative encrypted web port' },
  9000: { name: 'HTTP Alt', description: 'Common application / management port' },
  9090: { name: 'Prometheus', description: 'Metrics server' },
  9092: { name: 'Kafka', description: 'Event streaming' },
  9100: { name: 'Node Exporter', description: 'Host metrics endpoint' },
  9200: { name: 'Elasticsearch', description: 'Search and analytics engine' },
  11211: { name: 'Memcached', description: 'In-memory cache' },
  27017: { name: 'MongoDB', description: 'Document database' },
};

/** Friendly service name for a port, or null when the port is not well known. */
export function serviceForPort(port: number): { name: string; description: string } | null {
  return WELL_KNOWN_PORTS[port] ?? null;
}

export function serviceLabel(port: number): string {
  return WELL_KNOWN_PORTS[port]?.name ?? '';
}

/** Ports that are conventionally considered sensitive administrative access. */
const SENSITIVE_PORTS = new Set([22, 23, 135, 139, 445, 3389, 5985, 5986]);
/** Ports that conventionally front a database. */
const DATABASE_PORTS = new Set([1433, 1521, 3306, 5432, 6379, 9200, 11211, 27017]);

export function isSensitivePort(port: number): boolean {
  return SENSITIVE_PORTS.has(port);
}

export function isDatabasePort(port: number): boolean {
  return DATABASE_PORTS.has(port);
}

export function rangesIncludeSensitivePort(ranges: PortRange[]): number[] {
  return [...SENSITIVE_PORTS].filter((port) => rangeContains(ranges, port)).sort((a, b) => a - b);
}

export function rangesIncludeDatabasePort(ranges: PortRange[]): number[] {
  return [...DATABASE_PORTS].filter((port) => rangeContains(ranges, port)).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Protocols
 * ------------------------------------------------------------------ */

export const KNOWN_PROTOCOLS = ['TCP', 'UDP', 'ICMP', 'ANY'] as const;

export function normaliseProtocol(input: unknown): { protocol: Protocol; known: boolean } {
  const raw = String(input ?? '').trim().toUpperCase();
  if (raw === '' || raw === '*' || raw === 'ALL') return { protocol: 'ANY', known: true };
  if ((KNOWN_PROTOCOLS as readonly string[]).includes(raw)) return { protocol: raw, known: true };
  return { protocol: raw, known: false };
}

/** Two protocols can carry the same traffic when equal, or when either is ANY. */
export function protocolsOverlap(a: Protocol, b: Protocol): boolean {
  if (a === b) return true;
  return a === 'ANY' || b === 'ANY';
}

/** True when `superset` carries at least everything `subset` does. */
export function protocolCovers(superset: Protocol, subset: Protocol): boolean {
  return superset === 'ANY' || superset === subset;
}
