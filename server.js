// ======== Affichage carte — LIEN SIGNÉ (recommandé) ========
app.get("/card/t/:token", (req, res) => {
  let carte;
  try {
    carte = jwt.verify(req.params.token, SECRET);
  } catch {
    return res.status(404).send("<h1>Carte introuvable ❌</h1>");
  }

  const prenom = (carte.prenom || "").trim();
  const nom = (carte.nom || "").trim();
  const code = (carte.code || "").trim();
  const points = (carte.points ?? "").toString().trim();
  const reduction = (carte.reduction ?? "").toString().trim();

  const bg = (req.query.bg || "").toLowerCase() === "mail" ? "carte-mdl-mail.png" : "carte-mdl.png";
  const debug = req.query.debug === "1";

  // Petite protection XSS côté serveur
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const nomUpper = nom.toUpperCase();

  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carte de fidélité MDL</title>
<style>
:root{
  --maxw: 980px;

  /* positions (% du conteneur) */
  --y-bar:    36%;
  --y-nom:    66%;
  --y-prenom: 76%;
  --y-points: 83%;
  --y-reduc:  83%;

  --x-nom:     24%;
  --x-prenom:  24%;
  --r-nom:     35%;
  --r-prenom:  35%;

  --x-points:  26%;
  --w-points:  17%;
  --x-reduc:   45%;
  --w-reduc:   17%;

  --bar-l: 8%;
  --bar-r: 8%;
  --ty-nom:   -51%;
  --ty-prenom:-50%;
}
*{box-sizing:border-box}
body{
  margin:0; background:#f2f2f2;
  font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  min-height:100svh; display:flex; align-items:center; justify-content:center; padding:16px;
  color:#1c2434;
}
.wrap{ width:min(96vw, var(--maxw)); background:#fff; border-radius:20px; padding:16px; box-shadow:0 6px 24px rgba(0,0,0,.10); }
.carte{ position:relative; width:100%; border-radius:16px; overflow:hidden; aspect-ratio: 1024 / 585; background:#fff url('/static/${bg}') center/cover no-repeat; }
.overlay{ position:absolute; inset:0; }

/* Zones texte */
.line{
  position:absolute;
  opacity:0; /* visible après fit */
  white-space:nowrap; overflow:hidden; text-overflow:clip;
  letter-spacing:.2px; text-shadow:0 1px 0 rgba(255,255,255,.6);
  transition:opacity .12s ease;
}

/* Code-barres */
.barcode{ left:var(--bar-l); right:var(--bar-r); top:var(--y-bar); display:flex; align-items:center; justify-content:center; }
.barcode img{ width:86%; max-width:760px; height:auto; filter:drop-shadow(0 1px 0 rgba(255,255,255,.5)); }

/* Nom/Prénom */
.line.nom{
  left:var(--x-nom); right:var(--r-nom); top:var(--y-nom);
  transform: translateY(var(--ty-nom));
  font-weight:800;
  font-size:clamp(18px, 4.8vw, 46px);
  letter-spacing:-0.015em;
  text-transform:uppercase;
}
.line.prenom{
  left:var(--x-prenom); right:var(--r-prenom); top:var(--y-prenom);
  transform: translateY(var(--ty-prenom));
  font-weight:700;
  font-size:clamp(16px, 4.2vw, 34px);
}

/* Petites pilules */
.points{
  top:var(--y-points); left:var(--x-points); width:var(--w-points);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}
.reduction{
  top:var(--y-reduc);  left:var(--x-reduc);  width:var(--w-reduc);
  font-weight:700; font-size:clamp(14px,2.6vw,24px);
}

.info{ text-align:center; color:#444; font-size:14px; margin-top:12px; }
.fitted .line{ opacity:1; }

/* Resserrement auto bord droit Nom */
.carte.tight-nom   { --r-nom: 10.5%; }
.carte.tighter-nom { --r-nom: 12%;   }

/* Debug */
${debug ? `.line{ outline:1px dashed rgba(255,0,0,.65); background:rgba(255,0,0,.06); }` : ``}
</style>
</head>
<body>
  <div class="wrap">
    <div class="carte" role="img" aria-label="Carte de fidélité de ${esc(prenom)} ${esc(nom)}">
      <div class="overlay">
        <div class="line barcode">
          <img src="/barcode/${encodeURIComponent(code)}?text=0" alt="Code-barres ${esc(code)}" decoding="async" />
        </div>

        <div class="line nom"    data-min-scale="0.50" data-char-threshold="22">${esc(nomUpper)}</div>
        <div class="line prenom" data-min-scale="0.46">${esc(prenom)}</div>

        <div class="line points"    data-min-scale="0.50">${esc(points)}</div>
        <div class="line reduction" data-min-scale="0.50">${esc(reduction)}</div>
      </div>
    </div>
    <div class="info">
      ${['Code: ' + esc(code), (points!=='' ? 'Points: ' + esc(points) : null), (reduction!=='' ? 'Réduction: ' + esc(reduction) : null)].filter(Boolean).join(' • ')}
    </div>
  </div>

  <script>
  (function(){
    // Largeur disponible fiable (desktop/mobile) même en position:absolute
    function availWidth(el){
      var w = el.clientWidth || el.getBoundingClientRect().width || 0;
      if (w && w > 2) return w;
      var cs = getComputedStyle(el);
      var left  = parseFloat(cs.left)  || 0;
      var right = parseFloat(cs.right) || 0;
      var parent = el.offsetParent || el.parentElement || document.querySelector('.carte');
      if (parent){
        var pw = parent.getBoundingClientRect().width || 0;
        var cand = pw - left - right;
        if (cand > 2) return cand;
      }
      return 0;
    }

    function fitToWidth(el, opts){
      opts = opts || {};
      var minScale  = typeof opts.minScale === 'number' ? opts.minScale : 0.45;
      var precision = typeof opts.precision === 'number' ? opts.precision : 0.12;
      var charTh    = typeof opts.charThreshold === 'number' ? opts.charThreshold : 22;

      el.style.fontSize = '';
      el.style.letterSpacing = '';

      var cs   = getComputedStyle(el);
      var base = parseFloat(cs.fontSize);
      var w    = availWidth(el);
      if (!w || !base) return;

      // Pré-réduction selon longueur pondérée (espaces = 0.5)
      var txt    = (el.textContent || '').trim();
      var spaces = (txt.match(/\\s/g) || []).length;
      var wlen   = txt.length - spaces + Math.ceil(spaces * 0.5);
      var pre    = 1;
      if (wlen > charTh) pre = charTh / wlen;
      pre = Math.max(pre, minScale);

      // Bisection
      var lo = base * minScale, hi = base * pre, best = lo;
      el.style.fontSize = hi + 'px';
      if (el.scrollWidth <= w) {
        best = hi;
      } else {
        for (var i=0; i<26 && (hi - lo) > precision; i++) {
          var mid = (hi + lo) / 2;
          el.style.fontSize = mid + 'px';
          if (el.scrollWidth <= w) { best = mid; hi = mid; } else { lo = mid; }
        }
      }
      el.style.fontSize = best + 'px';

      // Ajustements fins si nécessaire
      if (el.scrollWidth > w) {
        var ls = 0, step = 0;
        while (el.scrollWidth > w && step < 6) {
          ls -= 0.2; step++;
          el.style.letterSpacing = ls + 'px';
        }
        var guard = 0;
        while (el.scrollWidth > w && guard < 6) {
          var f = parseFloat(el.style.fontSize) * 0.97;
          el.style.fontSize = f + 'px';
          guard++;
        }
      }
    }

    function fitAll(scope){
      scope = scope || document;
      var nodes = scope.querySelectorAll('.line.nom, .line.prenom, .line.points, .line.reduction');
      nodes.forEach(function(el){
        var ms = parseFloat(el.getAttribute('data-min-scale')) || 0.45;
        var ct = parseFloat(el.getAttribute('data-char-threshold')) || 22;
        fitToWidth(el, {minScale: ms, charThreshold: ct});
      });
    }

    function runFit(){
      var carte = document.querySelector('.carte');
      var nomEl = document.querySelector('.line.nom');

      function tooCloseRight(el, padPx){
        if (!el) return false;
        var w = availWidth(el);
        if (!w) return false;
        return el.scrollWidth >= Math.max(0, w - padPx);
      }

      if (carte) carte.classList.remove('tight-nom','tighter-nom');

      // Laisser le layout se stabiliser (important sur desktop)
      requestAnimationFrame(function(){
        fitAll();

        if (carte && nomEl) {
          var pad = 16; // marge de sécurité pour l'arrondi
          if (tooCloseRight(nomEl, pad)) {
            carte.classList.add('tight-nom');
            fitAll();
            if (tooCloseRight(nomEl, pad)) {
              carte.classList.add('tighter-nom');
              fitAll();
            }
          }
        }

        document.body.classList.add('fitted');
      });
    }

    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(runFit); }
    window.addEventListener('load', runFit);
    window.addEventListener('resize', runFit);
    window.addEventListener('orientationchange', runFit);
    window.fitNow = runFit;
  })();
  </script>
</body>
</html>`);
});
