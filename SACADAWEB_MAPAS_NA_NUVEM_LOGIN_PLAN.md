# SacadaWeb - Mapas na nuvem: login, Postgres e deploy na VPS

> **Desenho original, parcialmente substituído.** Este documento é o registro do plano aprovado (Fastify +
> Postgres + Caddy). A execução trocou o backend pelo **Appwrite self-hosted da VPS**: as seções 2 a 5 (schema
> SQL, autenticação própria, rotas Fastify, CLI de usuários) não valem mais e `server/` hoje é só um servidor
> estático. O que continua valendo é a interface `window.api` e o tratamento de concorrência da seção 6, as
> edições de cliente das seções 7 e 8 e o desenho de deploy da seção 9 (sem o serviço de banco). O fluxo atual
> está no [`README.md`](README.md).

## Contexto

Hoje o produto é um app Electron que guarda cada mapa como arquivo `.swmap.json` numa pasta local escolhida
pelo usuário (`%APPDATA%\SacadaWeb-Mapas\config.json` guarda `workDir` e `theme`), com histórico em
`.historico/`. O pedido: tela de login com senha, mapas salvos em banco de dados (sem pasta local) e o app
publicado numa VPS.

Decisões já tomadas com o usuário: **web no navegador** (o `.exe` deixa de existir; a VPS serve a interface e a
API), backend **Node + Fastify + PostgreSQL**, contas **criadas só pelo admin**, espaço de dados
**compartilhado** (todos os usuários logados veem e editam os mesmos mapas), deploy com **Docker Compose**
(Caddy + app + Postgres) e **sem migração** dos mapas antigos (banco começa vazio; arquivos antigos continuam
no disco e ainda podem entrar pelo botão Importar).

Fim esperado: uma URL (ex.: `https://mapas.exemplo.com`) que abre a tela de entrada; depois do login, a mesma
interface de mapas/organogramas de hoje, com árvore de pastas, autosave, histórico de versões, importação e
exportações — agora tudo no Postgres.

O cliente é reaproveitado quase inteiro: `resources/app/out/renderer/` continua sendo a única cópia da UI
(`index.html`, `assets/index-CJTx-kvA.js`, `assets/sacadaweb.css`), e `window.api` — até hoje fornecido pelo
preload do Electron — passa a ser fornecido por um novo arquivo `assets/cloud-api.js` que fala HTTP. Sem
reescrever React/bundle.

## Approach

Ordem de execução: passos 1–5 constroem o servidor e são verificáveis só com `curl`; passos 6–8 ligam o cliente;
passos 9–10 publicam. Cada passo deixa a árvore rodando.

### 1. Estrutura do projeto do servidor

Criar `server/` na raiz do repositório (novo; nada existente é movido).

`server/package.json`:

```json
{
  "name": "sacadaweb-mapas-server",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --env-file=../.env --watch src/index.js"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "@fastify/static": "^8.0.0",
    "fastify": "^5.0.0",
    "pg": "^8.13.0"
  }
}
```

Instalar depois com `npm --prefix server install` (gera `server/package-lock.json`, que o Dockerfile usa com
`npm ci`). Nada de `bcrypt`/`argon2`: hash de senha com `node:crypto` (scrypt), sem dependência nativa.

Arquivos e responsabilidade (um assunto por arquivo):

| Arquivo | O que faz |
|---|---|
| `server/src/index.js` | bootstrap Fastify: `ensureSchema()`, plugins, hook de cabeçalhos, rotas, estáticos, `listen` |
| `server/src/db.js` | `pool` do `pg`, `ensureSchema()`, `withTransaction(fn)`, `loadPaths(client)`, `touchSession` |
| `server/src/schema.sql` | DDL idempotente (passo 2) |
| `server/src/auth.js` | scrypt (`hashPassword`/`verifyPassword`), token de sessão, cookie, `requireUser`, `requireAdmin` |
| `server/src/validate.js` | portas de `validateName`, `isOrgChartData`, `isMindNode`, `parseMapFile`; validação de caminho |
| `server/src/tree.js` | montagem da árvore, resolução de caminho → id, nomes de cópia, snapshot/prune de versões |
| `server/src/routes/session.js` | `/api/login`, `/api/logout`, `/api/config`, `/api/config/theme` |
| `server/src/routes/maps.js` | `/api/tree`, `/api/maps*`, `/api/folders`, `/api/entries` |
| `server/src/routes/admin.js` | `/api/admin/users*` |
| `server/src/cli.js` | criação/edição de usuários pela linha de comando (passo 5) |

`server/src/index.js` (esqueleto exato):

```js
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { ensureSchema } from "./db.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerMapRoutes } from "./routes/maps.js";
import { registerAdminRoutes } from "./routes/admin.js";

const port = Number(process.env.PORT ?? 3000);
const webDir = process.env.WEB_DIR ?? path.resolve(import.meta.dirname, "../../resources/app/out/renderer");

const app = Fastify({
  trustProxy: true,                       // Caddy na frente: request.protocol/ip vêm do X-Forwarded-*
  bodyLimit: 32 * 1024 * 1024,
  logger: { level: process.env.LOG_LEVEL ?? "info" }
});

await app.register(cookie);
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
await app.register(fastifyStatic, {
  root: webDir,
  index: ["index.html"],
  setHeaders(response, filePath) {
    const isFont = filePath.includes(`${path.sep}fonts${path.sep}`);
    response.setHeader("Cache-Control", isFont ? "public, max-age=31536000, immutable" : "no-cache");
  }
});
app.addHook("onSend", async (_request, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "no-referrer");
});

await ensureSchema();
registerSessionRoutes(app);
registerMapRoutes(app);
registerAdminRoutes(app);
await app.listen({ host: "0.0.0.0", port });
```

