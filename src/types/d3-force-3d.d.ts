/**
 * Minimal typings for `d3-force-3d`.
 *
 * The package ships no types and there is no @types entry for it, so only the
 * surface this application actually uses is declared here.
 */
declare module 'd3-force-3d' {
  export interface SimulationNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLink<N> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
  }

  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], random?: () => number, numDimensions?: number) => void;
  }

  export interface LinkForce<N, L> extends Force<N> {
    links(): L[];
    links(links: L[]): this;
    id(accessor: (node: N, index: number, nodes: N[]) => string): this;
    distance(value: number | ((link: L, index: number, links: L[]) => number)): this;
    strength(value: number | ((link: L, index: number, links: L[]) => number)): this;
    iterations(value: number): this;
  }

  export interface ManyBodyForce<N> extends Force<N> {
    strength(value: number | ((node: N, index: number, nodes: N[]) => number)): this;
    theta(value: number): this;
    distanceMin(value: number): this;
    distanceMax(value: number): this;
  }

  export interface CenterForce<N> extends Force<N> {
    x(value: number): this;
    y(value: number): this;
    z(value: number): this;
    strength(value: number): this;
  }

  export interface AxisForce<N> extends Force<N> {
    x?(value: number | ((node: N, index: number, nodes: N[]) => number)): this;
    y?(value: number | ((node: N, index: number, nodes: N[]) => number)): this;
    z?(value: number | ((node: N, index: number, nodes: N[]) => number)): this;
    strength(value: number | ((node: N, index: number, nodes: N[]) => number)): this;
  }

  export interface CollideForce<N> extends Force<N> {
    radius(value: number | ((node: N, index: number, nodes: N[]) => number)): this;
    strength(value: number): this;
    iterations(value: number): this;
  }

  /** `L` is part of the public shape even though this interface only uses `N`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface Simulation<N, L> {
    tick(iterations?: number): this;
    stop(): this;
    restart(): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(value: number): this;
    alphaMin(value: number): this;
    alphaDecay(value: number): this;
    alphaTarget(value: number): this;
    velocityDecay(value: number): this;
    numDimensions(value: number): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    randomSource(source: () => number): this;
  }

  export function forceSimulation<N extends SimulationNode, L = SimulationLink<N>>(
    nodes?: N[],
    numDimensions?: number,
  ): Simulation<N, L>;

  export function forceLink<N, L>(links?: L[]): LinkForce<N, L>;
  export function forceManyBody<N>(): ManyBodyForce<N>;
  export function forceCenter<N>(x?: number, y?: number, z?: number): CenterForce<N>;
  export function forceCollide<N>(radius?: number | ((node: N) => number)): CollideForce<N>;
  export function forceX<N>(x?: number | ((node: N) => number)): AxisForce<N>;
  export function forceY<N>(y?: number | ((node: N) => number)): AxisForce<N>;
  export function forceZ<N>(z?: number | ((node: N) => number)): AxisForce<N>;
  export function forceRadial<N>(radius: number, x?: number, y?: number, z?: number): AxisForce<N>;
}
