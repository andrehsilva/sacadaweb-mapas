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
- O cliente (`assets/cloud-api.js` sobre o SDK Web vendorizado em `assets/vendor/appwrite-29.0.0.js`) fala
  direto com o Appwrite: Accounts para login, TablesDB para pastas, mapas e versões, Storage para o conteúdo
  dos arquivos. O nome do SDK carrega a versão de propósito: é o que permite servi-lo como `immutable`. Ao
  vendorizar uma versão nova, o arquivo entra com o novo número e o `index.html` aponta para ele (o nome antigo
  não pode ser reaproveitado, senão o cache de um ano continua valendo).
- Não há pasta local de mapas nem banco próprio. O servidor só serve arquivos: nada de estado, e a API key
  nunca chega ao navegador. Exportações (PNG, SVG, PDF, CSV, Excel, POP) acontecem no próprio navegador.

## Desenhar no palco

Além da árvore (mapa mental e organograma), o palco aceita **desenho**: formas geométricas, símbolos de fluxo,
setas e conectores, marcadores do POP e texto/nota. Uma barra flutuante no rodapé do palco abre cinco grupos —
**Formas**, **Fluxo**, **Linhas**, **Marcadores** e **Anotação** — e traz as ações de agrupar, duplicar, ordem,
desfazer/refazer e excluir.

- **Atalhos**: `V` selecionar · `R` retângulo · `O` elipse · `D` losango · `L` linha · `A` seta · `C` conector ·
  `T` texto · `N` nota · `P` ponto · `M` crítico (e mais no flyout de cada grupo). `Del` exclui, setas movem
  1px (`Shift` = 10px), `Ctrl+D` duplica, `Ctrl+G` agrupa, `Ctrl+]`/`Ctrl+[` mudam a ordem, `Esc` volta para a
  seleção. Como as letras têm precedência sobre o "digitar cria um nó" do editor, criar filho e irmão seguem em
  `Tab` e `Enter`.
- **Conectores**: arrastar com a ferramenta `C` de uma forma para outra (ou de um **nó** para outro) ancora as
  pontas — a ponta no nó acompanha o layout sozinha, porque o ponto é calculado no desenho e não gravado. Nó
  apagado não apaga o conector: ele fica no último ponto, marcado como órfão.
- **Onde fica**: o desenho é guardado no próprio `.swmap.json`, na chave `annotations` (independente do tipo de
  mapa), então salvar, versionar, compartilhar e exportar levam tudo junto. Arquivos antigos, sem essa chave,
  abrem normalmente; mapas com desenho continuam abrindo em versões que ignoram a chave.
- **Detalhes de projeto** (tokens, posse do teclado, ordem de desenho, export): [`DESIGN.md`](DESIGN.md),
  seção "Palco de desenho".

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

## VPS com docker compose

Este caminho é o do `docker-compose.yml` do repositório: o `app` + o `caddy` (proxy e HTTPS). Precisa das portas
80 e 443 livres no servidor.

1. Clone (ou copie) o repositório e crie o `.env` com `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`,
   `APPWRITE_API_KEY` e `DOMAIN` - e os ids de recurso, se trocar os padrões.
2. Prepare os recursos e a primeira conta (roda no host, com Node 22+; o container não precisa da API key):

```bash
npm install
npm run appwrite:setup
npm run appwrite:user -- add pessoa@dominio.com <senha> --admin
```

3. Suba os containers:

```bash
docker compose up -d --build
```

O Caddy fica na frente do servidor e emite o certificado automaticamente quando `DOMAIN` é um domínio real;
acesse pela URL do domínio. Sem domínio, use `DOMAIN=:80` e acesse pela porta 80.

## Publicar no Easypanel

O Easypanel já traz proxy e HTTPS próprios, então o serviço é um **App** (não um Compose): o `docker-compose.yml`
e o `Caddyfile` deste repositório não entram nesse caminho — eles disputariam as portas 80/443 com o Easypanel
se subissem no mesmo servidor.