`ensureSchema()` retenta a conexão 10× com 1s de intervalo (o Postgres do Compose pode subir depois) e aplica
`server/src/schema.sql` inteiro num único `query` (todo o DDL é `IF NOT EXISTS`/`CREATE OR REPLACE`).

### 2. Banco: `server/src/schema.sql`

Usar exatamente este conteúdo (caminhos são **derivados** por CTE recursiva; não existe coluna `path`, então
renomear pasta não exige atualizar descendentes):

```sql
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  active boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS folders (
  id bigserial PRIMARY KEY,
  parent_id bigint REFERENCES folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_key ON folders (COALESCE(parent_id, 0), lower(name));

CREATE TABLE IF NOT EXISTS maps (
  id bigserial PRIMARY KEY,
  folder_id bigint REFERENCES folders(id) ON DELETE CASCADE,
  name text NOT NULL,                                  -- sem a extensão .swmap.json
  template text NOT NULL DEFAULT 'livre' CHECK (template IN ('livre','pop-sacadaweb','organograma')),
  data jsonb NOT NULL,                                 -- o arquivo .swmap.json inteiro
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS maps_sibling_key ON maps (COALESCE(folder_id, 0), lower(name));

CREATE TABLE IF NOT EXISTS map_versions (
  id bigserial PRIMARY KEY,
  map_id bigint NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_versions_map_idx ON map_versions (map_id, created_at DESC);
```

Dentro de transações de escrita, usar `set local transaction isolation level read committed` (padrão) e
`SELECT ... FOR UPDATE` na linha do mapa antes de comparar `revision`.

### 3. Autenticação e sessão

`server/src/auth.js`:

- `hashPassword(password)` → `scrypt$16384$8$1$<salt-b64>$<hash-b64>` com `randomBytes(16)` de salt,
  `scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 67108864 })`.
- `verifyPassword(password, encoded)` → parsear o formato, recomputar e comparar com `timingSafeEqual`;
  qualquer erro de formato devolve `false`.
- `newSessionToken()` → `{ token: randomBytes(32).toString("base64url"), hash: sha256(token) em hex }`.
  Guarda **só o hash** em `sessions.token_hash`.
- `SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30)`.
- `cookieOptions(request)` → `{ path: "/", httpOnly: true, sameSite: "lax", secure: request.protocol === "https", maxAge: SESSION_DAYS * 86400 }`.
  `secure` automático: HTTP em `localhost` funciona, HTTPS atrás do Caddy também.
- `requireUser` (preHandler) lê o cookie `sid`, faz
  `SELECT u.id, u.username, u.role, u.theme, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`
  e, se não achar, responde `401 { error: "Sessão expirada. Entre de novo.", code: "auth" }`. Se faltar menos de
  1 dia para expirar, estende `expires_at` para `now() + SESSION_DAYS` (e atualiza `last_seen_at`).
- `requireAdmin` chama `requireUser` e, se `role !== "admin"`, responde `403 { error: "Ação só para administradores.", code: "forbidden" }`.

Rotas (`server/src/routes/session.js`):

| Rota | Corpo | 200 | Erros |
|---|---|---|---|
| `POST /api/login` | `{username, password}` | `{ theme, user: { username, role } }` + `set-cookie: sid` | `401 { error: "Usuário ou senha inválidos.", code: "auth" }`; `429 { error: "Muitas tentativas. Tente de novo em alguns minutos.", code: "rate" }` |
| `POST /api/logout` | — | `204` (apaga a linha de `sessions`, limpa o cookie) | — |
| `GET /api/config` | — | `{ theme, user }` (`user: null` quando não autenticado; `theme` = tema do usuário ou `"dark"`) | — |
| `PUT /api/config/theme` | `{ theme: "dark" \| "light" }` | `{ theme, user }` | `401` |

Detalhes do login: normalizar `username` com `trim()`, buscar por `lower(username) = lower($1)`, exigir
`active`; em caso de falha, **sempre** a mesma mensagem (não revela se o usuário existe) e `verifyPassword`
com um hash descartável quando o usuário não existe (evita diferença de tempo). No sucesso: apagar sessões
expiradas daquele usuário, criar a sessão, `reply.setCookie("sid", token, cookieOptions(request))`.
Rate limit só nesta rota: `config: { rateLimit: { max: 10, timeWindow: "10 minutes", errorResponseBuilder: () => ({ error: "Muitas tentativas. Tente de novo em alguns minutos.", code: "rate" }) } }`.

### 4. Rotas de dados (`server/src/routes/maps.js` + `server/src/tree.js`)

Todas exigem `requireUser`, registrado como hook de escopo — `registerMapRoutes(app)` abre
`app.register(async (scope) => { scope.addHook("preHandler", requireUser); …rotas… })`, e
`registerAdminRoutes` faz o mesmo com `requireAdmin` (o escopo encapsulado do Fastify garante que o hook não
vaze para `/api/health` e `/api/login`). Caminhos são strings com `/` e, para mapas,
terminam em `.swmap.json` — exatamente o que o cliente já usa hoje (`openMap.path`, `parentOf`, `baseName`).

