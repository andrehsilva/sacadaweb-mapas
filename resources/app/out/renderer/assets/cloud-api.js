/* SacadaWeb - Mapas :: cliente da nuvem (window.api sobre o Appwrite) */
(() => {
  "use strict";

  const MAP_EXTENSION = ".swmap.json";
  const FILE_EXTENSION = ".json"; // nome do arquivo no bucket (a extensão precisa ser .json)
  // Modelos que o app cria e que o arquivo pode trazer (mesmo conjunto nos dois caminhos).
  const TEMPLATES = ["livre", "pop-sacadaweb", "organograma", "desenho"];
  const MAX_MAP_BYTES = 20 * 1024 * 1024;
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  const MAX_VERSIONS = 20;
  const MAX_COPY_ATTEMPTS = 500;
  const MAX_ORG_NODES = 5000;
  const MAX_DRAWING_STROKES = 20000;
  const MAX_STROKE_POINTS = 20000;
  const MAX_STROKE_WIDTH = 200;
  const MAX_TOKEN_CHARS = 32;
  const MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
  const PAGE_SIZE = 100;
  const MAP_VERSION = 1;

  const MISSING_CONFIG = "Appwrite não configurado: defina APPWRITE_ENDPOINT e APPWRITE_PROJECT_ID no .env e reinicie o servidor.";
  const MISSING_SDK = "O SDK do Appwrite não carregou. Recarregue a página.";
  const EXPIRED_SESSION = "Sua sessão expirou. Entre de novo.";
  const BAD_CREDENTIALS = "Usuário ou senha inválidos.";
  const TOO_MANY_TRIES = "Muitas tentativas. Tente de novo em alguns minutos.";
  const DUPLICATE_NAME = "Já existe um item com esse nome.";
  const GONE = "Esse item não existe mais na nuvem.";
  const OFFLINE = "Sem conexão com a nuvem. Verifique a internet e tente de novo.";
  const LOST_ENTRY = "Esse item não existe mais. Atualize a lista de mapas.";
  const MISSING_CONTENT = "O conteúdo deste mapa não está na nuvem.";
  const BIG_MAP = "O mapa é grande demais para salvar (limite de 20 MB).";
  const BAD_FORMAT = "O arquivo não tem o formato de um mapa do SacadaWeb-Mapas.";
  const BAD_ORG = "O organograma deste arquivo está incompleto ou corrompido e não foi aberto.";
  const BAD_DATA = "Dados do mapa inválidos.";
  const BAD_DRAWING = "Os dados do desenho estão inválidos.";

  const KIND_BY_EXTENSION = {
    ".xmind": "xmind", ".mm": "freemind", ".md": "markdown", ".markdown": "markdown",
    ".txt": "markdown", ".csv": "csv", ".json": "lucid", ".vsdx": "visio", ".xlsx": "xlsx"
  };
  const MIME = {
    md: "text/markdown;charset=utf-8", svg: "image/svg+xml", csv: "text/csv;charset=utf-8",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png", swmap: "application/json"
  };
  const EXTENSIONS = { png: "png", md: "md", svg: "svg", csv: "csv", xlsx: "xlsx", swmap: "swmap.json" };

  // ------------------------------------------------------------- config e SDK ---

  const injected = window.SACADAWEB_CONFIG || {};
  const config = {
    endpoint: String(injected.endpoint || ""),
    projectId: String(injected.projectId || ""),
    databaseId: injected.databaseId || "sacadaweb_mapas",
    foldersTableId: injected.foldersTableId || "folders",
    mapsTableId: injected.mapsTableId || "maps",
    versionsTableId: injected.versionsTableId || "versions",
    mapsBucketId: injected.mapsBucketId || "maps"
  };

  let sdk = null;

  // Sem endpoint/projeto no .env não há como montar o cliente: toda chamada rejeita.
  function cloud() {
    if (sdk) return sdk;
    const Appwrite = window.Appwrite;
    if (!config.endpoint || !config.projectId) throw error(MISSING_CONFIG, "config");
    if (!Appwrite) throw error(MISSING_SDK, "config");
    try {
      const connection = new Appwrite.Client().setEndpoint(config.endpoint).setProject(config.projectId);
      sdk = {
        Appwrite,
        connection,
        account: new Appwrite.Account(connection),
        tablesDB: new Appwrite.TablesDB(connection),
        storage: new Appwrite.Storage(connection)
      };
    } catch {
      throw error(MISSING_CONFIG, "config");
    }
    return sdk;
  }

  // ------------------------------------------------------------------- erros ---

  function error(message, code, details) {
    const failure = new Error(message);
    failure.code = code || "http";
    failure.details = details || {};
    return failure;
  }

  // Appwrite fala em HTTP: traduz para o vocabulário do app.
  function translate(raw) {
    const status = Number(raw && raw.code) || 0;
    const details = { status, type: String((raw && raw.type) || "") };
    if (status === 401) return error(EXPIRED_SESSION, "auth", details);
    if (status === 429) return error(TOO_MANY_TRIES, "rate", details);
    if (status === 409) return error(DUPLICATE_NAME, "exists", details);
    if (status === 404) return error(GONE, "http", details);
    if (!status) return error(OFFLINE, "http", details);
    return error(`Falha na nuvem (${status}). Tente de novo.`, "http", details);
  }

  async function call(work) {
    try {
      return await work();
    } catch (raw) {
      throw translate(raw);
    }
  }

  // -------------------------------------------------------------- utilidades ---

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function fold(name) {
    return String(name == null ? "" : name).trim().toLowerCase();
  }

  function bytesOf(text) {
    // Buffer não existe no navegador: o Blob conta os bytes em UTF-8.
    return new Blob([text]).size;
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      throw error("O arquivo não é um JSON válido e não foi aberto.", "http");
    }
  }

  const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;
  const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  function validateName(name) {
    const trimmed = String(name == null ? "" : name).trim();
    if (!trimmed) throw error("Informe um nome.", "http");
    const hasControlChar = [...trimmed].some((char) => char.charCodeAt(0) < 32);
    if (INVALID_NAME_CHARS.test(trimmed) || hasControlChar) {
      throw error('O nome não pode conter \\ / : * ? " < > |', "http");
    }
    if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
      throw error("O nome não pode começar ou terminar com ponto.", "http");
    }
    if (RESERVED_NAMES.test(trimmed)) throw error("Esse nome é reservado pelo Windows.", "http");
    return trimmed;
  }

  const DEFAULT_ORG_SETTINGS = { orientation: "vertical", alignLevels: true, hiddenLevels: [] };

  function isOrgChartData(value) {
    if (!isRecord(value) || !Array.isArray(value.nodes) || !isRecord(value.settings)) return false;
    if (value.nodes.length === 0 || value.nodes.length > MAX_ORG_NODES) return false;
    if (!Array.isArray(value.links)) return false;
    const caption = value.settings.caption;
    if (caption !== undefined) {
      if (!isRecord(caption) || typeof caption.title !== "string" || typeof caption.text !== "string") return false;
      if (caption.hidden !== undefined && typeof caption.hidden !== "boolean") return false;
    }
    if (value.settings.orientation !== "vertical" && value.settings.orientation !== "horizontal") return false;
    const parents = new Map();
    for (const node of value.nodes) {
      if (!isRecord(node) || typeof node.id !== "string" || typeof node.title !== "string") return false;
      if (node.parentId !== null && typeof node.parentId !== "string") return false;
      if (parents.has(node.id)) return false;
      parents.set(node.id, node.parentId);
    }
    for (const [id, parentId] of parents) {
      if (parentId !== null && !parents.has(parentId)) return false;
      let steps = 0;
      let current = id;
      while (current !== null) {
        if (++steps > parents.size) return false;
        current = parents.get(current) ?? null;
      }
    }
    return true;
  }

  function isMindNode(value) {
    const isTree = (candidate) => isRecord(candidate) && isRecord(candidate.data);
    return isRecord(value) && (isTree(value) || isTree(value.root));
  }

  function createEmptyOrgChart(title) {
    return { nodes: [{ id: "raiz", parentId: null, title }], links: [], settings: { ...DEFAULT_ORG_SETTINGS } };
  }

  // Desenho livre: cor e fundo são nomes curtos de token (nunca hex).
  const DRAWING_VERSION = 1;
  const DRAWING_PENS = ["ink", "pencil", "marker", "highlighter", "charcoal", "watercolor", "neon", "spray"];
  const DRAWING_PAPER_SIZES = ["free", "a4", "a3", "square"];
  const DRAWING_PAPER_GRIDS = ["none", "grid", "dots", "ruled"];
  const DRAWING_PAPER_DEFAULT = { size: "free", grid: "none", background: "bg" };

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isToken(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_CHARS;
  }

  // Um ponto é [x, y, pressão]; um traço pode ter um ponto só (um toque).
  function isPoint(value) {
    if (!Array.isArray(value) || value.length !== 3) return false;
    if (!isFiniteNumber(value[0]) || !isFiniteNumber(value[1]) || !isFiniteNumber(value[2])) return false;
    return value[2] >= 0 && value[2] <= 1;
  }

  function isStroke(value) {
    if (!isRecord(value)) return false;
    if (!DRAWING_PENS.includes(value.pen)) return false;
    if (!isToken(value.color)) return false;
    if (!isFiniteNumber(value.width) || value.width <= 0 || value.width > MAX_STROKE_WIDTH) return false;
    if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) return false;
    if (value.seed !== undefined && !isFiniteNumber(value.seed)) return false;
    if (!Array.isArray(value.points) || value.points.length === 0 || value.points.length > MAX_STROKE_POINTS) return false;
    return value.points.every(isPoint);
  }

  function isDrawingPaper(value) {
    if (value === undefined) return true;
    if (!isRecord(value)) return false;
    if (value.size !== undefined && !DRAWING_PAPER_SIZES.includes(value.size)) return false;
    if (value.grid !== undefined && !DRAWING_PAPER_GRIDS.includes(value.grid)) return false;
    if (value.background !== undefined && !isToken(value.background)) return false;
    return true;
  }

  function isDrawingData(value) {
    if (!isRecord(value)) return false;
    if (value.version !== DRAWING_VERSION) return false;
    if (!Array.isArray(value.strokes) || value.strokes.length > MAX_DRAWING_STROKES) return false;
    if (!value.strokes.every(isStroke)) return false;
    return isDrawingPaper(value.paper);
  }

  // Prancheta nova: desenho sem traço nenhum (o arquivo pode ir direto para parseMapFile).
  function createEmptyDrawing() {
    return { version: DRAWING_VERSION, paper: { ...DRAWING_PAPER_DEFAULT }, strokes: [] };
  }

  // Mesmas regras do app antigo: valida o objeto antes de gravar e ao abrir.
  function parseMapFile(file) {
    if (!isRecord(file)) throw error(BAD_FORMAT, "http");
    if (file.version !== MAP_VERSION) {
      throw error(`Versão do arquivo (${String(file.version)}) não suportada por este app. Atualize o SacadaWeb-Mapas.`, "http");
    }
    const meta = file.meta;
    if (!isRecord(meta) || typeof meta.title !== "string" || !meta.title.trim() || meta.title.length > 200) {
      throw error(BAD_FORMAT, "http");
    }
    if (!TEMPLATES.includes(meta.template)) throw error(BAD_FORMAT, "http");
    if (meta.template === "organograma") {
      if (!isOrgChartData(file.orgchart)) throw error(BAD_ORG, "http");
    } else if (meta.template === "desenho") {
      if (!isDrawingData(file.drawing)) throw error(BAD_DRAWING, "http");
    } else if (!isMindNode(file.mindmap)) {
      throw error(BAD_DATA, "http");
    }
    return file;
  }

  function mapText(file) {
    const text = JSON.stringify(file, null, 2);
    if (bytesOf(text) > MAX_MAP_BYTES) throw error(BIG_MAP, "http");
    return text;
  }

  // ------------------------------------------------------------ índice e árvore ---

  const revisions = new Map(); // caminho -> revisão memorizada
  const index = {
    loaded: false,
    folders: [],
    maps: [],
    foldersById: new Map(),
    folderPathById: new Map(),
    foldersByPath: new Map(),
    mapsByPath: new Map(),
    tree: []
  };

  function markStale() {
    index.loaded = false;
  }

  function forgetPaths(prefix) {
    for (const path of [...revisions.keys()]) {
      if (path === prefix || path.startsWith(`${prefix}/`)) revisions.delete(path);
    }
  }

  // Renomear não muda a revisão: o que estava memorizado passa a valer no caminho novo.
  function moveRevisions(from, to) {
    for (const [path, revision] of [...revisions]) {
      if (path === from || path.startsWith(`${from}/`)) {
        revisions.delete(path);
        revisions.set(`${to}${path.slice(from.length)}`, revision);
      }
    }
  }

  async function listAllRows(tableId, queries) {
    const { Appwrite, tablesDB } = cloud();
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await call(() => tablesDB.listRows({
        databaseId: config.databaseId,
        tableId,
        queries: [...queries, Appwrite.Query.limit(PAGE_SIZE), Appwrite.Query.offset(offset)]
      }));
      const chunk = (page && page.rows) || [];
      rows.push(...chunk);
      if (chunk.length < PAGE_SIZE) return rows;
    }
  }

  // Caminho da pasta; "" é a raiz e null é pasta inexistente.
  function folderPath(id) {
    if (!id) return "";
    const cached = index.folderPathById.get(id);
    if (cached !== undefined) return cached;
    const row = index.foldersById.get(id);
    if (!row) return null;
    const chain = [];
    let current = row;
    let base = "";
    while (current) {
      const known = index.folderPathById.get(current.$id);
      if (known !== undefined) {
        base = known;
        break;
      }
      if (chain.includes(current.$id)) break; // pasta pendurada nela mesma: trata como raiz
      chain.push(current.$id);
      const parentId = current.parentId || null;
      const parent = parentId ? index.foldersById.get(parentId) : null;
      if (!parent) break;
      current = parent;
    }
    let path = base;
    for (let position = chain.length - 1; position >= 0; position -= 1) {
      const step = index.foldersById.get(chain[position]);
      path = path ? `${path}/${step.name}` : step.name;
      index.folderPathById.set(step.$id, path);
    }
    return index.folderPathById.get(id);
  }

  function parentPathOf(path) {
    const cut = path.lastIndexOf("/");
    return cut === -1 ? "" : path.slice(0, cut);
  }

  function pathOfMap(row) {
    const parentPath = (row.folderId ? folderPath(row.folderId) : "") || "";
    return parentPath ? `${parentPath}/${row.name}${MAP_EXTENSION}` : `${row.name}${MAP_EXTENSION}`;
  }

  function compareEntries(left, right) {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" });
  }

  function subtree(children, parentPath) {
    const list = children.get(parentPath) || [];
    for (const entry of list) {
      if (entry.kind === "folder") entry.children = subtree(children, entry.path);
    }
    return list.sort(compareEntries);
  }

  async function rebuild() {
    const { Appwrite } = cloud();
    const folders = await listAllRows(config.foldersTableId, [Appwrite.Query.orderAsc("name")]);
    const maps = await listAllRows(config.mapsTableId, [Appwrite.Query.orderAsc("name")]);
    index.folders = folders;
    index.maps = maps;
    index.foldersById = new Map(folders.map((row) => [row.$id, row]));
    index.folderPathById = new Map();
    index.foldersByPath = new Map();
    index.mapsByPath = new Map();
    const children = new Map();
    const attach = (parentPath, entry) => {
      const list = children.get(parentPath);
      if (list) list.push(entry);
      else children.set(parentPath, [entry]);
    };
    for (const row of folders) {
      const path = folderPath(row.$id);
      index.foldersByPath.set(path, row);
      attach(parentPathOf(path), { kind: "folder", name: row.name, path, children: [] });
    }
    for (const row of maps) {
      const parentPath = (row.folderId ? folderPath(row.folderId) : "") || "";
      const path = parentPath ? `${parentPath}/${row.name}${MAP_EXTENSION}` : `${row.name}${MAP_EXTENSION}`;
      index.mapsByPath.set(path, row);
      attach(parentPath, { kind: "map", name: row.name, path, template: row.template });
    }
    index.tree = subtree(children, "");
    index.loaded = true;
  }

  async function ensure() {
    if (!index.loaded) await rebuild();
  }

  function entryAt(path) {
    const map = index.mapsByPath.get(path);
    if (map) return { kind: "map", row: map };
    const folder = index.foldersByPath.get(path);
    if (folder) return { kind: "folder", row: folder };
    return null;
  }

  // Caminho pedido pode estar velho (outra pessoa mexeu): recarrega o índice antes de desistir.
  async function findEntry(path, missing) {
    await ensure();
    let found = entryAt(path);
    if (!found) {
      markStale();
      await ensure();
      found = entryAt(path);
    }
    if (!found) throw error(missing || LOST_ENTRY, "http");
    return found;
  }

  // Linha direto da nuvem: revisão e arquivo atual podem ter mudado desde o último listMaps.
  async function freshRow(tableId, rowId) {
    const { tablesDB } = cloud();
    return await call(() => tablesDB.getRow({ databaseId: config.databaseId, tableId, rowId }));
  }

  async function freshMapRow(path) {
    const found = await findEntry(path);
    if (found.kind !== "map") throw error("Esse caminho não é de um mapa.", "http");
    return await freshRow(config.mapsTableId, found.row.$id);
  }

  function rememberMapRow(row) {
    const position = index.maps.findIndex((candidate) => candidate.$id === row.$id);
    if (position === -1) {
      markStale();
      return;
    }
    index.maps[position] = row;
    index.mapsByPath.set(pathOfMap(row), row);
  }

  async function parentFolderOf(path) {
    if (!path) return null;
    const found = await findEntry(path);
    if (found.kind !== "folder") throw error("Esse caminho não é de uma pasta.", "http");
    return found.row;
  }

  function siblingMap(folderId, name, ignoreId) {
    const parent = folderId || null;
    return index.maps.some((row) => row.$id !== ignoreId && (row.folderId || null) === parent && fold(row.name) === fold(name));
  }

  function siblingFolder(parentId, name, ignoreId) {
    const parent = parentId || null;
    return index.folders.some((row) => row.$id !== ignoreId && (row.parentId || null) === parent && fold(row.name) === fold(name));
  }

  function isInsideFolder(folderId, targetId) {
    let current = folderId || null;
    let steps = 0;
    while (current && steps < 1000) {
      if (current === targetId) return true;
      const row = index.foldersById.get(current);
      current = row ? row.parentId || null : null;
      steps += 1;
    }
    return false;
  }

  function sortVersions(rows) {
    return [...rows].sort((left, right) => {
      const first = String(left.$createdAt || "");
      const second = String(right.$createdAt || "");
      if (first !== second) return first < second ? 1 : -1;
      return String(left.$id) < String(right.$id) ? 1 : -1;
    });
  }

  // --------------------------------------------------------- conteúdo no bucket ---

  async function readText(bucketId, fileId) {
    const { storage, connection } = cloud();
    const target = await call(() => storage.getFileDownload({ bucketId, fileId }));
    if (target instanceof Response) return await target.text();
    // O SDK devolve a URL do arquivo. Buscamos pelo transporte dele (client.call) em vez de um fetch cru:
    // é ele que manda X-Appwrite-Project e o fallback de cookie do localStorage — o navegador bloqueia
    // cookie de terceiros e, sem esse header, o download responde 401.
    const data = await call(() =>
      connection.call("GET", new URL(target), { accept: "application/octet-stream" }, {}, "arrayBuffer")
    );
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
    // Arquivo servido como JSON: o SDK já interpretou e devolve o objeto.
    return JSON.stringify(data);
  }

  // Sempre um arquivo novo no bucket de mapas; o antigo vira versão (ou é apagado).
  async function putContent(rowId, file) {
    const { Appwrite, storage } = cloud();
    const text = mapText(file);
    const uploaded = await call(() => storage.createFile({
      bucketId: config.mapsBucketId,
      fileId: Appwrite.ID.unique(),
      file: new File([text], `${rowId}${FILE_EXTENSION}`, { type: "application/json" }),
      permissions: []
    }));
    return { id: uploaded.$id, size: bytesOf(text) };
  }

  async function dropFile(bucketId, fileId) {
    if (!fileId) return;
    const { storage } = cloud();
    try {
      await call(() => storage.deleteFile({ bucketId, fileId }));
    } catch (failed) {
      if (failed.details.status !== 404) throw failed;
    }
  }

  async function dropRow(tableId, rowId) {
    const { tablesDB } = cloud();
    await call(() => tablesDB.deleteRow({ databaseId: config.databaseId, tableId, rowId }));
  }

  async function newestVersion(mapId) {
    const rows = await listAllRows(config.versionsTableId, [cloud().Appwrite.Query.equal("mapId", mapId)]);
    return sortVersions(rows)[0] || null;
  }

  async function pruneVersions(mapId) {
    const rows = await listAllRows(config.versionsTableId, [cloud().Appwrite.Query.equal("mapId", mapId)]);
    for (const extra of sortVersions(rows).slice(MAX_VERSIONS)) {
      await dropRow(config.versionsTableId, extra.$id);
      await dropFile(config.mapsBucketId, extra.dataFileId);
    }
  }

  // O arquivo anterior continua no bucket de mapas (nada é baixado nem reenviado) e ganha
  // uma linha em versions; freio de 5 minutos (force ignora) e poda para as 20 mais novas.
  async function keepHistory(row, previous, force) {
    const { Appwrite, tablesDB } = cloud();
    try {
      if (!previous.fileId) return;
      if (!force) {
        const latest = await newestVersion(row.$id);
        const age = latest ? Date.now() - new Date(latest.$createdAt).getTime() : Infinity;
        if (age < MIN_SNAPSHOT_INTERVAL_MS) {
          await dropFile(config.mapsBucketId, previous.fileId); // freio: apaga para não vazar
          return;
        }
      }
      await call(() => tablesDB.createRow({
        databaseId: config.databaseId,
        tableId: config.versionsTableId,
        rowId: Appwrite.ID.unique(),
        data: { mapId: row.$id, dataFileId: previous.fileId, size: previous.size }
      }));
      await pruneVersions(row.$id);
    } catch (failed) {
      console.error("Falha ao guardar o histórico do mapa", row.$id, failed);
    }
  }

  async function getVersion(mapId, versionId) {
    const { tablesDB } = cloud();
    try {
      const version = await call(() => tablesDB.getRow({
        databaseId: config.databaseId,
        tableId: config.versionsTableId,
        rowId: versionId
      }));
      return String(version.mapId) === String(mapId) ? version : null;
    } catch (failed) {
      if (failed.details.status === 404) return null;
      throw failed;
    }
  }

  async function removeMap(row) {
    let current = row;
    try {
      current = await freshRow(config.mapsTableId, row.$id);
    } catch (failed) {
      if (failed.details.status === 404) return; // já não existe: nada a limpar
      throw failed;
    }
    const versions = await listAllRows(config.versionsTableId, [cloud().Appwrite.Query.equal("mapId", current.$id)]);
    for (const version of versions) {
      await dropRow(config.versionsTableId, version.$id);
      await dropFile(config.mapsBucketId, version.dataFileId);
    }
    await dropFile(config.mapsBucketId, current.dataFileId);
    await dropRow(config.mapsTableId, current.$id);
    revisions.delete(pathOfMap(current));
  }

  // ------------------------------------------------------------------ sessão ---

  let cachedUser = null;
  let userLoaded = false;

  function forgetUser() {
    cachedUser = null;
    userLoaded = false;
  }

  async function currentUser() {
    if (!userLoaded) {
      const { account } = cloud();
      const me = await call(() => account.get());
      const labels = Array.isArray(me.labels) ? me.labels : [];
      cachedUser = { username: me.name || me.email || "Usuário", role: labels.includes("admin") ? "admin" : "user" };
      userLoaded = true;
    }
    return cachedUser;
  }

  async function editorName() {
    const user = await currentUser();
    return user ? user.username : "";
  }

  async function themeOf() {
    const { account } = cloud();
    const prefs = await call(() => account.getPrefs());
    return prefs && prefs.theme === "light" ? "light" : "dark";
  }

  async function getConfig() {
    cloud();
    let user = null;
    try {
      user = await currentUser();
    } catch (failed) {
      if (failed.code !== "auth") throw failed;
    }
    const theme = user ? await themeOf() : "dark";
    return { theme, user };
  }

  async function login(email, password) {
    const { account } = cloud();
    try {
      await call(() => account.createEmailPasswordSession({ email, password }));
    } catch (failed) {
      if (failed.code === "auth") failed.message = BAD_CREDENTIALS;
      throw failed;
    }
    forgetUser();
    revisions.clear();
    markStale();
    return getConfig();
  }

  async function logout() {
    const { account } = cloud();
    try {
      await call(() => account.deleteSession({ sessionId: "current" }));
    } catch (failed) {
      if (failed.code !== "auth") throw failed; // já não havia sessão
    }
    forgetUser();
    revisions.clear();
    markStale();
  }

  async function setTheme(theme) {
    const { account } = cloud();
    const value = theme === "light" ? "light" : "dark";
    const prefs = await call(() => account.getPrefs());
    await call(() => account.updatePrefs({ prefs: { ...(prefs || {}), theme: value } }));
    return getConfig();
  }

  // -------------------------------------------------------------------- mapas ---

  async function listMaps() {
    await rebuild();
    return index.tree;
  }

  async function readMap(path) {
    const row = await freshMapRow(path);
    if (!row.dataFileId) throw error(MISSING_CONTENT, "http");
    const file = parseMapFile(parseJson(await readText(config.mapsBucketId, row.dataFileId)));
    revisions.set(path, Number(row.revision) || 0);
    return file;
  }

  async function saveMap(path, file, options) {
    const { tablesDB } = cloud();
    const row = await freshMapRow(path);
    const revision = Number(row.revision) || 0;
    const force = Boolean(options && options.force);
    if (!force && (revisions.get(path) || 0) !== revision) {
      throw error(`Esse mapa foi alterado por ${row.updatedByName || "outra pessoa"} enquanto você editava.`, "conflict", {
        updatedBy: row.updatedByName || "",
        updatedAt: row.$updatedAt
      });
    }
    parseMapFile(file);
    const previous = { fileId: row.dataFileId, size: Number(row.size) || 0 };
    const username = await editorName();
    const uploaded = await putContent(row.$id, file);
    const next = revision + 1;
    const saved = await call(() => tablesDB.updateRow({
      databaseId: config.databaseId,
      tableId: config.mapsTableId,
      rowId: row.$id,
      data: { dataFileId: uploaded.id, size: uploaded.size, revision: next, updatedByName: username }
    }));
    rememberMapRow(saved);
    await keepHistory(row, previous, force);
    revisions.set(path, next);
    return { revision: next };
  }

  async function createMap(parentPath, title, template, initial) {
    const { Appwrite, tablesDB } = cloud();
    const name = validateName(title);
    if (!TEMPLATES.includes(template)) throw error(BAD_DATA, "http");
    const isOrg = template === "organograma";
    const isDraw = template === "desenho";
    // O desenho nasce vazio: `initial` é ignorado (nada a validar aqui, o arquivo é validado no fim).
    if (!isDraw && initial !== undefined && !(isOrg ? isOrgChartData(initial) : isMindNode(initial))) throw error(BAD_DATA, "http");
    const parent = await parentFolderOf(parentPath);
    if (siblingMap(parent ? parent.$id : null, name)) {
      throw error(`Já existe um mapa chamado "${name}" nesta pasta.`, "exists");
    }
    const now = new Date().toISOString();
    const file = {
      version: MAP_VERSION,
      meta: { title: name, createdAt: now, updatedAt: now, template },
      ...(isOrg
        ? { orgchart: initial ?? createEmptyOrgChart(name) }
        : isDraw
          ? { drawing: createEmptyDrawing() }
          : { mindmap: initial ?? { data: { text: name }, children: [] } })
    };
    parseMapFile(file);
    const username = await editorName();
    const rowId = Appwrite.ID.unique();
    const uploaded = await putContent(rowId, file);
    const data = {
      name,
      template,
      revision: 1,
      dataFileId: uploaded.id,
      size: uploaded.size,
      updatedByName: username
    };
    if (parent) data.folderId = parent.$id; // coluna opcional: na raiz fica nula
    await call(() => tablesDB.createRow({
      databaseId: config.databaseId,
      tableId: config.mapsTableId,
      rowId,
      data
    }));
    markStale();
    return parentPath ? `${parentPath}/${name}${MAP_EXTENSION}` : `${name}${MAP_EXTENSION}`;
  }

  async function createFolder(parentPath, name) {
    const { Appwrite, tablesDB } = cloud();
    const folderName = validateName(name);
    const parent = await parentFolderOf(parentPath);
    if (siblingFolder(parent ? parent.$id : null, folderName)) {
      throw error("Já existe uma pasta com esse nome.", "exists");
    }
    const data = { name: folderName };
    if (parent) data.parentId = parent.$id; // coluna opcional: na raiz fica nula
    await call(() => tablesDB.createRow({
      databaseId: config.databaseId,
      tableId: config.foldersTableId,
      rowId: Appwrite.ID.unique(),
      data
    }));
    markStale();
    return parentPath ? `${parentPath}/${folderName}` : folderName;
  }

  async function renameEntry(path, name) {
    const { tablesDB } = cloud();
    const newName = validateName(name);
    const found = await findEntry(path);
    const row = await freshRow(found.kind === "folder" ? config.foldersTableId : config.mapsTableId, found.row.$id);
    if (found.kind === "folder") {
      const parentId = row.parentId || null;
      if (siblingFolder(parentId, newName, row.$id)) throw error(DUPLICATE_NAME, "exists");
      const parentPath = parentId ? folderPath(parentId) || "" : "";
      const target = parentPath ? `${parentPath}/${newName}` : newName;
      if (target === path) return path;
      await call(() => tablesDB.updateRow({
        databaseId: config.databaseId,
        tableId: config.foldersTableId,
        rowId: row.$id,
        data: { name: newName }
      }));
      moveRevisions(path, target);
      markStale();
      return target;
    }
    const folderId = row.folderId || null;
    if (siblingMap(folderId, newName, row.$id)) throw error(DUPLICATE_NAME, "exists");
    const parentPath = folderId ? folderPath(folderId) || "" : "";
    const target = parentPath ? `${parentPath}/${newName}${MAP_EXTENSION}` : `${newName}${MAP_EXTENSION}`;
    if (target === path) return path;
    const data = { name: newName };
    const previousFileId = row.dataFileId;
    if (previousFileId) {
      // Renomear reescreve o título dentro do arquivo, mas não cria versão.
      const content = parseMapFile(parseJson(await readText(config.mapsBucketId, previousFileId)));
      const uploaded = await putContent(row.$id, { ...content, meta: { ...content.meta, title: newName } });
      data.dataFileId = uploaded.id;
      data.size = uploaded.size;
    }
    await call(() => tablesDB.updateRow({
      databaseId: config.databaseId,
      tableId: config.mapsTableId,
      rowId: row.$id,
      data
    }));
    if (data.dataFileId) await dropFile(config.mapsBucketId, previousFileId);
    moveRevisions(path, target);
    markStale();
    return target;
  }

  // Arrastar na árvore: muda só o vínculo com a pasta e devolve o caminho novo.
  async function moveEntry(path, targetFolderPath) {
    const { tablesDB } = cloud();
    const targetPath = targetFolderPath == null ? "" : String(targetFolderPath);
    const found = await findEntry(path, GONE);
    const destination = targetPath ? index.foldersByPath.get(targetPath) : null;
    if (targetPath && !destination) throw error(GONE, "http");
    const row = found.row;
    if (found.kind === "folder" && (targetPath === path || targetPath.startsWith(`${path}/`))) {
      throw error("Não dá para mover uma pasta para dentro dela mesma.", "bad_request");
    }
    const destinationId = destination ? destination.$id : null; // null é a raiz
    if (found.kind === "folder") {
      const parentId = row.parentId || null;
      if ((parentId ? folderPath(parentId) || "" : "") === targetPath) return path;
      if (siblingFolder(destinationId, row.name, row.$id)) throw error(DUPLICATE_NAME, "exists");
      await call(() => tablesDB.updateRow({
        databaseId: config.databaseId,
        tableId: config.foldersTableId,
        rowId: row.$id,
        data: { parentId: destinationId } // updateRow só mexe no que vai no data: para a raiz, null
      }));
      const next = targetPath ? `${targetPath}/${row.name}` : row.name;
      moveRevisions(path, next);
      markStale();
      return next;
    }
    const folderId = row.folderId || null;
    if ((folderId ? folderPath(folderId) || "" : "") === targetPath) return path;
    if (siblingMap(destinationId, row.name, row.$id)) throw error(DUPLICATE_NAME, "exists");
    await call(() => tablesDB.updateRow({
      databaseId: config.databaseId,
      tableId: config.mapsTableId,
      rowId: row.$id,
      data: { folderId: destinationId }
    }));
    const next = targetPath ? `${targetPath}/${row.name}${MAP_EXTENSION}` : `${row.name}${MAP_EXTENSION}`;
    moveRevisions(path, next);
    markStale();
    return next;
  }

  async function duplicateMap(path) {
    const { Appwrite, tablesDB } = cloud();
    const row = await freshMapRow(path);
    if (!row.dataFileId) throw error(MISSING_CONTENT, "http");
    const folderId = row.folderId || null;
    const parentPath = folderId ? folderPath(folderId) || "" : "";
    const content = parseMapFile(parseJson(await readText(config.mapsBucketId, row.dataFileId)));
    const name = copyName(folderId, row.name);
    const now = new Date().toISOString();
    const copy = { ...content, meta: { ...content.meta, title: name, createdAt: now, updatedAt: now } };
    const username = await editorName();
    const rowId = Appwrite.ID.unique();
    const uploaded = await putContent(rowId, copy);
    const data = {
      name,
      template: copy.meta.template,
      revision: 1,
      dataFileId: uploaded.id,
      size: uploaded.size,
      updatedByName: username
    };
    if (folderId) data.folderId = folderId;
    await call(() => tablesDB.createRow({
      databaseId: config.databaseId,
      tableId: config.mapsTableId,
      rowId,
      data
    }));
    markStale();
    return parentPath ? `${parentPath}/${name}${MAP_EXTENSION}` : `${name}${MAP_EXTENSION}`;
  }

  function copyName(folderId, baseName) {
    for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 1 ? `${baseName} - cópia` : `${baseName} - cópia ${attempt}`;
      if (!siblingMap(folderId, candidate)) return candidate;
    }
    throw error("Há cópias demais deste mapa. Exclua algumas e tente de novo.", "http");
  }

  async function deleteEntry(path) {
    const { tablesDB } = cloud();
    const found = await findEntry(path);
    if (found.kind === "map") {
      await removeMap(found.row);
      markStale();
      return null;
    }
    const folderId = found.row.$id;
    for (const row of index.maps.filter((map) => isInsideFolder(map.folderId, folderId))) await removeMap(row);
    const folders = index.folders.filter((row) => isInsideFolder(row.$id, folderId));
    folders.sort((left, right) => (folderPath(right.$id) || "").length - (folderPath(left.$id) || "").length);
    for (const row of folders) await dropRow(config.foldersTableId, row.$id);
    forgetPaths(path);
    markStale();
    return null;
  }

  async function listVersions(path) {
    const row = await freshMapRow(path);
    const rows = await listAllRows(config.versionsTableId, [cloud().Appwrite.Query.equal("mapId", row.$id)]);
    return sortVersions(rows).map((version) => ({
      id: version.$id,
      createdAt: version.$createdAt,
      size: Number(version.size) || 0
    }));
  }

  async function restoreVersion(path, versionId) {
    const { tablesDB } = cloud();
    const row = await freshMapRow(path);
    const version = await getVersion(row.$id, versionId);
    if (!version) throw error("Essa versão não existe mais.", "http");
    const content = parseMapFile(parseJson(await readText(config.mapsBucketId, version.dataFileId)));
    const previous = { fileId: row.dataFileId, size: Number(row.size) || 0 };
    const username = await editorName();
    const uploaded = await putContent(row.$id, content);
    const revision = (Number(row.revision) || 0) + 1;
    const saved = await call(() => tablesDB.updateRow({
      databaseId: config.databaseId,
      tableId: config.mapsTableId,
      rowId: row.$id,
      data: { dataFileId: uploaded.id, size: uploaded.size, revision, updatedByName: username }
    }));
    rememberMapRow(saved);
    await keepHistory(row, previous, true); // nada se perde: o estado atual vira versão
    revisions.set(path, revision);
    return { revision };
  }

  // ------------------------------------------------- exportação e importação ---

  function safeFileName(name) {
    return String(name || "").replace(/[\\/:*?"<>|]/g, "").replace(/^\.+|\.+$/g, "").trim();
  }

  function bytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function base64FromBytes(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function download(kind, defaultName, data) {
    // PNG vem como data URL e XLSX como base64 puro; decodificar sem fetch (o CSP
    // `default-src 'self'` bloquearia um fetch para `data:`).
    const blob = kind === "png"
      ? new Blob([bytesFromBase64(data.slice(data.indexOf(",") + 1))], { type: MIME.png })
      : kind === "xlsx"
        ? new Blob([bytesFromBase64(data)], { type: MIME.xlsx })
        : new Blob([data], { type: MIME[kind] });
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = `${safeFileName(defaultName) || "mapa"}.${EXTENSIONS[kind]}`;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true; // o navegador não avisa se o usuário cancelou; o cliente mostra o toast de sucesso
  }

  function printPdf(html) {
    return new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      // fora da tela, mas com layout real: iframe 0x0 some em algumas engines de impressão
      frame.style.cssText = "position:fixed;top:0;left:-10000px;width:1024px;height:768px;border:0;";
      frame.srcdoc = html;
      frame.addEventListener("load", () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => { frame.remove(); resolve(true); }, 1000);
      });
      document.body.append(frame);
    });
  }

  function pickFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xmind,.mm,.md,.markdown,.txt,.csv,.json,.vsdx,.xlsx";
      input.addEventListener("cancel", () => resolve(null));
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) { resolve(null); return; }
        const dot = file.name.lastIndexOf(".");
        const kind = KIND_BY_EXTENSION[(dot === -1 ? "" : file.name.slice(dot)).toLowerCase()];
        if (!kind) {
          reject(new Error("Formato não suportado. Use .xmind, .mm, .md, .txt, .csv, .xlsx (Excel), .json "
            + "(Lucidchart ou organograma do SacadaWeb-Mapas) ou .vsdx (Visio)."));
          return;
        }
        if (file.size > MAX_IMPORT_BYTES) {
          reject(new Error("O arquivo é grande demais para importar (limite de 20 MB)."));
          return;
        }
        resolve({
          fileName: file.name,
          kind,
          contentBase64: base64FromBytes(new Uint8Array(await file.arrayBuffer()))
        });
      });
      input.click();
    });
  }

  window.api = {
    getConfig,
    login,
    logout,
    setTheme,
    listMaps,
    readMap,
    saveMap,
    createMap,
    createFolder,
    renameEntry,
    moveEntry,
    duplicateMap,
    deleteEntry,
    listVersions,
    restoreVersion,
    saveExport: download,
    exportPdf: (defaultName, html) => printPdf(html),
    pickImportFile: pickFile
  };
})();
