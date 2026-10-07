// Runs inside the page during `npm run smoke`. Drives the real app against a throwaway copy
// of the fixture Sunrise folder and reports what happened. The last expression is the result.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.sunriseScenes && window.sunriseScenes.ready); i++) await wait(100);
  const app = window.sunriseScenes, out = { ok: false, steps: [] };
  if (!app) return { ok: false, error: 'the page never finished starting' };
  const step = (name, pass, detail) => { out.steps.push({ name, pass: !!pass, detail }); return !!pass; };
  window.confirm = () => true; window.alert = (m) => { out.steps.push({ name: 'alert', pass: false, detail: String(m) }); };
  try {
    step('desktop bridge is present', !!window.desktop);
    step('Sunrise folder found', !!app.session.root, app.session.root);
    if (app.session.mission) {
      // Second launch: nothing is opened by hand, so whatever is here was restored.
      out.restored = { mission: app.session.mission, view: app.ui.view, zoom: app.ui.zoom, pan: app.ui.pan, nodes: app.doc().nodes.length, files: Object.keys(app.session.files).length, sdkKeys: app.ui.sdkKeys.length };
      out.ok = out.steps.every((s) => s.pass); return out;
    }
    const list = await window.desktop.listMissions(app.session.root);
    step('missions are listed', list.length >= 3, list.map((m) => m.name + ':' + m.kind).join(' '));

    // Use the picker the way a person would: go to the Missions screen and click a row.
    app.go('missions'); await wait(400);
    const rows = [...document.querySelectorAll('#mission-list .mrow')];
    step('the mission picker shows them', rows.length === list.length && !document.getElementById('missions-view').hidden, rows.map((r) => r.querySelector('.mkind').textContent).join(', '));
    const search = document.getElementById('mission-search');
    const find = async (q) => { search.value = q; search.dispatchEvent(new Event('input')); await wait(200); return document.querySelectorAll('#mission-list .mrow').length; };
    step('searching by name narrows the list', await find('patrol') === 1);
    step('searching by scenario finds every script that uses it', await find('mission_demo') === 2);
    await find('');
    document.querySelector('#mission-list .mrow.kind-campaign').click(); await wait(600);
    step('a campaign script opens on the canvas', app.session.mission && app.session.mission.kind === 'visual' && app.session.mission.imported, JSON.stringify(app.session.mission));
    step('its nodes are drawn', document.querySelectorAll('#ws .node').length === app.doc().nodes.length && app.doc().nodes.length > 8, app.doc().nodes.length + ' nodes');
    step('its SDK keys are loaded', app.ui.sdkKeys.length > 0, app.ui.sdkKeys.length + ' keys from ' + app.session.sdkPath);
    step('the scenario was read from the script', app.doc().meta.scenario === 'MISSION_DEMO', app.doc().meta.scenario);
    const errs = app.current().problems.filter((p) => p.level === 'err').map((p) => p.msg);
    step('the drawing compiles without problems', errs.length === 0, errs.join(' | '));
    // Mission mode: its tab strip, a new scene tab, and back again without losing the campaign drawing.
    const campaignNodes = app.doc().nodes.length, modeSel = document.getElementById('m-mode');
    const setModeTo = async (m) => { modeSel.value = m; modeSel.dispatchEvent(new Event('change')); await wait(200); };
    const palette = () => [...document.querySelectorAll('#palette .pal')].map((p) => p.textContent);
    await setModeTo('mission');
    step('mission mode shows the Flow tab and its nodes', !document.getElementById('tabs').hidden && document.querySelectorAll('#tabs .tab').length === 1 && palette().some((p) => p.startsWith('When the player lands')), palette().length + ' palette entries');
    [...document.querySelectorAll('#tabs button')].find((b) => b.textContent === '+ scene').click(); await wait(200);
    step('a new scene gets its own tab and the scene nodes', document.querySelectorAll('#tabs .tab').length === 2 && document.querySelector('#tabs .tab.on').textContent.startsWith('scene')
      && palette().some((p) => p.startsWith('When this scene is run')) && !palette().some((p) => p.startsWith('When the player lands')) && !!document.querySelector('#tabs .tools input'));
    document.querySelector('#tabs .tab').click(); await wait(200);
    step('clicking Flow goes back to the flow', document.querySelector('#tabs .tab.on').textContent === 'Flow' && palette().some((p) => p.startsWith('Step')));
    await setModeTo('campaign');
    step('the campaign drawing is untouched by the visit', app.doc().nodes.length === campaignNodes && document.getElementById('tabs').hidden);

    await app.saveMission(); await wait(200);
    const back = await window.desktop.readMission(app.session.root, 'mission_demo');
    step('saving writes the script and the drawing', back.generated && !!back.scene && back.kind === 'scene', 'kind=' + back.kind);
    step('the mission is no longer marked imported', app.session.mission.imported === false);

    await app.openMission('adventure_raw');
    step('a plain Lua script opens as text', app.session.mission.kind === 'text' && !document.getElementById('text-view').hidden, app.session.mission.kind);
    const area = document.getElementById('text-area');
    area.value += '\n-- edited in the smoke run\n'; area.dispatchEvent(new Event('input'));
    step('text edits are held as unsaved', app.session.files['adventure_raw.lua'].includes('edited in the smoke run') && document.getElementById('mission-name').textContent.startsWith('●'));

    // A freeroam destination: a short script plus content.lua, read into the freeroam canvas.
    app.go('missions'); await wait(400);
    document.querySelector('#mission-list .mrow.kind-freeroam').click(); await wait(700);
    step('a freeroam script opens on the canvas', app.session.mission.kind === 'visual' && app.session.mission.imported && app.doc().meta.mode === 'freeroam', JSON.stringify(app.session.mission) + ' mode=' + app.doc().meta.mode);
    step('its zones, event and Lost Sector are drawn', document.querySelectorAll('#ws .node').length === 4 && document.getElementById('m-mode').value === 'freeroam', app.doc().nodes.map((n) => n.type).join(' '));
    const ferrs = app.current().problems.filter((p) => p.level === 'err').map((p) => p.msg);
    step('the freeroam drawing compiles without problems', ferrs.length === 0 && !!app.current().files['content.lua'], ferrs.join(' | '));
    step('nothing is marked unsaved just from opening it', !document.getElementById('mission-name').textContent.startsWith('●'));
    await app.saveMission(); await wait(200);
    const fr = await window.desktop.readMission(app.session.root, 'demo_freeroam');
    step('saving writes the script and content.lua', fr.generated && fr.kind === 'scene' && fr.files['content.lua'].includes('Generated by Sunrise Scenes') && fr.files['content.lua'].includes('unit(mission.Squad.SQ_OLD_BOSS, mission.Slot.SQ_OLD_BOSS)'));

    // A folder of shared Lua, and a mission with several files, in the text editor.
    await app.openMission('lib');
    step('a shared Lua folder opens as text with a tab per file', app.session.mission.kind === 'text' && document.querySelectorAll('#text-files button').length === 1 && document.getElementById('text-area').value.includes('Stand-in'), Object.keys(app.session.files).join(' '));

    // A plain folder of scripts (no Sunrise install around it), borrowing the install's SDK.
    // The folder dialog cannot be driven from here, so the session is pointed at it directly.
    const install = app.session.root, plain = install.replace(/[\\/]game[\\/]bin[\\/]x64[\\/]Sunrise$/, '') + install.match(/[\\/]/)[0] + 'plain';
    const info = await window.desktop.describeRoot(plain, install);
    step('a plain scripts folder is recognised', info && info.kind === 'scripts' && !!info.sdk, JSON.stringify(info));
    Object.assign(app.session, { root: plain, sdkDir: install, mission: null, files: {}, saved: {}, file: '', savedLua: null, notes: [] });
    app.go('missions'); await wait(500);
    step('its scripts are listed', document.querySelectorAll('#mission-list .mrow.kind-campaign').length === 1 && !document.getElementById('sdk-row').hidden,
      [...document.querySelectorAll('#mission-list .mname')].map((e) => e.textContent).join(' '));
    document.querySelector('#mission-list .mrow.kind-campaign').click(); await wait(600);
    step('a script from it opens with borrowed SDK keys', app.session.mission && app.session.mission.imported && app.ui.sdkKeys.length > 0, app.ui.sdkKeys.length + ' keys');
    step('the save button says what it does', document.getElementById('b-mission-save').textContent === 'Save script');
    await app.saveMission(); await wait(200);
    const kept = await window.desktop.readMission(plain, 'mission_demo', install);
    step('saving writes into the plain folder', kept.generated && kept.kind === 'scene' && kept.path.startsWith(plain), kept.path);
    Object.assign(app.session, { root: install, sdkDir: '', mission: null, savedLua: null });

    // Leave a recognisable state behind for the second launch to find.
    await app.openMission('mission_demo');
    app.ui.zoom = 0.5; app.ui.pan = { x: -123, y: 45 }; app.go('inputs');
    await wait(700);   // let the debounced workspace save land
    out.left = { mission: 'mission_demo', view: 'inputs', zoom: 0.5, pan: { x: -123, y: 45 }, nodes: app.doc().nodes.length };
    out.ok = out.steps.every((s) => s.pass);
  } catch (e) { out.error = String(e && e.stack || e); }
  return out;
})();
