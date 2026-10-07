# Roadmap

Keep this current. Move items between sections as they land; delete what stops being true.

## Done

- Free scene editor: sentence nodes, stacks, lines (OR / Wait-for-all AND), compile to `lib.flow`.
- Campaign mode on the same canvas, compile to a `lib.campaign` content table.
- Typed named inputs, grouped (slots by name prefix), searchable, drag-and-drop into sockets,
  click-to-search picker.
- Inputs screen with usage counts; SDK module browser with one-click add.
- Zoom (Ctrl + wheel, buttons, Fit) and pan.
- Custom nodes: action, wait (single event or re-checked condition), raw Lua node.
- Prefabs: fold a stack into a reusable node, rename its sockets, unpack it again.
- Node packs: export and import custom nodes between scenes.
- Lint for custom Lua: syntax (luaparse), sandbox-removed functions, "keeps state" marker.
- Whole-script syntax check on every compile.
- Desktop app (Electron), packaged to `release/`.
- Workspace saved to disk and restored on launch: drawing, open mission, unsaved text,
  screen, pan, zoom, selection, window size.
- Finds the Sunrise install (launcher preferences, or a chosen folder).
- Works on a plain folder of scripts too (for example a copy of the missions repository),
  optionally borrowing SDK keys from an install.
- Missions screen: lists scripts and unscripted activities, search, filter by kind.
- Opens a mission as: a saved drawing, an imported `campaign.new` script, an imported
  freeroam destination, or text.
- Freeroam mode: zones, public events and Lost Sectors on the canvas, compiled to a
  `lib.freeroam` script plus `content.lua`. Reads and rewrites all 9 real destinations.
- Text editor shows every Lua file in a mission's folder; folders of shared Lua are listed too.
- Loads the mission's scenario SDK module keys when it opens.
- Saves back to `Sunrise/scripts/`, keeping a hand-written script as `.lua.bak`.
- Slot types: read from the SDK, shown on inputs, enforced by sockets, checked on compile.
- Bungie's look: colour on both edges of a node, right-angled lines from bottom to top,
  orange triggers and green spawns. Local triggers ("Trigger local x", "When x").
- "Zavala's plaza" example: the scene from the GDC talk with the real Homecoming names.
- Mission mode: a Flow tab of legs and steps, scenes on their own tabs with outputs, leg
  tags, automatic trigger arming; compiled without `lib.campaign`. The opening of Homecoming
  (cutscene, Underwatch, steps home / gear / find, five scenes) is translated and installed.
- "Start scene" starts an authored scene with its cast (`spawn = true`), with "start bare" as
  the alternative; one note on the scene node names the squads the drawing also spawns from the scene's
  object (the SDK does not list casts, so it cannot say which of them are in it).
- "Send event N to scene" node: sends the Nth event key the SDK lists for a scene
  (`scene:send_event{key}`). `sdk.js` reads `event_keys` from the scene rows; needs an SDK from a
  Sunrise build newer than 0.5.1.
