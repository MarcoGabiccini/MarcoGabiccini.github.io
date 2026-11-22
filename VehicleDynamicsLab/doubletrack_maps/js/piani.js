// piani.js - un riquadro con un piano della mappa. Le curve le disegna Plotly; la curva
// scelta, quella sotto il mouse e il punto corrente stanno in uno strato SVG sopra il
// grafico, senza eventi: così l'hover e il replay non fanno ridisegnare Plotly.
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';

function menuGrandezze() {
  const s = document.createElement('select');
  for (const [nome, g] of Object.entries(GRANDEZZE)) s.add(new Option(g.voce, nome));
  return s;
}

// valori di una grandezza lungo una curva, calcolati una volta sola
function colonna(c, nome) {
  c._col = c._col || {};
  return c._col[nome] || (c._col[nome] = valori(c.dati, nome));
}

// intervallo di una grandezza sugli equilibri di un veicolo (chiocciole fino alla
// fine degli equilibri e bordo): la parte dopo il limite non allarga gli assi
function intervallo(V, nome) {
  V._int = V._int || {};
  if (V._int[nome]) return V._int[nome];
  let lo = Infinity, hi = -Infinity;
  for (const c of V.curve) {
    if (c.tipo === 'famiglia') continue;
    const v = colonna(c, nome), n = c.tipo === 'chiocciola' ? c.fine + 1 : c.n;
    for (let i = 0; i < n; i++) if (Number.isFinite(v[i])) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); }
  }
  return (V._int[nome] = [lo, hi]);
}

function rangeAsse(nome, veicoli) {
  const g = GRANDEZZE[nome];
  if (g.lim) return g.lim.slice();
  let lo = Infinity, hi = -Infinity;
  for (const V of veicoli) { const [a, b] = intervallo(V, nome); lo = Math.min(lo, a); hi = Math.max(hi, b); }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo >= 0 && lo < 0.3 * hi) lo = 0;            // l'origine si vede
  if (hi <= 0 && hi > 0.3 * lo) hi = 0;
  const m = 0.04 * (hi - lo || 1);
  return [lo - m, hi + m];
}

// «vista intera»: il riquadro con le quattro frecce sulle diagonali, verso i vertici
const ICONA_INTERA = '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect class="riquadro" x="0.75" y="0.75" width="16.5" height="16.5" rx="2.5"/>' +
  '<path d="M7.4 7.4 4.2 4.2M4.2 7V4.2H7 M10.6 7.4 13.8 4.2M11 4.2H13.8V7 M7.4 10.6 4.2 13.8M4.2 11V13.8H7 M10.6 10.6 13.8 13.8M11 13.8H13.8V11"/></svg>';

class Piano {
  constructor(contenitore, indice, app) {
    this.app = app;
    this.indice = indice;
    this.el = document.createElement('div');
    this.el.className = 'piano';
    const header = document.createElement('header');
    this.selX = menuGrandezze();
    this.selY = menuGrandezze();
    const lx = document.createElement('span'); lx.textContent = 'x';
    const ly = document.createElement('span'); ly.textContent = 'y';
    this.btnIntera = document.createElement('button');
    this.btnIntera.className = 'btnIntera';
    this.btnIntera.title = 'vista intera: toglie zoom e spostamento di questo piano (come un doppio clic nel piano)';
    this.btnIntera.setAttribute('aria-label', 'vista intera');
    this.btnIntera.innerHTML = ICONA_INTERA;
    this.btnIntera.onclick = () => this.vistaIntera();
    header.append(lx, this.selX, ly, this.selY, this.btnIntera);
    const wrap = document.createElement('div');
    wrap.className = 'graficoWrap';
    this.gd = document.createElement('div');
    this.gd.className = 'grafico';
    this.sopra = document.createElementNS(SVGNS, 'svg');
    this.sopra.classList.add('sopra');
    this.sopra.innerHTML = `<defs><clipPath id="taglio${indice}"><rect/></clipPath></defs>` +
      `<g clip-path="url(#taglio${indice})"><g class="sotto"></g><g class="scelta"></g><g class="punto"></g></g>`;
    this.rettangolo = this.sopra.querySelector('rect');
    this.gSotto = this.sopra.querySelector('g.sotto');
    this.gScelta = this.sopra.querySelector('g.scelta');
    this.gPunto = this.sopra.querySelector('g.punto');
    wrap.append(this.gd, this.sopra);
    this.el.append(header, wrap);
    contenitore.append(this.el);
    const cambia = () => { this.x = this.selX.value; this.y = this.selY.value; this.costruisci(); };
    this.selX.onchange = cambia;
    this.selY.onchange = cambia;
    this.pronto = false;
    new ResizeObserver(() => {
      if (this.pronto) Plotly.Plots.resize(this.gd).then(() => this.disegnaSopra(true));
    }).observe(wrap);
  }

