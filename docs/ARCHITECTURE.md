# Architecture

Vanilla JavaScript ES modules, bundled by Vite and shown in an Electron window. One runtime
dependency: `luaparse`, used to syntax-check Lua and to read existing scripts. No framework.

Packaging is `scripts/dist.mjs` (the `@electron/packager` API, same on every system). The file
layer finds an install's folders without regard to case (`below()` in `electron/files.cjs`),
because on Linux the game folder is a Windows one run through Proton or Wine.

## Desktop shell

| file | holds |
|---|---|
| `electron/main.cjs` | The window, the workspace file, and the IPC handlers. Loads `dist/index.html` (or `SUNRISE_SCENES_DEV=<url>`). `--smoke` runs `smoke.js` in the page and exits. |
| `electron/preload.cjs` | The only bridge: exposes `window.desktop` (load/save state, find/choose the Sunrise folder, list/read/write missions, find an SDK module). |
| `electron/files.cjs` | All disk logic, plain Node so tests can call it: `chooseRoot`, `describeRoot`, `resolveInstall`, `resolveSdk`, `findSunrise`, `listMissions`, `readMission`, `writeMission`, `sdkFor`. |
| `electron/smoke.js`, `scripts/smoke.mjs` | The end-to-end check: page-side steps, and the runner that launches the app twice. |

The same page runs in a plain browser (`npm run dev`); there `window.desktop` is absent, so
`api` in `src/desktop.js` is null, the Missions tab stays hidden and the document autosaves
to localStorage instead.

**Workspace.** `workspace.json` in Electron's user-data folder for the app (on Windows,
`%APPDATA%/Sunrise Scenes/`; `SUNRISE_SCENES_USERDATA` overrides it for tests) holds
`{ version, doc, session, ui, bounds }`: the document, the session (`root`, `sdkDir`, `mission`,
unsaved `text`, `savedLua`, import `notes`, `sdkPath`), the view state (screen, pan, zoom,
selection, node being edited) and the window bounds. It is rewritten 400 ms after any change
and once more when the window closes. On start the app restores all of it and re-reads the
open mission's SDK module.

**Missions on disk.** `root` is either a Sunrise install (`<game>/bin/x64/Sunrise`, with
missions under `scripts/` and the SDK under `sdk/lua/`) or a plain scripts folder (any
folder whose subfolders are missions, such as a copy of the missions repository). A plain
folder has no SDK, so `session.sdkDir` can name one to borrow; it is filled in automatically
when an install is found. `files.chooseRoot` decides what a picked folder is. A mission is
`<name>/<name>.lua`. Saving a drawing also writes `<name>.scene.json` beside it,
which is what makes it reopen exactly. Kinds: `scene` (has the sidecar), `campaign`
(hand-written `campaign.new`, imported to the canvas), `freeroam` (`freeroam.new`, imported
with its `content.lua`), `lua` (anything else, text editor), `helpers` (a folder of Lua with
no script of its own, such as `lib`; text editor), `none` (an activity from
`sdk/lua/activities.lua` with no script). A mission may be several Lua files: `readMission`
returns them all as `files`, and `writeMission(root, name, lua, scene, extra)` writes any of
them, backing each hand-written one up once.

## Modules

Pure (run in Node, covered by tests):

| file | holds |
|---|---|
| `src/catalog.js` | Built-in node types (sentence templates), input kinds, input grouping, event list, the template parser, and the registry that turns custom definitions into node types. `T(type)` returns a type; `setCustom(defs)` refreshes the registry. |
| `src/graph.js` | `graphOf(nodes)` (node / parent / chain / heads) and `sentence(n, inputs, nodeOf)`. |
| `src/state.js` | The document `S` (a live export; replace it with `setDoc`), load/save, every mutation (inputs, nodes, mode switch, custom nodes, make/unpack prefab), and the example mission. |
| `src/lualint.js` | `syntaxError`, `sandboxProblems`, `lintDef` for custom node definitions. |
| `src/sdk.js` | `parseSdk(text)`: best-effort reader for a generated mission module. |
| `src/compile/base.js` | Shared compiler pieces: problems, header, input table, `fillLua` (socket placeholders), definition and socket checks. |
| `src/compile/scene.js` | `flowGraph` (one drawn graph → `lib.flow` facts and steps, shared with mission mode), `compileScene` (a free scene as a whole script), `expandPrefabs`. |
| `src/compile/campaign.js` | Campaign drawing → `campaign.new{...}` content table. |
| `src/compile/freeroam.js` | Freeroam drawing → a short main script plus `content.lua` (the zone table). Refers to `mission.Squad.X` directly: a destination names thousands of squads, too many for an input table inside the 128 KiB main-script limit. |
| `src/compile/mission.js` | Mission mode: flow + scenes → one self-contained script (no `lib.campaign`). |
| `src/compile/index.js` | `compile(doc) → { lua, files, shown, problems, stem }`: the main script, any further files by name, everything joined for display, plus a syntax check of each file. |
| `src/luaEval.js` | `parseLua` and `evaluator()`: reads what a script declares (locals, tables, references into the mission module, calls to `campaign.*` / `freeroam.*`, calls into another file of the mission) without running it. Shared by the importers. |
| `src/importFreeroam.js` | `importFreeroam(lua, files, activity)`: reads `freeroam.new{zones = ...}`, following `content(mission, freeroam)` into `content.lua`, into a freeroam drawing. |
| `src/importCampaign.js` | `importCampaign(lua, activity) → { doc, warnings, scenario }` or `{ error }`. Parses a hand-written `campaign.new{...}` script, evaluates its locals and tables statically, and builds the campaign drawing. `on_start` bodies become device nodes where they are `move(...)` calls and Lua nodes otherwise, with the file's short names (`Slot.X`, `cue.CUE_1`) spelled out. |

