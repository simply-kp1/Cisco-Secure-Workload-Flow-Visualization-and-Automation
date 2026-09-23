import {
  Boxes,
  Database,
  FileStack,
  Globe,
  Gauge,
  HelpCircle,
  Layers,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Environment, ImpactLevel, IssueSeverity, RiskRating, ServerRole } from '@/types';

/**
 * Role presentation.
 *
 * Every role carries a distinct icon, a distinct node shape on the topology and
 * a short code label, so the map never relies on colour alone to convey role.
 */
export interface RoleStyle {
  label: string;
  short: string;
  icon: LucideIcon;
  /** Tailwind classes for chips and cards. */
  chip: string;
  dot: string;
  /** Hex values handed to Cytoscape. */
  color: string;
  border: string;
  /** Cytoscape node shape — the non-colour channel for role. */
  shape: string;
  description: string;
}

export const ROLE_STYLES: Record<ServerRole, RoleStyle> = {
  WEB: {
    label: 'Web',
    short: 'WEB',
    icon: Globe,
    chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
    dot: 'bg-sky-500',
    color: '#0ea5e9',
    border: '#0284c7',
    shape: 'round-rectangle',
    description: 'Public or internal web tier',
  },
  APP: {
    label: 'Application',
    short: 'APP',
    icon: Layers,
    chip: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
    dot: 'bg-violet-500',
    color: '#8b5cf6',
    border: '#7c3aed',
    shape: 'ellipse',
    description: 'Application / middleware tier',
  },
  DB: {
    label: 'Database',
    short: 'DB',
    icon: Database,
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    dot: 'bg-amber-500',
    color: '#f59e0b',
    border: '#d97706',
    shape: 'barrel',
    description: 'Database server',
  },
  API: {
    label: 'API',
    short: 'API',
    icon: Boxes,
    chip: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200',
    dot: 'bg-teal-500',
    color: '#14b8a6',
    border: '#0d9488',
    shape: 'hexagon',
    description: 'API or service endpoint',
  },
  FILE: {
    label: 'File',
    short: 'FILE',
    icon: FileStack,
    chip: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
    dot: 'bg-indigo-500',
    color: '#6366f1',
    border: '#4f46e5',
    shape: 'cut-rectangle',
    description: 'File / storage server',
  },
  MONITORING: {
    label: 'Monitoring',
    short: 'MON',
    icon: Gauge,
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    dot: 'bg-emerald-500',
    color: '#10b981',
    border: '#059669',
    shape: 'diamond',
    description: 'Monitoring / observability',
  },
  MANAGEMENT: {
    label: 'Management',
    short: 'MGMT',
    icon: ShieldCheck,
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    dot: 'bg-rose-500',
    color: '#f43f5e',
    border: '#e11d48',
    shape: 'octagon',
    description: 'Management / administration',
  },
  UNKNOWN: {
    label: 'Unresolved',
    short: '?',
    icon: HelpCircle,
    chip: 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
    dot: 'bg-ink-400',
    color: '#94a3b8',
    border: '#64748b',
    shape: 'triangle',
    description: 'Role not recorded, or endpoint missing from the inventory',
  },
};

export const ROLE_ORDER: ServerRole[] = [
  'WEB',
  'APP',
  'DB',
  'API',
  'FILE',
  'MONITORING',
  'MANAGEMENT',
  'UNKNOWN',
];

/* ------------------------------------------------------------------ */

export interface EnvironmentStyle {
  label: string;
  chip: string;
  color: string;
  description: string;
}

export const ENVIRONMENT_STYLES: Record<Environment, EnvironmentStyle> = {
  PROD: {
    label: 'Production',
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    color: '#f43f5e',
    description: 'Live production systems',
  },
  UAT: {
    label: 'UAT',
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    color: '#f59e0b',
    description: 'User acceptance / staging',
  },
  DEV: {
    label: 'Development',
    chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
    color: '#0ea5e9',
    description: 'Development and test',
  },
  UNKNOWN: {
    label: 'Unknown',
    chip: 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
    color: '#94a3b8',
    description: 'Environment not recorded',
  },
};

export const ENVIRONMENT_ORDER: Environment[] = ['PROD', 'UAT', 'DEV', 'UNKNOWN'];

/* ------------------------------------------------------------------ */

export const ACTION_STYLES = {
  ALLOW: {
    label: 'Allow',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    color: '#10b981',
    lineStyle: 'solid' as const,
    description: 'Traffic is permitted',
  },
  DENY: {
    label: 'Deny',
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    color: '#f43f5e',
    lineStyle: 'dashed' as const,
    description: 'Traffic is explicitly blocked',
  },
};

export const RISK_STYLES: Record<RiskRating, { chip: string; bar: string; color: string }> = {
  LOW: {
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    bar: 'bg-emerald-500',
    color: '#10b981',
  },
  MEDIUM: {
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    bar: 'bg-amber-500',
    color: '#f59e0b',
  },
  HIGH: {
    chip: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
    bar: 'bg-orange-500',
    color: '#f97316',
  },
  CRITICAL: {
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    bar: 'bg-rose-600',
    color: '#e11d48',
  },
};

export const SEVERITY_STYLES: Record<IssueSeverity, { chip: string; label: string; color: string }> = {
  critical: {
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    label: 'Critical',
    color: '#e11d48',
  },
  high: {
    chip: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
    label: 'High',
    color: '#f97316',
  },
  medium: {
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    label: 'Medium',
    color: '#f59e0b',
  },
  low: {
    chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
    label: 'Low',
    color: '#0ea5e9',
  },
  info: {
    chip: 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
    label: 'Info',
    color: '#94a3b8',
  },
};

export const IMPACT_STYLES: Record<ImpactLevel, { chip: string; color: string; ring: string }> = {
  DIRECT: {
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    color: '#e11d48',
    ring: '#e11d48',
  },
  ONE_HOP: {
    chip: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
    color: '#f97316',
    ring: '#f97316',
  },
  TWO_HOP: {
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    color: '#f59e0b',
    ring: '#f59e0b',
  },
  DOWNSTREAM: {
    chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
    color: '#0ea5e9',
    ring: '#0ea5e9',
  },
};

/** Difference-mode colours, shared between the topology and the legends. */
export const DIFF_COLORS = {
  ADDED: '#10b981',
  REMOVED: '#f43f5e',
  MODIFIED: '#f59e0b',
  UNCHANGED: '#cbd5e1',
};

/** Chart palette, in the order series should consume it. */
export const CHART_COLORS = [
  '#3563f4',
  '#8b5cf6',
  '#14b8a6',
  '#f59e0b',
  '#f43f5e',
  '#0ea5e9',
  '#10b981',
  '#6366f1',
  '#f97316',
  '#94a3b8',
];

export function roleStyle(role: ServerRole): RoleStyle {
  return ROLE_STYLES[role] ?? ROLE_STYLES.UNKNOWN;
}

export function environmentStyle(environment: Environment): EnvironmentStyle {
  return ENVIRONMENT_STYLES[environment] ?? ENVIRONMENT_STYLES.UNKNOWN;
}

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
