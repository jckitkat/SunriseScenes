// The desktop app's file layer and the campaign importer, against tests/fixtures/Sunrise.
// The fixture is made up: its SDK files follow the documented table names, but the real
// generated layout has not been seen. These tests prove the code agrees with the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.js';
import { importCampaign, looksLikeCampaign } from '../src/importCampaign.js';
import { importFreeroam, looksLikeFreeroam } from '../src/importFreeroam.js';
import { parseSdk } from '../src/sdk.js';
import { syntaxError } from '../src/lualint.js';

const files = createRequire(import.meta.url)('../electron/files.cjs');
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'Sunrise');
// A private copy laid out like a real install, so writes never touch the fixture.
function install() {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'sunrise-scenes-test-'));
  const root = path.join(game, 'bin', 'x64', 'Sunrise');
  fs.cpSync(fixture, root, { recursive: true });
  return { game, root };
}
const errors = (out) => out.problems.filter((p) => p.level === 'err').map((p) => p.msg);

test('the Sunrise folder is found from the game folder, bin/x64, its scripts folder, or itself', () => {
  const { game, root } = install();
  for (const picked of [game, path.join(game, 'bin', 'x64'), root, path.join(root, 'scripts')]) {
    assert.equal(files.resolveInstall(picked), root);
    assert.equal(files.chooseRoot(picked), root);
  }
  assert.equal(files.resolveInstall(os.tmpdir()), null);
  assert.equal(files.describeRoot(root).kind, 'install');
  assert.equal(files.findSunrise([path.dirname(game)]) !== null, true, 'found by looking below a parent folder');
  fs.rmSync(game, { recursive: true, force: true });
});

test('a plain folder of scripts works as a root, with or without a borrowed SDK', () => {
  // Laid out like a copy of the missions repository: mission folders at the top, no sdk.
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'sunrise-scenes-plain-'));
  fs.cpSync(path.join(fixture, 'scripts'), plain, { recursive: true });
  assert.equal(files.chooseRoot(plain), plain, 'taken as it is, not searched for an install');
  assert.equal(files.resolveInstall(plain), null);
  const d = files.describeRoot(plain);
  assert.deepEqual([d.kind, d.scripts, d.sdk], ['scripts', plain, '']);

  // Without an SDK: scripts are listed and open; unscripted activities and keys are not there.
  let list = files.listMissions(plain);
  assert.deepEqual(list.map((m) => m.name + ':' + m.kind), ['adventure_raw:lua', 'demo_freeroam:freeroam', 'lib:helpers', 'mission_demo:campaign']);
  let m = files.readMission(plain, 'mission_demo');
  assert.ok(m.lua.includes('campaign.new'));
  assert.equal(m.sdk.text, null);
  assert.equal(m.sdk.none, true);
  assert.equal(m.sdk.key, 'MISSION_DEMO', 'the scenario is still read from the script');

  // Borrowing the SDK of an install, named by any of its folders.
  for (const picked of [fixture, path.join(fixture, 'sdk'), path.join(fixture, 'sdk', 'lua')]) {
    assert.equal(files.resolveSdk(picked), path.join(fixture, 'sdk', 'lua'));
  }
  assert.equal(files.resolveSdk(plain), null);
  const sdk = files.resolveSdk(fixture);
  assert.equal(files.describeRoot(plain, sdk).sdk, sdk);
  list = files.listMissions(plain, sdk);
  assert.equal(list.find((x) => x.name === 'patrol_empty').kind, 'none');
  m = files.readMission(plain, 'mission_demo', sdk);
  assert.ok(m.sdk.text.includes('PT_GATE'));

  // Saving goes straight into the folder: <name>/<name>.lua, with the same .bak rule.
  const r = files.writeMission(plain, 'mission_demo', '-- new\nreturn {}\n', '{"meta":{}}');
  assert.equal(r.path, path.join(plain, 'mission_demo', 'mission_demo.lua'));
  assert.ok(fs.existsSync(path.join(plain, 'mission_demo', 'mission_demo.lua.bak')));
  files.writeMission(plain, 'brand_new', 'return {}\n', null);
  assert.ok(fs.existsSync(path.join(plain, 'brand_new', 'brand_new.lua')));

  // An empty folder is a valid place to start.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sunrise-scenes-empty-'));
  assert.equal(files.chooseRoot(empty), empty);
  assert.deepEqual(files.listMissions(empty), []);
  assert.equal(files.chooseRoot(path.join(empty, 'missing')), null);
  fs.rmSync(plain, { recursive: true, force: true }); fs.rmSync(empty, { recursive: true, force: true });
});

