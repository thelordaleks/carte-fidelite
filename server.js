"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bwipjs = require("bwip-js");

const app = express();
app.set("trust proxy", true);

// ===== Config
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET; // OBLIGATOIRE sur Render
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || path.join(__dirname, "static", "template.html");

// ===== Middlewares
app.use(express.json({ limit: "256kb" }));
app.use("/static", express.static(path.join(__dirname, "static"), { maxAge: "1y", etag: true }));

// ===== Helpers
function fillTpl(tpl, map) {
  let out = tpl;
  for (const [k, v] of Object.entries(map)) out = out.split(`{{${k}}}`).join(String(v ?? ""));
  return out;
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
// URL utilisée DANS LES MAILS (Render uniquement)
function baseUrlForEmails() {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME; // fourni par Render
  if (host) return `https://${host}`;
  // fallback dev local seulement
  return `http://localhost:${PORT}`;
}
// URL basée sur la requête courante (utile pour l’image code‑barres)
function baseUrlFromRequest(req) {
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0] || (host?.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
function euroCentsToString(cents) {
  if (cents == null || cents === "") return "";
  const n = Number(cents) / 100;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

// ===== Template (HTML/CSS prêt à l’emploi)
let templateHtml = fs.readFileSync(TEMPLATE_FILE, "utf8");

// ===== API: création du lien signé (utilisé par Excel/Outlook)
app.post("/api/create-card", (req, res) => {
  try {
    if (!SECRET) {
      return res.status(500).json({ error: "SECRET manquant (à définir dans Render > Environment)" });
    }
    const body = req.body || {};
    // Normalisation champs
    const payload = {
      firstName: body.firstName ?? body.prenom ?? "",
      lastName: body.lastName ?? body.nom ?? "",
      email: body.email ?? "",
      code: body.code ?? "",
      points: body.points ?? "",
      reduction: body.reduction ?? undefined,
      reduction_cents: body.reduction_cents ?? undefined
    };

    // JWT SANS expiration pour éviter “expiré” dans les mails anciens
    const token = jwt.sign(payload, SECRET);

    // Lien 100% Render (jamais localhost)
    const url = `${baseUrlForEmails()}/card/t/${token}`;

    return res.json({ url, token });
  } catch (err) {
    console.error("[/api/create-card] error:", err);
    res.status(500).json({ error: "Erreur interne" });
  }
});

// ===== Page carte: affiche à partir du token
app.get("/card/t/:token", (req, res) => {
  if (!SECRET) {
    return res.status(500).type("html").send("<h1>SECRET manquant sur le serveur</h1>");
  }
  try {
    const data = jwt.verify(req.params.token, SECRET);

    const base = baseUrlFromRequest(req);
    const code = String(data.code || "");
    const barcodeUrl = `${base}/barcode/${encodeURIComponent(code)}.png?width=640&height=150`;

    const html = fillTpl(templateHtml, {
      PRENOM: escapeHtml(data.firstName || ""),
      NOM: escapeHtml(data.lastName || ""),
      EMAIL: escapeHtml(data.email || ""),
      CODE: escapeHtml(code),
      POINTS: escapeHtml(data.points ?? ""),
      REDUCTION: escapeHtml(
        data.reduction != null ? String(data.reduction) : euroCentsToString(data.reduction_cents)
      ),
      BARCODE_URL: barcodeUrl
    });

    res.type("html").send(html);
  } catch (e) {
    console.error("[/card/t/:token] verify error:", e?.name, e?.message);
    const msg =
      e?.name === "TokenExpiredError" ? "Token expiré" :
      e?.name === "JsonWebTokenError" ? "Token invalide" :
      "Token invalide ou expiré";
    res.status(400).type("html").send(`<h1>${msg}</h1>`);
  }
});

// ===== Image code‑barres
app.get("/barcode/:code.png", async (req, res) => {
  try {
    const code = String(req.params.code || "");
    const width = Math.max(200, Math.min(2000, parseInt(req.query.width || "640", 10)));
    const height = Math.max(50, Math.min(600, parseInt(req.query.height || "150", 10)));

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      width,
      height,
      includetext: false,
      textxalign: "center"
    });

    res.type("png").send(png);
  } catch (err) {
    console.error("[/barcode] error:", err);
    res.status(400).type("text/plain").send("Erreur génération code‑barres");
  }
});

// ===== Diagnostics simples
app.get("/_diag", (req, res) => {
  res.json({
    ok: true,
    render_host: process.env.RENDER_EXTERNAL_HOSTNAME || null,
    has_secret: !!SECRET,
    template_file: TEMPLATE_FILE
  });
});

app.get("/", (req, res) => {
  res.type("text/plain").send("OK - utilisez POST /api/create-card pour obtenir l’URL de la carte.");
});

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur port ${PORT}`);
  if (!SECRET) console.warn("⚠️ SECRET non défini — ajoutez-le sur Render (Environment).");
  if (!process.env.RENDER_EXTERNAL_HOSTNAME) console.warn("ℹ️ RENDER_EXTERNAL_HOSTNAME non détecté (OK en local).");
});