Validação de caminho antes de qualquer consulta (`validatePath`): string ≤ 1000 chars; sem `\`; sem segmentos
vazios, `.` ou `..`; cada segmento aprovado por `validateName` (porta de `resources/app/out/main/index.js:219`:
`trim`, não vazio, sem `\ / : * ? " < > |`, sem caracteres < 32, sem ponto no início/fim, sem nomes reservados
do Windows, agora com no máximo 120 chars); caminho de mapa precisa terminar em `.swmap.json` (nome sem a
extensão ≤ 120). Caminho inválido → `400 { error: "Caminho inválido." }`.

Resolução: `loadPaths(client)` roda **uma** consulta e devolve `foldersByPath`, `folderPathById` e `mapByPath`:

```sql
WITH RECURSIVE fp AS (
  SELECT id, parent_id, name, name AS path FROM folders WHERE parent_id IS NULL
  UNION ALL
  SELECT f.id, f.parent_id, f.name, fp.path || '/' || f.name FROM folders f JOIN fp ON f.parent_id = fp.id
)
SELECT 'folder' AS kind, fp.id, fp.name, fp.path, fp.parent_id AS parent_id, NULL::text AS template
  FROM fp
UNION ALL
SELECT 'map', m.id, m.name, COALESCE(fp.path || '/', '') || m.name || '.swmap.json', m.folder_id, m.template
  FROM maps m LEFT JOIN fp ON fp.id = m.folder_id
ORDER BY 1, lower(3)
```

Essa ordem (pastas antes de mapas, cada grupo por `lower(name)`) já é a ordem que a barra lateral espera
(`sortEntries` do cliente era `pasta antes de mapa`, depois `localeCompare`). A montagem aninhada é em JS:
cada pasta vira `{ kind: "folder", name, path, children: [] }` ligada ao pai (ou à raiz) pelo
`folderPathById`; cada mapa vira `{ kind: "map", name, path, template }` pendurado na pasta dele (ou na raiz).

Rotas:

| Rota | Corpo/Query | OK | Erros |
|---|---|---|---|
| `GET /api/tree` | — | `200` array de entradas aninhadas (como `listMaps`) | |
| `GET /api/maps` | `?path=` | `200` = **o objeto do arquivo `.swmap.json`** + cabeçalho `x-map-revision: <n>` | `404 { error: "Mapa não encontrado." }` |
| `PUT /api/maps` | `?path=&rev=<n>[&force=1]`, corpo = arquivo | `200 { revision }` | `409 { error: "Esse mapa foi alterado por <usuario> enquanto você editava.", code: "conflict", updatedBy, updatedAt }`; `400` dados inválidos |
| `POST /api/maps` | `{ parentPath, title, template, initial }` | `201 { path }` | `409 { error: "Já existe um mapa chamado \"X\" nesta pasta.", code: "exists" }`; `400 "Dados do mapa inválidos."` |
| `POST /api/folders` | `{ parentPath, name }` | `201 { path }` | `409 { error: "Já existe uma pasta com esse nome.", code: "exists" }` |
| `PATCH /api/entries` | `?path=`, `{ name }` | `200 { path }` | `409 { error: "Já existe um item com esse nome.", code: "exists" }` |
| `POST /api/maps/duplicate` | `?path=` | `201 { path }` | `404`, `400 { error: "Só dá para duplicar mapas." }` |
| `DELETE /api/entries` | `?path=` | `204` | `404 { error: "Pasta não encontrada." }` |
| `GET /api/maps/versions` | `?path=` | `200 [{ id, createdAt, size }]` (mais novas primeiro) | `404` |
| `POST /api/maps/versions/restore` | `?path=`, `{ versionId }` | `200 { revision }` | `404 { error: "Essa versão não existe mais." }` |
| `GET /api/health` | — | `200 { ok: true }` | |

Regras de escrita (portadas de `resources/app/out/main/index.js`, com os mesmos textos):

- **`PUT /api/maps`** — dentro de transação: `SELECT id, revision, data FROM maps WHERE id = $1 FOR UPDATE`;
  `rev` ausente/não numérico → `400 { error: "Requisição sem revisão.", code: "bad_request" }`;
  `force` ausente e `rev` diferente de `revision` → `409` com `updatedBy` (join em `users`) e `updatedAt`;
  senão, snapshot da versão **anterior** (`insertMapVersion`, com o mesmo freio de 5 minutos, ignorado quando
  `force=1`) e `UPDATE maps SET data = $2, revision = revision + 1, updated_at = now(), updated_by = $3`.
  Validar com `parseMapFile` antes de gravar.
- **`parseMapFile`** (`server/src/validate.js`, porta de `main/index.js:446`): JSON objeto; `version === 1`
  (senão `400 { error: "Versão do arquivo (N) não suportada por este app. Atualize o SacadaWeb-Mapas." }`);
  `meta` objeto com `title` string não vazia ≤ 200, `template` em `livre|pop-sacadaweb|organograma`;
  `template === "organograma"` exige `isOrgChartData(file.orgchart)` (porta de `main/index.js:320`, incluindo
  o teto de `MAX_ORG_NODES = 5000` e a checagem de integridade de `parentId`); nos outros casos exige
  `isMindNode(file.mindmap)` (porta de `main/index.js:484`). Corpo maior que 20 MB →
  `400 { error: "O mapa é grande demais para salvar (limite de 20 MB)." }` (`Buffer.byteLength(JSON.stringify(file))`).