  assi(x, y) {
    this.x = x; this.y = y;
    this.selX.value = x; this.selY.value = y;
  }

  // torna alla vista intera, quella con tutta la mappa
  vistaIntera() {
    if (!this.pronto || !this.intera) return;
    Plotly.relayout(this.gd, { 'xaxis.range': this.intera.x.slice(), 'yaxis.range': this.intera.y.slice() });
  }

  // il bottone della vista intera si accende quando il piano è ingrandito o spostato
  segnaIntera() {
    const L = this.gd._fullLayout, I = this.intera;
    if (!L || !I) return;
    const uguale = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-6 * Math.abs(b[1] - b[0]);
    this.btnIntera.classList.toggle('mosso', !(uguale(L.xaxis.range, I.x) && uguale(L.yaxis.range, I.y)));
  }

  // tutte le tracce del piano: si rifà quando cambiano veicolo, assi o curve accese
  async costruisci() {
    const A = this.app, V = A.V, W = A.W, gx = this.x, gy = this.y;
    const rx = rangeAsse(gx, W ? [V, W] : [V]), ry = rangeAsse(gy, W ? [V, W] : [V]);
    const tracce = [];
    this.intera = { x: rx.slice(), y: ry.slice() };          // la vista intera, per il bottone (copie: Plotly riscrive i range che riceve)

    // più curve in una traccia sola, separate da NaN; customdata = [curva, riga]
    const unisci = (pezzi, conDati) => {
      const x = [], y = [], cd = [];
      for (const [c, i0, i1] of pezzi) {
        const vx = colonna(c, gx), vy = colonna(c, gy);
        for (let i = i0; i <= i1; i++) { x.push(vx[i]); y.push(vy[i]); if (conDati) cd.push([c.id, i]); }
        x.push(NaN); y.push(NaN); if (conDati) cd.push(null);
      }
      return conDati ? { x, y, customdata: cd } : { x, y };
    };
    const linea = (dati, colore, larghezza, extra) => Object.assign({
      type: 'scatter', mode: 'lines', line: { color: colore, width: larghezza },
      hoverinfo: dati.customdata ? 'none' : 'skip', connectgaps: false,
    }, dati, extra || {});

    // veicolo di confronto: chiocciole fino al limite e bordo, senza hover
    if (W) {
      const ch = W.curve.filter(c => c.tipo === 'chiocciola');
      tracce.push(linea(unisci(ch.map(c => [c, 0, c.fine]), false), COLORE.confronto, 1, { opacity: 0.45 }));
      const b = W.curve.find(c => c.tipo === 'bordo');
      tracce.push(linea(unisci([[b, 0, b.n - 1]], false), COLORE.confronto, 2, { line: { color: COLORE.confronto, width: 2, dash: 'dash' } }));
    }

    const chiocciole = V.curve.filter(c => c.tipo === 'chiocciola');
    const occupati = [];                                     // posti già presi dalle etichette
    if (A.mostra.plateau) {
      const pezzi = chiocciole.filter(c => c.regime > c.fine).map(c => [c, c.fine, c.regime]);
      tracce.push(linea(unisci(pezzi, true), COLORE.oltre, 1));
    }
    if (A.mostra.testacoda) {
      const pezzi = chiocciole.filter(c => c.regime < c.n - 1).map(c => [c, c.regime, c.n - 1]);
      tracce.push(linea(unisci(pezzi, true), COLORE.oltre, 1.2, { line: { color: COLORE.oltre, width: 1.2, dash: 'dot' }, opacity: 0.6 }));
    }
    if (A.mostra.chiocciole) {
      for (const c of chiocciole) tracce.push(linea(unisci([[c, 0, c.fine]], true), c.colore, 1.4));
    }
    for (const fam of FAMIGLIE) {
      if (!A.mostra[fam.chiave]) continue;
      const curve = V.curve.filter(c => c.famiglia === fam.chiave);
      tracce.push(linea(unisci(curve.map(c => [c, 0, c.n - 1]), true), fam.colore, 1.2,
        { line: { color: fam.colore, width: 1.2, dash: fam.dash } }));
      if (fam.chiave === 'beta') {                           // β = 0: confine fra nose-out e nose-in
        const zero = curve.filter(c => c.valore === 0);
        if (zero.length) tracce.push(linea(unisci(zero.map(c => [c, 0, c.n - 1]), true), fam.colore, 2.6));
      }
      tracce.push(this.etichette(curve, fam, rx, ry, occupati));
    }
    if (A.mostra.bordo) {
      const b = V.curve.find(c => c.tipo === 'bordo');
      tracce.push(linea(unisci([[b, 0, b.n - 1]], true), COLORE.bordo, 2));
      const gira = [];
      for (let i = 0; i + 1 < b.n; i++) if (b.motivo[i] === GIRA && b.motivo[i + 1] === GIRA) gira.push([b, i, i + 1]);
      if (gira.length) tracce.push(linea(unisci(gira, false), COLORE.picco, 2.4));
    }
    const rif = A.mostra.rif ? riferimento(V.rif, gx, gy) : null;
    if (rif) tracce.push(linea(rif, '#ffffff', 1.6, { line: { color: '#ffffff', width: 1.6, dash: 'dash' } }));

    const asse = (nome, range) => ({
      title: { text: GRANDEZZE[nome].titolo, standoff: 4, font: { size: 11 } },
      range, autorange: false, gridcolor: COLORE.griglia, zerolinecolor: '#4a4a55', zerolinewidth: 1,
      linecolor: '#444', ticks: 'outside', ticklen: 3, tickcolor: '#444', automargin: true,
    });
    const layout = {
      paper_bgcolor: '#1e1e24', plot_bgcolor: '#17171c',
      font: { color: COLORE.testo, size: 11, family: 'system-ui, "Segoe UI", sans-serif' },
      margin: { l: 48, r: 10, t: 8, b: 34 }, showlegend: false,
      hovermode: 'closest', hoverdistance: 14, dragmode: 'pan', separators: ',.',
      xaxis: asse(gx, rx), yaxis: asse(gy, ry),
      uirevision: [gx, gy, V.nome, W ? W.nome : ''].join('|'),
    };
    const config = { displayModeBar: false, scrollZoom: true, responsive: false, doubleClick: 'reset' };
    await Plotly.react(this.gd, tracce, layout, config);
    if (!this.pronto) {
      this.pronto = true;
      this.gd.on('plotly_hover', ev => {
        const p = ev.points && ev.points[0];
        if (p && p.customdata) A.passaSopra(p.customdata[0], p.customdata[1]);
      });
      this.gd.on('plotly_unhover', () => A.lascia());
      this.gd.on('plotly_click', ev => {
        const p = ev.points && ev.points[0];
        if (p && p.customdata) A.scegli(p.customdata[0], p.customdata[1]);
      });
      const mosso = () => { this.disegnaSopra(true); this.segnaIntera(); };
      this.gd.on('plotly_relayout', mosso);
      this.gd.on('plotly_relayouting', mosso);
      this.gd.on('plotly_afterplot', mosso);
    }
    this.disegnaSopra(true);
    this.segnaIntera();
  }

