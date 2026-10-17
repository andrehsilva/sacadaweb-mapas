#!/usr/bin/env node
// SacadaWeb - Mapas :: cria o banco, as tabelas, as colunas, os índices e os buckets no Appwrite.
// Idempotente: só cria o que falta e nunca apaga nada.
// O .env é lido pelo script do package.json (npm run appwrite:setup).

const ERRO_ENV =
  "Error: Defina APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY no .env (veja .env.example).";
const TAMANHO_MAXIMO = 20971520; // 20 MB por arquivo
const ESPERA_MAXIMA = 30000; // criar colunas e índices é assíncrono no Appwrite

const variavel = (nome, padrao = "") => (process.env[nome] ?? padrao).trim();

const config = {
  endpoint: variavel("APPWRITE_ENDPOINT"),
  projectId: variavel("APPWRITE_PROJECT_ID"),
  apiKey: variavel("APPWRITE_API_KEY"),
  databaseId: variavel("APPWRITE_DATABASE_ID", "sacadaweb_mapas"),
  foldersId: variavel("APPWRITE_FOLDERS_ID", "folders"),
  mapsId: variavel("APPWRITE_MAPS_ID", "maps"),
  versionsId: variavel("APPWRITE_VERSIONS_ID", "versions"),
  mapsBucketId: variavel("APPWRITE_MAPS_BUCKET_ID", "maps"),
};

// Colunas e índices de cada tabela, na ordem do modelo de dados.
const tabelas = [
  {
    id: config.foldersId,
    nome: "Pastas",
    colunas: [
      { chave: "name", tipo: "string", tamanho: 120, obrigatoria: true },
      { chave: "parentId", tipo: "string", tamanho: 36, obrigatoria: false },
    ],
    indices: [{ chave: "parentId", colunas: ["parentId"] }],
  },
  {
    id: config.mapsId,
    nome: "Mapas",
    colunas: [
      { chave: "name", tipo: "string", tamanho: 120, obrigatoria: true },
      { chave: "folderId", tipo: "string", tamanho: 36, obrigatoria: false },
      {
        chave: "template",
        tipo: "enum",
        elementos: ["livre", "pop-sacadaweb", "organograma", "desenho"],
        obrigatoria: true,
      },
      // O Appwrite recusa valor padrão em coluna obrigatória; a revisão inicial vai no próprio registro.
      { chave: "revision", tipo: "integer", minimo: 1, obrigatoria: true },
      { chave: "dataFileId", tipo: "string", tamanho: 36, obrigatoria: true },
      { chave: "size", tipo: "integer", minimo: 0, obrigatoria: true },
      { chave: "updatedByName", tipo: "string", tamanho: 120, obrigatoria: false },
    ],
    indices: [{ chave: "folderId", colunas: ["folderId"] }],
  },
  {
    id: config.versionsId,
    nome: "Versões",
    colunas: [
      { chave: "mapId", tipo: "string", tamanho: 36, obrigatoria: true },
      { chave: "dataFileId", tipo: "string", tamanho: 36, obrigatoria: true },
      { chave: "size", tipo: "integer", minimo: 0, obrigatoria: true },
    ],
    indices: [{ chave: "mapId", colunas: ["mapId"] }],
  },
];

const criados = [];
const existentes = [];

async function carregarSdk() {
  try {
    return await import("node-appwrite");
  } catch (erro) {
    if (erro?.code === "ERR_MODULE_NOT_FOUND") {
      console.error('Error: O pacote node-appwrite não está instalado. Rode "npm install" na raiz do projeto.');
    } else {
      console.error(`Error: ${erro?.message ?? erro}`);
    }
    return null;
  }
}

async function garantirBanco(tables) {
  const { databases } = await tables.list();
  if (databases.some((banco) => banco.$id === config.databaseId)) {
    existentes.push(`banco ${config.databaseId}`);
    return;
  }
  await tables.create({ databaseId: config.databaseId, name: "SacadaWeb - Mapas" });
  criados.push(`banco ${config.databaseId}`);
}

async function criarColuna(tables, tabelaId, coluna) {
  const base = { databaseId: config.databaseId, tableId: tabelaId, key: coluna.chave };
  if (coluna.tipo === "string") {
    await tables.createStringColumn({ ...base, size: coluna.tamanho, required: coluna.obrigatoria });
    return;
  }
  if (coluna.tipo === "integer") {
    await tables.createIntegerColumn({ ...base, required: coluna.obrigatoria, min: coluna.minimo });
    return;
  }
  await tables.createEnumColumn({ ...base, elements: coluna.elementos, required: coluna.obrigatoria });
}

