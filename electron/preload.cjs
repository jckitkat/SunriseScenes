// The only bridge between the page and the machine. The page gets these functions and
// nothing else: no Node, no file paths it did not get from here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (json) => ipcRenderer.invoke('state:save', json),
  saveStateNow: (json) => ipcRenderer.sendSync('state:save-sync', json),   // on window close
  findSunrise: () => ipcRenderer.invoke('sunrise:find'),
  chooseRoot: () => ipcRenderer.invoke('sunrise:choose'),
  describeRoot: (root, sdkDir) => ipcRenderer.invoke('sunrise:describe', root, sdkDir),
  chooseSdk: () => ipcRenderer.invoke('sdk:choose'),
  listMissions: (root, sdkDir) => ipcRenderer.invoke('missions:list', root, sdkDir),
  readMission: (root, name, sdkDir) => ipcRenderer.invoke('missions:read', root, name, sdkDir),
  writeMission: (root, name, lua, scene, extra) => ipcRenderer.invoke('missions:write', root, name, lua, scene, extra),
  sdkFor: (root, scenario, activity, sdkDir) => ipcRenderer.invoke('missions:sdk', root, scenario, activity, sdkDir),
  reveal: (root, name) => ipcRenderer.invoke('missions:reveal', root, name),
});
