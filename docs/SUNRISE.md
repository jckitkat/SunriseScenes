# What we know about Sunrise scripting

Condensed from the official docs (read in full, October 2026) and from reading
`lib/flow.lua`, `lib/campaign.lua`, `lib/mission_lib.lua` and two mission drafts in the
missions repo. Sunrise is work in progress; re-read the source page before relying on a
detail, and correct this file when it is wrong.

- Docs: https://projectsunrise.dev/docs/mission-scripting/ (pages: first-script, world-model,
  program-model, lua-api, generated-sdk, live-sdk-views, recipes, libraries, new-mission,
  finding-things, debugging, quick-reference)
- Scripts and shared libraries: https://github.com/stanuwu/SunriseMissions
- Not yet read: the live-sdk-views and finding-things pages.

## Script shape

- File: `<game>/bin/x64/Sunrise/scripts/<stem>/<stem>.lua`. `stem` = activity internal name,
  lower-cased, runs of non-alphanumerics → `_`, empty → `unnamed`, leading digit → `_` prefix.
- The chunk returns one table: optional `initial_state`, `on_start(context, state)`,
  `on_load(context, state)`, and `on_event_<kind>(context, state, event)`. A catch-all
  `on_event` is refused. Unknown entries that are not functions are an error.
- `require("missions")` maps `SCENARIO_NAME` → module name; `require(missions.X)` loads the
  generated mission module with `mission.Slot`, `.Squad`, `.Scene`, `.Directive`, `.states`,
  `.DialogueCue.<SENSOR>.CUE_<n>`, `.TaskGroup`, `.ActorAbility`, `.PerformanceState` …
- A squad and its type-1 slot share one key (`mission.Squad.SQ_X` / `mission.Slot.SQ_X`); so
  do a scene and its slot. The editor calls the slot the "twin" (`input.name__slot`).

## Runtime rules that shape the generated code

- Each callback is a transaction; requests leave after it returns. Any Lua error faults the
  whole program until "Reload script".
- Lua locals do not survive a reload; only mission variables (512), timers (32) and the phase
  do. `on_load` runs instead of `on_start` after a reload.
- Variable/timer names: 1–63 bytes of `A-Za-z0-9_-./`. String values ≤ 127 bytes.
- Sandbox: Lua 5.4 without `pairs`, `next`, `print`, `load*`, `getmetatable`, `xpcall`,
  `string.find/match/gmatch/gsub/dump`, `math.random`, `io`, `os`, `debug`, `coroutine`.
- An unknown key in a request's argument table is an error. Slot methods error on the wrong
  slot type. Neither can be checked by the editor.
- Type-31 triggers report only after `fire_trigger()` (arming), must be armed once their area
  is loaded, and report every update while occupied: disarm on first report.
- Assign a squad's combat objective before `place{}`.
- `client_state_changed` fires constantly; only `entered == true` is the arrival answer.
- A new attempt (accepted `restart_checkpoint`) clears timers, keeps variables.
- Limits: main script 128 KiB; 5M instructions per callback.

## API the generated code uses

`context:slot(id)`, `context:squad(id)`, `context:scene(id)`, `context:cohort{squads=}.cleared`,
`context:set_variable / clear_variable / start_timer`, `context:select_state(state)`,
`context:complete_mission{}`, `context.attempt_generation`, `context.sdk.device_transitions.*`,
`context.sdk.device_channels.position`, `state:variable(name)`.

Slot methods: `set_directive{directive, navpoint}`, `clear_directives()`,
`play_dialogue_cue{cue}`, `transition{transition}`, `applied{channel}`,
`set_object_active{active}`, `set_interactable_object{used}`, `set_cinematic_active{active}`,
`set_music_section{section}`, `fire_trigger()`, `disarm_trigger()`,
`assign_combat_objective{objective}`, `play_actor_path{path, spawn}`, `play_sequence()` (on a type-5
sequence slot; Homecoming has `SEQ_DOOR_EXPLOSION`, `SEQ_WAVE_ANNOUNCE_A/B`, `SEQ_BOSS_ANNOUNCE`).
Squad: `place{}`. Scene: `activate{}`, `stop{}`.

