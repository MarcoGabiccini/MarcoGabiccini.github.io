// veicolo.js - le due viste del veicolo, in SVG:
//   VistaBody   terna del veicolo (x avanti, y a sinistra) con G fermo nell'origine: velocità e
//               derive delle ruote, forze, carichi, a_G e il centro delle velocità C = (S, R);
//   VistaTerra  il veicolo sul terreno: la traiettoria della prova e il cerchio di regime.
// Si disegna ricostruendo il contenuto dell'SVG a ogni aggiornamento: sono poche decine di
// elementi, coordinate già in pixel (così gli spessori non dipendono dallo zoom).
'use strict';

const f1 = x => (Math.round(x * 10) / 10).toString();
const ALONE = 'paint-order="stroke" stroke="#17171c" stroke-width="3" stroke-linejoin="round"';

const Disegno = {
  linea: (p, q, colore, w = 1, dash = '') =>
    `<line x1="${f1(p[0])}" y1="${f1(p[1])}" x2="${f1(q[0])}" y2="${f1(q[1])}" stroke="${colore}" stroke-width="${w}"` +
    (dash ? ` stroke-dasharray="${dash}"` : '') + '/>',
  freccia(p, q, colore, w = 2, testa = 9) {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
    if (!(L > 1.5)) return '';
    const ux = dx / L, uy = dy / L, h = Math.min(testa, 0.6 * L), b = h * 0.42;
    const base = [q[0] - ux * h, q[1] - uy * h];
    return Disegno.linea(p, base, colore, w) +
      `<polygon points="${f1(q[0])},${f1(q[1])} ${f1(base[0] - uy * b)},${f1(base[1] + ux * b)} ${f1(base[0] + uy * b)},${f1(base[1] - ux * b)}" fill="${colore}"/>`;
  },
  poligono: (pts, fill, stroke, w = 1) =>
    `<polygon points="${pts.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round"/>`,
  percorso: (pts, colore, w = 1, dash = '') => {
    let d = '', su = false;
    for (const p of pts) {
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { su = false; continue; }
      d += (su ? 'L' : 'M') + f1(p[0]) + ',' + f1(p[1]);
      su = true;
    }
    return d ? `<path d="${d}" fill="none" stroke="${colore}" stroke-width="${w}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` : '';
  },
  cerchio: (p, r, fill, stroke, w = 1, dash = '') =>
    `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${f1(Math.max(0, r))}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"` +
    (dash ? ` stroke-dasharray="${dash}"` : '') + '/>',
  testo: (p, s, colore = COLORE.testo, ancora = 'middle', size = 11, peso = 400) =>
    `<text x="${f1(p[0])}" y="${f1(p[1])}" fill="${colore}" text-anchor="${ancora}" dominant-baseline="middle" font-size="${size}" font-weight="${peso}" ${ALONE}>${s}</text>`,
  // arco di centro c e raggio r fra due direzioni (angoli di schermo)
  arco(c, r, a0, a1, colore, w = 1) {
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 1e-3) return '';
    const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)], p1 = [c[0] + r * Math.cos(a0 + d), c[1] + r * Math.sin(a0 + d)];
    return `<path d="M${f1(p0[0])},${f1(p0[1])}A${f1(r)},${f1(r)} 0 0 ${d > 0 ? 1 : 0} ${f1(p1[0])},${f1(p1[1])}" fill="none" stroke="${colore}" stroke-width="${w}"/>`;
  },
};

// passo "tondo" della griglia e del righello: almeno minPx pixel
function passoTondo(s, minPx) {
  for (const p of [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (p * s >= minPx) return p;
  return 10000;
}

const sommaV = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1]];
const ruota = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];

// sagoma del veicolo nella sua terna [m]
function sagoma(P) {
  const xr = -P.a2 - 0.72, xf = P.a1 + 0.85, w = Math.max(P.t1, P.t2) / 2 + 0.13;
  return [[xf - 0.4, w], [xf, w - 0.3], [xf, -w + 0.3], [xf - 0.4, -w], [xr + 0.15, -w], [xr, -w + 0.12], [xr, w - 0.12], [xr + 0.15, w]];
}
function ruote(P) {
  return [['11', P.a1, P.t1 / 2], ['12', P.a1, -P.t1 / 2], ['21', -P.a2, P.t2 / 2], ['22', -P.a2, -P.t2 / 2]];
}
function rettangoloRuota(x, y, delta) {
  return [[0.31, 0.11], [0.31, -0.11], [-0.31, -0.11], [-0.31, 0.11]].map(q => sommaV([x, y], ruota(q, delta)));
}

