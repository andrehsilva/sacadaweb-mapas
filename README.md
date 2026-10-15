# SacadaWeb - Mapas na nuvem

App web para mapas mentais e organogramas, com exportação para roteiro de POP, PNG, SVG, PDF, CSV e Excel.
Login e dados ficam no Appwrite self-hosted da VPS; o navegador carrega a UI e fala direto com a API.

- Versão: 1.5.0
- Linguagem visual: [`DESIGN.md`](DESIGN.md) (porta do design system do NotAI/SacadaWeb)
- Marca: lockup "SacadaWeb - Mapas" em Outfit 700; ícone com "SW-Mapas"

## Como funciona

- `server/src/index.js` é um servidor estático em Node: entrega `resources/app/out/renderer/` e publica a config
  pública do Appwrite (`window.SACADAWEB_CONFIG`: endpoint, project ID e ids de tabelas e buckets) em
  `/assets/cloud-config.js`, gerado a partir do `.env` — a CSP da página só deixa rodar script da própria
  origem, então a config sai como asset, não como script inline.
- O cliente (`assets/cloud-api.js` sobre o SDK Web vendorizado em `assets/vendor/appwrite.js`) fala direto com
  o Appwrite: Accounts para login, TablesDB para pastas, mapas e versões, Storage para o conteúdo dos arquivos.
- Não há pasta local de mapas nem banco próprio. O servidor só serve arquivos: nada de estado, e a API key
  nunca chega ao navegador. Exportações (PNG, SVG, PDF, CSV, Excel, POP) acontecem no próprio navegador.

## Configuração

```bash
cp .env.example .env
```

Preencha o bloco do Appwrite:

- `APPWRITE_ENDPOINT` - endpoint com `/v1` no fim (ex.: `https://appwrite.sacadaweb.com.br/v1`).
- `APPWRITE_PROJECT_ID` - Console -> Settings -> Project ID.
- `APPWRITE_API_KEY` - chave do projeto com os escopos `databases`, `tables`, `columns`, `indexes`, `buckets`,
  `files` e `users`.

Os ids de recurso têm padrão e são criados por `npm run appwrite:setup`. Se trocar algum, mantenha o mesmo
valor no `.env` do servidor.

| Variável | Vai ao navegador | Para que serve |
|---|---|---|
| `APPWRITE_ENDPOINT` | sim, em `cloud-config.js` | URL da API do Appwrite |
| `APPWRITE_PROJECT_ID` | sim, em `cloud-config.js` | projeto usado pelo SDK Web |
| `APPWRITE_DATABASE_ID` | sim, em `cloud-config.js` | database `sacadaweb_mapas` |
| `APPWRITE_FOLDERS_ID`, `APPWRITE_MAPS_ID`, `APPWRITE_VERSIONS_ID` | sim, em `cloud-config.js` | tabelas `folders`, `maps` e `versions` |
| `APPWRITE_MAPS_BUCKET_ID` | sim, em `cloud-config.js` | bucket `maps` (conteúdo dos mapas e das versões) |
| `APPWRITE_API_KEY` | não | cria recursos e usuários; usada só pelos scripts de `tools/` |
| `PORT` | não | porta do servidor estático (padrão 3000) |
| `DOMAIN` | não | domínio do Caddy no compose (`:80` fica só em HTTP) |

## Rodar local

```bash
npm install
npm run appwrite:setup    # cria database, tabelas, índices e buckets
npm run dev               # http://localhost:3000
```

`npm run dev` lê o `.env` da raiz e reinicia a cada alteração; `npm run start` roda o mesmo servidor sem
`--watch`.

## VPS

1. Clone (ou copie) o repositório e crie o `.env` com `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`,
   `APPWRITE_API_KEY` e `DOMAIN` - e os ids de recurso, se tiver trocado os padrões.
2. Suba os containers:

```bash
docker compose up -d --build
```

O Caddy fica na frente do servidor e emite o certificado automaticamente quando `DOMAIN` é um domínio real;
acesse pela URL do domínio. Sem domínio, use `DOMAIN=:80` e acesse pela porta 80.

## Usuários

Não há autocadastro: os usuários são criados pelo admin. A tela de login pede e-mail e senha.

```bash
node tools/appwrite-user.mjs add pessoa@dominio.com <senha>            # usuário comum
node tools/appwrite-user.mjs add pessoa@dominio.com <senha> --admin    # marcado como admin
```

Também dá para criar pelo Console do Appwrite (Auth -> Users).

## Onde ficam os dados

Tudo no Appwrite: as tabelas `folders`, `maps` e `versions` guardam a árvore de pastas, os mapas (nome,
template, revisão, tamanho, último autor) e o histórico; o bucket `maps` guarda o `.swmap.json` inteiro — o
conteúdo atual do mapa e, quando ele é substituído, o arquivo anterior que vira uma versão.

O histórico mantém as 20 versões mais novas de cada mapa. Antes de gravar conteúdo novo, o arquivo antigo
vira uma linha em `versions`, com freio de 5 minutos entre versões (o que passar do limite é podado).

## Estrutura

```
server/                             servidor estático + config pública do Appwrite
  src/index.js                        entrega resources/app/out/renderer e /assets/cloud-config.js a partir do .env
tools/appwrite-setup.mjs            cria database, tabelas, índices e buckets (npm run appwrite:setup)
tools/appwrite-user.mjs             cria e atualiza usuários
tools/pack-brand.py                 gera os ícones e a marca (brand.js) a partir dos masters em build/
resources/app/out/renderer/         UI (bundle, CSS, fontes)
  assets/cloud-api.js                 interface window.api sobre o Appwrite
  assets/vendor/appwrite.js           SDK Web do Appwrite (IIFE, expõe window.Appwrite)
docker-compose.yml                  app + Caddy
Caddyfile                           reverse proxy com HTTPS automático
.env.example                        modelo das variáveis de ambiente
```

## App de desktop (aposentado)

O app Electron portátil e o fluxo de mapas em pasta local saíram de cena: `resources/app/out/main/`,
`resources/app/out/preload/`, `resources/app.asar`, `SacadaWeb-Mapas.exe` e `tools/build-portable.ps1`
continuam no repositório, mas o fluxo na nuvem não usa nada disso - a UI atual é só
`resources/app/out/renderer/`.

## Histórico do plano

`SACADAWEB_MAPAS_NA_NUVEM_LOGIN_PLAN.md` é o registro do desenho original (Fastify + Postgres): o login, o
Postgres e o CLI dele foram substituídos pelo Appwrite.
