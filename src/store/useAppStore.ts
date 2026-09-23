import { create } from 'zustand';
import type {
  ChangeAnalysis,
  ChangeSet,
  ChangeType,
  Dataset,
  HistoryEntry,
  Rule,
  TopologyFilters,
  TopologyLayout,
  TopologyMode,
  ValidationReport,
} from '@/types';
import { EMPTY_FILTERS } from '@/types';
import { parseImport } from '@/services/parseImport';
import { analyseChange, applyChange, createChangeSet, defaultChangeLabel } from '@/services/analyseChange';
import sampleDocument from '@/data/sampleDataset.json';

/** Which renderer the Network Map uses. */
export type TopologyView = '2D' | '3D';
/** Render quality for the 3D view. */
export type Quality3D = 'low' | 'balanced' | 'ultra';
/** Orbit keeps the horizon level; free allows rotation about every axis. */
export type ControlMode3D = 'orbit' | 'free';

export interface Settings {
  /** Hide node labels below this zoom level to keep large graphs readable. */
  labelZoomThreshold: number;
  maxPathHops: number;
  blastRadiusDepth: number;
  /** Above this node count, expensive visual effects are disabled. */
  performanceThreshold: number;
  animateLayout: boolean;
  showEdgeLabels: boolean;
  showDenyRules: boolean;

  /* ---------------- 3D view ---------------- */
  topologyView: TopologyView;
  quality3d: Quality3D;
  controlMode3d: ControlMode3D;
  showLabels3d: boolean;
  showFlow3d: boolean;
  showFloor3d: boolean;
  animate3d: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  labelZoomThreshold: 0.42,
  maxPathHops: 4,
  blastRadiusDepth: 3,
  performanceThreshold: 400,
  animateLayout: true,
  showEdgeLabels: false,
  showDenyRules: true,

  topologyView: '3D',
  quality3d: 'balanced',
  controlMode3d: 'orbit',
  showLabels3d: true,
  showFlow3d: true,
  showFloor3d: true,
  animate3d: true,
};

export interface AppState {
  /* ---------------- data ---------------- */
  /**
   * The dataset exactly as imported. This is never mutated: every edit produces
   * a new `workingDataset`, and the original stays available for comparison and
   * for the "revert all" action.
   */
  originalDataset: Dataset | null;
  /** The current, committed working state including any applied changes. */
  workingDataset: Dataset | null;
  validation: ValidationReport | null;

  /* ---------------- proposed change ---------------- */
  /** A change being evaluated but NOT applied to the working state. */
  proposedChange: ChangeSet | null;
  proposedAnalysis: ChangeAnalysis | null;

  /* ---------------- history ---------------- */
  history: HistoryEntry[];
  undoStack: Dataset[];
  redoStack: Dataset[];

  /* ---------------- view ---------------- */
  filters: TopologyFilters;
  layout: TopologyLayout;
  topologyMode: TopologyMode;
  selectedServerId: string | null;
  selectedServerIds: string[];
  selectedRuleId: string | null;
  selectedConnectionId: string | null;
  focusServerId: string | null;
  highlightedServerIds: string[];
  highlightedRuleIds: string[];
  settings: Settings;

  /* ---------------- actions ---------------- */
  loadDocument: (document: unknown, sourceName?: string) => ValidationReport;
  loadSample: () => ValidationReport;
  clearDataset: () => void;

  proposeChange: (type: ChangeType, originalRule: Rule | null, proposedRule: Rule | null, label?: string) => void;
  updateProposedRule: (rule: Rule) => void;
  discardProposedChange: () => void;
  commitProposedChange: () => void;
  applyImmediate: (type: ChangeType, originalRule: Rule | null, proposedRule: Rule | null) => void;

  undo: () => void;
  redo: () => void;
  revertAll: () => void;

  setFilters: (filters: Partial<TopologyFilters>) => void;
  resetFilters: () => void;
  setLayout: (layout: TopologyLayout) => void;
  setTopologyMode: (mode: TopologyMode) => void;
  selectServer: (serverId: string | null) => void;
  toggleServerSelection: (serverId: string) => void;
  clearServerSelection: () => void;
  selectRule: (ruleId: string | null) => void;
  selectConnection: (connectionId: string | null) => void;
  setFocusServer: (serverId: string | null) => void;
  highlight: (serverIds: string[], ruleIds: string[]) => void;
  clearHighlight: () => void;
  updateSettings: (settings: Partial<Settings>) => void;
}

