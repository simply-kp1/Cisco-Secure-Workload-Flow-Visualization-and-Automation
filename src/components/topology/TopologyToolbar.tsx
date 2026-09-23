import {
  Boxes,
  Crosshair,
  Download,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Orbit,
  Plus,
  Rotate3d,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tag,
  Waves,
} from 'lucide-react';
import type { TopologyLayout, TopologyMode } from '@/types';
import type { ControlMode3D, Quality3D, TopologyView } from '@/store/useAppStore';
import { IconButton, Tabs, Tooltip } from '@/components/ui';
import { cx } from '@/lib/design';
import { LAYOUTS } from './layouts';
import type { CanvasControls } from './NetworkCanvas';

export interface Toolbar3DState {
  quality: Quality3D;
  controlMode: ControlMode3D;
  showLabels: boolean;
  showFlow: boolean;
  showFloor: boolean;
  onQualityChange: (quality: Quality3D) => void;
  onControlModeChange: (mode: ControlMode3D) => void;
  onToggleLabels: () => void;
  onToggleFlow: () => void;
  onToggleFloor: () => void;
}

export function TopologyToolbar({
  controls,
  layout,
  onLayoutChange,
  mode,
  onModeChange,
  showDiffModes,
  fullscreen,
  onToggleFullscreen,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
  showEdgeLabels,
  onToggleEdgeLabels,
  nodeCount,
  edgeCount,
  view,
  onViewChange,
  three,
}: {
  controls: CanvasControls | null;
  layout: TopologyLayout;
  onLayoutChange: (layout: TopologyLayout) => void;
  mode: TopologyMode;
  onModeChange: (mode: TopologyMode) => void;
  showDiffModes: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
  nodeCount: number;
  edgeCount: number;
  view: TopologyView;
  onViewChange: (view: TopologyView) => void;
  three: Toolbar3DState;
}) {
  const is3d = view === '3D';

  const downloadPng = (): void => {
    const uri = controls?.png();
    if (!uri) return;
    const link = document.createElement('a');
    link.href = uri;
    link.download = `network-topology-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-ink-200/80 bg-white/90 px-3 py-2 backdrop-blur">
      <button
        type="button"
        onClick={onToggleFilters}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-all duration-150 active:scale-95',
          filtersOpen || activeFilterCount > 0
            ? 'bg-brand-600 text-white shadow-sm'
            : 'text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.2} />
        Filters
        {activeFilterCount > 0 ? (
          <span className="rounded-md bg-white/25 px-1.5 text-[11px] font-bold tabular-nums">
            {activeFilterCount}
          </span>
        ) : null}
      </button>

      <div className="h-5 w-px bg-ink-200" />

      <Tabs
        value={view}
        onChange={onViewChange}
        tabs={[
          { value: '2D', label: '2D', icon: Square },
          { value: '3D', label: '3D', icon: Boxes },
        ]}
        className="h-8 !p-0.5"
      />

      <div className="relative">
        <Layers className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <select
          value={layout}
          onChange={(event) => onLayoutChange(event.target.value as TopologyLayout)}
          title={LAYOUTS.find((item) => item.value === layout)?.description}
          className="h-8 cursor-pointer appearance-none rounded-lg border border-ink-200 bg-white py-0 pl-8 pr-7 text-[13px] font-semibold text-ink-700 transition-colors hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          {LAYOUTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {showDiffModes ? (
        <Tabs
          value={mode}
          onChange={onModeChange}
          tabs={[
            { value: 'CURRENT', label: 'Current' },
            { value: 'PROPOSED', label: 'Proposed' },
            { value: 'DIFFERENCE', label: 'Difference' },
          ]}
          className="h-8 !p-0.5"
        />
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <span className="mr-2 hidden text-[11.5px] font-medium tabular-nums text-ink-400 sm:inline">
          {nodeCount.toLocaleString()} servers · {edgeCount.toLocaleString()} connections
        </span>

        {is3d ? (
          <>
            <Tooltip
              content={
                three.controlMode === 'free'
                  ? 'Free rotation — drag to spin about any axis, including roll'
                  : 'Orbit — drag to rotate, keeps the horizon level'
              }
            >
              <IconButton
                icon={three.controlMode === 'free' ? Rotate3d : Orbit}
                label="Toggle rotation mode"
                active={three.controlMode === 'free'}
                onClick={() => three.onControlModeChange(three.controlMode === 'free' ? 'orbit' : 'free')}
              />
            </Tooltip>

            <Tooltip content={three.showFlow ? 'Hide traffic flow' : 'Show packets flowing along permitted connections'}>
              <IconButton
                icon={Waves}
                label="Toggle traffic flow"
                active={three.showFlow}
                onClick={three.onToggleFlow}
              />
            </Tooltip>

            <Tooltip content={three.showFloor ? 'Hide reflective floor' : 'Show reflective floor'}>
              <IconButton
                icon={Square}
                label="Toggle floor"
                active={three.showFloor}
                onClick={three.onToggleFloor}
              />
            </Tooltip>

            <Tooltip content={three.showLabels ? 'Hide server names' : 'Show server names'}>
              <IconButton icon={Tag} label="Toggle labels" active={three.showLabels} onClick={three.onToggleLabels} />
            </Tooltip>

            <Tooltip content="Render quality">
              <div className="relative">
                <Sparkles className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400" />
                <select
                  value={three.quality}
                  onChange={(event) => three.onQualityChange(event.target.value as Quality3D)}
                  aria-label="Render quality"
                  className="h-8 cursor-pointer appearance-none rounded-lg border border-ink-200 bg-white py-0 pl-7 pr-2 text-[12px] font-semibold text-ink-700 transition-colors hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  <option value="low">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="ultra">Ultra</option>
                </select>
              </div>
            </Tooltip>
          </>
        ) : (
          <Tooltip content={showEdgeLabels ? 'Hide connection labels' : 'Show protocol and ports on each connection'}>
            <IconButton
              icon={Tag}
              label="Toggle connection labels"
              active={showEdgeLabels}
              onClick={onToggleEdgeLabels}
            />
          </Tooltip>
        )}

        <IconButton icon={Plus} label="Zoom in" onClick={() => controls?.zoomIn()} />
        <IconButton icon={Minus} label="Zoom out" onClick={() => controls?.zoomOut()} />
        <IconButton icon={Crosshair} label="Fit to screen" onClick={() => controls?.fit()} />
        <IconButton
          icon={RotateCcw}
          label={is3d ? 'Reset the camera' : 'Reset layout'}
          onClick={() => controls?.resetLayout()}
        />
        <IconButton icon={Download} label="Download as PNG" onClick={downloadPng} />
        <IconButton
          icon={fullscreen ? Minimize2 : Maximize2}
          label={fullscreen ? 'Exit fullscreen' : 'Fullscreen topology'}
          onClick={onToggleFullscreen}
        />
      </div>
    </div>
  );
}
