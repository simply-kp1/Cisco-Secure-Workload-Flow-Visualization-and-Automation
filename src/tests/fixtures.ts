import type { Dataset, Rule, Server } from '@/types';
import { parsePorts } from '@/services/ports';

/** Build a server with sensible defaults so tests stay readable. */
export function server(id: string, overrides: Partial<Server> = {}): Server {
  return {
    id,
    name: id,
    ip: '10.0.0.1',
    role: 'APP',
    rawRole: 'APP',
    environment: 'PROD',
    rawEnvironment: 'PROD',
    os: 'Ubuntu 22.04',
    zone: 'DC1',
    ...overrides,
  };
}

/** Build a rule from a compact description: rule('r1', 'a', 'b', 'TCP', [1433]). */
export function rule(
  id: string,
  source: string,
  destination: string,
  protocol: string,
  ports: (string | number)[],
  action: 'ALLOW' | 'DENY' = 'ALLOW',
  overrides: Partial<Rule> = {},
): Rule {
  const parsed = parsePorts(ports);
  return {
    id,
    name: `${source}-to-${destination}`,
    source,
    destination,
    protocol,
    ports: parsed.ranges,
    rawPorts: ports,
    action,
    description: '',
    ...overrides,
  };
}

export function dataset(servers: Server[], rules: Rule[]): Dataset {
  return {
    metadata: { importer: 'test', importedAt: '2026-01-01T00:00:00.000Z' },
    servers,
    rules,
  };
}

/** WEB01 -> APP01 -> DB01, the canonical three-tier chain used across tests. */
export function threeTierDataset(): Dataset {
  return dataset(
    [
      server('web01', { name: 'web-srv-01', role: 'WEB', ip: '10.10.10.11' }),
      server('app01', { name: 'app-srv-01', role: 'APP', ip: '10.10.20.11' }),
      server('db01', { name: 'db-srv-01', role: 'DB', ip: '10.10.30.11' }),
    ],
    [
      rule('r-web-app', 'web01', 'app01', 'TCP', [8080]),
      rule('r-app-db', 'app01', 'db01', 'TCP', [1433]),
    ],
  );
}