// vista generica: centro c [m], scala s [px/m], zoom con la rotella e trascinamento
class Vista2D {
  constructor(svg) {
    this.svg = svg;
    this.c = [0, 0];
    this.s = 50;
    this.W = 300; this.H = 200;
    this.suCambio = () => {};
    const qui = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom(Math.exp(-e.deltaY * 0.0015), qui(e));
      this.suCambio('zoom');
    }, { passive: false });
    let prec = null;
    svg.addEventListener('pointerdown', e => { prec = qui(e); svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => {
      if (!prec) return;
      const p = qui(e), a = this.s2m(prec), b = this.s2m(p);
      this.c = [this.c[0] - (b[0] - a[0]), this.c[1] - (b[1] - a[1])];
      prec = p;
      this.suCambio('sposta');
    });
    const fine = () => { prec = null; };
    svg.addEventListener('pointerup', fine);
    svg.addEventListener('pointercancel', fine);
    new ResizeObserver(() => this.suCambio('dimensioni')).observe(svg);
  }
  misura() { this.W = this.svg.clientWidth || 300; this.H = this.svg.clientHeight || 200; }
  zoom(f, p) {
    const a = this.s2m(p);
    this.s = Math.min(3000, Math.max(0.01, this.s * f));
    const b = this.s2m(p);
    this.c = [this.c[0] + a[0] - b[0], this.c[1] + a[1] - b[1]];
  }
  // inquadra dei punti [m] lasciando un margine [px]
  inquadra(punti, margine = 40) {
    this.misura();
    const ok = punti.filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!ok.length) return;
    const xs = ok.map(p => p[0]), ys = ok.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const [orizz, vert] = this.orizzontaleVerticale(x1 - x0, y1 - y0);
    this.s = Math.min((this.W - 2 * margine) / Math.max(orizz, 1e-3), (this.H - 2 * margine) / Math.max(vert, 1e-3));
    this.s = Math.min(3000, Math.max(0.01, this.s));
    this.c = [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  griglia() {
    const passo = passoTondo(this.s, 42);
    const angoli = [[0, 0], [this.W, 0], [0, this.H], [this.W, this.H]].map(p => this.s2m(p));
    const xs = angoli.map(p => p[0]), ys = angoli.map(p => p[1]);
    let s = '';
    for (let x = Math.ceil(Math.min(...xs) / passo) * passo; x <= Math.max(...xs); x += passo)
      s += Disegno.linea(this.m2s([x, Math.min(...ys)]), this.m2s([x, Math.max(...ys)]), COLORE.griglia, 1);
    for (let y = Math.ceil(Math.min(...ys) / passo) * passo; y <= Math.max(...ys); y += passo)
      s += Disegno.linea(this.m2s([Math.min(...xs), y]), this.m2s([Math.max(...xs), y]), COLORE.griglia, 1);
    return s;
  }
  righello() {
    const L = passoTondo(this.s, 60), px = L * this.s, x0 = 12, y0 = this.H - 30;
    return Disegno.linea([x0, y0], [x0 + px, y0], COLORE.testo, 2) +
      Disegno.linea([x0, y0 - 4], [x0, y0 + 4], COLORE.testo, 1.5) + Disegno.linea([x0 + px, y0 - 4], [x0 + px, y0 + 4], COLORE.testo, 1.5) +
      Disegno.testo([x0 + px / 2, y0 - 10], fmt(L, L < 1 ? 1 : 0) + ' m', COLORE.testo, 'middle', 11);
  }
}

// ---------------------------------------------------------------------------------------
class VistaBody extends Vista2D {
  constructor(svg) { super(svg); this.iniziata = false; }
  // x avanti = su, y a sinistra = a sinistra
  m2s(p) { return [this.W / 2 - this.s * (p[1] - this.c[1]), this.H / 2 - this.s * (p[0] - this.c[0])]; }
  s2m(q) { return [this.c[0] - (q[1] - this.H / 2) / this.s, this.c[1] - (q[0] - this.W / 2) / this.s]; }
  orizzontaleVerticale(dx, dy) { return [dy, dx]; }
  sulVeicolo() { this.misura(); this.c = [0.15, 0]; this.s = Math.min(this.W, this.H) / 7.2; }
  inquadraC(st, P, k) {
    const C = centro(st, k);
    const punti = sagoma(P).concat([[0, 0]]);
    if (C) punti.push(C);
    this.inquadra(punti, 80);
  }