  // un'etichetta per curva: si prova prima l'estremo più vicino al limite (ã_y più alta;
  // per le iso-ã_y la velocità più alta), poi punti sempre più verso l'altro estremo,
  // finché l'etichetta sta dentro gli assi e non copre quelle già messe (occupati:
  // rettangoli in pixel, approssimati con le dimensioni del riquadro)
  etichette(curve, fam, rx, ry, occupati) {
    const x = [], y = [], testo = [];
    const pw = Math.max(200, (this.gd.clientWidth || 600) - 66), ph = Math.max(150, (this.gd.clientHeight || 400) - 50);
    const pix = (a, b) => [(a - rx[0]) / (rx[1] - rx[0]) * pw, (1 - (b - ry[0]) / (ry[1] - ry[0])) * ph];
    const libero = q => occupati.every(o => q[0] > o[2] || q[2] < o[0] || q[1] > o[3] || q[3] < o[1]);
    for (const c of curve) {
      const vx = colonna(c, this.x), vy = colonna(c, this.y);
      const crit = fam.chiave === 'ayt' ? c.dati.u : c.dati.ayt;
      const daFine = crit[c.n - 1] >= crit[0];
      const t = fam.testo(c.valore), w = 6 * t.replace(/<[^>]+>/g, '').length + 6, h = 13;
      const passo = Math.max(1, Math.floor(c.n / 12));
      for (let k = 0; k < c.n; k += passo) {
        const i = daFine ? c.n - 1 - k : k;
        if (!Number.isFinite(vx[i]) || !Number.isFinite(vy[i])) continue;
        const [a, b] = pix(vx[i], vy[i]);
        const q = [a - w / 2, b - h - 3, a + w / 2, b - 3];
        if (q[0] < 0 || q[2] > pw || q[1] < 0 || b > ph || !libero(q)) continue;
        occupati.push(q);
        x.push(vx[i]); y.push(vy[i]); testo.push(t);
        break;
      }
    }
    return { type: 'scatter', mode: 'text', x, y, text: testo, hoverinfo: 'skip',
      textfont: { color: COLORE.testo, size: 10 }, textposition: 'top center' };
  }