const MAX_UNDO = 40;

export const useAppStore = create<AppState>((set, get) => ({
  originalDataset: null,
  workingDataset: null,
  validation: null,

  proposedChange: null,
  proposedAnalysis: null,

  history: [],
  undoStack: [],
  redoStack: [],

  filters: { ...EMPTY_FILTERS },
  layout: 'force',
  topologyMode: 'CURRENT',
  selectedServerId: null,
  selectedServerIds: [],
  selectedRuleId: null,
  selectedConnectionId: null,
  focusServerId: null,
  highlightedServerIds: [],
  highlightedRuleIds: [],
  settings: { ...DEFAULT_SETTINGS },

  /* ---------------- data loading ---------------- */

  loadDocument: (document, sourceName) => {
    const result = parseImport(document, { sourceName });
    if (result.dataset) {
      set({
        originalDataset: result.dataset,
        // Structural clone so edits to the working copy can never reach the original.
        workingDataset: cloneDataset(result.dataset),
        validation: result.validation,
        history: [],
        undoStack: [],
        redoStack: [],
        proposedChange: null,
        proposedAnalysis: null,
        filters: { ...EMPTY_FILTERS },
        selectedServerId: null,
        selectedServerIds: [],
        selectedRuleId: null,
        selectedConnectionId: null,
        focusServerId: null,
        highlightedServerIds: [],
        highlightedRuleIds: [],
        topologyMode: 'CURRENT',
      });
    } else {
      set({ validation: result.validation });
    }
    return result.validation;
  },

  loadSample: () => get().loadDocument(sampleDocument, 'cisco_secure_workload_50_servers_sample.json'),

  clearDataset: () =>
    set({
      originalDataset: null,
      workingDataset: null,
      validation: null,
      history: [],
      undoStack: [],
      redoStack: [],
      proposedChange: null,
      proposedAnalysis: null,
      filters: { ...EMPTY_FILTERS },
      selectedServerId: null,
      selectedServerIds: [],
      selectedRuleId: null,
      selectedConnectionId: null,
      focusServerId: null,
      highlightedServerIds: [],
      highlightedRuleIds: [],
    }),

  /* ---------------- proposed changes ---------------- */

  proposeChange: (type, originalRule, proposedRule, label) => {
    const dataset = get().workingDataset;
    if (!dataset) return;
    const change = createChangeSet(type, originalRule, proposedRule, label);
    const settings = get().settings;
    const analysis = analyseChange(
      dataset,
      { type, originalRule, proposedRule },
      { maxHops: settings.maxPathHops, blastRadiusDepth: settings.blastRadiusDepth, changeId: change.changeId },
    );
    set({
      proposedChange: { ...change, analysis },
      proposedAnalysis: analysis,
      topologyMode: 'DIFFERENCE',
    });
  },

  /** Re-analyse as the user edits a rule in the builder, without committing. */
  updateProposedRule: (rule) => {
    const { workingDataset, proposedChange, settings } = get();
    if (!workingDataset || !proposedChange) return;
    const analysis = analyseChange(
      workingDataset,
      { type: proposedChange.type, originalRule: proposedChange.originalRule, proposedRule: rule },
      {
        maxHops: settings.maxPathHops,
        blastRadiusDepth: settings.blastRadiusDepth,
        changeId: proposedChange.changeId,
      },
    );
    set({
      proposedChange: {
        ...proposedChange,
        proposedRule: rule,
        label: defaultChangeLabel(proposedChange.type, proposedChange.originalRule, rule),
        analysis,
      },
      proposedAnalysis: analysis,
    });
  },

  discardProposedChange: () => set({ proposedChange: null, proposedAnalysis: null, topologyMode: 'CURRENT' }),

  commitProposedChange: () => {
    const { workingDataset, proposedChange, history, undoStack } = get();
    if (!workingDataset || !proposedChange) return;

    const rules = applyChange(workingDataset.rules, proposedChange);
    const next = { ...workingDataset, rules };
    const analysis = proposedChange.analysis;

    const entry: HistoryEntry = {
      id: proposedChange.changeId,
      at: new Date().toISOString(),
      type: proposedChange.type,
      label: proposedChange.label,
      ruleId: proposedChange.proposedRule?.id ?? proposedChange.originalRule?.id ?? '',
      before: proposedChange.originalRule,
      after: proposedChange.proposedRule,
      impactSummary: analysis
        ? `${analysis.risk.rating} risk · ${analysis.connectionsAdded.length} added, ${analysis.connectionsRemoved.length} removed, ${analysis.connectionsModified.length} modified · ${analysis.affectedServers.length} servers in blast radius`
        : 'Applied without analysis',
    };

    set({
      workingDataset: next,
      undoStack: [...undoStack, workingDataset].slice(-MAX_UNDO),
      redoStack: [],
      history: [entry, ...history],
      proposedChange: null,
      proposedAnalysis: null,
      topologyMode: 'CURRENT',
    });
  },

  /** Apply a change straight away (used by Disable / Delete from the rules table). */
  applyImmediate: (type, originalRule, proposedRule) => {
    const { workingDataset, history, undoStack, settings } = get();
    if (!workingDataset) return;

    const analysis = analyseChange(
      workingDataset,
      { type, originalRule, proposedRule },
      { maxHops: settings.maxPathHops, blastRadiusDepth: settings.blastRadiusDepth },
    );
    const rules = applyChange(workingDataset.rules, { type, originalRule, proposedRule });

    const entry: HistoryEntry = {
      id: analysis.changeId,
      at: new Date().toISOString(),
      type,
      label: defaultChangeLabel(type, originalRule, proposedRule),
      ruleId: proposedRule?.id ?? originalRule?.id ?? '',
      before: originalRule,
      after: proposedRule,
      impactSummary: `${analysis.risk.rating} risk · ${analysis.connectionsAdded.length} added, ${analysis.connectionsRemoved.length} removed, ${analysis.connectionsModified.length} modified`,
    };

    set({
      workingDataset: { ...workingDataset, rules },
      undoStack: [...undoStack, workingDataset].slice(-MAX_UNDO),
      redoStack: [],
      history: [entry, ...history],
    });
  },

  /* ---------------- undo / redo ---------------- */

  undo: () => {
    const { undoStack, redoStack, workingDataset, history } = get();
    if (undoStack.length === 0 || !workingDataset) return;
    const previous = undoStack[undoStack.length - 1];
    set({
      workingDataset: previous,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, workingDataset],
      history: history.slice(1),
    });
  },

  redo: () => {
    const { undoStack, redoStack, workingDataset } = get();
    if (redoStack.length === 0 || !workingDataset) return;
    const next = redoStack[redoStack.length - 1];
    set({
      workingDataset: next,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, workingDataset],
    });
  },

  revertAll: () => {
    const { originalDataset, workingDataset, undoStack } = get();
    if (!originalDataset || !workingDataset) return;
    set({
      workingDataset: cloneDataset(originalDataset),
      undoStack: [...undoStack, workingDataset].slice(-MAX_UNDO),
      redoStack: [],
      history: [],
      proposedChange: null,
      proposedAnalysis: null,
      topologyMode: 'CURRENT',
    });
  },

  /* ---------------- view ---------------- */

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  resetFilters: () => set({ filters: { ...EMPTY_FILTERS }, focusServerId: null }),
  setLayout: (layout) => set({ layout }),
  setTopologyMode: (topologyMode) => set({ topologyMode }),

  selectServer: (serverId) =>
    set({ selectedServerId: serverId, selectedConnectionId: null, selectedRuleId: null }),

  toggleServerSelection: (serverId) =>
    set((state) => ({
      selectedServerIds: state.selectedServerIds.includes(serverId)
        ? state.selectedServerIds.filter((id) => id !== serverId)
        : [...state.selectedServerIds, serverId],
    })),

  clearServerSelection: () => set({ selectedServerIds: [] }),
  selectRule: (ruleId) => set({ selectedRuleId: ruleId }),
  selectConnection: (connectionId) => set({ selectedConnectionId: connectionId, selectedServerId: null }),
  setFocusServer: (serverId) =>
    set((state) => ({
      focusServerId: serverId,
      filters: { ...state.filters, focusServerId: serverId },
    })),

  highlight: (serverIds, ruleIds) => set({ highlightedServerIds: serverIds, highlightedRuleIds: ruleIds }),
  clearHighlight: () => set({ highlightedServerIds: [], highlightedRuleIds: [] }),
  updateSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
}));

function cloneDataset(dataset: Dataset): Dataset {
  return {
    metadata: { ...dataset.metadata },
    servers: dataset.servers.map((server) => ({ ...server })),
    rules: dataset.rules.map((rule) => ({ ...rule, ports: rule.ports.map((range) => ({ ...range })) })),
  };
}