  render(st, P, k, strati) {
    this.misura();
    if (!this.iniziata && this.W > 50) { this.sulVeicolo(); this.iniziata = true; }
    if (!st) { this.svg.innerHTML = ''; return; }
    const M = p => this.m2s(p), D = Disegno, s = this.s;
    const { u, v, r } = esagera(st, k);
    const C = centro(st, k);
    const G = M([0, 0]);
    let out = this.griglia();

    // assi della terna del veicolo
    const lontano = 1e4 / Math.max(s, 1e-3);
    out += D.linea(M([-lontano, 0]), M([lontano, 0]), '#3c3c48', 1) + D.linea(M([0, -lontano]), M([0, lontano]), '#3c3c48', 1);
    if (G[0] > 0 && G[0] < this.W) out += D.testo([G[0] + 8, 48], 'x', COLORE.tenue, 'start', 12);
    if (G[1] > 40 && G[1] < this.H) out += D.testo([12, G[1] - 9], 'y', COLORE.tenue, 'start', 12);

    const visibile = q => q && Math.abs(q[0]) < 2e5 && Math.abs(q[1]) < 2e5;
    const Cs = C ? M(C) : null;
    const KV = 0.05, KF = 0.42, KA = 0.24, KZ = 0.30, Zm = P.m * P.g / 4;   // scale delle frecce [m per unità]
    const R4 = ruote(P);

    // raggi da C: le velocità sono perpendicolari
    if (strati.derive && C && visibile(Cs)) {
      out += D.linea(Cs, G, '#6a6a78', 1, '4 3');
      for (const [, x, y] of R4) out += D.linea(Cs, M([x, y]), '#55555f', 1, '4 3');
    }
    // carichi verticali: cerchi di area proporzionale a Z
    if (strati.carichi) {
      for (const [ij, x, y] of R4) {
        const Z = st['Z_' + ij];
        if (Number.isFinite(Z)) out += D.cerchio(M([x, y]), KZ * Math.sqrt(Math.max(Z, 0) / Zm) * s, 'rgba(160,160,175,0.13)', '#8c8c98', 1);
      }
    }
    // cassa e ruote
    out += D.poligono(sagoma(P).map(M), 'rgba(58,58,70,0.55)', '#9a9aa6', 1.2);
    for (const [ij, x, y] of R4) {
      const d = (st['delta_' + ij] || 0) * k;
      out += D.poligono(rettangoloRuota(x, y, d).map(M), '#0e0e12', '#c8c8d0', 1.2);
    }
    out += D.cerchio(G, 3.5, '#e6e6ea', '#17171c', 1.5);

    // velocità di G e delle ruote, derive
    if (strati.derive) {
      const VG = [u, v];
      out += D.freccia(G, M(sommaV([0, 0], VG, KV)), COLORE.u, 2.4);
      const aX = Math.atan2(M([1, 0])[1] - G[1], M([1, 0])[0] - G[0]);
      const aV = Math.atan2(M(VG)[1] - G[1], M(VG)[0] - G[0]);
      out += D.arco(G, 46, aX, aV, COLORE.beta, 1.6);
      out += D.testo(sommaV(G, [Math.cos(aV) * 60 + (st.beta >= 0 ? -6 : 6), Math.sin(aV) * 60]),
        'β ' + fmt(st.beta * DEG, 1) + '°', COLORE.testo, st.beta >= 0 ? 'end' : 'start', 11, 600);
      for (const [ij, x, y] of R4) {
        const d = (st['delta_' + ij] || 0) * k, Pw = M([x, y]);
        const Vw = [u - r * y, v + r * x];
        out += D.linea(M(sommaV([x, y], [Math.cos(d), Math.sin(d)], -0.75)), M(sommaV([x, y], [Math.cos(d), Math.sin(d)], 0.95)), '#77778a', 1, '2 3');
        out += D.freccia(Pw, M(sommaV([x, y], Vw, KV)), '#5aa2ee', 1.6, 8);
        const aH = Math.atan2(-Math.cos(d), -Math.sin(d)), aW = Math.atan2(-Vw[0], -Vw[1]);
        out += D.arco(Pw, 22, aH, aW, COLORE.testo, 1.2);
      }
    }
    // forze dei pneumatici nella terna della ruota: bianche, arancioni oltre il picco
    if (strati.forze) {
      for (const [ij, x, y] of R4) {
        const d = (st['delta_' + ij] || 0) * k, h = [Math.cos(d), Math.sin(d)], n = [-Math.sin(d), Math.cos(d)];
        const col = st['rp_' + ij] > 1 ? COLORE.picco : '#ececf0';
        const Fx = (st['Fx_' + ij] || 0) / 1e3, Fy = (st['Fy_' + ij] || 0) / 1e3;
        out += D.freccia(M([x, y]), M(sommaV([x, y], h, KF * Fx)), col, 2, 8);
        out += D.freccia(M([x, y]), M(sommaV([x, y], n, KF * Fy)), col, 2.2, 9);
      }
    }
    // accelerazione di G: a regime punta a C
    if (strati.acc && C) {
      const a = Math.hypot(st.v * st.r, st.u * st.r), L = Math.hypot(C[0], C[1]);
      if (L > 0) out += D.freccia(G, M([C[0] / L * KA * a, C[1] / L * KA * a]), COLORE.ayt, 2.4);
      const fine = M([C[0] / L * KA * a, C[1] / L * KA * a]);
      out += D.testo(sommaV(fine, [0, -11]), 'a<tspan font-size="8" dy="3">G</tspan>', COLORE.testo, 'middle', 11, 600);
    }
    // etichette delle ruote: deriva vera (non esagerata) e carico
    for (const [ij, x, y] of R4) {
      const parti = [];
      if (strati.derive) parti.push('α ' + fmt((st['alpha_' + ij] || 0) * DEG, 1) + '°');
      if (strati.carichi && Number.isFinite(st['Z_' + ij])) parti.push(fmt(st['Z_' + ij] / 1e3, 1) + ' kN');
      if (!parti.length) continue;
      const p = M([x, y]), sx = y > 0 ? -1 : 1, sy = x > 0 ? -1 : 1;
      out += D.testo([p[0] + sx * (0.36 * s + 10), p[1] + sy * (0.2 * s + 6)], parti.join(' · '), COLORE.testo, sx < 0 ? 'end' : 'start', 10.5);
    }

    // centro delle velocità C = (S, R): quote S lungo x e R lungo y
    if (C && visibile(Cs)) {
      const piede = M([C[0], 0]);
      out += D.linea(G, piede, '#cfcfd6', 1.4) + D.linea(piede, Cs, '#cfcfd6', 1.4, '6 4');
      out += D.testo(sommaV(sommaV(G, piede).map(z => z / 2), [10, 0]), 'S', COLORE.testo, 'start', 11, 600);
      out += D.testo(sommaV(sommaV(piede, Cs).map(z => z / 2), [0, -10]), k === 1 ? 'R' : 'R/k', COLORE.testo, 'middle', 11, 600);
      const dentro = Cs[0] > 8 && Cs[0] < this.W - 8 && Cs[1] > 8 && Cs[1] < this.H - 8;
      if (dentro) {
        out += D.cerchio(Cs, 6, 'none', '#ffffff', 2) + D.linea(sommaV(Cs, [-10, 0]), sommaV(Cs, [10, 0]), '#fff', 1.5) +
          D.linea(sommaV(Cs, [0, -10]), sommaV(Cs, [0, 10]), '#fff', 1.5);
        out += D.testo(sommaV(Cs, [12, -12]), 'C', '#ffffff', 'start', 13, 700);
      }
    }
    if (C && !(Cs && Cs[0] > 8 && Cs[0] < this.W - 8 && Cs[1] > 8 && Cs[1] < this.H - 8)) out += this.versoC(Cs || M(C), st, k);
    if (!C) out += D.testo([this.W / 2, 40], 'C all\'infinito: rettilineo', COLORE.testo, 'middle', 12);

    // didascalia: coordinate di C e scala
    const R = st.u / st.r, S = -st.v / st.r;
    const righe = [
      // nel testacoda (st.transitorio) C è il centro delle velocità dell'istante, non quello di un equilibrio
      Number.isFinite(R) && Math.abs(R) < 1e5 ? `${st.transitorio ? 'C = (−v/r, u/r)' : 'C = (S, R)'} = (${fmt(S, 2)} m, ${fmt(R, 1)} m)` : 'C = (S, R): R infinito',
      k === 1 ? 'scala vera' : `k = ${fmt(k, 1)}×: δ, β e ρ esagerati (S uguale, R/k)`,
    ];
    righe.forEach((t, i) => { out += D.testo([12, this.H - 56 - 16 * (righe.length - 1 - i)], t, COLORE.testo, 'start', 11.5); });
    out += this.righello();
    this.svg.innerHTML = out;
  }