  // una curva nello strato sopra, in giallo: spessa se è la scelta, sottile (con un
  // alone) se è quella sotto il mouse. Le chiocciole: piene fino alla fine della mappa,
  // tratteggiate sul plateau (ancora equilibri), a punti arancioni nel testacoda; la
  // scelta ha un rombo dove finisce la mappa.
  // Il bordo fa eccezione: non è una prova ma l'insieme dei picchi, e si accende in
  // arancione (il giallo resta alle curve che si percorrono come una manovra). Scelto:
  // una fascia arancione, con l'anima bianca dove dopo il picco c'è il plateau e tutta
  // arancione dove il veicolo comincia a girarsi, come il bordo che le sta sotto. Sotto
  // il mouse: solo un alone arancione attorno al bordo.
  disegnaCurva(c, px, scelta) {
    const vx = colonna(c, this.x), vy = colonna(c, this.y);
    const tratto = (i0, i1) => {
      let d = '', su = false;
      for (let i = i0; i <= i1; i++) {
        if (!Number.isFinite(vx[i]) || !Number.isFinite(vy[i])) { su = false; continue; }
        const [a, b] = px(vx[i], vy[i]);
        d += (su ? 'L' : 'M') + a.toFixed(1) + ',' + b.toFixed(1);
        su = true;
      }
      return d;
    };
    if (c.tipo === 'bordo') {
      const intero = tratto(0, c.n - 1);
      if (!scelta) return `<path d="${intero}" fill="none" stroke="${COLORE.picco}" stroke-width="8" stroke-linejoin="round" opacity="0.4"/>`;
      let b = `<path d="${intero}" fill="none" stroke="${COLORE.picco}" stroke-width="6" stroke-linejoin="round" opacity="0.95"/>`;
      const gira = i => c.motivo[i] === GIRA && c.motivo[i + 1] === GIRA;
      for (let i = 0; i + 1 < c.n;) {
        if (gira(i)) { i++; continue; }
        let j = i;
        while (j + 1 < c.n && !gira(j)) j++;
        b += `<path d="${tratto(i, j)}" fill="none" stroke="${COLORE.bordo}" stroke-width="1.8" stroke-linejoin="round"/>`;
        i = j;
      }
      return b;
    }
    const ch = c.tipo === 'chiocciola', fine = ch ? c.fine : c.n - 1, reg = ch ? c.regime : c.n - 1;
    const w = scelta ? 3 : 1.6, w2 = scelta ? 1.8 : 1.2;
    let s = '';
    if (!scelta) s += `<path d="${tratto(0, fine)}" fill="none" stroke="${COLORE.scelta}" stroke-width="6" stroke-linejoin="round" opacity="0.16"/>`;
    s += `<path d="${tratto(0, fine)}" fill="none" stroke="${COLORE.scelta}" stroke-width="${w}" stroke-linejoin="round" opacity="0.92"/>`;
    if (reg > fine) s += `<path d="${tratto(fine, reg)}" fill="none" stroke="${COLORE.scelta}" stroke-width="${w2}" stroke-dasharray="5 3" opacity="0.85"/>`;
    if (reg < c.n - 1) s += `<path d="${tratto(reg, c.n - 1)}" fill="none" stroke="${COLORE.picco}" stroke-width="${w2 + 0.4}" stroke-dasharray="0.1 4" stroke-linecap="round" opacity="0.9"/>`;
    if (scelta && fine < c.n - 1) {
      const [a, b] = px(vx[fine], vy[fine]);
      if (Number.isFinite(a) && Number.isFinite(b))
        s += `<path d="M${a},${b - 6}L${a + 6},${b}L${a},${b + 6}L${a - 6},${b}Z" fill="${COLORE.bordo}" stroke="#17171c" stroke-width="1.5"/>`;
    }
    return s;
  }