- **`insertMapVersion`**: insere `data` (o estado anterior), `size = octet_length(data::text)`; freio
  `MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000` comparado com a versão mais nova; depois
  `DELETE FROM map_versions WHERE map_id = $1 AND id NOT IN (SELECT id FROM map_versions WHERE map_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20)`
  (`MAX_VERSIONS = 20`).
- **`restoreVersion`**: busca a versão por id+map_id, valida com `parseMapFile`, insere snapshot **forçado** do
  estado atual (nada se perde) e grava os dados da versão como estado atual (`revision + 1`).
- **`POST /api/maps`**: `validateName(title)`; conferir irmão de mesmo nome (case-insensitive) → `409`;
  `data = { version: 1, meta: { title, createdAt: now, updatedAt: now, template }, ...(template === "organograma"
  ? { orgchart: initial ?? createEmptyOrgChart(title) } : { mindmap: initial ?? { data: { text: title }, children: [] } }) }`
  (`createEmptyOrgChart`/`DEFAULT_ORG_SETTINGS` portados de `main/index.js:311-357`). `initial` vindo do
  cliente quando o template é `pop-sacadaweb` (árvore do roteiro POP) ou na importação.
- **`PATCH /api/entries`**: renomear mapa → `UPDATE maps SET name, updated_at, updated_by` **e**
  `data = jsonb_set(data, '{meta,title}', to_jsonb(name))`; renomear pasta → só `UPDATE folders SET name`
  (os caminhos dos descendentes são derivados, nada mais a fazer).
- **`POST /api/maps/duplicate`**: `freeCopyName` idêntico ao de hoje (`"<nome> - cópia"`, depois
  `"<nome> - cópia 2"`, … até 500 tentativas, comparando case-insensitive); copia `data` com
  `meta.title/createdAt/updatedAt` atualizados, mesmo `template`, mesma pasta.
- **`DELETE /api/entries`**: `DELETE` direto (o `shell.trashItem` do Electron não existe mais); pastas caem em
  cascata (`folders` → `folders`/`maps` → `map_versions`).

### 5. CLI de usuários (`server/src/cli.js`)

Rodar sempre da raiz do repositório, com `node --env-file=.env server/src/cli.js ...` (no container:
`docker compose exec app node server/src/cli.js ...`). Sem `DATABASE_URL` → sai com
`Error: Defina DATABASE_URL (veja .env.example).`

```
user:add <usuario> [--role admin|user] (--generate | --password-stdin)
user:passwd <usuario> (--generate | --password-stdin)
user:role <usuario> admin|user
user:enable <usuario> | user:disable <usuario>
user:list
```

- `--generate` imprime uma senha de 18 chars (`randomBytes(13).toString("base64url")`) numa linha:
  `Senha de <usuario>: <senha>` — mostrada uma única vez, nada é gravado em claro.
- `--password-stdin` lê a primeira linha de `stdin`. Sem nenhuma das duas flags → erro explicando as opções
  (nada de prompt interativo).
- Senha com menos de 10 chars → `Error: A senha precisa de pelo menos 10 caracteres.`
- `user:add` com usuário existente → `Error: Já existe um usuário "x".` Usa o mesmo `hashPassword` de `auth.js`.
- `user:list` imprime `usuario  role  ativo  criado em` (uma linha por usuário).

### 6. Cliente: `resources/app/out/renderer/assets/cloud-api.js` (novo)

Script clássico (não módulo), carregado **antes** do bundle, que define `window.api` com os mesmos nomes e
assinaturas do preload atual (`resources/app/out/preload/index.js`) — é o contrato inteiro entre UI e servidor:

```js
/* SacadaWeb - Mapas :: cliente da nuvem (substitui window.api do preload do Electron) */
(() => {
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
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
  const revisions = new Map(); // path -> revisão lida do servidor

  function apiError(body, status) {
    const error = new Error((body && body.error) || `Falha na requisição (${status}).`);
    error.code = (body && body.code) || "http";
    error.details = body;
    error.status = status;
    return error;
  }

  async function request(method, url, body) {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 204) return null;
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) throw apiError(parsed, response.status);
    return parsed;
  }

  const mapUrl = (path) => `/api/maps?path=${encodeURIComponent(path)}`;
  const entryUrl = (path) => `/api/entries?path=${encodeURIComponent(path)}`;

  async function readMap(path) {
    const response = await fetch(mapUrl(path), { credentials: "same-origin" });
    const text = await response.text();
    let file = null;
    try { file = text ? JSON.parse(text) : null; } catch { file = null; }
    if (!response.ok) throw apiError(file, response.status);
    revisions.set(path, Number(response.headers.get("x-map-revision") || 0));
    return file;
  }

  async function saveMap(path, file, options) {
    const query = new URLSearchParams({ path, rev: String(revisions.get(path) || 0) });
    if (options && options.force) query.set("force", "1");
    const result = await request("PUT", `/api/maps?${query}`, file);
    revisions.set(path, result.revision);
    return result;
  }

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
    return true;   // o navegador não avisa se o usuário cancelou; o cliente mostra o toast de sucesso
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
    getConfig: () => request("GET", "/api/config"),
    login: (username, password) => request("POST", "/api/login", { username, password }),
    logout: () => request("POST", "/api/logout"),
    setTheme: (theme) => request("PUT", "/api/config/theme", { theme }),
    listMaps: () => request("GET", "/api/tree"),
    readMap,
    saveMap,
    createMap: (parentPath, title, template, initial) =>
      request("POST", "/api/maps", { parentPath, title, template, initial }).then((result) => result.path),
    createFolder: (parentPath, name) =>
      request("POST", "/api/folders", { parentPath, name }).then((result) => result.path),
    renameEntry: (path, name) =>
      request("PATCH", entryUrl(path), { name }).then((result) => { revisions.delete(path); return result.path; }),
    duplicateMap: (path) =>
      request("POST", `/api/maps/duplicate?path=${encodeURIComponent(path)}`).then((result) => result.path),
    deleteEntry: (path) => request("DELETE", entryUrl(path)).then((result) => { revisions.delete(path); return result; }),
    listVersions: (path) => request("GET", `/api/maps/versions?path=${encodeURIComponent(path)}`),
    restoreVersion: (path, versionId) =>
      request("POST", `/api/maps/versions/restore?path=${encodeURIComponent(path)}`, { versionId })
        .then((result) => { revisions.set(path, result.revision); return result; }),
    saveExport: download,
    exportPdf: (defaultName, html) => printPdf(html),
    pickImportFile: pickFile
  };
})();
```

Não existem mais `chooseWorkDir`, `onCloseRequested` nem `closeWindow` — nenhum lugar do cliente os chama
depois do passo 8.

### 7. Cliente: `index.html` e `sacadaweb.css`

`resources/app/out/renderer/index.html`:

1. Carregar o shim antes de tudo (logo depois do `<meta>` de CSP, antes de `brand.js`):
   `<script src="./assets/cloud-api.js"></script>`
2. Trocar o rodapé da barra lateral (bloco `#workdir`) por — mantém o `<span id="workdir-path">`, que já tem
   estilo de elipse no CSS de origem e passa a mostrar o usuário:

```html
        <div id="workdir">
          <span id="workdir-path"></span>
          <button id="btn-logout" class="icon" title="Sair da conta">Sair</button>
        </div>
```

3. Substituir todo o bloco `<div id="welcome" hidden> … </div>` (escolha de pasta) pela tela de entrada
   (mesma classe `.welcome-card`, que já existe no CSS de origem e na camada de design):

```html
    <div id="login" hidden>
      <form id="login-form" class="welcome-card">
        <span class="brand-lockup">
          <span class="brand-word">Sacada<span class="brand-web">Web</span></span>
          <span class="brand-sub">- Mapas</span>
        </span>
        <h1>Entrar</h1>
        <p>Use o usuário e a senha criados pelo administrador.</p>
        <label for="login-user">Usuário</label>
        <input id="login-user" name="username" type="text" autocomplete="username"
               autocapitalize="none" spellcheck="false" required />
        <label for="login-pass">Senha</label>
        <input id="login-pass" name="password" type="password" autocomplete="current-password" required />
        <p id="login-error" role="alert"></p>
        <button id="btn-login" type="submit" class="primary">Entrar</button>
      </form>
    </div>
```

`resources/app/out/renderer/assets/sacadaweb.css` (única camada de estilo editável, conforme `DESIGN.md`):
apagar a regra `#welcome { background: var(--color-bg); }` (o elemento não existe mais; as regras de
`.welcome-card*` continuam e são usadas pelo login) e acrescentar, no fim do arquivo:

```css
/* --------------------------------------------------------- tela de entrada */
#login {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
}
#login-form label {
  display: block;
  margin: var(--space-4) 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
}
#login-form input {
  width: 100%;
  padding: 6px 10px;
  background: var(--color-surface-alt);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font: inherit;
}
#login-form input:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
#login-form button.primary {
  margin-top: var(--space-5);
  padding: 9px 14px;
}
#login-error {
  min-height: 1.4em;
  margin: var(--space-3) 0 0;
  color: var(--color-danger);
  font-size: var(--fs-label);
}
```

(`[hidden] { display: none !important }` no CSS de origem vence o `display: flex` de `#login`, então
`#login.hidden` funciona como hoje em `#welcome`.)

### 8. Cliente: edições no bundle `assets/index-CJTx-kvA.js`

Só a "cola" do app (linhas ~30500–30980, código legível, não minificado) muda. Seis edições, todas com o
texto exato de antes e de depois:

**(a) `sidebar.setWorkDir` (linha ~30517)** — troca o rótulo de pasta pelo usuário logado:

```js
    setUser(user) {
      const label = byId("workdir-path");
      label.textContent = user.username;
      label.title = user.role === "admin" ? `${user.username} (administrador)` : user.username;
    },
```