Documented but not yet given a built-in node: `set_darkness_zone`, `set_ghost_link`,
`set_occupancy_condition`, `set_object_filter`, `watch_damage`, `play_performance`,
`set_public_event_state`, `play_sequence{sequence}` on an actor, `reset_objectives`, `advance_task`, `run_atoms`,
`play_actor_action`, `retire_actor`, `actor_command`, `hold_spawn`, `restart_checkpoint`,
`activate_objects`, `set_channel`. Custom nodes are the way to reach these today.

## lib.flow (read from source)

- `flow.new{key, facts = {{id, observe(context, state, event)}}, steps = {{id, after, when, run, await, checkpoint, reset_facts}}}`.
- Conditions: `nil`, `flow.fact(id)`, `flow.all(...)`, `flow.any(...)`, or
  `function(context, state)`.
- `graph:advance` walks steps in dependency order (source order among ready steps). `after`
  is AND. `when` is re-checked on every advance until the step has entered. A step runs `run`
  once, then finishes when `await` is true.
- `graph:handle(context, state, event)` offers the event to **every** unlatched fact, then
  advances. Facts latch for the attempt, even before their step starts.
- State keys are `flow.<key>.step.<id>` / `.fact.<id>`; 64 facts, 64 steps, 63-byte names.
- Cycles in `after` assert at load.

## lib.campaign (read from source)

`campaign.new{key, directive_sensor, dialogue_sensor, legs, steps, encounters, intro, spawn_set, omit, finish}`
returns the whole program table.

- `legs = {{id, state, arm = {triggers}, watch = {monitors}}}`; first leg is the landing.
- `steps = {{id, directive, navpoint, waypoint, lines, scene, on_start(context), ends, barrier, revisit}}`.
  `ends` keys: `trigger`, `monitor`, `region` (leg id), `clear` (encounter id/s), `ghost_link`,
  `interact`, `destroyed` (list, all), `scene` (a slot), `health = {slot, at}`.
- `encounters = {{id, after, trigger | monitor, objective, squads = {unit(squad, slot, group)}, lines, on_start}}`.
- Helpers: `campaign.unit`, `campaign.line(cue, filter)`, `campaign.move(context, slots, "open")`.
- It asserts at load that every step/encounter trigger is armed by some leg.
- A step without `barrier` also ends on any later step's trigger, monitor or region.
- There is no hook for a custom end condition. `on_start` receives only `context`.
- The repo marks the Red War drafts as largely untested; only Homecoming has run in game.

## Files on disk

- The launcher keeps `%LOCALAPPDATA%/io.github.stanuwu.sunrise-launcher/preferences.json`
  with an `installDirectory`. The app starts its search there and looks up to two folders
  down for `bin/x64/Sunrise`.
- `Sunrise/scripts/<name>/<name>.lua` per activity, `scripts/lib/` for shared helpers.
  The launcher installs and updates this folder and may take it back from a manual clone,
  so files written there are not guaranteed to survive a launcher update.
- `Sunrise/sdk/lua/missions.lua` and `activities.lua` map `UPPER_NAME` to a module name such
  as `"missions.adventure_ginger_80b2e043"`; modules live in `sdk/lua/missions/` and
  `sdk/lua/activities/`. An activity module has a `mission` field holding its mission module.
  **Only that much is documented.** `electron/files.cjs` and `src/sdk.js` assume one
  `KEY = "module.path"` entry per name and `Name = {` table openers; the fixture under
  `tests/fixtures/Sunrise` is made up to match that assumption, not copied from a real install.

## The existing mission scripts (missions repo, read October 2026)

- 33 activity scripts. 26 are a single `return campaign.new{...}`: all 16 Red War missions,
  plus `adventure_rumba/vod/whisk`, `mission_abs/bond/launchpad/pact/scot`, `strike_bond/pact`.
  The importer reads all 26; importing, compiling and importing again gives identical output.
