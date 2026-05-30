/* ============================================================
   Carte fidélité MDL — logique PWA
   ============================================================ */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // --- Éléments ---
  const cardWrap     = $("card-wrap");
  const nomEl        = $("card-nom");
  const prenomEl     = $("card-prenom");
  const pointsEl     = $("card-points");
  const reductionEl  = $("card-reduction");
  const codeEl       = $("card-code");
  const barcodeImg   = $("card-barcode-img");
  const barcodeTap   = $("barcode-tap");
  const walletIcon   = $("wallet-icon");
  const refreshIcon  = $("refresh-icon");
  const statusEl     = $("status");
  const netStatus    = $("net-status");
  const codeEntry    = $("code-entry");
  const codeInput    = $("code-input");
  const codeSubmit   = $("code-submit");
  const bcOverlay    = $("bc-overlay");
  const bcOverlayImg = $("bc-overlay-img");
  const bcOverlayCode= $("bc-overlay-code");

  // --- Résolution du code adhérent ---
  // Priorité au code de l'URL (lien du mail), sinon dernier code mémorisé.
  const params  = new URLSearchParams(location.search);
  const fromUrl = (params.get("code") || "").trim();
  let code = fromUrl || localStorage.getItem("mdl_last_code") || "";
  if (fromUrl) localStorage.setItem("mdl_last_code", fromUrl);

  // ============================================================
  // Thème clair / sombre
  // ============================================================
  (() => {
    const toggle = $("theme-toggle");
    if (localStorage.getItem("mdl_theme") === "dark") {
      document.body.classList.add("dark");
      toggle.textContent = "\u2600\uFE0F";
    }
    toggle.addEventListener("click", () => {
      const dark = document.body.classList.toggle("dark");
      toggle.textContent = dark ? "\u2600\uFE0F" : "\uD83C\uDF19";
      localStorage.setItem("mdl_theme", dark ? "dark" : "light");
    });
  })();

  // ============================================================
  // Helpers de formatage
  // ============================================================
  function fmtEuro(v) {
    if (v === null || v === undefined || v === "" || v === "\u2014") return "0,00 \u20AC";
    const n = Number(String(v).replace("\u20AC", "").replace(",", ".").trim());
    if (Number.isFinite(n)) return n.toFixed(2).replace(".", ",") + " \u20AC";
    return String(v);
  }
  function fmtPoints(v) {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "0";
  }

  // Sépare nom/prénom si le serveur ne renvoie encore qu'un fullname
  function splitName(data) {
    let nom = (data && data.nom) ? String(data.nom) : "";
    let prenom = (data && data.prenom) ? String(data.prenom) : "";
    if (!nom && !prenom && data && data.fullname) {
      // Fallback : on met tout sur la ligne "Nom" en attendant le patch serveur
      nom = String(data.fullname);
    }
    return { nom, prenom };
  }

  // ============================================================
  // Rendu de la carte
  // ============================================================
  function renderCard(data) {
    if (!code) return;
    cardWrap.hidden = false;
    codeEntry.hidden = true;

    const { nom, prenom } = splitName(data);
    nomEl.textContent       = nom;
    prenomEl.textContent    = prenom;
    pointsEl.textContent    = fmtPoints(data && data.points);
    reductionEl.textContent = fmtEuro(data && data.reduction);
    codeEl.textContent      = code;

    const wanted = "/barcode/" + encodeURIComponent(code);
    if (barcodeImg.getAttribute("src") !== wanted) barcodeImg.src = wanted;

    walletIcon.href = "/wallet/" + encodeURIComponent(code);
  }

  function cacheCard(data) {
    try { localStorage.setItem("mdl_card_" + code, JSON.stringify(data)); } catch (_) {}
  }
  function readCachedCard() {
    try {
      const raw = localStorage.getItem("mdl_card_" + code);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ============================================================
  // Rafraîchissement depuis le serveur
  // ============================================================
  let refreshing = false;

  async function refreshCard() {
    if (!code || refreshing) return;
    refreshing = true;
    refreshIcon.querySelector("svg")?.classList.add("spin");

    try {
      const res  = await fetch("/api/get-card/" + encodeURIComponent(code), { cache: "no-store" });
      const data = await res.json();

      if (data && data.ok) {
        renderCard(data);
        cacheCard(data);
        statusEl.textContent = "\u2705 \u00C0 jour \u2014 " + new Date().toLocaleTimeString();
      } else {
        if (!readCachedCard()) {
          cardWrap.hidden = true;
          codeEntry.hidden = false;
          statusEl.textContent = "\u26A0\uFE0F Carte introuvable. V\u00E9rifie ton code.";
        } else {
          statusEl.textContent = "\u26A0\uFE0F Carte introuvable c\u00F4t\u00E9 serveur.";
        }
      }
    } catch (_) {
      const cached = readCachedCard();
      if (cached) {
        renderCard(cached);
        statusEl.textContent = "\uD83D\uDCA4 Hors-ligne \u2014 derni\u00E8re carte connue affich\u00E9e.";
      } else {
        statusEl.textContent = "\uD83D\uDCA4 Hors-ligne \u2014 aucune carte enregistr\u00E9e pour l'instant.";
      }
    } finally {
      refreshing = false;
      setTimeout(() => refreshIcon.querySelector("svg")?.classList.remove("spin"), 800);
    }
  }

  refreshIcon.addEventListener("click", refreshCard);

  // ============================================================
  // Overlay plein écran du code-barres (scan facile en caisse)
  // ============================================================
  barcodeTap.addEventListener("click", () => {
    if (!code) return;
    bcOverlayImg.src = "/barcode/" + encodeURIComponent(code);
    bcOverlayCode.textContent = code;
    bcOverlay.hidden = false;
  });
  bcOverlay.addEventListener("click", () => { bcOverlay.hidden = true; });

  // ============================================================
  // Saisie manuelle du code
  // ============================================================
  function submitCode() {
    const v = (codeInput.value || "").trim();
    if (!v) return;
    code = v;
    localStorage.setItem("mdl_last_code", v);
    statusEl.textContent = "\u23F3 Recherche\u2026";
    refreshCard();
  }
  codeSubmit.addEventListener("click", submitCode);
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitCode(); });

  // ============================================================
  // État réseau
  // ============================================================
  function updateNet() {
    if (navigator.onLine) {
      netStatus.textContent = "\uD83D\uDFE2 En ligne";
      netStatus.classList.remove("offline");
    } else {
      netStatus.textContent = "\uD83D\uDD34 Hors ligne";
      netStatus.classList.add("offline");
    }
  }
  window.addEventListener("online", () => { updateNet(); refreshCard(); });
  window.addEventListener("offline", updateNet);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshCard();
  });

  // ============================================================
  // Démarrage
  // ============================================================
  updateNet();

  if (code) {
    const cached = readCachedCard();
    if (cached) renderCard(cached);
    refreshCard();
  } else {
    codeEntry.hidden = false;
  }

  // ============================================================
  // Service worker
  // ============================================================
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
