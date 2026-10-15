"use strict";
const electron = require("electron");
const IPC = {
  getConfig: "config:get",
  chooseWorkDir: "config:chooseWorkDir",
  setTheme: "config:setTheme",
  listMaps: "maps:list",
  readMap: "maps:read",
  saveMap: "maps:save",
  createMap: "maps:create",
  createFolder: "folders:create",
  renameEntry: "entries:rename",
  duplicateMap: "maps:duplicate",
  deleteEntry: "entries:delete",
  saveExport: "export:save",
  exportPdf: "export:pdf",
  listVersions: "history:list",
  restoreVersion: "history:restore",
  pickImportFile: "import:pick",
  closeRequested: "window:close-requested",
  closeWindow: "window:close"
};
const api = {
  getConfig: () => electron.ipcRenderer.invoke(IPC.getConfig),
  chooseWorkDir: () => electron.ipcRenderer.invoke(IPC.chooseWorkDir),
  setTheme: (theme) => electron.ipcRenderer.invoke(IPC.setTheme, theme),
  listMaps: () => electron.ipcRenderer.invoke(IPC.listMaps),
  readMap: (path) => electron.ipcRenderer.invoke(IPC.readMap, path),
  saveMap: (path, file) => electron.ipcRenderer.invoke(IPC.saveMap, path, file),
  createMap: (folderPath, title, template, mindmap) => electron.ipcRenderer.invoke(IPC.createMap, folderPath, title, template, mindmap),
  createFolder: (parentPath, name) => electron.ipcRenderer.invoke(IPC.createFolder, parentPath, name),
  renameEntry: (path, newName) => electron.ipcRenderer.invoke(IPC.renameEntry, path, newName),
  duplicateMap: (path) => electron.ipcRenderer.invoke(IPC.duplicateMap, path),
  deleteEntry: (path) => electron.ipcRenderer.invoke(IPC.deleteEntry, path),
  saveExport: (kind, defaultName, data) => electron.ipcRenderer.invoke(IPC.saveExport, kind, defaultName, data),
  exportPdf: (defaultName, html) => electron.ipcRenderer.invoke(IPC.exportPdf, defaultName, html),
  listVersions: (path) => electron.ipcRenderer.invoke(IPC.listVersions, path),
  restoreVersion: (path, versionId) => electron.ipcRenderer.invoke(IPC.restoreVersion, path, versionId),
  pickImportFile: () => electron.ipcRenderer.invoke(IPC.pickImportFile),
  onCloseRequested: (callback) => {
    electron.ipcRenderer.on(IPC.closeRequested, () => callback());
  },
  closeWindow: () => electron.ipcRenderer.invoke(IPC.closeWindow)
};
electron.contextBridge.exposeInMainWorld("api", api);