- 9 are open-world destinations (`*_freeroam`): an 8-line script,
  `return freeroam.new{zones = content(mission, freeroam)}`, plus a `content.lua` of 20 to
  170 KB headed "Generated from installed mission data. Do not edit." The importer reads all
  9, and what the compiler writes back matches each original `content.lua` statement for
  statement (comments aside).
- The rest open as text, with a tab per file: three social spaces (`campaign_social_space_d2`,
  `city_tower_social_d2`, `tangled_shore_social_space`: on entering a region, select its state,
  activate objects, place squads, start scenes, play idles), `adventure_ginger` (hand-written
  `lib.flow` with wipe handling), `raid_gluttony_0` and `cine_110_twr` (small hand-coded state
  machines). `tangled_shore/` and `lib/` are folders of shared Lua with no script of their own.
- Shape the drafts share: locals `unit, line, move = campaign.unit, campaign.line, campaign.move`,
  `Slot, Squad, Directive = mission.Slot, ...`, `cue = mission.DialogueCue.<SENSOR>`; encounters
  declared as local tables above the call; `on_start` almost always just `move(...)` calls.
- Two files (`mission_bond`, `strike_bond`) call a local helper function from `on_start`.
  The importer keeps the call as Lua and warns that the helper itself is not carried over.
- Encounters with no squads exist (lines or `on_start` only) and are valid.
- Their header comments say "not tested in game"; RED_WAR.md says only Homecoming has run.

## lib.freeroam (read from source)

`freeroam.new{zones = {...}}` returns the whole program table. A zone:
`{state, region, patrol = {unit(squad, slot)}, ambient = {...}, events = {site...}, sector = {...}}`.

- A site: `{sensor, objective, squads = {unit...}, chest = {slots}}`. One site per zone runs at
  a time; it ends when every squad it placed is dead, then the chest objects are activated and
  the next site starts after a cooldown.
- A sector: `{boss, squads, chest}` in every real file. The library also accepts `doors`,
  `blockers`, `crystals`, `shield` and `gates`; no existing script uses them and the editor
  has no nodes for them (the importer warns and drops them).
- A zone with a `sector` is treated as that sector's private content: its patrols are not placed.
- `region` must be unique per zone (asserted). Up to 64 zones.
- Squads are always paired with the slot of the same key.

## Seen on a real install (October 2026)

- `<game>/bin/x64/Sunrise/` holds `scripts/`, `sdk/`, `cache/`, `data/`, `settings.json`,
  `activity_sdk.pack`. There is no `logs/` folder until file logging is switched on.
- `sdk/lua/missions.lua` and `activities.lua`: `return { NAME = "missions.<file>", ... }`, one
  entry per line. About 1,170 activities, of which about 40 have a script.
- A mission module (about 1 MB for Homecoming): `local mission = { name, id, tag, states = {...},
  slots = { KEY = { id, name, index, type = 31, ... } }, squads = {...}, scenes = {...}, tasks = {...} }`
  followed by `mission.Slot = { KEY = "slot/..." }`, `mission.Squad`, `mission.Scene`,
  `mission.DialogueCue = { SENSOR = { CUE_0 = 0, ... } }`, `mission.Directive = { KEY = { id,
  slot_row, title, description } }` and more, then `return mission`. The last part of a slot
  id is its type in hex.
- `parseSdk` finds every key the 35 importable scripts use (11,404 inputs checked), and reads
  each slot's type from the `slots` rows.
- **Slot types are enforced and consistent.** Across those 35 scripts every socket only ever
  holds one slot type: arm and trigger 31, watch and monitor 30, objective 3, devices 23,
  navpoint 47, waypoint and line filter 60, directive sensor 68, dialogue sensor 53, interact,
  destroyed, omit and chest 4, Ghost link 65, health 2, cinematic 6, public event sensor 71,
  sector boss 1. Name prefixes are a habit, not a rule: `PT_SPIRE` is type 47.
- **First fault seen in game:** "activity slot is not an exact type-31", from a drawing where
  an object and a device had been dropped into a leg's arm list. Fixed by typed sockets.
