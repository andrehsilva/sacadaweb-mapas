/* ============================================================================
   SacadaWeb - Mapas :: comportamento da camada de design
   - barra lateral expansivel/recolhivel (persistida, com atalho Ctrl+B)
   Nao toca no estado do app: apenas alterna uma classe no <body> e avisa o
   canvas (resize) para o mapa se reajustar.
   ========================================================================== */
(() => {
  const STORAGE_KEY = "sacadaweb:sidebar-collapsed";
  const COLLAPSED_CLASS = "sidebar-collapsed";
  const TRANSITION_MS = 180;

  const sidebar = document.getElementById("sidebar");
  const header = sidebar?.querySelector(".sidebar-header");
  if (!sidebar || !header) return;

  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    collapsed = false;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "btn-sidebar-toggle";
  toggle.className = "sidebar-toggle";
  toggle.setAttribute("aria-controls", "sidebar");
  toggle.innerHTML =
    '<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="15 6 9 12 15 18" /></svg>';
  const brand = header.querySelector(".brand");
  if (brand) brand.after(toggle);
  else header.append(toggle);

  const notifyCanvas = () => {
    window.dispatchEvent(new Event("resize"));
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), TRANSITION_MS);
  };

  const render = () => {
    document.body.classList.toggle(COLLAPSED_CLASS, collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const label = collapsed ? "Expandir barra lateral (Ctrl+B)" : "Recolher barra lateral (Ctrl+B)";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
  };

  const setCollapsed = (next) => {
    if (next === collapsed) return;
    collapsed = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      /* sem persistencia: o estado ainda vale nesta sessao */
    }
    render();
    notifyCanvas();
  };

  toggle.addEventListener("click", () => setCollapsed(!collapsed));

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key.toLowerCase() !== "b") return;
    event.preventDefault();
    setCollapsed(!collapsed);
  });

  render();

  // o titulo do mapa truncado expoe o nome completo no hover
  const mapTitle = document.getElementById("map-title");
  if (mapTitle) {
    const syncTitle = () => {
      if (mapTitle.scrollWidth > mapTitle.clientWidth) mapTitle.title = mapTitle.textContent.trim();
      else mapTitle.removeAttribute("title");
    };
    new MutationObserver(syncTitle).observe(mapTitle, {
      childList: true,
      characterData: true,
      subtree: true
    });
    window.addEventListener("resize", syncTitle);
    toggle.addEventListener("click", () => window.setTimeout(syncTitle, TRANSITION_MS + 40));
    syncTitle();
  }
})();