Page:

| file | holds |
|---|---|
| `src/main.js` | Entry. `boot()` restores the workspace; top bar, file open/save, and the `changed` / `go` hooks. |
| `src/desktop.js` | `api` (the preload bridge or null), `session`, `persist` / `persistNow`. |
| `src/ui/missionsView.js` | Missions screen, `openMission`, `saveMission`, `isDirty`, the header's mission bar and import notes. |
| `src/ui/textView.js` | Text editor for scripts the canvas cannot draw. |
| `src/ui/dom.js` | `$`, `el`, `download`, `ui` (view state), `changed`, `go`, `track`, `pressThenDrag`. |
| `src/ui/canvas.js` | Node rendering (`nodeElement`, `paramControl`), stacks, lines, drag, snap, pan, zoom, prefab buttons. |
| `src/ui/sockets.js` | Sockets, chip drag-and-drop, the searchable picker. |
| `src/ui/sidebar.js` | Input chips by group, node palette. |
| `src/ui/inputsView.js` | Inputs screen and SDK browser. |
| `src/ui/nodesView.js` | Nodes screen: custom node editor, prefab editor, packs, reference. |
| `src/ui/output.js` | Lua pane and problems list. |

UI modules never import `main.js`. They call `changed(what)` and `go(view, focus)` from
`dom.js`; `main.js` assigns the real handlers. `changed()` saves and recompiles;
`changed('nodes')` also redraws the canvas; `changed('all')` redraws the current screen.

## The document

```js
{
  meta: { activity, scenario, initial, mode },     // mode: 'scene' | 'campaign' | 'freeroam'
  inputs: [{ id: 'i12', kind, name, key }],        // kind: State|Slot|Squad|Scene|Directive|Cue
  custom: [ /* custom node definitions, below */ ],
  nodes: [{ id, type, x, y, next, params }],       // the graph of the mode on screen
  wires: [{ from, to }],
  graphs: { <mode>: { nodes, wires } },            // the graphs of the modes not on screen
  collapsed: [], seq
}
```

`next` is the node snapped underneath. A stack is a chain of `next`. `setMode` stores
`nodes/wires` in `graphs` under the old mode and takes the new mode's out. Node params hold input ids for sockets, arrays for list sockets,
node ids for `@c_leg` / `@c_enc` picks.

Custom definitions (`id` is `u_<n>`, used as the node `type`):

```js
{ id, kind: 'action', mode: 'both'|'scene'|'campaign', template, run }
{ id, kind: 'wait', template, start, event, listen, cond }     // event '' = re-check on `listen`
{ id, kind: 'prefab', template, body: [{ type, params }] }     // '$name' in params = a prefab socket
```

## Sentence templates

`{name:Kind}` socket · `?` optional · `*` list · `{name:=a|b}` choice (`a=x` sets the Lua
value) · `{name:num}` · `{name:text}` · `{name:flag}` · built-ins only: `{name:id}`,
`{name:code}`, `{name:@c_leg}`.

In custom Lua: `{name}` is replaced by the socket's value, `{name.slot}` by the twin slot of
a Squad/Scene, `{node}` by a string unique to the node. `input.some_name` is honoured and
pulls that input into the generated input table.

## How compilation works

**Free scene.** Prefabs are expanded in place. For each node, predecessors = the node above
plus every line in. Nodes are ordered by when they can first start; unreachable ones are
warned about and skipped. Each node becomes one `lib.flow` step: `after = {...}` for one
predecessor or a Wait-for-all, `when = flow.any(marked(...))` for a whichever-first join
(sources get a small marker step). Waits become facts gated on the event kind being handled
(`kind == "..."`), because `graph:handle` shows every event to every fact.

**Mission.** `src/compile/mission.js`. The Flow tab is read into legs and steps; each scene tab
goes through `flowGraph` (the same code that compiles a free scene) with a `begin` clause that
holds it until a step has run it and, if it is tagged with a leg, until the player is in that
leg. Every graph is its own `lib.flow` graph; they are kept in `GRAPHS`, each event is offered
to all of them, then all are advanced twice. They talk through attempt-scoped marks:
`m.on.<tab>` (a step ran the scene) and `m.out.<tab>.<name>` (the scene fired an output). The
file also carries what `lib.campaign` does for the client: opening cutscenes with the spawn
held, `OMIT` for interactable objects, re-arming waiting triggers and re-sending the goal on
entering an area.

In the document, mission mode keeps `mission: { tabs: [{ id, name, leg, nodes, wires }], active }`.
As with modes, the tab on screen has its graph in `nodes` / `wires` and its own entry holds
null; `tabsOf(doc)` gives every tab with its graph. Problems carry a `tab` so the UI can mark
and jump to the right one.

**Freeroam.** Each Zone stack is one zone: its state, region, patrol and ambient squads, with
Public event and Lost Sector nodes stacked under it. Zones are written in region order.

**Campaign.** The Campaign stack gives setup, cutscenes, legs and the omit list. The story
stack is cut into steps at each Step node; blue nodes become `lines` / `on_start`, Until
nodes become `ends`. Each Encounter stack is one encounter; a line from a Step sets `after`.

## Adding a built-in node

1. Add the type to `BUILTIN` in `catalog.js` with a sentence that reads true.
2. Emit its Lua: a `case` in `scene.js`, or handling in `campaignModel` / `compileCampaign`.
3. If it waits on a new event kind, make sure the kind is in `EVENT_KINDS`.
4. Add a test asserting the emitted call and that the output parses.
5. If it uses an API call not yet in docs/SUNRISE.md, document it there first.
