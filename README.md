# SacadaWeb - Mapas

App de desktop (Windows 64 bits) para mapas mentais e organogramas, com exportação para roteiro de POP, PNG,
SVG, PDF, CSV e Excel. Esta pasta é o **projeto editável + o app portátil**.

- Versão: 1.5.0
- Linguagem visual: [`DESIGN.md`](DESIGN.md) (porta do design system do NotAI/SacadaWeb)
- Marca: lockup "SacadaWeb - Mapas" em Outfit 700; ícone com "SW-Mapas" (`SW` nas medidas pequenas)

## Rodar

| Quero | Como |
|---|---|
| Abrir o app agora | duplo clique em `SacadaWeb-Mapas.exe` |
| Gerar/entregar uma cópia | `SacadaWeb-Mapas-1.5.0-portable.exe` (arquivo único: extrai ao lado e abre) |

Não precisa instalar nem ser administrador. O Windows pode avisar do SmartScreen porque o executável não é
assinado: _Mais informações_ → _Executar assim mesmo_.

> **Neste repositório** está só o projeto editável: o runtime (`.exe`, `.dll`, `.pak`, `locales/`) e o zip
> portátil **não** são versionados (o `.exe` sozinho tem 235 MB). Para rodar a partir do clone, veja
> [Rodar a partir do repositório](#rodar-a-partir-do-repositório).

## Rodar a partir do repositório

O runtime Electron não está no Git, então um clone limpo roda a UI direto da fonte:

```bash
npm --prefix resources/app install    # @electron-toolkit/preload + utils
npx --yes electron@44 resources/app   # abre a janela com resources/app/out/*
```

Para reconstruir o app empacotado (`resources/app.asar`) antes de abrir o `.exe`, use o passo de
[Editar o app](#editar-o-app).

## Onde ficam os dados

- Mapas: na pasta escolhida na primeira abertura (arquivos `.swmap.json`), com versões anteriores em `.historico/`.
- Configuração (pasta de trabalho e tema): `%APPDATA%\SacadaWeb-Mapas\config.json`.

## Estrutura

```
SacadaWeb-Mapas.exe            runtime Electron com o app embutido
*.dll *.pak *.bin *.dat        runtime Electron (não editar)
locales/                       traduções do Chromium
resources/app.asar             aplicativo empacotado  <- gerado de resources/app
resources/app/                 código do app (fonte de verdade para edição)
  out/main/index.js              Node: janela, arquivos, IPC, exportação de PDF
  out/preload/index.js           ponte contextBridge (window.api)
  out/renderer/index.html        casca da UI
  out/renderer/assets/           bundle do renderer, CSS, fontes, camada de design
build/                         insumos e ferramentas de build (asar, rcedit, masters de marca)
tools/pack-brand.py            gera ícones e o lockup a partir de build/*-master.png
tools/build-portable.ps1       gera o executável portátil de arquivo único
DESIGN.md                      tokens e regras do design system
```

## Editar o app

1. Mexa em `resources/app/**` (o código está legível, não minificado).
2. Reempacote e rode:

```bat
node build\node_modules\@electron\asar\bin\asar.mjs pack resources\app resources\app.asar
SacadaWeb-Mapas.exe
```

O runtime carrega `resources/app.asar`. As ferramentas de build (`@electron/asar`, `rcedit`) ficam em
`build/node_modules`; para reinstalar: `cd build && npm install`.

## Marca e ícone

- Fonte do desenho: `build/brand.html` (lockup + ladrilho do ícone, com as fontes embutidas do app).
  Renderize os alvos `#icon` e `#icon-small` em 512×512 e salve como `build/icon-master.png` e
  `build/icon-small-master.png`; o lockup vai para `build/lockup-master.png`.
- Empacotar: `python tools/pack-brand.py` (gera `build/icon.ico`, `build/icon.png`, `resources/icon.png`,
  `resources/app/resources/icon.png` e `resources/app/out/renderer/assets/brand.js`).
- Aplicar o ícone no executável (com o app fechado):

```bat
build\node_modules\rcedit\bin\rcedit-x64.exe SacadaWeb-Mapas.exe ^
  --set-icon build\icon.ico ^
  --set-version-string ProductName "SacadaWeb-Mapas" ^
  --set-version-string FileDescription "SacadaWeb-Mapas" ^
  --set-version-string CompanyName "SacadaWeb" ^
  --set-version-string OriginalFilename "SacadaWeb-Mapas.exe"
```

- Fontes embutidas (OFL, licenças em `resources/app/out/renderer/assets/fonts`): JetBrains Mono
  (chrome, 400/500/600/700) e Outfit 700 (marca, a mesma de sacadaweb.com.br).

## Gerar o pacote portátil

```bat
powershell -File tools\build-portable.ps1
```

Monta o payload (runtime Electron + `resources/app.asar`, sem o projeto e sem os insumos de build) e grava
`SacadaWeb-Mapas-<versão>-portable.zip`. Usa o `ZipArchive` do .NET, sem dependência externa; passe
`-SevenZip <...>\7z.exe` para usar o 7-Zip (mais rápido).
