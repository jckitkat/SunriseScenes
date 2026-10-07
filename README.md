# Sunrise Scenes

A desktop app for visually scripting [Project Sunrise](https://projectsunrise.dev) missions.
Pick a mission from your Sunrise install, stack sentence-shaped nodes, drop named inputs
into them, and save the Lua script straight back where Sunrise loads it.

> The app checks that the Lua parses and is consistent with the drawing. Only parts of what it
> generates have been played in the game so far; [docs/SUNRISE.md](docs/SUNRISE.md) records
> what has been seen working and what has not.

## Run it

```bash
npm install
```

```bash
npm start
```

It needs Node 22 or newer. `npm run dist` packages the app for the machine it runs on into
`release/` (`Sunrise Scenes.exe` on Windows, `sunrise-scenes` on Linux). `npm run dist:x64`
makes an Intel/AMD build, and `npm run dist:linux` / `npm run dist:win` build for the other
system. `npm test` runs the unit tests and `npm run smoke` launches the real app against a
test folder and checks it end to end.

### Linux

The app runs the same on Linux; the unit tests, the smoke run and a packaged build have been
run on Ubuntu (arm64). Three things to know:

- **Libraries.** Electron needs a few system libraries a minimal install may lack. If
  `npm start` stops with `error while loading shared libraries`, on Debian or Ubuntu install
  them with `sudo apt install libnss3 libnspr4 libgtk-3-0 libgbm1 libasound2t64` (the last is
  `libasound2` on older releases).
- **Sandbox.** On Ubuntu 24.04 and newer, an Electron app started from a folder can stop with
  a message about the SUID sandbox or user namespaces. Either run it with `--no-sandbox`
  (`npm start -- --no-sandbox`, or `./sunrise-scenes --no-sandbox` for a packaged build), or
  allow it once with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. The app
  loads only its own page and never opens web content inside itself.
- **Finding the game.** Sunrise is a Windows mod, so on Linux the game folder is wherever
  Steam with Proton, or Wine, keeps it. Use *Choose folder…* on the Missions screen and pick
  the game folder (the one holding `bin`), or `bin/x64/Sunrise` itself. Capitalisation of
  those folders does not matter. Set `SUNRISE_SCENES_ROOT=/path/to/game` to have it found
  automatically. No display? `xvfb-run npm run smoke` runs the smoke test headless.

## Using it

- **Missions** — the scripts to work on. The app looks where the launcher says the game is;
  use *Choose folder…* to point at it yourself, or at any ordinary folder that just holds
  scripts (each mission a folder with a `.lua` file of the same name, like a copy of the
  missions repository). A plain folder has no SDK of its own; if a Sunrise install is found
  its SDK keys are used, or pick one with *Choose SDK folder…*. Opening a mission:
  - one drawn here before opens exactly as it was left;
  - a hand-written `lib.campaign` script (the Red War drafts) is read into the canvas;
  - a freeroam destination (`lib.freeroam` plus its `content.lua`) is read into the canvas;
  - any other Lua opens in a text editor, with a tab for each Lua file in its folder;
  - an activity with no script opens an empty canvas.

  Either way the keys of that mission's generated SDK module are loaded for the Inputs screen.
- **Editor** — the canvas. Drag nodes from the palette, snap them into stacks, drag inputs
  from the left into sockets. The right pane shows the Lua and anything wrong with it. The
  **?** button explains the rules of the current mode.
- **Inputs** — every door, squad, trigger, goal and line the mission names, plus a browser
  over the loaded SDK keys.
- **Nodes** — write your own node types, tune prefabs, import or export node packs.

**Save to Sunrise** (**Save script** for a plain folder; Ctrl+S either way) writes
`<name>/<name>.lua` and the drawing beside it.
The first time it would replace a hand-written script it asks, and keeps the old file as
`<name>.lua.bak`. The Sunrise launcher updates that folder and may restore its own copies,
so use **Save scene** to keep your own copy of anything you care about.

The app remembers everything between runs: the drawing, the open mission, unsaved text,
which screen you were on, and where the canvas was scrolled and zoomed.

Four modes, switched in the top bar: **Free scene** draws any flow and exports a `lib.flow`
graph; **Campaign** draws a linear story and exports a `lib.campaign` content table;
**Mission** draws a mission as a flow of steps plus scenes on their own tabs and exports one
self-contained script; **Freeroam** draws an open-world destination's zones and exports a `lib.freeroam` script
with its `content.lua`.

## More

See [docs/](docs/) for the design rules, the architecture, notes on the Sunrise runtime and
the roadmap. `npm run dev` runs the editor alone in a browser, without file access.