**(b) `saveCurrentMap` (linha ~30605)** — passa a tratar conflito de edição simultânea. O bloco abaixo
substitui a linha `await window.api.saveMap(path, file);`; acrescentar `resolveConflict` logo depois da função
(que usa `openDialog`/`button`/`el`/`actionRow`/`VERSION_DATE_FORMAT`, todos já no mesmo escopo, e cujo Escape
cai no `!== false` — isto é, mantém a versão de quem está editando e deixa a do outro no histórico):

```js
  try {
    await window.api.saveMap(path, file);
  } catch (error) {
    if (error?.code !== "conflict") throw error;
    const keepMine = await resolveConflict(error) !== false;
    if (!keepMine) {
      await openMapAt(path, { force: true, skipFlush: true });
      return;
    }
    await window.api.saveMap(path, file, { force: true });
  }
  if (openMap?.path === path) openMap = { path, meta: { ...file.meta, title: baseName(path) } };
  savedSnapshot = snapshot;
```

```js
function resolveConflict(error) {
  const who = error?.details?.updatedBy ? `"${error.details.updatedBy}"` : "Outra pessoa";
  const when = error?.details?.updatedAt ? ` (${VERSION_DATE_FORMAT.format(new Date(error.details.updatedAt))})` : "";
  return openDialog((dialog, close2) => {
    const mine = button("Manter a minha versão", "primary");
    const theirs = button("Usar a versão da nuvem");
    mine.addEventListener("click", () => close2(true));
    theirs.addEventListener("click", () => close2(false));
    dialog.append(
      el("h2", void 0, "Mapa alterado por outra pessoa"),
      el("p", void 0, `${who} salvou este mapa por último${when}. Se você mantiver a sua versão, a dele fica guardada no histórico.`),
      actionRow([theirs, mine])
    );
    queueMicrotask(() => mine.focus());
  });
}
```

**(c) `openMapAt` (linha ~30650)** — precisa poder recarregar sem passar pelo autosave (o flush tentaria
salvar de novo e cairia no mesmo conflito):

```js
async function openMapAt(path, options = {}) {
  if (!options.force && openMap?.path === path) return;
  if (!options.skipFlush && !await flushSafely()) return;
```

**(d) `startWorkspace` e remoção de `changeWorkDir` (linhas ~30874–30888)** — apagar a função `changeWorkDir`
inteira e trocar `startWorkspace` por:

```js
async function startWorkspace() {
  try {
    await sidebar.refresh();
  } catch (error) {
    showError(error);
  }
}
```

**(e) `bindToolbar` (linha ~30899)** — trocar a linha
`byId("btn-change-workdir").addEventListener("click", () => void changeWorkDir().catch(showError));` por
`byId("btn-logout").addEventListener("click", () => void logout());` e acrescentar a função ao lado de
`toggleTheme`:

```js
async function logout() {
  if (!await flushSafely()) return;
  try {
    await window.api.logout();
  } finally {
    location.reload();
  }
}
```

**(f) `bindWindowClose` (linha ~30948)** — o `closeRequested` do Electron não existe no navegador; o aviso de
"não salvou" passa a ser o do próprio navegador, e sair/ocultar a aba tenta gravar antes:

```js
function bindWindowClose() {
  window.addEventListener("beforeunload", (event) => {
    const state = statusEl.dataset.state;
    if (state !== "dirty" && state !== "saving" && state !== "error") return;
    void autosave.flush().catch(() => void 0);
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void autosave.flush().catch(() => void 0);
  });
}
```

**(g) `init` (linha ~30968)** — a entrada passa a ser sessão, não pasta; `#welcome` deixa de existir:

```js
async function init() {
  config = await window.api.getConfig();
  applyTheme(config.theme);
  initToolbar();
  updateThemeButton();
  bindToolbar();
  bindShortcuts();
  bindWindowClose();
  showMapArea(false);
  if (config.user) await enterWorkspace(config.user);
  else showLogin();
}

async function enterWorkspace(user) {
  config = { ...config, user };
  sidebar.setUser(user);
  await startWorkspace();
}

function showLogin() {
  const overlay = byId("login");
  const form = byId("login-form");
  const userInput = byId("login-user");
  const passInput = byId("login-pass");
  const error2 = byId("login-error");
  const submit = byId("btn-login");
  userInput.value = "";
  passInput.value = "";
  error2.textContent = "";
  overlay.hidden = false;
  userInput.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    error2.textContent = "";
    try {
      const next2 = await window.api.login(userInput.value.trim(), passInput.value);
      config = { theme: next2.theme, user: next2.user };
      applyTheme(config.theme);
      updateThemeButton();
      passInput.value = "";
      overlay.hidden = true;
      await enterWorkspace(config.user);
    } catch (error) {
      error2.textContent = errorMessage(error);
      passInput.select();
    } finally {
      submit.disabled = false;
    }
  });
}

init().catch(showError);
```

**(h) `exportOrgPdf` (linha ~30802)** — o PDF agora sai pela janela de impressão do navegador; trocar só o
texto do toast:
`if (saved) showToast("Exportado como PDF (como está na tela).");` →
`if (saved) showToast('PDF pronto: escolha "Salvar como PDF" na janela de impressão.');`

O HTML do PDF (`buildPdfHtml`, linha ~29032) é autocontido — `<style>` embutido com
`@page { size: A3 landscape; margin: 10mm }`, SVG inline e logo em data URL — e cabe na CSP da página
(`style-src 'unsafe-inline'`, `img-src data:`), então o resultado impresso é o mesmo que o `printToPDF` do
Electron produzia.