test('missions are listed with their kind, shared helper folders included', () => {
  const list = files.listMissions(fixture), by = Object.fromEntries(list.map((m) => [m.name, m]));
  assert.equal(by.lib.kind, 'helpers', 'a folder of Lua with no script of its own');
  assert.equal(by.demo_freeroam.kind, 'freeroam');
  assert.equal(by.demo_freeroam.files, 2, 'the script and its content.lua');
  assert.equal(by.mission_demo.kind, 'campaign');
  assert.equal(by.mission_demo.scenario, 'MISSION_DEMO');
  assert.equal(by.adventure_raw.kind, 'lua');
  assert.equal(by.patrol_empty.kind, 'none', 'an activity the SDK lists but nobody scripted');
});

test('reading a mission also finds its scenario\'s SDK module', () => {
  const m = files.readMission(fixture, 'mission_demo');
  assert.equal(m.sdk.key, 'MISSION_DEMO');
  assert.match(m.sdk.path, /mission_demo_80aa0001\.lua$/);
  const kinds = new Set(parseSdk(m.sdk.text).keys.map((k) => k.kind));
  assert.deepEqual([...kinds].sort(), ['Cue', 'Directive', 'Slot', 'Squad', 'State']);
  // No script: the scenario comes from the activity module instead.
  const empty = files.readMission(fixture, 'patrol_empty');
  assert.equal(empty.lua, null);
  assert.equal(empty.sdk.key, 'PATROL_EMPTY');
  assert.ok(empty.sdk.text.includes('PT_PATROL_START'));
});

test('script names cannot reach outside the scripts folder', () => {
  assert.throws(() => files.readMission(fixture, '../sdk'));
  assert.throws(() => files.writeMission(fixture, '..\\..\\evil', 'x', null));
});

