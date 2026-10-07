# Design rules

These come from the GDC talk and from decisions made with the project owner. A feature that
breaks one needs a reason written here.

## From the talk

1. **Nodes are sentences.** "Ikora shoots and kills the Psion", not a box with pins. If a new
   node cannot be read aloud, reword it. Do not promise in the sentence what the code does
   not do (the talk's "run-to" vs "run-nearby" warning).
2. **Named inputs, not data wires.** Everything a scene refers to is declared once, typed,
   and used by name. Inputs only fit sockets of their kind.
3. **Like with like.** A node carries everything about its action: who, what, on whom.
4. **Stacks flow downward.** A node snapped under another waits for the one above.
5. **Lines are for concurrency only.** Several lines into a node = whichever finishes first
   (OR). "Wait for all" = AND.
6. **Colour says what kind of node.** As in Bungie's tool (slides 66, 87 to 89): orange for
   triggers (Begin, When a trigger fires, Trigger local), green for spawning, blue for actions,
   purple for waiting on the game, yellow for flow. Ours adds crimson for End, teal for a
   campaign Step, pink for a prefab.
9. **Look like the original.** Read from the slide images, not just the notes: nodes are
   compact grey bars with the colour on both edges; lines leave the bottom of a node and
   enter the top of the next with right-angle turns; inputs named inside a node are tinted
   by their type; local triggers ("Trigger local x" / a stack headed "When x") replace long
   lines. Things the original has that we do not yet: an "until" slot on long-running
   nodes, "If" / "If not" on a trigger, "Randomizes", a "Wait a to b seconds" range,
   output triggers, and loops.
7. **No state in scenes.** No variables, counters or timers the author can read back. Each
   node runs at most once. This makes races and deadlocks structurally impossible rather
   than merely unlikely. Text script owns state; scenes own flow and waiting.
8. **Inputs and outputs make prefabs.** A stack plus its named inputs is reusable.

## From the project owner

- Campaign mode must look and work like the free scene canvas (stacks of sentence nodes),
  not a form. The first form-based version was rejected as clunky.
- Inputs are grouped by kind (slots further by name prefix), searchable, and dragged into
  sockets. Real mission SDK modules have a great many keys; finding one must stay quick.
- Inputs and custom nodes each get their own full screen for editing.
- It is an npm project, not a single HTML file, and it ships as a standalone desktop app.
- The app reopens exactly where it was left: drawing, open mission, screen, scroll and zoom.
- Missions are picked from the user's own Sunrise install with a mission selector, opened
  for viewing and editing, and saved back there. Opening one loads its SDK entries too.
- Freeroam destinations are drawn too, in the same canvas style, not left as text.
- The scripts do not have to be in a Sunrise install: any ordinary folder holding only the
  scripts can be chosen instead.

## Mission mode (agreed October 2026)

The campaign library was too rigid, so missions get their own mode, modelled on how the talk
splits the work:

- **The flow is the "script" side.** One tab, one stack of steps for the whole mission. A
  step shows a goal, runs scenes, and ends on an Until node. Steps run strictly in order.
- **Scenes are the unit, and each is a tab** (in Bungie's tool the tabs are scenes, not
  areas). A scene is drawn like a free scene, starts when a step runs it, and reports back
  through named outputs. It keeps running after the step that started it has ended.
- **Legs are a label on a scene**, not a container. A scene tagged with a leg waits until
  the player is there. Nobody lists which triggers to arm: a node that waits on a trigger
  arms it, and waiting triggers are armed again whenever an area loads.
- Scenes use the mission's inputs directly for now. Per-scene typed inputs (so one scene
  can be reused with different actors, as in the talk) are the next step, not built yet.
- Campaign mode stays for the existing drafts, which are `lib.campaign` tables.

## Our own

- **Sockets know their slot type.** A slot socket says which slot types the game accepts
  there (a trigger socket takes type 31, a device socket type 23, ...). Once an SDK module is
  loaded every slot input knows its type, wrong drops are refused, and a wrong one already in
  a drawing is an error. This came from a real fault in game: "not an exact type-31".
- **Honest problems list.** Anything the compiler can know is wrong is reported before export,
  with the node highlighted. Anything it cannot know (argument names, slot types, whether
  the client accepts a request) is not implied to be checked.
- **Lean on the shared libraries.** Free scenes compile to `lib.flow`; campaigns to a
  `lib.campaign` content table. The fragile client workarounds live upstream in those
  libraries and should not be re-implemented here.
- **Custom Lua is allowed but marked.** Custom nodes that touch variables, timers or the
  phase are tagged "keeps state" on the canvas, because they step outside rule 7.
