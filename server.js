// ======== Dépendances ========
const express = require("express");
const path = require("path");
const fs = require("fs");
const bwipjs = require("bwip-js");

// jsonwebtoken est optionnel: on ne plante pas si non installé
let jwt = null;
try { jwt = require("jsonwebtoken"); } catch { /* noop */ }

// ======== Configuration ========
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "dev-secret-change-me";

// ======== Middlewares ========
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static"))); // mets carte-mdl.png ici

// ======== Helpers ========
// Récupère une query num (ex: ybar=42) avec défaut si NaN
function num(q, def) {
  const v = Number(q);
  return Number.isFinite(v) ? v : def;
}
// Construit l'objet "carte" depuis token JWT ou query
function buildCarteFromTokenOrQuery(req, token) {
  let payload = {};
  if (jwt && token) {
    try { payload = jwt.verify(token, SECRET); } catch { /* token invalide */ }
  }
  const carte = {
    prenom: (req.query.prenom ?? payload.prenom ?? "").toString(),
    nom: (req.query.nom ?? payload.nom ?? "").toString(),
    code: (req.query.code ?? payload.code ?? token ?? "").toString(),
  };
  return carte;
}

// ======== Routes ========

// Accueil simple
app.get("/", (_req, res) => {
  res.send(`<!doctype html><meta charset="utf-8">
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:0;padding:40px;color:#1c2434}</style>
  <h2>✅ Serveur MDL en ligne</h2>
  <ul>
    <li>Carte via JWT: <code>/card/t/&lt;token&gt;</code></li>
    <li>Carte legacy: <code>/card/legacy/&lt;id&gt;?prenom=...&amp;nom=...</code></li>
    <li>Barcode: <code>/barcode/&lt;code&gt;?scale=4&amp;height=12&amp;text=1</code> (texte intégré off par défaut)</li>
  </ul>`);
});

// --------- Générateur de code-barres PNG ---------
app.get("/barcode/:code", async (req, res) => {
  const code = (req.params.code || "").toString();
  const scale = num(req.query.scale, 4);     // densité
  const height = num(req.query.height, 12);  // hauteur barres (en "lignes")
  const textsize = num(req.query.textsize, 12);
  const includeText = req.query.text === "1"; // par défaut: pas de texte intégré

  if (!code) return res.status(400).send("Missing code");

  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128",     // type
      text: code,
      scale: scale,        // 3..6
      height: height,      // 10..20
      includetext: includeText,
      textxalign: "center",
      textsize: textsize,
      textyoffset: 2,
      backgroundcolor: "FFFFFF",
      paddingwidth: 0,
      paddingheight: 0,
    });
    res.type("png").send(png);
  } catch (e) {
    console.error("bwip error:", e);
    res.status(500).send("barcode generation failed");
  }
});

// --------- Carte via TOKEN (JWT si dispo) ---------
app.get("/card/t/:token", (req, res) => {
  const carte = buildCarteFromTokenOrQuery(req, req.params.token);

  // Valeurs par défaut + overrides via query
  const cssVars = {
    ybar: num(req.query.ybar, 42),
    yprenom: num(req.query.yprenom, 74),
    ynom: num(req.query.ynom, 84),
    xpad: num(req.query.xpad, 7),
    barleft: num(req.query.barleft, 8),
    barright: num(req.query.barright, 8),
    bars: num(req.query.bars, 4),
    barh: num(req.query.barh, 12),
    bartxt: num(req.query.bartxt, 12),
  };

  res.send(renderCarteHTML(carte, cssVars));
});

// --------- Carte legacy (sans JWT) ---------
app.get("/card/legacy/:id", (req, res) => {
  const carte = {
    prenom: (req.query.prenom || "").toString(),
    nom: (req.query.nom || "").toString(),
    code: (req.query.code || req.params.id || "").toString(),
  };

  const cssVars = {
    ybar: num(req.query.ybar, 42),
    yprenom: num(req.query.yprenom, 74),
    ynom: num(req.query.ynom, 84),
    xpad: num(req.query.xpad, 7),
    barleft: num(req.query.barleft, 8),
    barright: num(req.query.barright, 8),
    bars: num(req.query.bars, 4),
    barh: num(req.query.barh, 12),
    bartxt: num(req.query.bartxt, 12),
  };

  res.send(renderCarteHTML(carte, cssVars));
});

// ======== Lancement ========
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  if (jwt) console.log("✅ jsonwebtoken présent"); else console.log("ℹ️ jsonwebtoken non installé — /card/t utilisera surtout la query");
});