  // C fuori dalla vista: una freccia sul bordo che punta verso C
  versoC(Cs, st, k) {
    const c = [this.W / 2, this.H / 2], d = [Cs[0] - c[0], Cs[1] - c[1]], L = Math.hypot(d[0], d[1]);
    if (!(L > 0)) return '';
    const u = [d[0] / L, d[1] / L], m = 28;
    const t = Math.min(u[0] ? (u[0] > 0 ? this.W - m - c[0] : m - c[0]) / u[0] : Infinity,
                       u[1] ? (u[1] > 0 ? this.H - m - c[1] : m - c[1]) / u[1] : Infinity);
    const punta = [c[0] + u[0] * t, c[1] + u[1] * t], coda = [punta[0] - u[0] * 34, punta[1] - u[1] * 34];
    const R = st.u / st.r;
    const dist = k === 1 ? `R = ${fmt(R, 0)} m` : `R/k = ${fmt(R / k, 0)} m`;
    return Disegno.freccia(coda, punta, '#ffffff', 2, 10) +
      Disegno.testo([coda[0] - u[0] * 8, coda[1] - u[1] * 8 - 12], 'C: ' + dist, '#ffffff', u[0] > 0.3 ? 'end' : u[0] < -0.3 ? 'start' : 'middle', 11.5, 600);
  }
}