1. **Servidor**: instale o Easypanel onde as portas 80 e 443 estiverem livres (ele mesmo as ocupa). Se a VPS do
   Appwrite roda o Traefik do Appwrite nessas portas, use outro servidor para o Easypanel.
2. **Serviço**: no projeto, **New Service** → **App**, nome `mapas`.
3. **Source** → **GitHub**: repositório `andrehsilva/sacadaweb-mapas`, branch `main`, **Build Path** `/`
   (o contexto do build é a raiz, porque a imagem copia `resources/app/out/renderer`).
4. **Build** → **Dockerfile**, com o caminho `server/Dockerfile`.
5. **Environment** (só o que é público; a API key fica no seu terminal, nos scripts de `tools/`):

```dotenv
APPWRITE_ENDPOINT=https://appwrite.sacadaweb.com.br/v1
APPWRITE_PROJECT_ID=6ad11c64002f575634af
APPWRITE_DATABASE_ID=sacadaweb_mapas
APPWRITE_FOLDERS_ID=folders
APPWRITE_MAPS_ID=maps
APPWRITE_VERSIONS_ID=versions
APPWRITE_MAPS_BUCKET_ID=maps
PORT=3000
```

6. **Domains**: hostname (`mapas.sacadaweb.com.br`), porta interna **3000**, HTTPS ligado, marcado como
   primário. Aponte o DNS para o IP do servidor do Easypanel antes do deploy. Servir o app num subdomínio do
   mesmo domínio do Appwrite deixa o cookie de sessão *same-site* — sem depender do fallback em `localStorage`.
7. **Deploy** e acompanhe o build; depois confirme em `https://<hostname>/api/health` (`{"ok":true}`) e nos
   logs. **Enable Auto Deploy** publica a cada push na branch.
8. A primeira conta sai do seu terminal, com este repositório e o `.env` preenchido:
   `npm run appwrite:user -- add voce@dominio.com <senha> --admin`.

O serviço é stateless (um único container, sem volume): os dados ficam no Appwrite.

## Usuários

Não há autocadastro: os usuários são criados pelo admin. A tela de login pede e-mail e senha.

```bash
npm run appwrite:user -- list                                     # lista as contas
npm run appwrite:user -- add pessoa@dominio.com <senha>           # usuário comum
npm run appwrite:user -- add pessoa@dominio.com <senha> --admin   # marcado como admin
npm run appwrite:user -- passwd pessoa@dominio.com <nova-senha>   # troca a senha
```

Fora dos scripts do `package.json`, todo comando de `tools/` precisa do `.env` na linha de comando:
`node --env-file=.env tools/appwrite-user.mjs list`.

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
  assets/index-<hash>.js              bundle do renderer (o hash é do conteúdo)
  assets/vendor/appwrite-<versão>.js  SDK Web do Appwrite (IIFE, expõe window.Appwrite; nome carrega a versão)
docker-compose.yml                  app + Caddy
Caddyfile                           reverse proxy com HTTPS automático
.env.example                        modelo das variáveis de ambiente
```

O bundle do renderer leva o hash do conteúdo no nome justamente para poder ser servido como
`immutable`. Trocar o conteúdo e manter o nome deixa o arquivo congelado no cache do navegador por um
ano: ao regravar o bundle, ele entra com o hash novo e o `index.html` aponta para ele.

## App de desktop (aposentado)

O app Electron portátil e o fluxo de mapas em pasta local saíram de cena: `resources/app/out/main/`,
`resources/app/out/preload/`, `resources/app.asar`, `SacadaWeb-Mapas.exe` e `tools/build-portable.ps1`
continuam no repositório, mas o fluxo na nuvem não usa nada disso - a UI atual é só
`resources/app/out/renderer/`.

## Histórico do plano

`SACADAWEB_MAPAS_NA_NUVEM_LOGIN_PLAN.md` é o registro do desenho original (Fastify + Postgres): o login, o
Postgres e o CLI dele foram substituídos pelo Appwrite.