Nada mais muda no cliente: importação, POP, minimapa, notas, undo/redo, upload de imagem (que já usa
`FileReader`) e todas as exportações já eram 100% do lado da UI.

### 9. Docker Compose, Caddy e variáveis

`server/Dockerfile` (contexto de build é a **raiz** do repositório, porque o cliente vive em
`resources/app/out/renderer`):

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/src ./server/src
COPY resources/app/out/renderer ./public
ENV WEB_DIR=/app/public PORT=3000 NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server/src/index.js"]
```

`Caddyfile` (raiz):

```
{$DOMAIN} {
	encode zstd gzip
	reverse_proxy app:3000
}
```

`docker-compose.yml` (raiz):

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-sacadaweb_mapas}
      POSTGRES_USER: ${DB_USER:-sacada}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?defina DB_PASSWORD no .env}
    ports:
      - "127.0.0.1:5432:5432"        # só para desenvolvimento local; não fica exposto na internet
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-sacada} -d ${DB_NAME:-sacadaweb_mapas}"]
      interval: 5s
      timeout: 5s
      retries: 12
    restart: unless-stopped

  app:
    build:
      context: .
      dockerfile: server/Dockerfile
    environment:
      DATABASE_URL: postgres://${DB_USER:-sacada}:${DB_PASSWORD}@db:5432/${DB_NAME:-sacadaweb_mapas}
      PORT: 3000
      SESSION_DAYS: 30
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    environment:
      DOMAIN: ${DOMAIN:-:80}         # com domínio: HTTPS automático; sem domínio: só HTTP na porta 80
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    restart: unless-stopped

volumes:
  pgdata: {}
  caddy_data: {}
  caddy_config: {}
```

`.env.example` (raiz) — o Compose lê este arquivo automaticamente; o `npm run dev` também:

```
# Domínio público. Sem domínio, use ":80" (o app fica só em HTTP).
DOMAIN=mapas.exemplo.com

DB_NAME=sacadaweb_mapas
DB_USER=sacada
DB_PASSWORD=troque-esta-senha

# Só para rodar o servidor fora do container (npm run dev)
DATABASE_URL=postgres://sacada:troque-esta-senha@127.0.0.1:5432/sacadaweb_mapas
```

### 10. README

Reescrever as seções de operação (é o único manual do projeto):

- **Rodar** — dois modos: local (`cp .env.example .env`, `docker compose up -d db`,
  `npm --prefix server install`, `npm --prefix server run dev` → `http://localhost:3000`) e VPS
  (`git`/cópia do repositório, `.env` com `DOMAIN`/`DB_PASSWORD`, `docker compose up -d --build`,
  criação do admin pelo CLI, acesso pela URL).
- **Onde ficam os dados** — Postgres no volume `pgdata`; nada de pasta local. Backup:
  `docker compose exec -T db pg_dump -U $DB_USER $DB_NAME | gzip > backup-$(date +%F).sql.gz` (cron diário).
- **Estrutura** — acrescentar `server/` (API + CLI), `docker-compose.yml`, `Caddyfile`,
  `resources/app/out/renderer/assets/cloud-api.js`; marcar `resources/app/out/main/`,
  `out/preload/`, `SacadaWeb-Mapas.exe` e `tools/build-portable.ps1` como o app de desktop **aposentado**
  (continuam no repositório; nada no fluxo novo os usa).
- **Usuários** — os comandos do passo 5 (o admin cria contas; não há autocadastro).

## Arquivos críticos e âncoras

| Arquivo | Onde | Por quê |
|---|---|---|
| `resources/app/out/renderer/assets/index-CJTx-kvA.js` | linhas 30500–30980 (cola do app: `createSidebar`, `saveCurrentMap`, `openMapAt`, `init`) | as 8 edições do passo 8; o resto do arquivo (bibliotecas + editor) não é tocado |
| `resources/app/out/renderer/index.html` | `<head>` (linha 7–15), `#workdir` (linhas 58–66), `#welcome` (linhas 240–256) | shim antes do bundle, rodapé vira usuário+Sair, welcome vira login |
| `resources/app/out/main/index.js` | `resolveInside`:211, `validateName`:219, `DEFAULT_ORG_SETTINGS`:311, `isOrgChartData`:320, `createEmptyOrgChart`:352, `parseMapFile`:446, `isMindNode`:484, `snapshot/prune`:293–340 | fonte única das regras que o servidor replica (validação, org, versões) — ler antes de portar |
| `resources/app/out/preload/index.js` | arquivo inteiro (45 linhas) | assinatura exata dos 18 métodos de `window.api` que o shim precisa reproduzir |
| `server/src/routes/maps.js` + `server/src/tree.js` (novos) | — | núcleo de dados: resolução de caminho, concorrência otimista, versões |

## Verificação

Pré-requisitos: Docker Desktop rodando, `node` ≥ 22 (na máquina: v24.16.0), raiz do repositório como diretório
de trabalho. Não existe `psql` local: o banco vem do Compose.

1. **Banco de pé**
   `cp .env.example .env` (trocar `DB_PASSWORD`), depois `docker compose up -d db` e
   `docker compose ps` → `db` com estado `healthy`.