  // strato sopra: curva scelta (solo se tutto = true), curva sotto il mouse (quando
  // cambia) e i punti. Il punto fissato con un clic (magenta, con l'anello bianco) sta
  // sulla curva scelta e resta in tutti i piani anche mentre il mouse passa altrove: è
  // il punto da cui parte ▶, e con ▶ o con il cursore del tempo si sposta lungo la
  // curva. Il punto sotto il mouse è bianco, più piccolo, disegnato sopra.
  disegnaSopra(tutto) {
    const L = this.gd._fullLayout;
    if (!L || !L.xaxis || !L._size) return;
    const sz = L._size, xa = L.xaxis, ya = L.yaxis;
    const px = (x, y) => [sz.l + xa.l2p(x), sz.t + ya.l2p(y)];
    const A = this.app;
    if (tutto) {
      this.rettangolo.setAttribute('x', sz.l); this.rettangolo.setAttribute('y', sz.t);
      this.rettangolo.setAttribute('width', sz.w); this.rettangolo.setAttribute('height', sz.h);
      const c = A.V.curve[A.sel.id];
      this.gScelta.innerHTML = c ? this.disegnaCurva(c, px, true) : '';
    }
    const h = A.hover && A.hover.id !== A.sel.id ? A.hover.id : null;
    if (tutto || h !== this.idSotto) {
      this.idSotto = h;
      this.gSotto.innerHTML = h === null ? '' : this.disegnaCurva(A.V.curve[h], px, false);
    }
    const cerchi = (st, disegno) => {
      if (!st) return '';
      const [a, b] = px(valore(st, this.x), valore(st, this.y));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
      return disegno.map(([r, attributi]) => `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="${r}" ${attributi}/>`).join('');
    };
    let s = cerchi(A.fissato, [[9, 'fill="#17171c"'], [6.5, `fill="${COLORE.fissato}" stroke="#ffffff" stroke-width="2"`]]);
    if (A.hover) s += cerchi(A.stato, [[5, 'fill="#ffffff" stroke="#000" stroke-width="2"']]);
    this.gPunto.innerHTML = s;
  }
}
