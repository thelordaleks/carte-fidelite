// ======== Dépendances ========
const express = require("express");
const path = require("path");
const bwipjs = require("bwip-js");

// jsonwebtoken optionnel
let jwt = null;
try { jwt = require("jsonwebtoken"); } catch { /* noop */ }

// ======== Configuration ========
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || "dev-secret-change-me";
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/+$/,""); // ex: "" ou "/mdl"

// URL publique (Render): BASE_URL > RENDER_EXTERNAL_HOSTNAME > fallback local
const PUBLIC_HOST = process.env.BASE_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:${PORT}`);

app.set("trust proxy", 1); // Render est derrière un proxy

// ======== Middlewares ========
app.use(express.json());
app.use(BASE_PATH + "/static", express.static(path.join(__dirname, "static"))); // mets carte-mdl.png ici

// ======== Helpers ========
const num = (q, d) => (Number.isFinite(Number(q)) ? Number(q) : d);

function buildCarteFromTokenOrQuery(req, token) {
  let payload = {};
  if (jwt && token) {
    try { payload = jwt.verify(token, SECRET); } catch {}
  }
  return {
    prenom: (req.query.prenom ?? payload.prenom ?? "").toString(),
    nom: (req.query.nom ?? payload.nom ?? "").toString(),
    code: (req.query.code ?? payload.code ?? token ?? "").toString(),
  };
}

// Construit un chemin absolu serveur (respecte BASE_PATH)
const absPath = (p) => (BASE_PATH ? BASE_PATH : "") + (p.startsWith("/") ? p : "/" + p);

// ======== HTML Carte ========
function renderCarteHTML({ prenom, nom, code }) {
  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carte MDL</title>
<style>
:root{ --y-barcode:40%; --y-prenom:76%; --y-nom:86%; --bar-scale:4; --bar-height:12; --bar-textsize:12;
       --prenom-size: clamp(18px,3.4vw,28px); --nom-size: clamp(22px,4.2vw,34px); }
*{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Arial;background:#f3f5f9;color:#1c2434}
.wrap{min-height:100dvh;display:grid;place-items:center;padding:16px}
.carte{width:min(92vw,540px);aspect-ratio:86/54;position:relative;border-radius:14px;overflow:hidden;
       box-shadow:0 8px 30px rgba(0,20,60,.12);
       background:#fff url(${JSON.stringify(absPath("/static/carte-mdl.png"))}) center/cover no-repeat;}
.overlay{position:absolute;inset:0}
.line{position:absolute;left:6%;width:88%;transform:translateY(-50%)}
.barcode{top:var(--y-barcode)}
.code-human{margin-top:4px;font:600 14px ui-monospace,Consolas,monospace;color:#1e2b3c}
.prenom{top:var(--y-prenom);font-weight:700;font-size:var(--prenom-size);color:#1e2b3c}
.nom{top:var(--y-nom);font-weight:900;font-size:var(--nom-size);color:#0d2a4a}
.grid-guide{position:absolute;inset:0;display:none;pointer-events:none;background:
  linear-gradient(to right, rgba(0,0,0,.08) 1px, transparent 1px) 0 0/10% 100%,
  linear-gradient(to bottom, rgba(0,0,0,.08) 1px, transparent 1px) 0 0/100% 10%;}
.grid-guide.on{display:block}
.foot{margin-top:12px;text-align:center;color:#5b6575;font-size:13px}
</style></head>
<body>
<div class="wrap">
  <div class="carte">
    <div class="overlay">
      <div class="line barcode">
        <div style="display:flex;flex-direction:column;align-items:center">
          <img id="barcode-img" alt="Code-barres" loading="eager" decoding="async"/>
          <div id="barcode-human" class="code-human"></div>
        </div>
      </div>
      <div class="line prenom">${prenom ? String(prenom) : ""}</div>
      <div class="line nom">${nom ? String(nom).toUpperCase() : ""}</div>
    </div>
    <div id="grid-guide" class="grid-guide"></div>
  </div>
  <div class="foot">MDL — Carte de fidélité</div>
</div>

<script>
(function(){
  const code = ${JSON.stringify(code || "")};
  const img = document.getElementById('barcode-img');
  const codeHuman = document.getElementById('barcode-human');

  const styles = getComputedStyle(document.documentElement);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = Number(styles.getPropertyValue('--bar-scale')) || 4;
  const height = Number(styles.getPropertyValue('--bar-height')) || 12;
  const textsize = Number(styles.getPropertyValue('--bar-textsize')) || 12;

  const params = new URLSearchParams({
    scale: String(scale + Math.max(0, dpr-1)),
    height: String(height),
    text: "0",
    textsize: String(textsize)
  });

  img.src = ${JSON.stringify(absPath("/barcode/"))} + encodeURIComponent(code) + '?' + params.toString();
  codeHuman.textContent = code || '';

  window.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase()==='g'){
      document.getElementById('grid-guide').classList.toggle('on');
    }
  });
})();
</script>
</body></html>`;
}

// ======== Routes ========
app.get(BASE_PATH + "/", (_req, res) => {
  res.send(`<!doctype html><meta charset="utf-8">
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:0;padding:32px}</style>
  <h2>✅ Serveur MDL en ligne (Render)</h2>
  <p>URL publique détectée: <code>${PUBLIC_HOST}${BASE_PATH}</code></p>
  <ul>
    <li>Carte (JWT): <code>${BASE_PATH}/card/t/&lt;token&gt;</code></li>
    <li>Carte legacy: <code>${BASE_PATH}/card/legacy/&lt;id&gt;?prenom=...&amp;nom=...</code></li>
    <li>Barcode PNG: <code>${BASE_PATH}/barcode/&lt;code&gt;</code></li>
    <li>Health: <code>${BASE_PATH}/health</code></li>
  </ul>`);
});

// PNG Code128
app.get(BASE_PATH + "/barcode/:code", async (req, res) => {
  const code = String(req.params.code || "");
  const scale = num(req.query.scale, 4);
  const height = num(req.query.height, 12);
  const textsize = num(req.query.textsize, 12);
  const includeText = req.query.text === "1";
  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      scale, height,
      includetext: includeText,
      textxalign: "center",
      textsize, textcolor: "1E2B3C",
      backgroundcolor: "FFFFFF",
      paddingwidth: 6, paddingheight: 6,
    });
    res.type("png").send(png);
  } catch (e) {
    console.error("Barcode error:", e);
    res.status(400).send("Barcode generation error");
  }
});

// Carte via token (JWT)
app.get(BASE_PATH + "/card/t/:token", (req, res) => {
  const { token } = req.params;
  const carte = buildCarteFromTokenOrQuery(req, token);
  res.send(renderCarteHTML(carte));
});

// Carte legacy
app.get(BASE_PATH + "/card/legacy/:id", (req, res) => {
  const { id } = req.params;
  const carte = { prenom: String(req.query.prenom || ""), nom: String(req.query.nom || ""), code: String(id) };
  res.send(renderCarteHTML(carte));
});

// Health + 404 logger
app.get(BASE_PATH + "/health", (_req, res) => res.send("OK"));
app.use((req, res, next) => {
  console.warn("404:", req.method, req.originalUrl, "ref:", req.get("referer"));
  res.status(404).send("Not Found");
});

// ======== Démarrage ========
app.listen(PORT, () => {
  // Log propre pour Render
  console.log(`🚀 Serveur démarré: ${PUBLIC_HOST}${BASE_PATH || ""}`);
});
