# Sunrise Scenes

A desktop app (Electron) for visually scripting Project Sunrise missions. Project Sunrise is
the Destiny 2 offline preservation mod; its missions are Lua scripts. The editor design
follows Evan Moran's GDC talk "Walking, Talking and Projectiles: Storytelling Tools in
Destiny 2".

Read these before changing anything non-trivial:

- [docs/DESIGN.md](docs/DESIGN.md) — the rules the editor holds to, and why. Check new features against them.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, the document and workspace formats, how to add a node.
- [docs/SUNRISE.md](docs/SUNRISE.md) — what is known about the Sunrise scripting runtime, its libraries and its files on disk.
- [docs/ROADMAP.md](docs/ROADMAP.md) — done, known gaps, ideas. Update it when a feature lands.

## Commands

- `npm start` — build and open the desktop app
- `npm run dev` — the editor in a browser at http://127.0.0.1:5173 (no file access; handy for UI work)
- `npm test` — unit tests (Node's built-in runner): compilers, importer, file layer
- `npm run smoke` — builds, then launches the real desktop app twice with no window against a
  throwaway copy of `tests/fixtures/Sunrise`, and checks open / save / restore
- `npm run dist` — package to `release/` for this machine (`scripts/dist.mjs`; `dist:x64`,
  `dist:linux`, `dist:win` for the others). If the packaged app is open, `release/` is locked:
  `node scripts/dist.mjs --out=release-new`
- Start here when picking the project up: [docs/HANDOFF.md](docs/HANDOFF.md)

## Ground rules

- **Three layers, kept apart.**
  1. Pure logic that runs in Node with no DOM: `src/compile/`, `catalog.js`, `graph.js`,
     `lualint.js`, `sdk.js`, `state.js`, `luaEval.js`, `importCampaign.js`, `importFreeroam.js`.
  2. Page code: `src/ui/`, `src/main.js`, `src/desktop.js`.
  3. Disk access: `electron/files.cjs` only, reached through `electron/preload.cjs`. The page
     never gets Node. Script names are validated (`^[a-z0-9_]+$`) so no path leaves the scripts folder.
     A root is either a Sunrise install or a plain folder of scripts; `files.cjs` hides the difference.
- **Every change to layer 1 or to `files.cjs` gets a unit test.** Generated Lua must pass
  `syntaxError()`. Anything that changes how the app opens, saves or restores gets a step in
  `electron/smoke.js`.
- **Tests do not prove in-game behaviour.** They prove the Lua parses and says what the
  drawing says, and that the file layer agrees with a made-up fixture. The author runs the
  game and reports back; what has actually been seen there is recorded in docs/SUNRISE.md
  (marked "seen in game" / "reported from the game"). Never claim in-game behaviour beyond
  that, and say plainly when something is untried.
- **It must keep working on Windows and Linux.** No shell-specific npm scripts (use a Node
  script), `path.join` for every path, and no assumption about how a folder is capitalised.
- **Never destroy a user's script.** Writing over a file this app did not generate must leave
  a `.lua.bak` first (`files.writeMission` does this; keep it that way) and the UI must ask.
- **Only use documented API** in generated Lua. If a new call is needed, read the docs page
  first and record what you learned in docs/SUNRISE.md.
- **Mission mode is ours to get right.** It does not use `lib.campaign`; `src/compile/mission.js`
  generates the whole runtime. Anything `lib.campaign` does to work around the client (see the
  list at the top of that file) must be carried over deliberately, and anything new learned in
  game goes into docs/SUNRISE.md before the code changes.
- **Built-in nodes keep no state** (no variables, counters or phases beyond what `lib.flow`
  stores). This is the talk's central design decision; see docs/DESIGN.md.
- User-facing text is plain and specific: say what is wrong and what to do about it.
- Keep `docs/ROADMAP.md` current. If a limitation is removed, remove it from the docs too.
- On Windows, do not rewrite JSON files with PowerShell's `Set-Content -Encoding utf8`: it adds
  a BOM and breaks the build. Files are LF everywhere (`.gitattributes`).
