import { describe, expect, it } from 'vitest';
import {
  countPorts,
  formatPorts,
  intersectRanges,
  isAnyPort,
  mergeRanges,
  normaliseProtocol,
  parsePortToken,
  parsePorts,
  protocolCovers,
  protocolsOverlap,
  rangeContains,
  rangesCover,
  rangesEqual,
  serviceForPort,
  subtractRanges,
} from '@/services/ports';

describe('parsePortToken', () => {
  it('parses a numeric port', () => {
    expect(parsePortToken(443)).toEqual({ from: 443, to: 443 });
  });

  it('parses a string port', () => {
    expect(parsePortToken('1433')).toEqual({ from: 1433, to: 1433 });
  });

  it('parses hyphenated, dotted and colon ranges', () => {
    expect(parsePortToken('1400-1500')).toEqual({ from: 1400, to: 1500 });
    expect(parsePortToken('1400..1500')).toEqual({ from: 1400, to: 1500 });
    expect(parsePortToken('1400:1500')).toEqual({ from: 1400, to: 1500 });
  });

  it('normalises a reversed range', () => {
    expect(parsePortToken('1500-1400')).toEqual({ from: 1400, to: 1500 });
  });

  it('treats ANY and wildcards as the full port space', () => {
    expect(parsePortToken('ANY')).toEqual({ from: 0, to: 65535 });
    expect(parsePortToken('*')).toEqual({ from: 0, to: 65535 });
  });

  it('strips a trailing protocol qualifier', () => {
    expect(parsePortToken('8080/tcp')).toEqual({ from: 8080, to: 8080 });
  });

  it('rejects out-of-range and malformed values', () => {
    expect(parsePortToken(70000)).toBeNull();
    expect(parsePortToken('70000')).toBeNull();
    expect(parsePortToken(-1)).toBeNull();
    expect(parsePortToken('not-a-port')).toBeNull();
    expect(parsePortToken(443.5)).toBeNull();
  });
});

describe('parsePorts', () => {
  it('handles arrays of mixed numbers and strings', () => {
    const result = parsePorts([8080, '8443']);
    expect(result.ranges).toEqual([
      { from: 8080, to: 8080 },
      { from: 8443, to: 8443 },
    ]);
    expect(result.invalid).toEqual([]);
  });

  it('collects malformed tokens instead of discarding them silently', () => {
    const result = parsePorts([443, 'banana', 99999]);
    expect(result.ranges).toEqual([{ from: 443, to: 443 }]);
    expect(result.invalid).toEqual(['banana', '99999']);
  });

  it('splits comma-separated strings', () => {
    const result = parsePorts('80, 443, 8080-8090');
    expect(result.ranges).toEqual([
      { from: 80, to: 80 },
      { from: 443, to: 443 },
      { from: 8080, to: 8090 },
    ]);
  });

  it('collapses to the full range when ANY is present', () => {
    const result = parsePorts(['ANY', 443]);
    expect(result.isAny).toBe(true);
    expect(result.ranges).toEqual([{ from: 0, to: 65535 }]);
  });

  it('returns an empty set for missing input', () => {
    expect(parsePorts(undefined).ranges).toEqual([]);
    expect(parsePorts(null).ranges).toEqual([]);
  });
});

describe('range algebra', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(
      mergeRanges([
        { from: 100, to: 200 },
        { from: 150, to: 250 },
        { from: 251, to: 260 },
        { from: 400, to: 410 },
      ]),
    ).toEqual([
      { from: 100, to: 260 },
      { from: 400, to: 410 },
    ]);
  });

  it('intersects range sets', () => {
    expect(intersectRanges([{ from: 1400, to: 1500 }], [{ from: 1433, to: 1433 }])).toEqual([
      { from: 1433, to: 1433 },
    ]);
    expect(intersectRanges([{ from: 1400, to: 1500 }], [{ from: 5432, to: 5432 }])).toEqual([]);
  });

  it('detects coverage', () => {
    expect(rangesCover([{ from: 1400, to: 1500 }], [{ from: 1433, to: 1433 }])).toBe(true);
    expect(rangesCover([{ from: 1433, to: 1433 }], [{ from: 1400, to: 1500 }])).toBe(false);
  });

  it('subtracts ranges', () => {
    expect(subtractRanges([{ from: 100, to: 200 }], [{ from: 150, to: 160 }])).toEqual([
      { from: 100, to: 149 },
      { from: 161, to: 200 },
    ]);
    expect(subtractRanges([{ from: 100, to: 200 }], [{ from: 0, to: 65535 }])).toEqual([]);
  });

  it('compares range sets for equality after normalisation', () => {
    expect(
      rangesEqual(
        [
          { from: 100, to: 150 },
          { from: 151, to: 200 },
        ],
        [{ from: 100, to: 200 }],
      ),
    ).toBe(true);
    expect(rangesEqual([{ from: 100, to: 200 }], [{ from: 100, to: 201 }])).toBe(false);
  });

  it('counts and formats', () => {
    expect(countPorts([{ from: 100, to: 109 }])).toBe(10);
    expect(formatPorts([{ from: 443, to: 443 }, { from: 8000, to: 8080 }])).toBe('443, 8000-8080');
    expect(formatPorts([{ from: 0, to: 65535 }])).toBe('ANY');
    expect(formatPorts([])).toBe('—');
    expect(isAnyPort([{ from: 0, to: 65535 }])).toBe(true);
    expect(rangeContains([{ from: 1400, to: 1500 }], 1433)).toBe(true);
    expect(rangeContains([{ from: 1400, to: 1500 }], 5432)).toBe(false);
  });
});

describe('protocols', () => {
  it('normalises known protocols and flags unknown ones', () => {
    expect(normaliseProtocol('tcp')).toEqual({ protocol: 'TCP', known: true });
    expect(normaliseProtocol('')).toEqual({ protocol: 'ANY', known: true });
    expect(normaliseProtocol('SCTP')).toEqual({ protocol: 'SCTP', known: false });
  });

  it('treats ANY as overlapping every protocol', () => {
    expect(protocolsOverlap('TCP', 'TCP')).toBe(true);
    expect(protocolsOverlap('TCP', 'UDP')).toBe(false);
    expect(protocolsOverlap('ANY', 'UDP')).toBe(true);
    expect(protocolCovers('ANY', 'TCP')).toBe(true);
    expect(protocolCovers('TCP', 'ANY')).toBe(false);
  });
});

describe('well-known services', () => {
  it('names widely recognised ports', () => {
    expect(serviceForPort(443)?.name).toBe('HTTPS');
    expect(serviceForPort(1433)?.name).toBe('SQL Server');
    expect(serviceForPort(5432)?.name).toBe('PostgreSQL');
    expect(serviceForPort(3389)?.name).toBe('RDP');
  });

  it('does not guess at uncommon ports', () => {
    expect(serviceForPort(47821)).toBeNull();
    expect(serviceForPort(12345)).toBeNull();
  });
});