// ======== Template HTML/CSS/JS ========
function renderCarteHTML(carte, vars) {
  // échappes simples
  const esc = (s) => String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const prenom = esc(carte.prenom);
  const nom = esc(carte.nom);
  const code = esc(carte.code);

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  --maxw: 600px;

  /* Positions par défaut (en %) — ajustables par URL */
  --y-bar: ${vars.ybar}%;
  --y-prenom: ${vars.yprenom}%;
  --y-nom: ${vars.ynom}%;

  /* Marges latérales et largeur du code-barres */
  --x-pad: ${vars.xpad}%;
  --bar-left: ${vars.barleft}%;
  --bar-right: ${vars.barright}%;

  /* Taille du code-barres */
  --bar-scale: ${vars.bars};
  --bar-height: ${vars.barh};
  --bar-textsize: ${vars.bartxt};

  /* Style textes */
  --prenom-size: clamp(18px, 5vw, 36px);
  --nom-size:    clamp(20px, 5.6vw, 40px);
  --human-size:  clamp(12px, 2.6vw, 16px);
}
*{box-sizing:border-box}
body{
  margin:0; background:#f6f7f9;
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  min-height:100svh; display:flex; align-items:center; justify-content:center; padding:16px;
  color:#1c2434;
}
.wrap{
  width:min(92vw, var(--maxw));
  background:#fff; border-radius:20px; padding:16px;
  box-shadow:0 6px 24px rgba(0,0,0,.10);
}
.carte{
  position:relative; width:100%;
  background:#fff url('/static/carte-mdl.png') center/cover no-repeat;
  border-radius:16px; overflow:hidden;
  aspect-ratio: 5 / 3;
}
.overlay{ position:absolute; inset:0; padding:6% var(--x-pad); }
.line{
  position:absolute; left:var(--bar-left); right:var(--bar-right);
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
  overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
}
.barcode{ top: var(--y-bar); }
.code-wrap{ width:100%; }
.code-wrap img{
  width:100%; height:auto; display:block;
  max-height: min(22vh, 28%); /* garde-fou */
}
.code-human{
  text-align:center; margin-top:4px; color:#1a2740; font-weight:600;
  font-size: var(--human-size);
  letter-spacing: .06em;
}
.prenom{
  top: var(--y-prenom);
  font-weight:800; font-size: var(--prenom-size); color:#1a2740;
}
.nom{
  top: var(--y-nom);
  font-weight:900; font-size: var(--nom-size); color:#0d2a4a;
}
.grid-guide{position:absolute;inset:0;pointer-events:none;display:none;background:
  linear-gradient(to right, rgba(0,0,0,.08) 1px, transparent 1px) 0 0/10% 100%,
  linear-gradient(to bottom, rgba(0,0,0,.08) 1px, transparent 1px) 0 0/100% 10%;
}
.grid-guide.on{display:block}
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte">
      <div class="overlay">
        <div class="line barcode">
          <div class="code-wrap">
            <img id="barcode-img" alt="Code-barres" loading="eager" decoding="async"/>
            <div id="barcode-human" class="code-human"></div>
          </div>
        </div>
        <div class="line prenom">${prenom}</div>
        <div class="line nom">${nom.toUpperCase()}</div>
      </div>
      <div id="grid-guide" class="grid-guide"></div>
    </div>
    <div class="foot" style="margin-top:12px;text-align:center;color:#5b6575;font-size:13px">
      MDL — Carte de fidélité
    </div>
  </div>

<script>
(function(){
  const code = ${JSON.stringify(code)};
  const img = document.getElementById('barcode-img');
  const codeHuman = document.getElementById('barcode-human');

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const styles = getComputedStyle(document.documentElement);
  const scale = Number(styles.getPropertyValue('--bar-scale')) || 4;
  const height = Number(styles.getPropertyValue('--bar-height')) || 12;
  const textsize = Number(styles.getPropertyValue('--bar-textsize')) || 12;

  const params = new URLSearchParams({
    scale: String(scale + Math.max(0, dpr-1)),
    height: String(height),
    text: "0",          // pas de texte intégré
    textsize: String(textsize)
  });

  img.src = '/barcode/' + encodeURIComponent(code) + '?' + params.toString();
  codeHuman.textContent = code || '';

  // G = grille
  window.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase()==='g'){
      document.getElementById('grid-guide').classList.toggle('on');
    }
  });
})();
</script>
</body>
</html>`;
}