- Homecoming's data still holds Bungie's four Zavala plaza scenes from the GDC talk:
  `SC_ZAVALA`, `SC_ZAVALA_COMBAT`, `SC_ZAVALA_BUNKER_SHIELD_BUNKER`, `SC_ZAVALA_SHIELD_DEATH`,
  with `SQ_ZAVALA` and `SQUAD_KILL_CABAL_1` to `8`. The "Zavala's plaza" example uses them.

## Authored scenes (read from Sunrise's source after a failure in game)

- `context:scene(id):activate{}` only starts the scene. In game the scene then runs with
  nobody in it: the actors do nothing. This was the first thing seen to go wrong with scenes.
- `activate{spawn = true}` first prepares the scene's **cast**: for every squad participant it
  reserves the source squad and binds the scene's actor control (a type-2 slot) to it, then
  starts the scene. The one installed script that plays combat scenes, `raid_gluttony_0`,
  uses `activate{spawn = true}` and does not place those squads itself.
- A cast squad must be a squad of the scene's own object (`activity_sdk_scene_cast.cpp`:
  "a source must name one squad occurrence in the scene's own object and state"). The slot id
  `slot/<object>/...` carries the object, but that only narrows it: in Homecoming's Underwatch nearly every squad
  (31 of the ones the opening spawns) shares the object of `SCENE_CABAL_FIRST_CONTACT`. The Lua
  SDK modules do not list casts, so the editor cannot tell which squads a scene will take. It
  gives one note on the scene node naming the squads the drawing spawns from that object.
- `spawn = true` raises a Lua error ("scene has no unambiguous authored spawn cast") when the
  cast cannot be resolved; an empty cast is fine. Uncaught, that faults the script, so the
  generated `start_scene` helper wraps it in `pcall` and falls back to a bare start.
- The host "refuses incompatible live ownership" of a cast squad, so placing a cast squad with
  `place{}` as well as starting its scene with `spawn = true` is asking for trouble. Not yet
  seen in game either way.
- `lib.campaign` starts a step's scene with `activate{}`, bare.
- **A scene can be refused before it starts, bare or with its cast.** `prepare_scene`
  (`activity_sdk_mission_prepare.cpp`) resolves the whole cast even for a bare start, and checks
  the mission seed and the scene's state. Its answers (`SceneStatus`): `wrong_state` (the scene's
  state is neither the seeded one nor live in the current region), `mission_seed_unavailable` /
  `mission_seed_pending`, `dependency_capacity` (more than eight cast squads), `ambiguous_target`,
  `target_unavailable`, `missing_resource` / `ambiguous_resource`, `schema_join_not_exact`,
  `no_activity_link`, `refused`.
- These refusals are **not Lua errors**. `activate{}` only queues an intent; the refusal comes
  later at delivery (`scene_refused` + the status name) and the script carries on. `pcall`
  around `activate{spawn = true}` catches only "no unambiguous authored spawn cast".
- Sunrise's own debug panel (SDK > scenes) lists every scene of the current state with an
  **availability** column and an **Advance** button, which is a bare start and is greyed out
  unless availability is `ready`; after a press it shows `last: <status>`. Reported from the
  game on Homecoming's Underwatch scenes: they do not start from this panel either, so the
  cause there is on the host side, not in the generated script.
- **Seen in game (Sunrise 0.5.1.0, packet view):** after a manual start of
  `SCENE_CAYDE_GOLDEN_GUN` the client answers with a type-43 `sensor_sense_update`: field 0
  (the activation token, `kSceneTokenOrdinal`) = 5, field 1 (the completion latch,
  `kSceneCompletionOrdinal`) = false. So the client accepted the start and holds the scene as
  running and unfinished; the actors still do nothing.
- **Scenes have event gates.** A scene's graph has gates, and `scene:send_event{key}` adds one
  event key to the running generation (keys are cumulative; a new generation restarts the
  scene). Sunrise's current source writes them into the SDK scene rows as
  `event_keys = { 0x…, … }`, "the graph's gates in order: what set_scene_events publishes to run
  the scene" (`activity_sdk_lua_missions.cpp`), and counts `authored_scene_event_keys` in
  `manifest.json`. The 0.5.1 release has neither, so its SDK cannot say which keys a scene waits for.
  Likely reading of the packet above, not proven: the scene is waiting at its first gate. No
  installed script calls `send_event`.
