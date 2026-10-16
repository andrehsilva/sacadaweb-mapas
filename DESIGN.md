---
version: alpha
name: SacadaWeb-Mapas
description: Mapas mentais e organogramas de desktop. Porta do DESIGN.md do NotAI (github.com/andrehsilva/annotation) para o SacadaWeb-Mapas - dark-first, JetBrains Mono no chrome, Outfit na marca e um unico azul de acento.
colors:
  background: "#f4f6fa"
  background-dark: "#1b1b1b"
  surface: "#e9edf4"
  surface-dark: "#202020"
  surface-raised: "#ffffff"
  surface-raised-dark: "#262626"
  border: "#dbe0e9"
  border-dark: "#313131"
  border-strong: "#c1c8d6"
  border-strong-dark: "#434343"
  on-surface: "#131720"
  on-surface-dark: "#e7e7e7"
  on-surface-muted: "#59616f"
  on-surface-muted-dark: "#9c9c9c"
  primary: "#1f6feb"
  primary-dark: "#6ba5f8"
  primary-strong: "#1a5fd0"
  primary-strong-dark: "#4b8cf0"
  on-primary: "#ffffff"
  on-primary-dark: "#10161f"
  accent-soft: "#1f6feb1f"
  accent-soft-dark: "#6ba5f82e"
  warn: "#f0f0c8"
  warn-dark: "#3b3b1d"
  on-warn: "#5c5c14"
  on-warn-dark: "#e3e38a"
  danger: "#b42318"
  danger-dark: "#f28b82"
  success: "#1c6a45"
  success-dark: "#7fd8a4"
typography:
  brand-word:
    fontFamily: Outfit
    fontSize: 19px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.025em
  brand-word-welcome:
    fontFamily: Outfit
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.03em
  headline:
    fontFamily: JetBrains Mono
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.02em
  title:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.01em
  body:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: JetBrains Mono
    fontSize: 13.5px
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.02em
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.08em
  status-chip:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.02em
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  full: 999px
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 28px
  7: 44px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: 5px 12px
    typography: "{typography.label}"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary-dark}"
    rounded: "{rounded.md}"
    padding: 5px 12px
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 5px 12px
    typography: "{typography.label}"
  button-ghost-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-surface-dark}"
    rounded: "{rounded.md}"
    padding: 5px 12px
    typography: "{typography.label}"
  icon-button:
    size: 32px
    rounded: "{rounded.md}"
    padding: 0
  status-chip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface-muted}"
    rounded: "{rounded.full}"
    padding: 3px 10px
    typography: "{typography.status-chip}"
  status-chip-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.on-surface-muted-dark}"
    rounded: "{rounded.full}"
    padding: 3px 10px
    typography: "{typography.status-chip}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 6px 10px
    typography: "{typography.label}"
  input-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-surface-dark}"
    rounded: "{rounded.md}"
    padding: 6px 10px
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    rounded: "{rounded.lg}"
    padding: 16px
  floating-menu:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: 4px
    shadow: 0 12px 28px rgb(19 23 32 / 12%)
  floating-menu-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    rounded: "{rounded.lg}"
    padding: 4px
    shadow: 0 12px 32px rgb(0 0 0 / 50%)
  sidebar:
    width: 288px
    backgroundColor: "{colors.surface-dark}"
    borderColor: "{colors.border-dark}"
  sidebar-rail:
    width: 52px
    backgroundColor: "{colors.surface-dark}"
  tree-row:
    rounded: "{rounded.md}"
    padding: 5px 8px
  tag-chip:
    backgroundColor: transparent
    textColor: "{colors.on-surface-muted}"
    rounded: "{rounded.full}"
    padding: 2px 10px
    typography: "{typography.label}"
---

# SacadaWeb - Mapas

## Overview

App de desktop (Windows) para o analista de processos: mapas mentais e organogramas salvos como arquivos
`.swmap.json` na pasta escolhida pelo usuário, com exportação para roteiro de POP, PNG, SVG, PDF, CSV e Excel.

A linguagem visual é uma **porta do DESIGN.md do NotAI** (`github.com/andrehsilva/annotation`), que por sua vez
vem do tema de documentação do Oh My Posh: superfícies quase pretas, chrome em monoespaçada, fios de 1px e
**um único azul** de acento. A marca (SacadaWeb) entra só no lockup, na fonte Outfit.

O lockup segue a assinatura do site (sacadaweb.com.br): **"SacadaWeb" numa palavra, Outfit 700, tracking
-0.025em, monocromático** (sem dividir o acento no "Web"), com o sufixo do produto "- MAPAS" em JetBrains Mono
10/600, maiúsculas e tracking 0.08em. Os mesmos parâmetros valem no mestre `build/brand.html`, de onde
`tools/pack-brand.py` gera o lockup embutido nos exports (`brand.js`).

