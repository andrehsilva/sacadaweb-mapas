"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const fs = require("fs");
const promises = require("fs/promises");
const icon = path.join(__dirname, "../../resources/icon.png");
const MAP_EXTENSION = ".swmap.json";
const MAP_FILE_VERSION = 1;
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
async function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  try {
    await promises.writeFile(tmpPath, content);
    await promises.rename(tmpPath, filePath);
  } catch (error) {
    await promises.unlink(tmpPath).catch(() => void 0);
    throw error;
  }
}
const DEFAULT_CONFIG = { workDir: null, theme: "dark" };
const configPath = () => path.join(electron.app.getPath("userData"), "config.json");
let cached = null;
async function loadConfig() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await promises.readFile(configPath(), "utf-8"));
    const workDir = typeof parsed.workDir === "string" && fs.existsSync(parsed.workDir) ? parsed.workDir : null;
    const theme = parsed.theme === "light" ? "light" : "dark";
    cached = { workDir, theme };
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}
async function updateConfig(patch) {
  const next = { ...await loadConfig(), ...patch };
  await atomicWrite(configPath(), JSON.stringify(next, null, 2));
  cached = next;
  return next;
}
function suggestWorkDir() {
  const home = electron.app.getPath("home");
  const candidates = [
    "G:\\Meu Drive",
    "G:\\My Drive",
    path.join(home, "Meu Drive"),
    path.join(home, "My Drive"),
    path.join(home, "Google Drive"),
    electron.app.getPath("documents")
  ];
  return candidates.find((path2) => fs.existsSync(path2)) ?? home;
}
const FILTERS = {
  png: { name: "Imagem PNG", extensions: ["png"] },
  md: { name: "Markdown", extensions: ["md"] },
  svg: { name: "Imagem vetorial SVG", extensions: ["svg"] },
  csv: { name: "Planilha CSV", extensions: ["csv"] },
  xlsx: { name: "Planilha Excel", extensions: ["xlsx"] },
  swmap: { name: "Organograma SacadaWeb-Mapas", extensions: ["json"] }
};
const EXTENSIONS = {
  png: "png",
  md: "md",
  svg: "svg",
  csv: "csv",
  xlsx: "xlsx",
  swmap: "swmap.json"
};
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG_DATA_URL_PREFIX = /^data:image\/png;base64,/;
function toBuffer(kind, data) {
  if (kind === "xlsx") {
    if (!BASE64_PATTERN.test(data)) throw new Error("Planilha inválida.");
    return Buffer.from(data, "base64");
  }
  if (kind !== "png") return data;
  if (!PNG_DATA_URL_PREFIX.test(data)) throw new Error("Imagem PNG inválida.");
  return Buffer.from(data.replace(PNG_DATA_URL_PREFIX, ""), "base64");
}
async function saveExport(window, kind, defaultName, data) {
  const content = toBuffer(kind, data);
  const options = {
    title: "Exportar mapa",
    defaultPath: `${defaultName}.${EXTENSIONS[kind]}`,
    filters: [FILTERS[kind]]
  };
  const { canceled, filePath } = window ? await electron.dialog.showSaveDialog(window, options) : await electron.dialog.showSaveDialog(options);
  if (canceled || !filePath) return false;
  if (typeof content === "string") await atomicWrite(filePath, content);
  else await promises.writeFile(filePath, content);
  return true;
}
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const KIND_BY_EXTENSION = {
  ".xmind": "xmind",
  ".mm": "freemind",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "markdown",
  ".csv": "csv",
  ".json": "lucid",
  ".vsdx": "visio",
  ".xlsx": "xlsx"
};
async function pickImportFile(window) {
  const options = {
    title: "Importar mapa",
    properties: ["openFile"],
    filters: [
      {
        name: "Mapas, organogramas e texto",
        extensions: ["xmind", "mm", "md", "markdown", "txt", "csv", "json", "vsdx", "xlsx"]
      }
    ]
  };
  const { canceled, filePaths } = window ? await electron.dialog.showOpenDialog(window, options) : await electron.dialog.showOpenDialog(options);
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const kind = KIND_BY_EXTENSION[path.extname(filePath).toLowerCase()];
  if (!kind)
    throw new Error(
      "Formato não suportado. Use .xmind, .mm, .md, .txt, .csv, .xlsx (Excel), .json (Lucidchart ou organograma do SacadaWeb-Mapas) ou .vsdx (Visio)."
    );
  if ((await promises.stat(filePath)).size > MAX_IMPORT_BYTES) {
    throw new Error("O arquivo é grande demais para importar (limite de 20 MB).");
  }
  const content = await promises.readFile(filePath);
  return {
    fileName: filePath.slice(Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/")) + 1),
    kind,
    contentBase64: content.toString("base64")
  };
}
const MAX_HTML_BYTES = 30 * 1024 * 1024;
async function renderHtmlToPdf(html) {
  if (typeof html !== "string" || html.length === 0) throw new Error("Conteúdo do PDF inválido.");
  if (Buffer.byteLength(html, "utf-8") > MAX_HTML_BYTES) {
    throw new Error("O organograma é grande demais para gerar o PDF.");
  }
  const tempFile = path.join(electron.app.getPath("temp"), `sacadaweb-mapas-${process.pid}-${Date.now()}.html`);
  await promises.writeFile(tempFile, html, "utf-8");
  const window = new electron.BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    await window.loadFile(tempFile);
    return await window.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    window.destroy();
    await promises.unlink(tempFile).catch(() => void 0);
  }
}
async function exportPdf(parent, defaultName, html) {
  const options = {
    title: "Exportar PDF",
    defaultPath: `${defaultName}.pdf`,
    filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
  };
  const { canceled, filePath } = parent ? await electron.dialog.showSaveDialog(parent, options) : await electron.dialog.showSaveDialog(options);
  if (canceled || !filePath) return false;
  await atomicWrite(filePath, await renderHtmlToPdf(html));
  return true;
}
const CLOSE_TIMEOUT_MS = 8e3;
const allowedToClose = /* @__PURE__ */ new WeakSet();
function guardWindowClose(window) {
  window.on("close", (event) => {
    if (allowedToClose.has(window)) return;
    event.preventDefault();
    window.webContents.send(IPC.closeRequested);
    setTimeout(() => {
      if (!window.isDestroyed()) forceClose(window);
    }, CLOSE_TIMEOUT_MS).unref();
  });
}
function forceClose(window) {
  allowedToClose.add(window);
  window.close();
}
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;
const FIRST_PRINTABLE_CHAR_CODE = 32;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function resolveInside(root, relPath) {
  const absolute = path.resolve(root, relPath);
  const rel = path.relative(root, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Caminho fora da pasta de trabalho.");
  }
  return absolute;
}
function validateName(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Informe um nome.");
  const hasControlChar = [...trimmed].some((char) => char.charCodeAt(0) < FIRST_PRINTABLE_CHAR_CODE);
  if (INVALID_NAME_CHARS.test(trimmed) || hasControlChar) {
    throw new Error('O nome não pode conter \\ / : * ? " < > |');
  }
  if (trimmed.endsWith(".") || trimmed.startsWith(".")) {
    throw new Error("O nome não pode começar ou terminar com ponto.");
  }
  if (RESERVED_NAMES.test(trimmed)) throw new Error("Esse nome é reservado pelo Windows.");
  return trimmed;
}
function toRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}
const HISTORY_DIR = ".historico";
const MAX_VERSIONS = 20;
const MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1e3;
const VERSION_ID = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.swmap\.json$/;
function isVersionId(id) {
  return VERSION_ID.test(id);
}
function versionIdFor(date) {
  return `${date.toISOString().replace(/[:.]/g, "-")}${MAP_EXTENSION}`;
}
function versionDate(id) {
  const match = VERSION_ID.exec(id);
  if (!match) return null;
  const [, day, hh, mm, ss, ms] = match;
  return /* @__PURE__ */ new Date(`${day}T${hh}:${mm}:${ss}.${ms}Z`);
}
function historyDirFor(root, mapPath) {
  return resolveInside(root, path.join(HISTORY_DIR, mapPath));
}
async function exists$1(path2) {
  return promises.stat(path2).then(
    () => true,
    () => false
  );
}
async function listVersions(root, mapPath) {
  const dir = historyDirFor(root, mapPath);
  const names = await promises.readdir(dir).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const ids = names.filter(isVersionId).sort().reverse();
  return Promise.all(
    ids.map(async (id) => ({
      id,
      createdAt: versionDate(id).toISOString(),
      size: (await promises.stat(path.join(dir, id))).size
    }))
  );
}
async function prune(dir) {
  const ids = (await promises.readdir(dir)).filter(isVersionId).sort().reverse();
  await Promise.all(ids.slice(MAX_VERSIONS).map((id) => promises.unlink(path.join(dir, id))));
}
async function snapshot(root, mapPath, options = {}) {
  const source = resolveInside(root, mapPath);
  if (!await exists$1(source)) return;
  const now = options.now ?? /* @__PURE__ */ new Date();
  const dir = historyDirFor(root, mapPath);
  if (!options.force) {
    const [latest] = await listVersions(root, mapPath);
    if (latest && now.getTime() - new Date(latest.createdAt).getTime() < MIN_SNAPSHOT_INTERVAL_MS) {
      return;
    }
  }
  await promises.mkdir(dir, { recursive: true });
  await promises.copyFile(source, path.join(dir, versionIdFor(now)));
  await prune(dir);
}
async function restoreVersion(root, mapPath, versionId, validate) {
  if (!isVersionId(versionId)) throw new Error("Versão inválida.");
  const versionPath = path.join(historyDirFor(root, mapPath), versionId);
  const raw = await promises.readFile(versionPath, "utf-8").catch(() => {
    throw new Error("Essa versão não existe mais.");
  });
  validate(raw);
  await snapshot(root, mapPath, { force: true });
  await atomicWrite(resolveInside(root, mapPath), raw);
}
async function moveHistory(root, oldPath, newPath) {
  const from = historyDirFor(root, oldPath);
  if (!await exists$1(from)) return;
  const to = historyDirFor(root, newPath);
  await promises.mkdir(path.join(to, ".."), { recursive: true });
  await promises.rename(from, to);
}
const DEFAULT_ORG_SETTINGS = {
  orientation: "vertical",
  alignLevels: true,
  hiddenLevels: []
};
const MAX_ORG_NODES = 5e3;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOrgChartData(value) {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !isRecord(value.settings)) return false;
  if (value.nodes.length === 0 || value.nodes.length > MAX_ORG_NODES) return false;
  if (!Array.isArray(value.links)) return false;
  const caption = value.settings.caption;
  if (caption !== void 0) {
    if (!isRecord(caption) || typeof caption.title !== "string" || typeof caption.text !== "string" || caption.hidden !== void 0 && typeof caption.hidden !== "boolean") {
      return false;
    }
  }
  if (value.settings.orientation !== "vertical" && value.settings.orientation !== "horizontal") {
    return false;
  }
  const parentById = /* @__PURE__ */ new Map();
  for (const node of value.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || typeof node.title !== "string")
      return false;
    if (node.parentId !== null && typeof node.parentId !== "string") return false;
    if (parentById.has(node.id)) return false;
    parentById.set(node.id, node.parentId);
  }
  for (const [id, parentId] of parentById) {
    if (parentId !== null && !parentById.has(parentId)) return false;
    let steps = 0;
    let current = id;
    while (current !== null) {
      if (++steps > parentById.size) return false;
      current = parentById.get(current) ?? null;
    }
  }
  return true;
}
function createEmptyOrgChart(title) {
  return {
    nodes: [{ id: "raiz", parentId: null, title }],
    links: [],
    settings: { ...DEFAULT_ORG_SETTINGS }
  };
}
const CONFLICT_PATTERNS = [
  /^(.+) \(\d+\)$/,
  /^(.+?)[ _-]+(?:conflicted copy|cópia em conflito)\b.*$/i
];
function originalNameOf(name) {
  for (const pattern of CONFLICT_PATTERNS) {
    const match = pattern.exec(name);
    if (match) return match[1].trim();
  }
  return null;
}
function markConflicts(entries) {
  const mapsByName = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.kind === "map") mapsByName.set(entry.name.toLowerCase(), entry.path);
  }
  return entries.map((entry) => {
    if (entry.kind !== "map") return entry;
    const original = originalNameOf(entry.name);
    const originalPath = original ? mapsByName.get(original.toLowerCase()) : void 0;
    return originalPath ? { ...entry, conflictWith: originalPath } : entry;
  });
}
const HIDDEN_PREFIX = ".";
function isMapFileName(name) {
  return name.toLowerCase().endsWith(MAP_EXTENSION);
}
function mapNameOf(fileName) {
  return fileName.slice(0, -MAP_EXTENSION.length);
}
async function exists(path2) {
  return promises.stat(path2).then(
    () => true,
    () => false
  );
}
function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
}
const TEMPLATE_PEEK_BYTES = 1024;
const TEMPLATE_PATTERN = /"template"\s*:\s*"(livre|pop-sacadaweb|organograma)"/;
async function peekTemplate(absolute) {
  try {
    const handle = await promises.open(absolute, "r");
    try {
      const buffer = Buffer.alloc(TEMPLATE_PEEK_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, TEMPLATE_PEEK_BYTES, 0);
      const found = TEMPLATE_PATTERN.exec(buffer.toString("utf-8", 0, bytesRead));
      return found ? found[1] : void 0;
    } finally {
      await handle.close();
    }
  } catch {
    return void 0;
  }
}
async function readTree(root, dir) {
  const dirents = await promises.readdir(dir, { withFileTypes: true });
  const entries = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(HIDDEN_PREFIX)) continue;
    const absolute = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      entries.push({
        kind: "folder",
        name: dirent.name,
        path: toRelative(root, absolute),
        children: await readTree(root, absolute)
      });
    } else if (dirent.isFile() && isMapFileName(dirent.name)) {
      const template = await peekTemplate(absolute);
      entries.push({
        kind: "map",
        name: mapNameOf(dirent.name),
        path: toRelative(root, absolute),
        ...template ? { template } : {}
      });
    }
  }
  return sortEntries(markConflicts(entries));
}
function listMaps(root) {
  return readTree(root, root);
}
function parseMapFile(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("O arquivo não é um JSON válido e não foi aberto.");
  }
  const file = parsed;
  if (!file || typeof file !== "object" || typeof file.meta !== "object" || !file.mindmap && !file.orgchart) {
    throw new Error("O arquivo não tem o formato de um mapa do SacadaWeb-Mapas.");
  }
  if (file.version !== MAP_FILE_VERSION) {
    throw new Error(
      `Versão do arquivo (${String(file.version)}) não suportada por este app. Atualize o SacadaWeb-Mapas.`
    );
  }
  if (file.meta?.template === "organograma" && !isOrgChartData(file.orgchart)) {
    throw new Error("O organograma deste arquivo está incompleto ou corrompido e não foi aberto.");
  }
  return file;
}
async function readMap(root, relPath) {
  const raw = await promises.readFile(resolveInside(root, relPath), "utf-8");
  return parseMapFile(raw);
}
async function snapshotSafely(root, relPath) {
  try {
    await snapshot(root, relPath);
  } catch (error) {
    console.error("Falha ao criar a versão do histórico de", relPath, error);
  }
}
async function saveMap(root, relPath, file) {
  const absolute = resolveInside(root, relPath);
  if (!isMapFileName(absolute)) throw new Error("Extensão de arquivo inválida.");
  await snapshotSafely(root, relPath);
  await atomicWrite(absolute, JSON.stringify(file, null, 2));
}
function isMindNode(value) {
  const isTree = (candidate) => {
    const node = candidate;
    return typeof node === "object" && node !== null && typeof node.data === "object" && node.data !== null;
  };
  const full = value;
  return isTree(value) || typeof full === "object" && full !== null && isTree(full.root);
}
async function createMap(root, folderPath, title, template, initial) {
  const isOrg = template === "organograma";
  if (initial !== void 0 && !(isOrg ? isOrgChartData(initial) : isMindNode(initial))) {
    throw new Error("Dados do mapa inválidos.");
  }
  const name = validateName(title);
  const absolute = path.join(resolveInside(root, folderPath), name + MAP_EXTENSION);
  if (await exists(absolute)) throw new Error(`Já existe um mapa chamado "${name}" nesta pasta.`);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const file = {
    version: MAP_FILE_VERSION,
    meta: { title: name, createdAt: now, updatedAt: now, template },
    ...isOrg ? { orgchart: initial ?? createEmptyOrgChart(name) } : { mindmap: initial ?? { data: { text: name }, children: [] } }
  };
  await atomicWrite(absolute, JSON.stringify(file, null, 2));
  return toRelative(root, absolute);
}
async function createFolder(root, parentPath, name) {
  const absolute = path.join(resolveInside(root, parentPath), validateName(name));
  if (await exists(absolute)) throw new Error("Já existe uma pasta com esse nome.");
  await promises.mkdir(absolute);
  return toRelative(root, absolute);
}
async function renameEntry(root, relPath, newName) {
  const source = resolveInside(root, relPath);
  const name = validateName(newName);
  const isMap = isMapFileName(source);
  const target = path.join(path.dirname(source), isMap ? name + MAP_EXTENSION : name);
  if (target === source) return relPath;
  if (await exists(target)) throw new Error("Já existe um item com esse nome.");
  await promises.rename(source, target);
  await moveHistory(root, relPath, toRelative(root, target)).catch((error) => {
    console.error("Falha ao mover o histórico de", relPath, error);
  });
  if (isMap) await updateTitle(target, name);
  return toRelative(root, target);
}
const MAX_COPY_ATTEMPTS = 500;
async function freeCopyName(folder, name) {
  for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? `${name} - cópia` : `${name} - cópia ${attempt}`;
    if (!await exists(path.join(folder, candidate + MAP_EXTENSION))) return candidate;
  }
  throw new Error("Há cópias demais deste mapa. Exclua algumas e tente de novo.");
}
async function duplicateMap(root, relPath) {
  const source = resolveInside(root, relPath);
  if (!isMapFileName(source)) throw new Error("Só dá para duplicar mapas.");
  const file = parseMapFile(await promises.readFile(source, "utf-8"));
  const folder = path.dirname(source);
  const name = await freeCopyName(folder, mapNameOf(path.basename(source)));
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const copy = {
    ...file,
    meta: { ...file.meta, title: name, createdAt: now, updatedAt: now }
  };
  const target = path.join(folder, name + MAP_EXTENSION);
  await atomicWrite(target, JSON.stringify(copy, null, 2));
  return toRelative(root, target);
}
async function updateTitle(absolute, title) {
  const file = parseMapFile(await promises.readFile(absolute, "utf-8"));
  const renamed = { ...file, meta: { ...file.meta, title } };
  await atomicWrite(absolute, JSON.stringify(renamed, null, 2));
}
async function deleteEntry(root, relPath) {
  const absolute = resolveInside(root, relPath);
  if (absolute === root || path.basename(absolute) === "")
    throw new Error("Não é possível excluir a pasta de trabalho.");
  await electron.shell.trashItem(absolute);
}
async function requireWorkDir() {
  const { workDir } = await loadConfig();
  if (!workDir) throw new Error("Escolha a pasta de trabalho antes de continuar.");
  return workDir;
}
async function chooseWorkDir(event) {
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: "Escolha a pasta dos mapas (ideal: uma pasta do Google Drive para desktop)",
    defaultPath: suggestWorkDir(),
    properties: ["openDirectory", "createDirectory"]
  };
  const { canceled, filePaths } = window ? await electron.dialog.showOpenDialog(window, options) : await electron.dialog.showOpenDialog(options);
  if (canceled || filePaths.length === 0) return null;
  return updateConfig({ workDir: filePaths[0] });
}
function registerIpc() {
  electron.ipcMain.handle(IPC.getConfig, () => loadConfig());
  electron.ipcMain.handle(IPC.chooseWorkDir, chooseWorkDir);
  electron.ipcMain.handle(
    IPC.setTheme,
    (_e, theme) => updateConfig({ theme: theme === "dark" ? "dark" : "light" })
  );
  electron.ipcMain.handle(IPC.listMaps, async () => listMaps(await requireWorkDir()));
  electron.ipcMain.handle(
    IPC.readMap,
    async (_e, path2) => readMap(await requireWorkDir(), path2)
  );
  electron.ipcMain.handle(
    IPC.saveMap,
    async (_e, path2, file) => saveMap(await requireWorkDir(), path2, file)
  );
  electron.ipcMain.handle(
    IPC.createMap,
    async (_e, folder, title, template, mindmap) => createMap(await requireWorkDir(), folder, title, template, mindmap)
  );
  electron.ipcMain.handle(
    IPC.createFolder,
    async (_e, parent, name) => createFolder(await requireWorkDir(), parent, name)
  );
  electron.ipcMain.handle(
    IPC.duplicateMap,
    async (_e, path2) => duplicateMap(await requireWorkDir(), path2)
  );
  electron.ipcMain.handle(
    IPC.renameEntry,
    async (_e, path2, name) => renameEntry(await requireWorkDir(), path2, name)
  );
  electron.ipcMain.handle(
    IPC.deleteEntry,
    async (_e, path2) => deleteEntry(await requireWorkDir(), path2)
  );
  electron.ipcMain.handle(
    IPC.saveExport,
    (event, kind, defaultName, data) => saveExport(electron.BrowserWindow.fromWebContents(event.sender), kind, defaultName, data)
  );
  electron.ipcMain.handle(
    IPC.exportPdf,
    (event, defaultName, html) => exportPdf(electron.BrowserWindow.fromWebContents(event.sender), defaultName, html)
  );
  electron.ipcMain.handle(
    IPC.listVersions,
    async (_e, path2) => listVersions(await requireWorkDir(), path2)
  );
  electron.ipcMain.handle(
    IPC.restoreVersion,
    async (_e, path2, versionId) => restoreVersion(await requireWorkDir(), path2, versionId, parseMapFile)
  );
  electron.ipcMain.handle(
    IPC.pickImportFile,
    (event) => pickImportFile(electron.BrowserWindow.fromWebContents(event.sender))
  );
  electron.ipcMain.handle(IPC.closeWindow, (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    if (window) forceClose(window);
  });
}
const APP_ID = "br.com.sacadaweb.mapas";
function isExternalUrl(url) {
  return url.startsWith("https://") || url.startsWith("http://");
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: "SacadaWeb - Mapas",
    icon,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  guardWindowClose(mainWindow);
  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId(APP_ID);
  electron.app.on("browser-window-created", (_, window) => utils.optimizer.watchWindowShortcuts(window));
  registerIpc();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
