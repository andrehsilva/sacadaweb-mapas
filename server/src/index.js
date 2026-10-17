import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.PORT ?? 3000);
const webDir = process.env.WEB_DIR ?? path.resolve(import.meta.dirname, "../../resources/app/out/renderer");
const indexPath = path.join(webDir, "index.html");

// Só o que é público vai para o navegador: a chave de API nunca passa por aqui.
const config = {
  endpoint: process.env.APPWRITE_ENDPOINT ?? "",
  projectId: process.env.APPWRITE_PROJECT_ID ?? "",
  databaseId: process.env.APPWRITE_DATABASE_ID ?? "sacadaweb_mapas",
  foldersTableId: process.env.APPWRITE_FOLDERS_ID ?? "folders",
  mapsTableId: process.env.APPWRITE_MAPS_ID ?? "maps",
  versionsTableId: process.env.APPWRITE_VERSIONS_ID ?? "versions",
  mapsBucketId: process.env.APPWRITE_MAPS_BUCKET_ID ?? "maps"
};

// A CSP da página precisa liberar o endpoint do Appwrite (que é configurável): o placeholder do HTML
// vira a origem do .env. Sem endpoint configurado, sobra `'self'` e o app avisa que falta configurar.
function originOf(endpoint) {
  try {
    return endpoint ? new URL(endpoint).origin : "";
  } catch {
    return "";
  }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

// Em produção os ativos ganham cache de verdade (o SDK vendorizado e o bundle têm versão/hash no nome);
// em desenvolvimento nada é cacheado, senão editar o app fica com cara de "não pegou".
const IS_PROD = process.env.NODE_ENV === "production";
const CACHE = {
  forever: "public, max-age=31536000, immutable",
  short: "public, max-age=300, stale-while-revalidate=86400",
  none: "no-cache"
};
// O nome do bundle do renderer já traz hash de conteúdo (index-<hash>.js) e o vendor traz a versão.
const isVersioned = (fileName) => /(^|\/)vendor\//.test(fileName) || /index-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(fileName);

function cacheControlFor(filePath) {
  if (!IS_PROD) return CACHE.none;
  if (filePath.includes(`${path.sep}fonts${path.sep}`) || isVersioned(filePath)) return CACHE.forever;
  return CACHE.short;
}

app.get("/assets/cloud-config.js", async (_request, reply) =>
  reply
    .type("application/javascript; charset=utf-8")
    .header("cache-control", "no-store")
    .send(`window.SACADAWEB_CONFIG = ${JSON.stringify(config)};\n`)
);

await app.register(fastifyStatic, {
  root: path.join(webDir, "assets"),
  prefix: "/assets/",
  index: false,
  // O plugin sobrescreve o Cache-Control depois do setHeaders; desligar isso é o que faz a
  // política abaixo valer de verdade (antes tudo saía como "public, max-age=0").
  cacheControl: false,
  setHeaders(response, filePath) {
    response.setHeader("Cache-Control", cacheControlFor(filePath));
  }
});

const sendIndex = async (_request, reply) => {
  const html = await fs.readFile(indexPath, "utf-8");
  return reply
    .type("text/html; charset=utf-8")
    .header("cache-control", "no-cache")
    .send(html.replaceAll("%APPWRITE_ORIGIN%", originOf(config.endpoint)));
};

app.get("/", sendIndex);
app.get("/index.html", sendIndex);

app.addHook("onSend", async (_request, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "no-referrer");
});

app.get("/api/health", async () => ({ ok: true }));

await app.listen({ host: "0.0.0.0", port });

// Como o node é o PID 1 no container, SIGTERM sem handler é ignorado: o orquestrador espera o timeout e
// mata com SIGKILL, cortando requisições no meio. Fechamos o servidor e saímos.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    app.close().then(
      () => process.exit(0),
      (error) => {
        app.log.error(error);
        process.exit(1);
      }
    );
  });
}