// Esagerazione k: l'assetto con tan β_k = k tan β e la curvatura con R_k = R/k; i moduli
// delle velocità restano veri. Per angoli piccoli è v·k e r·k; con β grande (testacoda,
// veicolo di traverso) β_k resta sotto i 90°. Il centro delle velocità viene (S, R/k).
function esagera(st, k) {
  if (k === 1) return { u: st.u, v: st.v, r: st.r };
  const V = Math.hypot(st.u, st.v), bk = Math.atan2(k * st.v, st.u);
  const u = V * Math.cos(bk), v = V * Math.sin(bk);
  const r = Math.abs(st.u) > 1e-9 ? k * st.r * u / st.u : k * st.r;
  return { u, v, r };
}

// centro delle velocità nella terna del veicolo, con l'esagerazione k: (−v/r, u/(k r))
function centro(st, k) {
  if (!st || !(Math.abs(st.r) > 1e-7)) return null;
  return [-st.v / st.r, st.u / (k * st.r)];
}

// ---------------------------------------------------------------------------------------
// Traiettoria di una chiocciola: fra due campioni (la prova è sfoltita) si integra con u, v
// e psi interpolati, e l'errore sull'estremo si distribuisce lungo il tratto.
function densifica(c) {
  if (c._denso) return c._denso;
  const d = c.dati, X = [], Y = [], S = [];
  for (let i = 0; i < c.n - 1; i++) {
    const dt = d.t[i + 1] - d.t[i], dpsi = d.psi[i + 1] - d.psi[i];
    const m = Math.min(40, Math.max(1, Math.ceil(Math.abs(dpsi) / (2 / DEG))));
    const pts = [[d.X[i], d.Y[i]]];
    let x = d.X[i], y = d.Y[i];
    for (let j = 0; j < m; j++) {
      const f = (j + 0.5) / m;
      const u = d.u[i] + f * (d.u[i + 1] - d.u[i]), v = d.v[i] + f * (d.v[i + 1] - d.v[i]), psi = d.psi[i] + f * dpsi;
      x += (u * Math.cos(psi) - v * Math.sin(psi)) * dt / m;
      y += (u * Math.sin(psi) + v * Math.cos(psi)) * dt / m;
      pts.push([x, y]);
    }
    const ex = d.X[i + 1] - x, ey = d.Y[i + 1] - y;
    for (let j = 0; j < m; j++) { X.push(pts[j][0] + ex * j / m); Y.push(pts[j][1] + ey * j / m); S.push(i + j / m); }
  }
  X.push(d.X[c.n - 1]); Y.push(d.Y[c.n - 1]); S.push(c.n - 1);
  return (c._denso = { X, Y, S });
}
function posa(c, s) {
  const T = densifica(c), d = c.dati;
  let lo = 0, hi = T.S.length - 1;
  if (s <= 0) lo = hi = 0;
  else if (s >= c.n - 1) lo = hi;
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T.S[m] <= s) lo = m; else hi = m; }
  const f = hi > lo ? (s - T.S[lo]) / (T.S[hi] - T.S[lo]) : 0;
  const i = Math.max(0, Math.min(c.n - 2, Math.floor(s))), g = Math.max(0, Math.min(1, s - i));
  return { X: T.X[lo] + f * (T.X[hi] - T.X[lo]), Y: T.Y[lo] + f * (T.Y[hi] - T.Y[lo]), psi: d.psi[i] + g * (d.psi[i + 1] - d.psi[i]), indice: lo };
}
// il raggio più piccolo fra gli equilibri di una curva (per la scala della vista)
function raggioMinimo(c) {
  if (c._Rmin) return c._Rmin;
  const n = c.tipo === 'chiocciola' ? c.fine + 1 : c.n;
  let m = Infinity;
  for (let i = 0; i < n; i++) if (Math.abs(c.dati.rho[i]) > 1e-6) m = Math.min(m, Math.abs(1 / c.dati.rho[i]));
  return (c._Rmin = m);
}

