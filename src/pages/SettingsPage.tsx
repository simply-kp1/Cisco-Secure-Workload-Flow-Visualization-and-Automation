import { Boxes, Gauge, Info, Route, Settings as SettingsIcon, Sliders } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  useAppStore,
  type ControlMode3D,
  type Quality3D,
  type TopologyView,
} from '@/store/useAppStore';
import { useDataset, useGraph } from '@/store/selectors';
import { Button, Callout, Card, CardHeader, Field, Select, Toggle } from '@/components/ui';

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const dataset = useDataset();
  const graph = useGraph();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Analysis"
          subtitle="How far the engine searches when calculating paths and impact."
          icon={Route}
        />
        <div className="space-y-4 border-t border-ink-100 px-5 py-4">
          <Select
            label="Maximum path hops"
            value={String(settings.maxPathHops)}
            onChange={(event) => updateSettings({ maxPathHops: Number(event.target.value) })}
            hint="Applies to Path Explorer and to the path calculations inside change analysis. Higher values find longer routes but take longer on large policies."
          >
            {[2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value} hops
              </option>
            ))}
          </Select>

          <Select
            label="Blast radius depth"
            value={String(settings.blastRadiusDepth)}
            onChange={(event) => updateSettings({ blastRadiusDepth: Number(event.target.value) })}
            hint="How many permitted network hops outward from a changed rule are considered potentially affected."
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value} hop{value === 1 ? '' : 's'}
              </option>
            ))}
          </Select>

          <Callout tone="neutral" icon={Info}>
            These settings change only how far the search runs. They do not change how findings are worded or how
            the risk score is calculated — the risk model is fixed and every point it awards is attributed to a
            named factor.
          </Callout>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Topology rendering"
          subtitle="Tuned for large graphs. The defaults suit a few hundred servers."
          icon={Gauge}
        />
        <div className="space-y-2 border-t border-ink-100 px-5 py-4">
          <Select
            label="Hide labels below zoom level"
            value={String(settings.labelZoomThreshold)}
            onChange={(event) => updateSettings({ labelZoomThreshold: Number(event.target.value) })}
            hint="Suppressing labels when zoomed out keeps very large diagrams legible and responsive."
          >
            <option value="0">Never hide labels</option>
            <option value="0.4">Hide below 0.4×</option>
            <option value="0.42">Hide below 0.42× (default)</option>
            <option value="0.55">Hide below 0.55×</option>
            <option value="0.8">Hide below 0.8×</option>
          </Select>

          <Select
            label="Reduce visual effects above"
            value={String(settings.performanceThreshold)}
            onChange={(event) => updateSettings({ performanceThreshold: Number(event.target.value) })}
            hint="Transitions and gradients are disabled past this many nodes so interaction stays smooth."
          >
            <option value="200">200 servers</option>
            <option value="400">400 servers (default)</option>
            <option value="800">800 servers</option>
            <option value="2000">2,000 servers</option>
          </Select>

          <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3.5 py-1">
            <Toggle
              checked={settings.animateLayout}
              onChange={(animateLayout) => updateSettings({ animateLayout })}
              label="Animate layout changes"
              description="Automatically disabled above 250 nodes regardless of this setting."
            />
            <Toggle
              checked={settings.showEdgeLabels}
              onChange={(showEdgeLabels) => updateSettings({ showEdgeLabels })}
              label="Show protocol and ports on connections"
              description="Useful on a filtered view; noisy on a full policy."
            />
            <Toggle
              checked={settings.showDenyRules}
              onChange={(showDenyRules) => updateSettings({ showDenyRules })}
              label="Draw DENY connections"
              description="Turning this off shows permitted connectivity only."
            />
          </div>

          <Button
            variant="secondary"
            icon={Sliders}
            className="mt-2 w-full"
            onClick={() => updateSettings(DEFAULT_SETTINGS)}
          >
            Restore defaults
          </Button>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="3D network map"
          subtitle="The Network Map renders in 3D by default. Drag to rotate, scroll to zoom, right-drag to pan."
          icon={Boxes}
        />
        <div className="grid gap-4 border-t border-ink-100 px-5 py-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Select
              label="Default view"
              value={settings.topologyView}
              onChange={(event) => updateSettings({ topologyView: event.target.value as TopologyView })}
              hint="The 2D diagram remains available from the toolbar and is often easier for dense, detailed work."
            >
              <option value="3D">3D</option>
              <option value="2D">2D</option>
            </Select>

            <Select
              label="Render quality"
              value={settings.quality3d}
              onChange={(event) => updateSettings({ quality3d: event.target.value as Quality3D })}
              hint="Treated as a ceiling. The map lowers it automatically on a large estate, or if the frame rate on this machine cannot sustain it."
            >
              <option value="low">Fast — no ambient occlusion or reflections</option>
              <option value="balanced">Balanced (default)</option>
              <option value="ultra">Ultra — full effects, anti-aliasing</option>
            </Select>

            <Select
              label="Rotation"
              value={settings.controlMode3d}
              onChange={(event) => updateSettings({ controlMode3d: event.target.value as ControlMode3D })}
              hint="Orbit keeps the horizon level, which is easier to stay oriented in. Free allows rotation about every axis, including roll."
            >
              <option value="orbit">Orbit — horizon stays level</option>
              <option value="free">Free — rotate about all axes</option>
            </Select>
          </div>

          <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3.5 py-1">
            <Toggle
              checked={settings.showFlow3d}
              onChange={(showFlow3d) => updateSettings({ showFlow3d })}
              label="Show traffic flow"
              description="Packets travel along permitted connections. This is how direction is conveyed — an arrowhead is ambiguous when the camera can look straight down a connection."
            />
            <Toggle
              checked={settings.showFloor3d}
              onChange={(showFloor3d) => updateSettings({ showFloor3d })}
              label="Reflective floor"
              description="Grounds the scene and gives a sense of depth. The reflection renders the scene twice, so it is dropped automatically on very large estates."
            />
            <Toggle
              checked={settings.showLabels3d}
              onChange={(showLabels3d) => updateSettings({ showLabels3d })}
              label="Show server names"
              description="Past roughly 200 servers only the most connected are named, or the labels obscure the map."
            />
            <Toggle
              checked={settings.animate3d}
              onChange={(animate3d) => updateSettings({ animate3d })}
              label="Idle motion"
              description="A slow drift that keeps the scene feeling live. Disabled automatically above 400 servers."
            />
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="About this build" icon={SettingsIcon} />
        <div className="grid gap-x-8 border-t border-ink-100 px-5 py-2 sm:grid-cols-2">
          <div>
            <Field label="Application">Secure Workload Policy Visualiser</Field>
            <Field label="Analysis engine">Standalone TypeScript services, unit tested independently of the UI</Field>
            <Field label="Topology engine">three.js / React Three Fiber in 3D, Cytoscape.js in 2D</Field>
            <Field label="Data handling">Entirely in-browser; nothing is uploaded</Field>
          </div>
          <div>
            <Field label="Servers loaded">{dataset ? dataset.servers.length : '—'}</Field>
            <Field label="Rules loaded">{dataset ? dataset.rules.length : '—'}</Field>
            <Field label="Connections in graph">{graph ? graph.connections.length : '—'}</Field>
            <Field label="Importer">{dataset?.metadata.importer ?? '—'}</Field>
          </div>
        </div>
        <div className="border-t border-ink-100 px-5 py-4">
          <Callout tone="neutral" icon={Info}>
            This tool analyses network policy. It has no visibility of application-level dependencies, so it
            reports where connectivity changes and where service impact is possible — it never asserts that an
            application will or will not fail.
          </Callout>
        </div>
      </Card>
    </div>
  );
}
