# Secure Workload Policy Visualiser

**Before you change a network rule, see exactly what connectivity changes, which systems could be
affected, whether equivalent access already exists, whether you are duplicating a rule, and whether
you might remove an important network path.**

Upload a policy export and it becomes an interactive 3D topology. Propose a change and it tells you
— in plain English, with the evidence — what that change actually does.

Everything runs in your browser. Nothing is uploaded anywhere.

![Status](https://img.shields.io/badge/tests-130%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License](https://img.shields.io/badge/license-none%20yet-lightgrey)

---

## Contents

- [What problem this solves](#what-problem-this-solves)
- [Quick start](#quick-start)
- [The features, page by page](#the-features-page-by-page)
- [The 3D network map](#the-3d-network-map)
- [How the analysis works](#how-the-analysis-works)
- [What it will not tell you](#what-it-will-not-tell-you)
- [Architecture](#architecture)
- [Adding your own data format](#adding-your-own-data-format)
- [Performance](#performance)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Status and scope](#status-and-scope)

---

## What problem this solves

Microsegmentation policies get large fast. A few hundred workloads and a few thousand rules later,
nobody can answer simple questions with confidence:

- If I delete this rule, what stops working?
- Does something else already permit this traffic, or is this rule the only thing holding it up?
- Am I about to add a rule that already exists?
- Is there an ALLOW and a DENY fighting over the same traffic?
- Which servers could be affected by this change, and *why* each one?

Spreadsheets do not answer those. This does — before you touch anything.

---

## Quick start

### Windows

Double-click **`start.bat`**. It checks Node is installed, installs dependencies the first time,
builds, serves on **http://localhost:15455** and opens a browser.

**`stop.bat`** shuts it down from another window (or press Ctrl+C in the server window).

| Command | What it does |
| --- | --- |
| `start.bat` | Build if there is no build, then serve on port 15455. |
| `start.bat dev` | Development server with hot reload, same port. |
| `start.bat clean` | Delete `dist\` and rebuild from scratch, then serve. |
| `stop.bat` | Stop whatever is listening on port 15455. |

> Use **`localhost`**, not `127.0.0.1`. The server binds to localhost only — deliberately, so policy
> data is never exposed on your network — and on most modern systems that resolves to IPv6 `[::1]`.

### Any platform

Requires **Node.js 20+**.

```bash
npm install
npm run dev       # dev server on http://localhost:15455
npm run build     # typecheck + production build
npm start         # serve the build and open a browser
npm test          # analysis engine unit tests
npm run lint
```

### No data to hand?

Click **Load Demo Environment** — 50 servers, 149 rules, and a handful of deliberate policy
problems to find (a duplicate rule, two unresolved endpoints, plenty of broad administrative
access).

---

## The features, page by page

| Page | What it gives you |
| --- | --- |
| **Dashboard** | Totals, charts and a topology overview. Every statistic is clickable and takes you to the filtered view behind it. |
| **Network Map** | The interactive 3D diagram. Six layouts, filtering, focus mode, multi-select, before/after difference overlay. A 2D view is one click away. |
| **Servers** | Every server with its inbound/outbound rules, ports, neighbours and dependencies. Cards or table. |
| **Rules** | Searchable, sortable table of every rule. Edit, clone, disable, delete, or analyse. |
| **Ports** | Port-by-port usage with friendly names for well-known services, and counts of rules, servers, allows and denies. |
| **Path Explorer** | Every permitted route between two servers, hop by hop with the rule at each hop — or a clear statement that no permitted path exists. |
| **Change Analysis** | Propose a change and see its full impact before applying it. The centrepiece. |
| **Conflicts** | Automatically generated issues list: duplicates, ALLOW/DENY conflicts, port overlaps, redundant rules, overly broad rules, missing servers, isolated servers. |
| **Change History** | Session change log with before/after states, undo, redo and revert-all. |
| **Import / Export** | Load a policy, review the validation report, export the working state as JSON or CSV. |
| **Settings** | Analysis depth and rendering preferences. |

### Import validation

Malformed input never crashes the app. It is read as far as possible and everything odd is
reported: duplicate IDs, unknown source or destination references, malformed ports, unrecognised
protocols and actions, invalid or duplicated IP addresses, missing fields.

Rules pointing at endpoints that are not in the inventory are **kept**, with the endpoint drawn as
an unresolved node — because a rule referencing something you cannot account for is exactly the
thing you want to see, not silently drop.

### Change Analysis

Propose an **add, modify, delete or disable** and get, before anything is applied:

- **Connections added / removed / modified**, each described in a sentence
- **Blast radius** — direct, 1-hop, 2-hop and downstream, with the reason each server is listed
- **Potential service impact** — connectivity the change removes, and whether equivalent access remains
- **Alternative path analysis** — if another rule still permits the same traffic, which one
- **Paths created and removed** — multi-hop routes that appear or disappear
- **Ports opened and closed**, per server pair
- **Duplicate, conflict, overlap and redundancy checks** against the existing policy
- **Security exposure notes** — administrative ports, database access, cross-environment or unrestricted access
- **A risk rating** (LOW / MEDIUM / HIGH / CRITICAL) with every point attributed to a named factor
- **An exportable impact report** — JSON, CSV or printable

The **before / after topology** switches between Current, Proposed and Difference, with added,
removed, modified and unchanged connections distinctly marked.

---

## The 3D network map

The map renders in **3D by default**, using three.js through React Three Fiber.

**Camera** — drag to rotate, scroll to zoom, right-drag to pan. Two rotation modes:

- **Orbit** (default) keeps the horizon level, so it is easy to stay oriented. The polar range is
  unclamped, so the camera passes freely over and under the graph.
- **Free** rotates about every axis including roll.

**Reading the scene**

- Each server is a solid whose **silhouette encodes its role** — a slab for web, a sphere for
  application, a cylinder for database, a hexagonal prism for API, a cube for file, an octahedron
  for monitoring, a dodecahedron for management, a tetrahedron for an unresolved endpoint. Role is
  never carried by colour alone, which matters more in 3D than on a flat diagram because lighting
  changes apparent hue.
- Connections are **arcs**, not straight lines, so several rules between the same pair fan out
  instead of overlapping exactly.
- Direction is shown by **packets travelling along the connection**, not arrowheads. An arrowhead
  is ambiguous once the camera can look straight down a connection; motion is not.
- Green is permitted, red is blocked — the same language as the 2D view, difference mode and the
  blast-radius rings.

**Layouts**

| Layout | In three dimensions |
| --- | --- |
| Force directed | A 3D force simulation (`d3-force-3d`), settled before the first frame. |
| Hierarchical | Tiers stacked vertically, management at the top through to databases at the base. |
| Circular | An even shell around a sphere, ordered by connection count. |
| Grouped by role / environment / zone | One island per group, spread on a ring. |

**Realism** comes from a physically-based render: metal-and-clearcoat materials, a key / fill / rim
light rig, soft shadows, a blurred reflective floor, ambient occlusion, bloom on the emissive
accents and ACES filmic tone mapping. The environment map is built from emissive panels in-scene
rather than a downloaded HDRI, so there is nothing to fetch and it works offline.

**It adapts to your hardware.** The quality setting is a ceiling, not a demand. Quality drops
automatically on a large estate, and a frame-rate watchdog steps it down further if the scene
cannot hold a usable frame rate on the machine it is running on. It only ever reduces — stepping
back up on a brief recovery would oscillate, which is more distracting than a slightly conservative
picture.

The 3D renderer is code-split and loaded on demand, so working in 2D costs nothing.

---

## How the analysis works

### Connectivity is a five-tuple

```
SOURCE → DESTINATION → PROTOCOL → PORT → ACTION
```

Two connections are identical only when **all five** match.

- `APP01 → DB01 TCP 1433` is a different connection from `APP01 → DB01 TCP 5432`
- `APP01 → DB01 TCP 1433` is a different connection from `DB01 → APP01 TCP 1433`

Direction matters. Protocol matters. Port matters. Action matters. This holds everywhere in the
engine, and the test suite asserts each of those cases explicitly.

### Ports are ranges, not numbers

Ports are parsed into merged, sorted ranges, so coverage becomes set arithmetic. That is what makes
the interesting questions answerable rather than guessed:

- `1400-1500` genuinely covers `1433`, so a narrow rule can be shown as **potentially redundant**
- several narrow rules can **collectively** cover a broad one, and that is detected
- removing a rule can be tested for whether the remaining rules still cover the same ports

### Risk is deterministic

The rating is a transparent score. Every point comes from a named factor with an explanation, and
the raw counts are shown beside the rating so the label never has to be taken on trust:

```
CRITICAL   (deterministic score 15)

+3  51 servers within the blast radius
+2  1 permitted connection removed
+2  No alternative path detected for 1 removed connection
+2  1 database connection potentially lost
+1  1 existing permitted path removed
+3  Removed connectivity is used within 10 existing network paths
+2  1 production server directly affected
```

---

## What it will not tell you

This is important, and the wording throughout the application is deliberate.

**The dataset describes network policy. It does not describe application dependencies.** So the
tool never claims an application will break. It reports what it can actually demonstrate:

> Removing this rule means **app-srv-03** will no longer have a permitted TCP 1433 connection to
> **db-srv-06**. No alternative network path detected. This connection is also used within 10
> existing network paths.

Findings use *potential service impact*, *potential connectivity loss*, *may affect*, and *no
alternative network path detected*.

**ALLOW/DENY conflicts are reported without declaring a winner.** Rule precedence is not present in
this data, so the tool says the rules target the same traffic with different actions and that
precedence must be checked — rather than inventing an answer.

Other honest limits:

- Rules referencing endpoints missing from the inventory are flagged, not resolved
- Path finding is bounded by a configurable maximum hop count
- The blast radius is a **reachability estimate** through permitted connections, not a prediction of failure
- "High risk" uses conventional definitions (administrative ports, database ports, unrestricted
  access, cross-environment traffic) — it is not a scored threat model

---

## Architecture

### The analysis engine is independent of the interface

Every piece of policy reasoning lives in `src/services` as plain TypeScript functions that take
data and return data. They import nothing from React, and are tested — and reusable — on their own.

| Function | File | Responsibility |
| --- | --- | --- |
| `parseImport()` | `services/parseImport.ts` | Entry point for external documents. Never throws. |
| `validateDataset()` | `services/validateDataset.ts` | Produces the full validation report. |
| `buildGraph()` | `services/graph.ts` | Builds the directed, port-qualified policy graph. |
| `findDuplicates()` | `services/duplicates.ts` | Exact duplicate rules. |
| `findOverlaps()` | `services/duplicates.ts` | Rules sharing ports on the same directed pair. |
| `calculateRuleCoverage()` | `services/duplicates.ts` | Whether other rules collectively provide the same access. |
| `findRedundantRules()` | `services/duplicates.ts` | Rules already covered by a broader rule. |
| `findConflicts()` | `services/conflicts.ts` | ALLOW/DENY pairs targeting the same traffic. |
| `findAllowedPaths()` | `services/paths.ts` | Every permitted route between two servers. |
| `findAlternativePaths()` | `services/paths.ts` | Whether equivalent connectivity survives a removal. |
| `calculateAffectedServers()` | `services/impact.ts` | Servers named directly by a change. |
| `calculateBlastRadius()` | `services/impact.ts` | Outward expansion, with a reason per server. |
| `comparePolicies()` | `services/compare.ts` | Added / removed / modified / unchanged connections. |
| `detectPotentialBreakage()` | `services/compare.ts` | Connectivity a change would remove. |
| `analyseChange()` | `services/analyseChange.ts` | Orchestrates the whole before/after analysis. |

### Three states, kept apart

- **`originalDataset`** — exactly as imported. Never mutated. `Revert all` restores it.
- **`workingDataset`** — the current state including applied changes.
- **`proposedChange`** — a change being evaluated but *not* applied.

`analyseChange()` derives a proposed rule list, builds a second graph from it, and compares the
two. The dataset it is given is never modified; a unit test asserts exactly that.

Changes are modelled as a change-set:

```ts
{
  changeId: string,
  type: 'ADD_RULE' | 'MODIFY_RULE' | 'DELETE_RULE' | 'DISABLE_RULE' | 'ENABLE_RULE',
  originalRule: Rule | null,
  proposedRule: Rule | null,
  analysis: ChangeAnalysis | null,
}
```

### Built with

React 19 · TypeScript (strict) · Vite · Tailwind CSS · Zustand · three.js + React Three Fiber
(3D) · Cytoscape.js + fCoSE (2D) · Recharts · Lucide · Vitest

---

## Adding your own data format

`src/services/importers/` is the **only** place that knows about source document shapes. An
importer translates a vendor document into the canonical `Dataset` and reports what it could not
read:

```ts
export interface DatasetImporter {
  id: string;
  label: string;
  detect(document: unknown): number;          // confidence, 0–1
  parse(document: unknown, ctx): ImporterOutput;
}
```

Write one, register it in `registry.ts`, and you are done. Nothing in the analysis engine or the
interface changes. The architecture was built with these in mind:

- Cisco Secure Workload native exports and API
- Cisco ASA / ACI
- Palo Alto security policy
- AWS Security Groups, Azure Network Security Groups
- ServiceNow change requests

The bundled `genericImporter` already absorbs a good deal of variation: `consumer`/`provider` or
`source`/`destination`, endpoint references by id, name or IP, role and environment synonyms
(`frontend` → WEB, `production` → PROD, `bastion` → MANAGEMENT), ports as numbers, strings, comma
lists or ranges, and `enabled: false` inverted into `disabled`.

### Expected input shape

```json
{
  "servers": [
    { "id": "srv-001", "name": "web-srv-01", "ip": "10.10.10.11",
      "role": "WEB", "environment": "PROD", "os": "Ubuntu 22.04", "zone": "DC2" }
  ],
  "rules": [
    { "id": "rule-001", "name": "web-to-app", "consumer": "web-srv-01", "provider": "app-srv-09",
      "protocol": "TCP", "ports": [8080, 8443], "action": "ALLOW",
      "description": "Web tier may connect to assigned application server." }
  ]
}
```

---

## Performance

Measured in Chrome on a synthetic estate of **1,000 servers and 5,994 rules**:

| Operation | Time |
| --- | --- |
| Import, parse, validate and render the dashboard | ~1.3 s |
| Servers / Rules / Ports / Conflicts pages | 0.4–0.8 s |
| 2D network map, force layout, to interactive | ~3.9 s |
| 3D network map, force layout, to interactive | ~2.0 s |

What makes that possible:

- **Shared derived state.** Graph, issue, summary and port-usage computations are cached at module
  level keyed on dataset identity, so hundreds of components share one computation rather than each
  rebuilding the graph.
- **Paged tables.** Rule, server and port tables render 200 rows at a time; the server card grid
  grows on demand.
- **Incremental graph updates.** The 2D canvas diffs elements rather than rebuilding, and runs a
  layout only when the node set or layout mode actually changes.
- **Zoom-aware labels.** Labels are suppressed below a zoom threshold that scales with node count.
- **Instanced 3D geometry.** One draw call per role rather than one per server, merged line
  geometry for connections, and a per-frame particle budget that shrinks as the policy grows.
- **On-demand 3D.** three.js and its ecosystem are a separate chunk, fetched only when needed.

---

## Testing

```bash
npm test
```

**130 unit tests** covering the analysis engine independently of the interface:

- port parsing, ranges, merging, coverage, subtraction, well-known service naming
- exact duplicates — and the cases that are **not** duplicates: different port, different protocol,
  reverse direction, different action
- ALLOW/DENY conflicts including partial port overlap, and that no winner is declared
- port range overlap and redundancy detection
- rule coverage by a single broader rule *and* by a combination of rules
- multi-hop path finding, cycles, hop limits, direction, DENY traversal
- removing the only allowed path, and removing a rule where an equivalent one remains
- blast radius levels, depth limits, and that DENY connections are not traversed
- risk scoring: every point attributable to a factor, and no-op changes scoring zero
- invalid server references, invalid ports, unknown protocols, duplicate ids, malformed documents
- the supplied 50-server sample end to end, including a serialisation round-trip

---

## Project layout

```
src/
  types/            Canonical domain model
  services/         Analysis engine (no React)
    importers/      Source-format adapters
  store/            Zustand store + memoised derived state
  components/
    ui/             Design system primitives
    layout/         Sidebar, top bar, global search
    topology/       Cytoscape canvas, layouts, stylesheet, filters, legend
    topology3d/     three.js scene: 3D layouts, instanced nodes, arcs, lighting
    panels/         Server, connection, rule builder, impact analysis
    charts/         Recharts wrappers
    upload/         Drop zone and validation report
  pages/            One file per navigation item
  tests/            Analysis engine unit tests
```

---

## Status and scope

**What this is:** a working analysis and visualisation tool that runs entirely in the browser.

**What this is not, yet:** despite "Automation" in the repository name, there is **no automated
remediation and no write-back to any controller**. It does not connect to Cisco Secure Workload or
any other system. It reads a file, analyses it, and lets you simulate changes in memory. Applied
changes affect the in-browser working copy only and can be exported as JSON — they are never pushed
anywhere.

The importer layer is deliberately modular so live API integration can be added without disturbing
the analysis engine, but that work has not been done.

### About the sample data

`Rules/cisco_secure_workload_50_servers_sample.json` is **synthetic test data**. It self-declares
as such, uses RFC 1918 private addresses (`10.10.x.x`) in sequential blocks, and has generic
hostnames. It is not an exact Cisco Secure Workload API export schema, and it does not come from
any real environment.

### Licence

No licence file is present yet, which means default copyright applies — all rights reserved. If you
intend others to use, modify or distribute this, add a licence (MIT and Apache-2.0 are the usual
choices).

### A note on privacy

Policy exports describe your internal network in detail. This application reads files entirely in
the browser and never transmits them. The dev server binds to localhost only, deliberately, so
nothing is exposed on your network. If you add real exports to a clone of this repository, keep
them out of version control — `.gitignore` already reserves `/private-data/` and `*.private.json`
for that purpose.
