#!/usr/bin/env node
// SacadaWeb - Mapas :: contas de acesso. Não há autocadastro: o admin cria os usuários.
// O .env é lido pelo script do package.json (npm run appwrite:user -- <comando>).

const ERRO_ENV =
  "Error: Defina APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY no .env (veja .env.example).";
const ROTULO_ADMIN = "admin";
const SENHA_MINIMA = 10;
const LIMITE_LISTA = 100;

const USO = [
  "Uso: node tools/appwrite-user.mjs <comando> [argumentos]",
  "",
  "  add <email> <senha> [--admin]   cria o usuário (senha com 10+ caracteres)",
  "  passwd <email> <senha>          troca a senha",
  "  admin <email>                   marca o usuário como admin",
  "  user <email>                    tira o rótulo de admin",
  "  disable <email>                 desativa o acesso",
  "  enable <email>                  reativa o acesso",
  "  list                            lista os usuários",
].join("\n");

const variavel = (nome) => (process.env[nome] ?? "").trim();

const config = {
  endpoint: variavel("APPWRITE_ENDPOINT"),
  projectId: variavel("APPWRITE_PROJECT_ID"),
  apiKey: variavel("APPWRITE_API_KEY"),
};

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

function exigirSenha(senha) {
  if (!senha || senha.length < SENHA_MINIMA) {
    throw new Error("A senha precisa de pelo menos 10 caracteres.");
  }
}

function exigirArgumentos(args) {
  if (!args[0] || !args[1]) {
    console.log(USO);
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function acharUsuario(users, Query, email) {
  const { users: encontrados } = await users.list({ queries: [Query.equal("email", email)] });
  return encontrados[0] ?? null;
}

async function exigirUsuario(users, Query, email) {
  const usuario = await acharUsuario(users, Query, email);
  if (!usuario) throw new Error(`Não encontrei o usuário ${email}.`);
  return usuario;
}

async function adicionar(users, sdk, args) {
  if (!exigirArgumentos(args)) return;
  const [email, senha] = args;
  const admin = args.includes("--admin");
  exigirSenha(senha);
  if (await acharUsuario(users, sdk.Query, email)) {
    throw new Error("Já existe um usuário com esse e-mail.");
  }

  let usuario;
  try {
    usuario = await users.create({
      userId: sdk.ID.unique(),
      email,
      password: senha,
      name: email.split("@")[0],
    });
  } catch (erro) {
    if (erro?.code === 409) throw new Error("Já existe um usuário com esse e-mail.");
    throw erro;
  }

  if (admin) {
    await users.updateLabels({ userId: usuario.$id, labels: [ROTULO_ADMIN] });
  }
  console.log(`${admin ? "Admin" : "Usuário"} criado: ${email}`);
}

async function trocarSenha(users, sdk, args) {
  if (!exigirArgumentos(args)) return;
  const [email, senha] = args;
  exigirSenha(senha);
  const usuario = await exigirUsuario(users, sdk.Query, email);
  await users.updatePassword({ userId: usuario.$id, password: senha });
  console.log(`Senha trocada: ${email}`);
}

async function definirAdmin(users, sdk, email, ligado) {
  const usuario = await exigirUsuario(users, sdk.Query, email);
  const rotulos = new Set(usuario.labels ?? []);
  if (ligado) rotulos.add(ROTULO_ADMIN);
  else rotulos.delete(ROTULO_ADMIN);
  await users.updateLabels({ userId: usuario.$id, labels: [...rotulos] });
  console.log(`${ligado ? "Admin" : "Usuário comum"}: ${email}`);
}

async function definirAtivo(users, sdk, email, ativo) {
  const usuario = await exigirUsuario(users, sdk.Query, email);
  await users.updateStatus({ userId: usuario.$id, status: ativo });
  console.log(`${ativo ? "Ativado" : "Desativado"}: ${email}`);
}

async function listar(users, sdk) {
  const { users: lista, total } = await users.list({
    queries: [sdk.Query.orderAsc("email"), sdk.Query.limit(LIMITE_LISTA)],
  });
  console.log("email  nome  ativo  rotulos  criado em");
  for (const usuario of lista) {
    const ativo = usuario.status ? "sim" : "não";
    const rotulos = (usuario.labels ?? []).join(",") || "-";
    console.log(
      `${usuario.email}  ${usuario.name || "-"}  ${ativo}  ${rotulos}  ${usuario.$createdAt}`,
    );
  }
  console.log(`${total} usuário(s).`);
}

async function main() {
  const [comando, ...args] = process.argv.slice(2);

  if (!comando) {
    console.log(USO);
    process.exitCode = 1;
    return;
  }

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
  const users = new sdk.Users(client);

  switch (comando) {
    case "add":
      return adicionar(users, sdk, args);
    case "passwd":
      return trocarSenha(users, sdk, args);
    case "admin":
    case "user":
      if (!args[0]) return usoIncorreto();
      return definirAdmin(users, sdk, args[0], comando === "admin");
    case "disable":
    case "enable":
      if (!args[0]) return usoIncorreto();
      return definirAtivo(users, sdk, args[0], comando === "enable");
    case "list":
      return listar(users, sdk);
    default:
      return usoIncorreto();
  }
}

function usoIncorreto() {
  console.log(USO);
  process.exitCode = 1;
}

main().catch((erro) => {
  console.error(`Error: ${erro?.message ?? erro}`);
  process.exitCode = 1;
});