- **Seen on disk after building master `fbfcb1c` (2026-10-05) and regenerating:** SDK
  `format_version` 42, `authored_scene_event_keys` 5310, and every one of Homecoming's 71 scene
  rows has `event_keys` (3 to 17 of them). All 71 lists begin with `0x385838EC`; several keys
  recur across scenes (`0x9CD3EB24` on the civilian scenes, `0x6F51AC66`, `0xCFB8CB39`). The
  keys are unnamed hashes: what each gate does is not known, and neither is whether the first
  one must be sent before anything moves.
- `state/activity_sdk/format.h`: each gate carries its event key and an ordinal, and "-1 opens
  every scene". That fits `0x385838EC` being first in every list: most likely the opening gate
  that every scene needs before anything else. The Lua SDK does not print the ordinals. Whether
  later gates must be sent in order, or all of them, is not stated anywhere and not yet tried.
- **Reported from the game (master `fbfcb1c`):** `SCENE_CAYDE_GOLDEN_GUN` started from a script
  with `activate{spawn = true}` followed by events 1 to 4 fails with a run of incident packets;
  the same scene started bare from the debug panel and sent events by hand plays. The script
  does not place `sq_cayde` itself. So for this scene the host-prepared cast is the suspect, and
  "start bare" the thing to try. Not yet confirmed which part of the cast preparation the client
  objects to, nor whether sending four events in one go matters.
- **What `sunrise.log` showed for that report** (`core.logging.file_sink` on, `server` at
  `info`; the file is `Sunrise/logs/sunrise.log`): nothing was refused. For `spawn = true` the
  host logs one `intent result=scene_enqueued` per preparation step (place a cast squad in
  reserve, bind its actor control), then `scene_cast result=partial … omitted=N` and
  `delivery result=scene_staged`; each event sent is `delivery result=scene_event_staged`.
  Cayde's scene: six preparation steps (three squad/actor pairs), `omitted=9`, staged, then
  events 1 and 3 staged within 170 ms. First contact: no pairs, `omitted=2`. Centurion intro: one
  pair, `omitted=1`. A bare start from the debug panel would log `scene_cast result=partial` too
  when N is not 0, and none followed, so the scene that then played was the script's own
  generation, moved on by events sent from the panel. A refusal would read
  `result=scene_refused` with the status name.
- **Resolved (2026-10-06), with a byte trace added to a local Sunrise build:** the Cayde scene
  never played from the script because the script sent the wrong events. By hand the scene was
  sent `0x50E394F0` and `0x6F51AC66`, which are positions 3 and 5 of its `event_keys` list; the
  script sent positions 1 and 3. The debug panel's gate **ordinal** for those two keys is 1 and
  3, and that was the number being read off. So: the editor's "event N" is the position in
  `event_keys`; a gate's ordinal is a different number, and the Lua SDK does not print it.
  Timing (start to first event, gap between events, 60 ms or 3 s) made no difference.
- The same trace shows a start with `spawn = true` and a bare start put **identical bytes** on
  the wire apart from the generation: the same three squad dependencies either way. The only
  difference is the squads the host places beforehand.
- `0x385838EC` (first in every list, ordinal -1) was not needed to play the Cayde scene, and
  sending it did not stop the scene playing once `0x6F51AC66` arrived. What it does is unknown.
- "unmapped target, N B" in the debug event view is the label of every incident packet (no name
  is known for its target; N is the payload size). It is not an error.
- The editor's "Send event N to scene" node emits `context:scene(x):send_event{key = 0x…}` with
  the Nth key of that list. `send_event` takes only `key`, which must be above 0 and below
  `0xFFFFFFFF`. Not yet run in game.

## Things never verified in game

Almost everything. One imported and edited campaign script (Homecoming) has loaded and run far
enough to fault on a wrong slot type. Beyond that: the whichever-first join (`when` + marker steps), the
`applied{channel}` wait before any request was made, the SDK module parser's guess at the
generated file layout, and the lookup from an activity to its scenario.