2. **Servidor**
   `npm --prefix server install` (cria `server/package-lock.json`), depois `npm --prefix server run dev`.
   Log esperado: `Server listening at http://0.0.0.0:3000` e criação das tabelas sem erro.
   `curl -s localhost:3000/api/health` → `{"ok":true}`.
3. **Admin**
   `node --env-file=.env server/src/cli.js user:add admin --role admin --generate` → imprime
   `Senha de admin: <senha>`. Guardar. `node --env-file=.env server/src/cli.js user:list` → uma linha `admin  admin  true  ...`.
4. **API sem sessão**
   `curl -si localhost:3000/api/tree` → `401` com `{"error":"Sessão expirada. Entre de novo.","code":"auth"}`.
   `curl -si 'localhost:3000/api/maps?path=../../etc/passwd'` (com cookie de sessão, passo 5) → `400`.
5. **Login**
   `curl -si -X POST localhost:3000/api/login -H 'content-type: application/json' -d '{"username":"admin","password":"<senha>"}'`
   → `200`, `set-cookie: sid=...; Path=/; HttpOnly; SameSite=Lax`, corpo `{"theme":"dark","user":{"username":"admin","role":"admin"}}`.
   Repetir com senha errada → `401`; 11 tentativas seguidas → `429`.
6. **Interface (navegador em `http://localhost:3000`)**
   - Sem cookie: aparece o cartão **Entrar** sobre o app; senha errada mostra a mensagem vermelha no cartão
     (sem toast); senha certa entra e o cartão some.
   - Barra lateral vazia com "Nenhum mapa ainda…"; rodapé mostra `admin` e o botão **Sair**.
   - `+ Mapa` → nome `Teste` + modelo `POP (roteiro padrão)` → o mapa abre com o roteiro e o chip fica `Salvo`.
   - Editar um nó (F2, digitar) → chip `Alterações pendentes…` → em ~2s `Salvo`.
   - F5: continua logado, o mapa aparece na árvore, abrir mostra a edição gravada.
   - `docker compose exec -T db psql -U sacada -d sacadaweb_mapas -c "select id, name, template, revision from maps"`
     → 1 linha, `revision` ≥ 2 (`select count(*) from map_versions` ≥ 1).
   - Renomear (`✎`), duplicar (`⧉`, cria "Teste - cópia"), nova pasta e excluir (`🗑`): a árvore e o banco
     acompanham; excluir pasta leva o conteúdo junto (cascata).
   - Histórico (`Versões anteriores`): após duas edições salvas, lista as versões; restaurar muda o conteúdo na
     tela e `select count(*) from map_versions` aumenta.
   - Exportar Markdown, PNG, SVG, CSV e Excel: cada um baixa um arquivo na pasta Downloads com a extensão certa
     e conteúdo não vazio. "Exportar PDF" (organograma): abre a janela de impressão; escolher "Salvar como PDF"
     gera o PDF com as caixas.
   - Importar um `.xlsx` de organograma existente pelo botão **Importar** → vira um mapa novo na árvore.
7. **Conflito de edição**
   Duas janelas anônimas (ou dois usuários) com o mesmo mapa aberto: salvar na janela A (esperar o chip
   `Salvo`), editar na janela B e esperar o autosave → aparece "Mapa alterado por outra pessoa".
   - "Manter a minha versão" → salva, a versão de A aparece no Histórico e B segue com o texto de B.
   - Repetir escolhendo "Usar a versão da nuvem" → B recarrega com o conteúdo de A.
8. **VPS**
   Na VPS: DNS do `DOMAIN` apontando para o IP, portas 80/443 abertas, `docker compose up -d --build`,
   `docker compose logs -f caddy` (certificado emitido), `docker compose exec app node server/src/cli.js user:add admin --role admin --generate`,
   depois abrir `https://<DOMAIN>` e repetir os itens 6 e 7 (inclusive o download de exportações e o PDF).

## Premissas e contingências

- **Tema fora do login**: `GET /api/config` sem sessão devolve `theme: "dark"`, então quem usa tema claro vê a
  tela de entrada escura e o app claro depois de entrar. Aceitável; se incomodar, guardar o último tema em
  `localStorage` no shim e usar como padrão do cartão.
- **`Iframe srcdoc > print()`** é o mecanismo do PDF. Se algum navegador bloquear (CSP/extensão), o PDF também
  sai por `Ctrl+P` na página; nesse caso trocar `printPdf` por `window.open("", "_blank")` + `document.write`
  + `print()`.
- **`--generate` no CLI** imprime a senha uma única vez (nada em claro no banco). Se a pessoa perder a senha,
  `user:passwd <usuario> --generate` cria outra.
- **Sem controle de versão no repositório**: se uma edição do bundle der errado, a cópia original continua
  congelada em `resources/app.asar` (`out/renderer/...`) e pode ser extraída de lá.
- **`resources/app/out/main/`, `out/preload/` e `SacadaWeb-Mapas.exe`** ficam no repositório sem uso (o
  executável antigo ainda abre o app local, sem login e sem banco); o fluxo novo não depende deles. Apagar
  essas pastas e o runtime Electron é uma faxina opcional, fora deste plano.
- **Se o Postgres subir devagar** no primeiro `docker compose up`, o `ensureSchema` já retenta 10× com 1s de
  intervalo; se ainda assim falhar, o `depends_on: service_healthy` do Compose é o que resolve.