// Cria a tabela, as colunas e os índices que faltam; espera cada etapa ficar pronta.
async function garantirTabela(tables, tabela, permissoes) {
  const { tables: lista } = await tables.listTables({ databaseId: config.databaseId });
  if (lista.some((item) => item.$id === tabela.id)) {
    existentes.push(`tabela ${tabela.id}`);
  } else {
    await tables.createTable({
      databaseId: config.databaseId,
      tableId: tabela.id,
      name: tabela.nome,
      permissions: permissoes,
      rowSecurity: false,
    });
    criados.push(`tabela ${tabela.id}`);
  }

  const { columns } = await tables.listColumns({ databaseId: config.databaseId, tableId: tabela.id });
  const colunas = new Set(columns.map((coluna) => coluna.key));
  for (const coluna of tabela.colunas) {
    if (colunas.has(coluna.chave)) {
      // Enum que ganhou valor novo (ex.: o template "desenho") precisa ser ampliado na instância que já existe:
      // o Appwrite recusa gravar valor fora da lista, então manter o schema antigo quebraria a criação.
      const atual = columns.find((item) => item.key === coluna.chave);
      // O Appwrite reporta coluna de enum como type "string" com `elements` (e format "enum"),
      // então a detecção é pela presença da lista, não pelo type.
      if (coluna.tipo === "enum" && Array.isArray(atual?.elements)) {
        const faltando = coluna.elementos.filter((valor) => !(atual.elements ?? []).includes(valor));
        if (faltando.length > 0) {
          await tables.updateEnumColumn({
            databaseId: config.databaseId,
            tableId: tabela.id,
            key: coluna.chave,
            elements: coluna.elementos,
            required: coluna.obrigatoria,
            // O SDK do servidor exige o parâmetro na chamada; null = sem valor padrão.
            xdefault: null,
          });
          criados.push(`coluna ${tabela.id}.${coluna.chave} (enum ampliado: ${faltando.join(", ")})`);
          continue;
        }
      }
      existentes.push(`coluna ${tabela.id}.${coluna.chave}`);
      continue;
    }
    await criarColuna(tables, tabela.id, coluna);
    criados.push(`coluna ${tabela.id}.${coluna.chave}`);
  }

  // Índice só entra depois que as colunas ficam disponíveis.
  await aguardar(() => pendentesDeColuna(tables, tabela.id));

  const { indexes } = await tables.listIndexes({ databaseId: config.databaseId, tableId: tabela.id });
  const indices = new Set(indexes.map((indice) => indice.key));
  for (const indice of tabela.indices) {
    if (indices.has(indice.chave)) {
      existentes.push(`índice ${tabela.id}.${indice.chave}`);
      continue;
    }
    await tables.createIndex({
      databaseId: config.databaseId,
      tableId: tabela.id,
      key: indice.chave,
      type: "key",
      columns: indice.colunas,
    });
    criados.push(`índice ${tabela.id}.${indice.chave}`);
  }
}

async function pendentesDeColuna(tables, tabelaId) {
  const { columns } = await tables.listColumns({ databaseId: config.databaseId, tableId: tabelaId });
  return columns
    .filter((coluna) => coluna.status !== "available")
    .map((coluna) => `coluna ${tabelaId}.${coluna.key} (${coluna.status})`);
}

async function pendentesDeIndice(tables) {
  const pendentes = [];
  for (const tabela of tabelas) {
    const { indexes } = await tables.listIndexes({ databaseId: config.databaseId, tableId: tabela.id });
    for (const indice of indexes) {
      if (indice.status !== "available") pendentes.push(`índice ${tabela.id}.${indice.key} (${indice.status})`);
    }
  }
  return pendentes;
}

async function garantirBucket(storage, bucketId, nome, permissoes) {
  const { buckets } = await storage.listBuckets();
  if (buckets.some((bucket) => bucket.$id === bucketId)) {
    existentes.push(`bucket ${bucketId}`);
    return;
  }
  await storage.createBucket({
    bucketId,
    name: nome,
    permissions: permissoes,
    fileSecurity: false,
    maximumFileSize: TAMANHO_MAXIMO,
    allowedFileExtensions: ["json"],
  });
  criados.push(`bucket ${bucketId}`);
}

// A criação é assíncrona: espera tudo ficar `available` antes de dizer que terminou.
async function aguardar(verificar) {
  const limite = Date.now() + ESPERA_MAXIMA;
  for (;;) {
    const pendentes = await verificar();
    if (!pendentes.length) return;
    if (Date.now() >= limite) {
      throw new Error(`O Appwrite ainda está processando: ${pendentes.join(", ")}.`);
    }
    await new Promise((resolver) => setTimeout(resolver, 1000));
  }
}

async function main() {
  if (!config.endpoint || !config.projectId || !config.apiKey) {
    console.error(ERRO_ENV);
    process.exitCode = 1;
    return;
  }

  const sdk = await carregarSdk();
  if (!sdk) {
    process.exitCode = 1;
    return;
  }

  const client = new sdk.Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);
  const tables = new sdk.TablesDB(client);
  const storage = new sdk.Storage(client);
  // Todo usuário autenticado lê e escreve: um espaço único, sem segurança por linha ou arquivo.
  const permissoes = [sdk.Permission.read(sdk.Role.users()), sdk.Permission.write(sdk.Role.users())];

  console.log(`Appwrite: ${config.endpoint} :: projeto ${config.projectId}`);

  await garantirBanco(tables);
  for (const tabela of tabelas) await garantirTabela(tables, tabela, permissoes);
  // Um bucket só: a versão anterior de um mapa é o próprio arquivo antigo, que fica onde estava.
  await garantirBucket(storage, config.mapsBucketId, "Mapas (arquivos)", permissoes);

  await aguardar(() => pendentesDeIndice(tables));

  console.log("");
  console.log("Resumo:");
  for (const item of criados) console.log(`  criado:     ${item}`);
  for (const item of existentes) console.log(`  já existia: ${item}`);
  console.log("");
  console.log("Tudo pronto.");
}

main().catch((erro) => {
  console.error(`Error: ${erro?.message ?? erro}`);
  process.exitCode = 1;
});