class VistaTerra extends Vista2D {
  constructor(svg) { super(svg); this.modo = 'segui'; this.zoomUtente = 1; }
  // seguendo il veicolo la rotella cambia solo l'ingrandimento
  zoom(f, p) {
    if (this.modo === 'segui') this.zoomUtente = Math.min(50, Math.max(0.02, this.zoomUtente * f));
    else super.zoom(f, p);
  }
  m2s(p) { return [this.W / 2 + this.s * (p[0] - this.c[0]), this.H / 2 - this.s * (p[1] - this.c[1])]; }
  s2m(q) { return [this.c[0] + (q[0] - this.W / 2) / this.s, this.c[1] - (q[1] - this.H / 2) / this.s]; }
  orizzontaleVerticale(dx, dy) { return [dx, dy]; }

  // la posa del veicolo: nelle chiocciole quella della prova; per gli altri equilibri il
  // veicolo è nell'origine e la sua velocità punta in su
  posaDi(c, s, st) {
    if (c.tipo === 'chiocciola') return posa(c, s);
    return { X: 0, Y: 0, psi: Math.PI / 2 - st.beta };
  }
  tutto(c, s, st) {
    this.modo = 'libero';
    if (c.tipo === 'chiocciola') {
      const T = densifica(c);
      const passo = Math.max(1, Math.floor(T.X.length / 400)), pts = [];
      for (let i = 0; i < T.X.length; i += passo) pts.push([T.X[i], T.Y[i]]);
      this.inquadra(pts, 30);
    } else {
      const q = this.posaDi(c, s, st), Cw = this.centroW(q, st);
      const R = Math.abs(st.u / st.r);
      if (Cw && R < 5e3) this.inquadra([[Cw[0] - R, Cw[1] - R], [Cw[0] + R, Cw[1] + R], [q.X, q.Y]], 30);
      else this.inquadra([[q.X - 20, q.Y - 20], [q.X + 20, q.Y + 20]], 30);
    }
  }
  centroW(q, st) {
    if (!(Math.abs(st.r) > 1e-7)) return null;
    const S = -st.v / st.r, R = st.u / st.r;
    return [q.X + S * Math.cos(q.psi) - R * Math.sin(q.psi), q.Y + S * Math.sin(q.psi) + R * Math.cos(q.psi)];
  }