test('a hand-written campaign script is read into a drawing that says the same thing', () => {
  const lua = fs.readFileSync(path.join(fixture, 'scripts', 'mission_demo', 'mission_demo.lua'), 'utf8');
  assert.equal(looksLikeCampaign(lua), true);
  const r = importCampaign(lua, 'mission_demo');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.scenario, 'MISSION_DEMO');
  const out = compile(r.doc);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  for (const expected of [
    /key = "demo"/, /spawn_set = 0x8029E4B4/, /intro = \{\s+\{state = input\.\w+, cinematic = input\.pf_opening_cinematic\}/,
    /\{id = "landing",\s+state = input\.\w+,\s+arm = \{input\.pt_gate\}\}/,
    /\{id = "reach",\s+directive = input\.reach_the_gate,\s+navpoint = input\.ap_gate,\s+lines = \{line\(input\.cue_1\), line\(input\.cue_2, input\.tv_gate_approach\)\},\s+ends = \{trigger = input\.pt_gate\}\}/,
    /\{id = "fight",[\s\S]+?move\(context, \{input\.d_yard_lights\}, "power_on"\)[\s\S]+?barrier = true,\s+ends = \{clear = "yard"\}\}/,
    /move\(context, \{input\.d_switch_door, input\.d_switch\}, "open"\)\s+context:slot\(mission\.Slot\.MUSIC_SENSOR\):set_music_section\{section = 3\}/,
    /ends = \{interact = input\.o_switch, trigger = \{input\.pt_switch_room, input\.pt_exit\}\}/,
    /revisit = true,\s+ends = \{trigger = input\.pt_exit, region = "yard"\}/,
    /\{id = "yard",\s+after = "reach",\s+trigger = input\.pt_gate,\s+objective = input\.obj_yard,\s+lines = \{line\(input\.cue_4\)\}/,
    /unit\(input\.sq_yard_a, input\.sq_yard_a__slot\)/,
  ]) assert.match(out.lua, expected);
  // What it wrote reads back to the same drawing: nothing is lost by saving and reopening as Lua.
  const again = importCampaign(out.lua, 'mission_demo');
  assert.deepEqual(again.warnings, []);
  assert.equal(compile(again.doc).lua, out.lua);
});

test('the importer says what it cannot carry over, and refuses what it cannot read', () => {
  const lua = `local missions = require("missions")
local mission = require(missions.X)
local campaign = require("lib.campaign")
local Slot = mission.Slot
local function helper(context) end
return campaign.new{ key = "k", directive_sensor = Slot.S, finish = function(context) end, mystery = 1,
  legs = {{id = "a", state = mission.states.ST}},
  steps = {{id = "one", on_start = function(ctx) helper(ctx) end, ends = {weather = true}}},
}`;
  const r = importCampaign(lua, 'x');
  assert.ok(r.warnings.some((w) => /"finish"/.test(w)));
  assert.ok(r.warnings.some((w) => /"mystery"/.test(w)));
  assert.ok(r.warnings.some((w) => /uses "helper"/.test(w)));
  assert.ok(r.warnings.some((w) => /end "weather"/.test(w)));
  const kept = r.doc.nodes.find((n) => n.type === 'c_lua');
  assert.equal(kept.params.code, 'helper(context)', 'the parameter is renamed to context');
  assert.equal(looksLikeCampaign('return { on_start = function() end }'), false);
  assert.ok(importCampaign('return {', 'x').error);
});

test('saving keeps a hand-written script as .bak once and writes the drawing beside it', () => {
  const { game, root } = install();
  const dir = path.join(root, 'scripts', 'mission_demo'), original = fs.readFileSync(path.join(dir, 'mission_demo.lua'), 'utf8');
  const r = importCampaign(original, 'mission_demo'), out = compile(r.doc);
  const first = files.writeMission(root, 'mission_demo', out.lua, JSON.stringify(r.doc));
  assert.ok(first.backup);
  assert.equal(fs.readFileSync(path.join(dir, 'mission_demo.lua.bak'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(dir, 'mission_demo.lua'), 'utf8'), out.lua);
  const back = files.readMission(root, 'mission_demo');
  assert.equal(back.kind, 'scene');
  assert.equal(back.generated, true);
  assert.equal(JSON.parse(back.scene).meta.activity, 'mission_demo');
  // A second save must not overwrite the backup with generated code.
  assert.equal(files.writeMission(root, 'mission_demo', out.lua + '\n', JSON.stringify(r.doc)).backup, '');
  assert.equal(fs.readFileSync(path.join(dir, 'mission_demo.lua.bak'), 'utf8'), original);
  // A brand-new mission gets its folder made.
  files.writeMission(root, 'patrol_empty', 'return {}\n', '{"meta":{"scenario":"PATROL_EMPTY"}}');
  assert.equal(files.listMissions(root).find((m) => m.name === 'patrol_empty').kind, 'scene');
  fs.rmSync(game, { recursive: true, force: true });
});

test('a freeroam destination is read from its two files and written back the same', () => {
  const m = files.readMission(fixture, 'demo_freeroam');
  assert.deepEqual(Object.keys(m.files), ['demo_freeroam.lua', 'content.lua'], 'main script first');
  assert.equal(m.sdk.key, 'DEMO_FREEROAM');
  assert.equal(looksLikeFreeroam(m.lua), true);
  const r = importFreeroam(m.lua, m.files, 'demo_freeroam');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.doc.meta.mode, 'freeroam');
  assert.deepEqual(r.doc.nodes.map((n) => n.type), ['f_zone', 'f_event', 'f_zone', 'f_sector']);
  const out = compile(r.doc);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.equal(syntaxError(out.files['content.lua']), null);
  assert.match(out.lua, /return freeroam\.new\{zones = content\(mission, freeroam\)\}/);
  assert.match(out.lua, /require\("demo_freeroam\.content"\)/);
  // Statement for statement the same zone table as the original (comments aside).
  const body = (t) => t.split('\n').map((l) => l.replace(/--.*$/, '').trimEnd()).filter((l) => l.trim()).join('\n');
  assert.equal(body(out.files['content.lua']), body(m.files['content.lua']));
  const again = importFreeroam(out.lua, out.files, 'demo_freeroam');
  assert.equal(compile(again.doc).shown, out.shown);
});

test('freeroam problems are reported: shared regions, missing state, stray nodes', async () => {
  const st = await import('../src/state.js');
  const m = files.readMission(fixture, 'demo_freeroam');
  importFreeroam(m.lua, m.files, 'demo_freeroam');
  const zones = st.S.nodes.filter((n) => n.type === 'f_zone');
  zones[1].params.region = zones[0].params.region; zones[0].params.state = '';
  st.addNode('f_event', 0, 900, {});
  const out = compile(st.S);
  assert.ok(errors(out).some((e) => /share region 40/.test(e)));
  assert.ok(errors(out).some((e) => /no state/.test(e)));
  assert.ok(out.problems.some((p) => p.level === 'warn' && /not stacked under a Zone/.test(p.msg)));
  assert.ok(importFreeroam(m.lua, {}, 'x').error.includes('content.lua'), 'says which file is missing');
});

test('saving a mission with several files backs each hand-written one up once', () => {
  const { game, root } = install();
  const dir = path.join(root, 'scripts', 'demo_freeroam'), original = fs.readFileSync(path.join(dir, 'content.lua'), 'utf8');
  const m = files.readMission(root, 'demo_freeroam'), out = compile(importFreeroam(m.lua, m.files, 'demo_freeroam').doc);
  const r = files.writeMission(root, 'demo_freeroam', out.lua, '{"meta":{"scenario":"DEMO_FREEROAM"}}', out.files);
  assert.equal(r.backups.length, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'content.lua.bak'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(dir, 'content.lua'), 'utf8'), out.files['content.lua']);
  assert.equal(files.readMission(root, 'demo_freeroam').kind, 'scene');
  // Text edits: only the files handed over are touched, and names cannot leave the folder.
  files.writeMission(root, 'lib', null, null, { 'campaign.lua': '-- edited\nreturn {}\n' });
  assert.ok(fs.readFileSync(path.join(root, 'scripts', 'lib', 'campaign.lua'), 'utf8').startsWith('-- edited'));
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'lib', 'lib.lua')), false);
  assert.throws(() => files.writeMission(root, 'lib', null, null, { '../escape.lua': 'x' }));
  assert.throws(() => files.writeMission(root, 'lib', null, null, { 'notes.txt': 'x' }));
  fs.rmSync(game, { recursive: true, force: true });
});
test('a Sunrise folder is found however its folders are capitalised (Linux cares, Windows does not)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-case-'));
  try {
    const install = path.join(tmp, 'game', 'Bin', 'X64', 'sunrise');
    fs.mkdirSync(path.join(install, 'sdk', 'lua'), { recursive: true });
    fs.mkdirSync(path.join(install, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(install, 'sdk', 'lua', 'missions.lua'), 'return {}');
    // Windows hands back the spelling it was asked with, Linux the real one; compare without case.
    const same = (a, b) => { assert.ok(a, 'nothing found'); assert.equal(fs.realpathSync(a).toLowerCase(), fs.realpathSync(b).toLowerCase()); };
    same(files.resolveInstall(path.join(tmp, 'game')), install);
    same(files.resolveInstall(path.join(tmp, 'game', 'Bin')), install);
    same(files.resolveInstall(path.join(install, 'scripts')), install);
    same(files.chooseRoot(tmp), install);
    assert.equal(files.resolveInstall(path.join(tmp, 'nothing-here')), null);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the launcher\'s preferences are looked for where each system keeps them', () => {
  const win = files.launcherPrefs({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me', 'win32');
  assert.equal(win.length, 1);
  assert.match(win[0], /io\.github\.stanuwu\.sunrise-launcher.preferences\.json$/);
  const linux = files.launcherPrefs({}, '/home/me', 'linux').map((p) => p.replace(/\\/g, '/'));
  assert.deepEqual(linux, ['/home/me/.config/io.github.stanuwu.sunrise-launcher/preferences.json', '/home/me/.local/share/io.github.stanuwu.sunrise-launcher/preferences.json']);
  const xdg = files.launcherPrefs({ XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data' }, '/home/me', 'linux').map((p) => p.replace(/\\/g, '/'));
  assert.deepEqual(xdg, ['/cfg/io.github.stanuwu.sunrise-launcher/preferences.json', '/data/io.github.stanuwu.sunrise-launcher/preferences.json']);
  // a folder a Windows launcher wrote down while running under Wine or Proton
  assert.equal(files.nativeDir('Z:\\home\\me\\Games\\Destiny 2', 'linux'), '/home/me/Games/Destiny 2');
  assert.equal(files.nativeDir('/home/me/Games', 'linux'), '/home/me/Games');
  assert.equal(files.nativeDir('C:\\Games\\Destiny 2', 'linux'), 'C:\\Games\\Destiny 2', 'a C: path has no single Linux meaning; left alone');
  assert.equal(files.nativeDir('Z:\\home\\me', 'win32'), 'Z:\\home\\me');
});