- Runs on Linux as well as Windows: packaging by a Node script, case-blind install lookup,
  launcher preferences looked for in the XDG folders, Wine `Z:\` paths understood. Unit tests,
  smoke run and a packaged arm64 build were run on Ubuntu under WSL; not yet on a real Linux
  desktop, and not against a real Proton install.
- "Play sequence" node in every mode (an authored sequence on a type-5 slot).
- Highlight several nodes (Shift/Ctrl-click, Shift-drag a box, Ctrl+A), move or delete them
  together, and copy, cut and paste them (Ctrl+C/X/V or the Copy/Paste buttons). A paste keeps
  snaps and lines between the copied nodes, brings their inputs into the target drawing, gives a
  copied step/leg/encounter its own id, and leaves out nodes that do not fit the canvas.
  `copyNodes`/`pasteNodes` in `state.js`; the clipboard lives in the page, not the system one,
  so it lasts until the app closes and does not cross app windows.
- Unit tests, plus an end-to-end smoke run of the real app.

## Known gaps

- Campaign mode's "Start scene" still starts the scene bare, because `lib.campaign` does.
- **Scene events are numbered two ways.** The editor's "Send event N" is the position in the
  SDK's `event_keys` list; Sunrise's gates also have an ordinal, which the Lua SDK does not
  print. Reading one for the other cost an afternoon (see "Authored scenes" in docs/SUNRISE.md).
  Wanted: show each event's key on the node and on the Inputs screen, and take the ordinal
  from the SDK if Sunrise starts printing it. What each event of a scene does is only known
  by trying it in game; nothing records that yet.
- "Start scene" does not wait for anything. Whether a scene needs its opening event (the key
  first in every list) is unknown; the Cayde scene played without it.
- A scene tab's "When this scene is run" fires when the leg's area is selected, which can be
  before the player has arrived (seen in the log: 0.3 s early). A scene started then did not
  play. The tab should wait for the arrival report.
- A scene the host refuses after the script asked for it is silent: the refusal is not a Lua
  error, so the script cannot see it or fall back.

- **Mission mode has been played only as far as Homecoming's Underwatch leg**, by the author,
  with the first-contact, centurion and Cayde scenes started and sent events from the script.
  Whether the steps advance correctly to the end of "find" has not been reported.
- Mission mode, not built yet: per-scene typed inputs (reuse), stopping or restarting a
  scene, steps that can be skipped ahead (lib.campaign's non-barrier behaviour), more Until
  kinds (squads cleared, Ghost scan, health, destroyed), an importer from `campaign.new`
  drafts, a mission-mode example.
- Mission mode spends one saved variable per node (lib.flow). The compiler warns at 400 of
  the game's 512 and refuses above; a whole mission will need a tighter runtime.

- Free scenes, campaign mode and freeroam output have not been played in the game at all.
- The test fixture's SDK files are still made up; they match the real layout in the ways the
  code depends on, but should be replaced with trimmed copies of real modules.
- From Bungie's tool, not built yet: "until" on long-running nodes, "If" / "If not",
  "Randomizes", a wait range, output triggers, loops. Lines do not route around nodes.
- The Zavala example cannot say "becomes immovable / passive / untargetable", "targets", or the
  cover and firing animations: Sunrise documents no request for them.
- Importer: only `campaign.new` scripts. Comments are not kept. Local helper functions used
  from `on_start` are not carried over (warned). `finish`, task groups on squads and unknown
  fields are dropped (warned).
- Social spaces, `adventure_ginger`, the raid and `cine_110_twr` open as text only. They are
  hand-coded Lua, not a table a library reads, so there is nothing structured to draw. The
  three social spaces share one pattern (see docs/SUNRISE.md) and are the best candidate for
  a fourth mode; the others would need a general Lua-to-nodes importer, which cannot be
  faithful.
- Freeroam: no nodes for the sector fields no script uses yet (doors, blockers, crystals,
  shield, gates). No freeroam example. Custom nodes and prefabs do not apply.
- The launcher may overwrite `scripts/`; the app does not detect or guard against that
  beyond the `.bak` it makes itself.
- Prefabs: free scene only; steps are edited by unpack → edit → make again; no nesting.
- Custom waits and prefabs do not exist in campaign mode (lib.campaign has no hook).
- Campaign: no task groups on encounter squads, no `finish` hook, one scene per step.
- Free scene: no checkpoints or wipe/restart, no interruptible ("until") actions.
- A custom wait on `client_state_changed` only sees the arrival report (`entered == true`).
- No undo/redo. The clipboard for copied nodes is the app's own, not the system one.
- Request argument names and slot types are not checked for custom Lua.
- Packaging makes a folder with an `.exe`, not an installer; no app icon; not code-signed.

## Ideas, unranked

- Carry local helper functions over on import (a "preamble" Lua block for the script).
- Built-in nodes for the documented calls listed in docs/SUNRISE.md as not yet covered.
- Live highlighting of the running step by reading the Mission state variables
  (`flow.<key>.step.<id>`), as in the talk's demo.
- Slot-type hints on sockets (trigger vs device vs sensor) from SDK data rather than prefixes.
- Watch the script folder and warn when a file changes underneath the open mission.
- Comments and grouping boxes on the canvas; automatic layout.
- An installer (electron-builder) and auto-update.