  render(c, s, st, P, kBeta) {
    this.misura();
    if (!st || !c) { this.svg.innerHTML = ''; return; }
    const M = p => this.m2s(p), D = Disegno;
    const q = this.posaDi(c, s, st);
    if (this.modo === 'segui') {
      const Rv = Math.min(150, Math.max(8, raggioMinimo(c)));
      this.s = this.zoomUtente * Math.min(this.W, this.H) / (2.5 * Rv + 12);
      this.c = [q.X, q.Y];
    }
    let out = this.griglia();
    const Cw = this.centroW(q, st), R = Math.abs(st.u / st.r);

    if (c.tipo === 'chiocciola') {
      const T = densifica(c);
      const tutti = T.X.map((x, i) => M([x, T.Y[i]]));
      out += D.percorso(tutti, '#3a3a46', 1);
      // il tratto fatto: azzurro nella mappa, grigio chiaro sul plateau, arancione nel testacoda
      const indice = r => { const i = T.S.findIndex(z => z >= r); return i < 0 ? tutti.length - 1 : i; };
      const iFine = indice(c.fine), iReg = indice(c.regime);
      const fatto = Math.min(q.indice, tutti.length - 1), qui = [M([q.X, q.Y])];
      const tratto = (i0, i1, colore) => { if (i1 >= i0) out += D.percorso(tutti.slice(i0, i1 + 1).concat(qui.slice(0, i1 === fatto ? 1 : 0)), colore, 1.6); };
      tratto(0, Math.min(fatto, iFine), '#7fb2e6');
      tratto(iFine, Math.min(fatto, iReg), '#b8b8c4');
      tratto(iReg, fatto, COLORE.picco);
    }
    if (Cw && R < 5e3) {
      const Cs = M(Cw);
      out += D.cerchio(Cs, R * this.s, 'none', c.tipo === 'chiocciola' ? COLORE.rho : '#7fb2e6', c.tipo === 'chiocciola' ? 1.3 : 1.6,
        c.tipo === 'chiocciola' ? '6 4' : '');
      out += D.linea(sommaV(Cs, [-6, 0]), sommaV(Cs, [6, 0]), '#fff', 1.2) + D.linea(sommaV(Cs, [0, -6]), sommaV(Cs, [0, 6]), '#fff', 1.2);
      out += D.testo(sommaV(Cs, [9, -10]), 'C · R = ' + fmt(R, 0) + ' m', COLORE.testo, 'start', 11);
    }

    // il veicolo, ingrandito se è troppo piccolo; con kBeta l'assetto è esagerato (tan β → kBeta tan β)
    // e lo sterzo delle ruote allo stesso modo, così anche con kBeta grande restano sotto i 90°
    const esagerato = a => Math.atan2(kBeta * Math.sin(a), Math.cos(a));
    const lungo = P.a1 + P.a2 + 1.57, g = Math.max(1, 34 / (lungo * this.s));
    const psiV = q.psi + st.beta, psi = psiV - esagerato(st.beta);
    const aW = p => { const z = ruota([p[0] * g, p[1] * g], psi); return M([q.X + z[0], q.Y + z[1]]); };
    out += D.poligono(sagoma(P).map(aW), 'rgba(58,58,70,0.9)', '#c8c8d0', 1.2);
    for (const [ij, x, y] of ruote(P)) out += D.poligono(rettangoloRuota(x, y, esagerato(st['delta_' + ij] || 0)).map(aW), '#0e0e12', '#c8c8d0', 1);
    const Gs = M([q.X, q.Y]);
    const testaV = M([q.X + 2.4 * g * Math.cos(psiV), q.Y + 2.4 * g * Math.sin(psiV)]);
    out += D.freccia(Gs, testaV, COLORE.u, 2.2);
    out += this.righello();
    if (g > 1.01) out += D.testo([this.W - 10, 18], 'veicolo ingrandito ' + fmt(g, 0) + '×', COLORE.tenue, 'end', 10.5);
    if (kBeta > 1) out += D.testo([this.W - 10, g > 1.01 ? 33 : 18], 'β esagerato ' + fmt(kBeta, 0) + '×: β disegnato ' +
      fmt(esagerato(st.beta) * 180 / Math.PI, 1) + '°, vero ' + fmt(st.beta * 180 / Math.PI, 2) + '°', COLORE.tenue, 'end', 10.5);
    this.svg.innerHTML = out;
  }
}