Público: um único dono técnico no teclado, então densidade ganha de aresidade e toda ação principal tem atalho.

Valores dos dials: `DESIGN_VARIANCE: 4` (UI de produto previsível), `MOTION_INTENSITY: 2` (só feedback de estado,
160ms), `VISUAL_DENSITY: 6` (a barra lateral carrega a árvore de mapas com contadores).

## Colors

- **Background (#1b1b1b escuro / #f4f6fa claro):** canvas do app e do editor de mapa.
- **Surface (#202020 / #e9edf4):** barra lateral, barra de ferramentas, painel de nota — a faixa de chrome.
  Só o que está elevado é mais claro, então um card lê como card sem precisar de sombra.
- **Surface raised (#262626 / #ffffff):** menus flutuantes, minimapa, barra de busca e dialogos.
- **Border (#313131 / #dbe0e9):** fios de 1px; o único recurso de separação dentro de cards e barras.
- **Primary (#6ba5f8 escuro / #1f6feb claro):** acento único — botão "+ Mapa", item ativo da árvore, nó raiz do
  mapa, foco de teclado, barra de seleção do minimapa. Nada mais é colorido, exceto os dois estados semânticos.
- **Warn / Danger:** usado apenas em estado (alterações não salvas, erro) e em hover destrutivo.

## Typography

`JetBrains Mono` em todo o chrome (fallback `Cascadia Code`, `Consolas`, `ui-monospace`), porque a referência é
monoespaçada e porque o produto é de teclado. O lockup da marca é `Outfit` 700 (a fonte do site sacadaweb.com.br).
O texto do mapa (canvas, organograma e exportações) usa a mesma monoespaçada, herdada das constantes de tema no
renderer. As duas famílias vão embutidas em `out/renderer/assets/fonts` (licenças OFL ao lado).

## Layout

Grade de três colunas: barra lateral de 288px + área de trabalho fluida + painel de nota de 300px, com uma barra
de 52px no topo da área de trabalho. A barra lateral é **recolhível**: recolhida vira um rail de 52px com o
alternador e o botão de novo mapa (atalho `Ctrl+B`, estado guardado em `localStorage`). O canvas recebe `resize`
depois da transição para o mapa se reajustar.

Toda a escala de espaçamento vem de `--space-1..7` (4/8/12/16/20/28/44) e nada usa valor solto.

## Elevation & Depth

Plano. Profundidade vem de contraste de fio e de um degrau de superfície, nunca de sombra. Só superfícies
flutuantes (menu Exportar, minimapa, barra de busca, toolbar de nó, dialogs, toasts) recebem uma sombra suave.

## Shapes

`rounded.md` (8px) para controles interativos, `rounded.lg` (12px) para cards, menus e dialogs, `rounded.full`
para chips e contadores, `rounded.sm` (4px) para keycaps e botões da árvore. Radii descem com o aninhamento:
12px no contêiner, 8px no que fica dentro dele.

## Components

- **Botões:** `button-primary` sólido para a ação de compromisso da vista (hoje só "+ Mapa"); `button-ghost`
  (surface + fio) para o resto; botões só de ícone são quadrados de 32px.
- **Barra de ferramentas:** grupos separados por fio de 1px, botões de 32px, `aria-pressed` em acento suave.
  Em janelas estreitas (<=1360px) o rótulo de "Exportar" some e o seletor de layout encolhe, para o título do
  mapa continuar legível; título truncado expõe o nome completo no hover.
- **Chips:** `status-chip` para o estado de gravação ("Salvo", "Salvando…", "Alterações não salvas"); chips de
  tag são de contorno, chips de contagem são preenchidos.
- **Árvore de mapas:** linhas de 8px de raio, hover em surface, item ativo em `accent-soft` com ícone e texto no
  acento; ferramentas da linha aparecem no hover/foco (seguem focáveis por teclado). Os ícones saem da fábrica
  do próprio renderer (traço 1.5, `currentColor`, 16px, sem preenchimento) — nada de emoji no chrome; os emojis
  do roteiro de POP (`📄 ⚠️ 🔴 ✅ 📎`) são conteúdo, não chrome. Arrastar uma linha sobre uma pasta (ou sobre a
  área vazia, para a raiz) move o item: a origem fica `dragging`, o alvo `drop-into` e o alvo inválido
  `drop-forbidden`. O mesmo movimento tem caminho sem mouse pela ferramenta "Mover para…".
- **Motion:** 160ms em cor, fio e fundo; 1px de deslocamento no `:active`; nada mais. `prefers-reduced-motion`
  desliga tudo.

## Palco de desenho

O palco do mapa mental aceita uma **camada de anotação** (formas geométricas, símbolos de fluxo, setas e
conectores, marcadores do POP, texto e nota) desenhada sobre a árvore e guardada no próprio arquivo, com a
mesma linguagem do resto: superfície elevada, ícones de traço 1.5, um único acento.

- **Barra flutuante** no rodapé do palco (arrastável), com cinco grupos em flyout — Formas, Fluxo, Linhas,
  Marcadores, Anotação — e as ações de agrupar, duplicar, ordem e excluir. O botão do grupo assume o ícone da
  ferramenta ativa; a ferramenta ativa fica em `accent-soft` com o acento no ícone.
- **Atalhos**: `V` selecionar · `R` retângulo · `O` elipse · `D` losango · `L` linha · `A` seta · `C` conector ·
  `T` texto · `N` nota · `P` ponto · `M` crítico; `Del` exclui (levando os conectores ancorados), setas movem
  1px (`Shift` = 10px), `Ctrl+D` duplica, `Ctrl+G` agrupa, `Ctrl+]`/`Ctrl+[` ordem, `Esc` volta para a seleção,
  `Ctrl+Z`/`Ctrl+Y` desfazem e refazem.
- **Seleção**: contorno tracejado no acento, oito alças de redimensionar, alça de rotação (`Shift` = 15°) e três
  alças de conexão. O laço de seleção é `Shift`+arrastar no vazio, para não roubar o arraste/pan do mapa.
- **Posse do teclado**: com um nó do mapa selecionado (e nenhuma anotação por perto), `Del`, setas e `Ctrl+Z`
  continuam sendo do mapa; a camada só consome o que é dela, e nunca com editor de texto aberto. As letras de
  ferramenta (`R`, `O`, `C`…) têm precedência sobre o "digitar uma letra cria um nó" do editor — criar filho e
  irmão continua em `Tab`/`Enter`, e esse é o preço consciente de ter atalho de ferramenta sem modificador.
  Cuidado ao mexer no guarda de edição: o SDK deixa `.smm-node-edit-wrap` no DOM com `display: none` depois de
  confirmar a edição, então **presença não é edição** — checar visibilidade, senão a camada morre pelo resto da
  sessão depois da primeira edição de texto de nó.
- **Conectores ancorados**: uma ponta pode apontar para um nó da árvore (`{ node, anchor }`) ou para um ponto
  livre; o ponto na borda do nó é **derivado no desenho**, nunca gravado, então o conector acompanha relayout,
  movimento e abertura de subárvore sem reescrever o arquivo. Nó removido não apaga o conector: ele fica no
  último ponto conhecido, tracejado e mais claro (`is-orphan`), com a âncora órfã preservada no dado.
- **Conteúdo x chrome**: a pintura dos itens é **inline**, resolvida dos tokens na hora de desenhar, porque o
  SVG exportado é serializado fora do documento e não carrega a folha de estilo; o chrome de edição (camada,
  alças, guias, laço, paleta, painel de propriedades) vive em classes CSS. Trocar de tema redesenha a camada.
- **Persistência e export**: `annotations: { version, items }` no `.swmap.json` (chave ausente = sem desenho),
  com **nome de token** no dado e hex só no markup gerado. O desenho sai no PNG/PDF do mapa mental pela injeção
  no `handleBeingExportSvg` da lib, viaja no arquivo de compartilhar e faz a moldura do export crescer para
  caber. O organograma entra na fatia seguinte (mesma camada, export pelo SVG do próprio app).

## Onde o design vive no código

| Camada | Arquivo | O que muda ali |
|---|---|---|
| Tokens + polimento de UI | `resources/app/out/renderer/assets/sacadaweb.css` | paletas claro/escuro, fontes, componentes, rail recolhido, responsivo |
| Comportamento | `resources/app/out/renderer/assets/sacadaweb.js` | recolher/expandir a barra lateral, persistência, atalho, tooltip do título |
| Marca (lockup do PDF) | `resources/app/out/renderer/assets/brand.js` | data URL gerado por `tools/pack-brand.py` |
| Tema do mapa/organograma e exportações | `resources/app/out/renderer/assets/index-*.js` | constantes `FONT`, `themeConfig`, `TIER_FILLS`, `THEME_COLORS`, `STYLES` |
| Casca e janela | `resources/app/out/main/index.js` | título, ícone, tema padrão, extensão de arquivo, mensagens |

O CSS de origem (`index-*.css`) não é editado: `sacadaweb.css` carrega depois e sobrescreve tokens e componentes.

## Do's and Don'ts

- Do keep exactly one accent color; warn/danger are the only exceptions.
- Do keep the density: 52px bar, 32px controls, 13px mono chrome.
- Do give every primary action a keyboard path (a barra lateral tem `Ctrl+B`).
- Don't add gradients, glows or drop shadows to static surfaces.
- Don't use color alone to encode state; always pair it with a label.
- Don't edit `index-*.css` or minify `sacadaweb.css`: a camada de design é o único lugar de estilo.
