// dati.js — stato del viewer, lettura della telemetria, grandezze derivate.
// Formato: docs/telemetria.md. Unità SI, angoli in radianti (i gradi solo nei grafici).
'use strict';

const MAX_RUN = 4;
const RUOTE = ['11', '12', '21', '22'];
const NOME_RUOTA = { '11': 'ant. sinistra', '12': 'ant. destra', '21': 'post. sinistra', '22': 'post. destra' };
// niente bianco, arancione né rosso: nei pneumatici sono i colori della forza attuale (prima del
// picco, oltre il picco, ruota bloccata)
const RUN_COLORI = ['#5ab0ff', '#f0e05a', '#81c784', '#b39ddb'];
// Colori per ruota (stessi in tutti i pannelli) e per assale.
const COLORE_RUOTA = { '11': '#00e5ff', '12': '#4d7cff', '21': '#c070ff', '22': '#ff4de8' };
const COLORE_ASSALE = { '1': '#00e5ff', '2': '#ff4de8' };
// Percorso da seguire e coni (traiettoria e 3D).
const COLORE_PERCORSO = '#b8bcc6';
const COLORE_CONI = '#ff8c1a';

// Campi del veicolo che il viewer legge da EMBEDDED_RUNS[k].veicolo (mostra_nel_viewer passa tutto P).
// Se una run arriva da un CSV aperto a mano, senza veicolo, si usano i valori di parametri_veicolo.m.
const VEICOLO_DEFAULT = {
  m: 1100, g: 9.81, a1: 1.11, a2: 1.39, l: 2.50, t1: 1.35, t2: 1.35, rr: 0.30, h: 0.60, q1: 0.03, q2: 0.08,
  tau1: 0.05, tau2: 0,
  Fz0: 2999.898, mf_C: 1.65, mf_pD1: 0.88, mf_pD2: -0.22, mf_pK1: 15.0, mf_pK2: 1.6, mf_E: 0.5, lambda_mu: 1.0,
  omega_eps: 0.5,
};

// Stato globale. runs[k] = {name, label, modello, veicolo, veicoloDefault, percorso, cols, data, n,
// show, colore, tratto, statico, disp}. ref = indice della run di riferimento (telecamera e tempi).
// Ogni run porta il suo percorso (leggiPercorso: linea da seguire, coni, mezzeria della pista),
// null se i dati non lo portano. percorso = quello disegnato (percorsoDaMostrare).
const V = { runs: [], ref: 0, tNow: 0, iRef: 0, fonte: '', percorso: null };

// ---------------------------------------------------------------- lettura
// Un campo numerico del CSV. parseFloat legge NaN e Infinity/-Infinity ma non
// Inf/-Inf (MATLAB, Julia) né inf/-inf (Python, C): quelli si leggono a parte,
// in maiuscolo o minuscolo, anche col segno +.
function numeroCSV(s) {
  if (s === undefined) return NaN;
  const x = parseFloat(s);
  if (!Number.isNaN(x)) return x;
  const m = /^\s*([+-]?)inf(inity)?\s*$/i.exec(s);
  return m ? (m[1] === '-' ? -Infinity : Infinity) : NaN;
}

function parseCSV(text) {
  const righe = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (righe.length < 2) throw new Error('CSV vuoto');
  const cols = righe[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  const n = righe.length - 1;
  const data = {};
  cols.forEach(c => { data[c] = new Float64Array(n); });
  for (let i = 0; i < n; i++) {
    const v = righe[i + 1].split(',');
    for (let j = 0; j < cols.length; j++) data[cols[j]][i] = numeroCSV(v[j]);
  }
  if (!data.t) throw new Error('manca la colonna t');
  return { cols, data, n };
}

// Carica uno <script> accanto alla pagina: da file:// la fetch è bloccata dal CORS, lo <script> no.
// La query string evita che il browser serva una versione vecchia dalla cache: di solito è
// l'istante della richiesta; con versione, il file si riscarica solo quando la versione cambia.
function caricaScript(src, versione) {
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = src + (src.includes('?') ? '&' : '?') + (versione ? 'v=' + encodeURIComponent(versione) : 't=' + Date.now());
    s.onload = () => res(true);
    s.onerror = () => { s.remove(); res(false); };
    document.head.appendChild(s);
  });
}

// 'dt' se ci sono le colonne per ruota, 'st' se ci sono quelle d'assale; altrimenti dal nome
// del file (<manovra>_<modello>.csv).
function modelloDa(cols, nome) {
  if (cols.includes('Z_11') || cols.includes('Fy_11')) return 'dt';
  if (cols.includes('alpha_1') || cols.includes('Y_1')) return 'st';
  if (/_st(\.csv)?$/i.test(nome || '')) return 'st';
  return 'dt';
}

// ---------------------------------------------------------------- run
function nuovaRun({ name, label, modello, veicolo, csv }) {
  const p = parseCSV(csv);
  const mod = (modello || modelloDa(p.cols, name)).toLowerCase() === 'st' ? 'st' : 'dt';
  const ve = Object.assign({}, VEICOLO_DEFAULT);
  let veicoloDefault = true;
  if (veicolo && typeof veicolo === 'object') {
    for (const k of Object.keys(veicolo)) if (Number.isFinite(+veicolo[k])) ve[k] = +veicolo[k];
    veicoloDefault = false;
  }
  if (!(ve.l > 0)) ve.l = ve.a1 + ve.a2;
  const run = { name: name || 'run', label: label || name || 'run', modello: mod,
    veicolo: ve, veicoloDefault, percorso: null,
    cols: p.cols.slice(), data: p.data, n: p.n, show: true, derivate: [], disp: {} };
  aggiungiDerivate(run);
  run.statico = carichiStatici(run);
  return run;
}

// Colonne ricavate (offerte nei pannelli con le altre, elencate in run.derivate):
//  - DT: alpha_1, alpha_2 (media delle due ruote) e Y_1, Y_2 (somma in {B}) per il confronto col monotraccia;
//  - ST: delta_1, delta_2 dalle derive, esatte per il monotraccia (docs/convenzioni.md par. 8):
//        delta_1 = alpha_1 + (v + a1 r)/u,  delta_2 = alpha_2 + (v - a2 r)/u.
function aggiungiDerivate(run) {
  const d = run.data, n = run.n, ve = run.veicolo;
  const add = (c, f) => {
    if (d[c]) return;
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = f(i);
    d[c] = a; run.cols.push(c); run.derivate.push(c);
  };
  if (run.modello === 'dt') {
    if (d.alpha_11 && d.alpha_12) add('alpha_1', i => 0.5 * (d.alpha_11[i] + d.alpha_12[i]));
    if (d.alpha_21 && d.alpha_22) add('alpha_2', i => 0.5 * (d.alpha_21[i] + d.alpha_22[i]));
    if (d.Y_11 && d.Y_12) add('Y_1', i => d.Y_11[i] + d.Y_12[i]);
    if (d.Y_21 && d.Y_22) add('Y_2', i => d.Y_21[i] + d.Y_22[i]);
  } else if (d.u && d.v && d.r) {
    const U = i => Math.max(Math.abs(d.u[i]), 0.1);
    if (d.alpha_1) add('delta_1', i => d.alpha_1[i] + (d.v[i] + ve.a1 * d.r[i]) / U(i));
    if (d.alpha_2) add('delta_2', i => d.alpha_2[i] + (d.v[i] - ve.a2 * d.r[i]) / U(i));
  }
}

// Carichi statici per ruota: Z_1j^0 = m g a2/(2 l), Z_2j^0 = m g a1/(2 l). Il veicolo esportato non
// porta m e g: se mancano, m g si legge dalla telemetria come somma dei quattro Z al primo campione
// (esatto senza deportanza: i trasferimenti si elidono nella somma).
function carichiStatici(run) {
  const ve = run.veicolo, d = run.data;
  let mg = NaN, stimato = false;
  if (ve.m > 0) mg = ve.m * (ve.g > 0 ? ve.g : 9.81);
  else if (RUOTE.every(ij => d['Z_' + ij])) {
    mg = RUOTE.reduce((s, ij) => s + d['Z_' + ij][0], 0); stimato = true;
  }
  if (!Number.isFinite(mg)) return null;
  const Z1 = mg * ve.a2 / (2 * ve.l), Z2 = mg * ve.a1 / (2 * ve.l);
  return { mg, stimato, Z: { '11': Z1, '12': Z1, '21': Z2, '22': Z2 } };
}

// Indice dell'ultimo campione con t <= tq (fermo agli estremi).
function idxAt(run, tq) {
  const a = run.data.t; let lo = 0, hi = run.n - 1;
  if (tq >= a[hi]) return hi;
  if (tq <= a[0]) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= tq) lo = m; else hi = m - 1; }
  return lo;
}

function val(run, col, i, def) {
  const a = run && run.data[col];
  if (!a) return def;
  const v = a[i];
  return Number.isFinite(v) ? v : def;
}

const haRuote = run => run && run.modello === 'dt' && RUOTE.every(ij => run.data['Z_' + ij] && run.data['Fx_' + ij] && run.data['Fy_' + ij]);

// Stile di linea: il double track pieno, il monotraccia tratteggiato; più run dello stesso
// modello si distinguono col tratto e col colore.
const TRATTI_DT = ['solid', 'dot', 'longdash', 'dashdot'];
const TRATTI_ST = ['dash', 'dashdot', 'longdashdot', 'dot'];
const DASH_CANVAS = { solid: [], dot: [2, 3], dash: [7, 4], longdash: [12, 4], dashdot: [7, 3, 2, 3], longdashdot: [12, 3, 2, 3] };
const DASH_SVG = { solid: '', dot: '2,3', dash: '7,4', longdash: '12,4', dashdot: '7,3,2,3', longdashdot: '12,3,2,3' };
function assegnaStili() {
  let nd = 0, ns = 0;
  V.runs.forEach((r, k) => {
    r.colore = RUN_COLORI[k % RUN_COLORI.length];
    r.tratto = r.modello === 'st' ? TRATTI_ST[ns++ % TRATTI_ST.length] : TRATTI_DT[nd++ % TRATTI_DT.length];
  });
}

const visibili = () => V.runs.map((r, k) => k).filter(k => V.runs[k].show);
const refRun = () => V.runs[V.ref];

// ---------------------------------------------------------------- Magic Formula (docs/convenzioni.md par. 4)
function mfD(Z, ve) {
  if (!(Z > 0)) return 0;
  const dfz = (Z - ve.Fz0) / ve.Fz0;
  return (ve.lambda_mu ?? 1) * (ve.mf_pD1 + ve.mf_pD2 * dfz) * Z;
}
// Coefficienti B, C, D, E della curva al carico Z (come in pneumatico.m).
function mfCoeff(Z, ve) {
  const D = mfD(Z, ve);
  if (!(D > 0)) return null;
  const BCD = ve.mf_pK1 * ve.Fz0 * Math.sin(2 * Math.atan(Z / (ve.mf_pK2 * ve.Fz0)));
  return { B: BCD / (ve.mf_C * D), C: ve.mf_C, D, E: ve.mf_E };
}
function mfF(x, k) {
  if (!k) return 0;
  const Bx = k.B * x;
  return k.D * Math.sin(k.C * Math.atan(Bx - k.E * (Bx - Math.atan(Bx))));
}
// Scorrimento del picco: C atan(...) = pi/2 (se C > 1), per bisezione.
function mfPicco(k) {
  if (!k || !(k.C > 1)) return NaN;
  const g = x => { const Bx = k.B * x; return k.C * Math.atan(Bx - k.E * (Bx - Math.atan(Bx))) - Math.PI / 2; };
  let a = 0, b = 5 / k.B;
  if (g(b) < 0) return NaN;
  for (let it = 0; it < 50; it++) { const m = 0.5 * (a + b); if (g(m) < 0) a = m; else b = m; }
  return 0.5 * (a + b);
}

// ---------------------------------------------------------------- percorso
// Il percorso che il pilota segue arriva con le run, scritto da mostra_nel_viewer in due posti:
//  - in dati/telemetria.js, dopo le run e uguale per tutte:   window.PERCORSO = {...}
//  - accanto a ogni CSV, in risultati/<nome>.js, con i dati del veicolo di quella run:
//      window.AMBIENTE = {"name": "<nome>", "veicolo": {...}, "percorso": {...}}
//    (percorso manca se la prova non ne segue uno). Serve ai CSV aperti a mano: caricaAmbiente.
// In tutti e due il percorso è
//   {X: [...], Y: [...], larghezza: 0, coniX: [...], coniY: [...], mezzeriaX: [...], mezzeriaY: [...]}
// X, Y          punti del percorso in {S} (m), come le colonne X, Y delle run;
// larghezza     se > 0, pista d'asfalto larga così (m); 0 = niente pista;
// coniX, coniY  posizioni dei coni in {S} (m), anche vuote;
// mezzeriaX, mezzeriaY  punti della mezzeria della pista in {S} (m), anche vuoti o assenti. Se ci
//               sono, la pista è centrata sulla mezzeria e il percorso ci passa dentro, tagliando
//               le curve; se no, la pista è centrata sul percorso.
// Una linea (percorso o mezzeria) è chiusa (circuito) se il primo e l'ultimo punto distano meno
// di tre passi medi.
function leggiPercorso(p) {
  if (!p) return null;
  // jsonencode di MATLAB scrive un vettore di un solo elemento come numero, non come array
  const vettore = a => (Array.isArray(a) ? a : a === undefined || a === null ? [] : [a]).map(Number);
  const linea = lineaPerPunti(vettore(p.X), vettore(p.Y));
  if (!linea) return null;
  const coniX = vettore(p.coniX), coniY = vettore(p.coniY), nc = Math.min(coniX.length, coniY.length);
  return Object.assign(linea, { larghezza: +p.larghezza > 0 ? +p.larghezza : 0,
    coniX: coniX.slice(0, nc), coniY: coniY.slice(0, nc),
    mezzeria: lineaPerPunti(vettore(p.mezzeriaX), vettore(p.mezzeriaY)) });
}
// Linea per punti {X, Y, n, nx, ny, chiuso}, con la normale a sinistra in ogni punto; null se i
// punti sono meno di due.
function lineaPerPunti(X, Y) {
  if (X.length < 2 || X.length !== Y.length) return null;
  let lung = 0;
  for (let i = 1; i < X.length; i++) lung += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
  const chiusura = Math.hypot(X[X.length - 1] - X[0], Y[Y.length - 1] - Y[0]);
  const chiuso = X.length > 2 && chiusura < 3 * lung / (X.length - 1);
  if (chiuso && chiusura < 1e-3) { X.pop(); Y.pop(); }      // ultimo punto = primo: il giro si chiude da sé
  const n = X.length;
  // normale a sinistra della linea, (-ty, tx), dalla tangente per differenze centrate
  // (in avanti e all'indietro agli estremi di una linea aperta)
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = chiuso ? (i + n - 1) % n : Math.max(i - 1, 0), b = chiuso ? (i + 1) % n : Math.min(i + 1, n - 1);
    const tx = X[b] - X[a], ty = Y[b] - Y[a], L = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / L; ny[i] = tx / L;
  }
  return { X, Y, n, nx, ny, chiuso };
}
// Linea al centro della pista: la mezzeria se i dati la portano, altrimenti il percorso.
const centroPista = p => p.mezzeria || p;
// Curva parallela a una linea (il percorso o la mezzeria) a distanza d (m, positiva a sinistra);
// d = 0 è la linea stessa. Per una linea chiusa si ripete in fondo il primo punto, così si chiude.
function curvaParallela(p, d) {
  const x = [], y = [];
  for (let i = 0; i < p.n; i++) { x.push(p.X[i] + d * p.nx[i]); y.push(p.Y[i] + d * p.ny[i]); }
  if (p.chiuso) { x.push(x[0]); y.push(y[0]); }
  return { x, y };
}
// Il percorso da disegnare: quello della run di riferimento; se non ne ha, quello della prima run
// visibile che ne ha uno.
function percorsoDaMostrare() {
  const r = V.runs[V.ref];
  if (r && r.percorso) return r.percorso;
  const altra = V.runs.find(x => x.show && x.percorso);
  return altra ? altra.percorso : null;
}

// ---------------------------------------------------------------- caricamento
// EMBEDDED_RUNS = [{name, label, modello, veicolo, csv}], con il testo del CSV così com'è.
async function runsDaEmbedded(lista) {
  const out = [];
  for (const e of lista.slice(0, MAX_RUN)) {
    if (!e.csv) throw new Error((e.name || 'run') + ': nessun CSV');
    out.push(nuovaRun({ name: e.name, label: e.label, modello: e.modello, veicolo: e.veicolo, csv: e.csv }));
  }
  return out;
}

// Prima dati/telemetria.js (scritto da mostra_nel_viewer), poi dati/esempio.js. Il percorso si
// tiene solo se arriva con lo stesso file delle run, ed è di tutte le run del file.
// (Se c'è dati/prove.js si parte invece da una delle sue prove: "prove pronte", più sotto.)
async function caricaDatiIniziali() {
  for (const [file, descr] of [['dati/telemetria.js', 'telemetria.js'], ['dati/esempio.js', 'esempio.js']]) {
    window.EMBEDDED_RUNS = undefined;
    window.PERCORSO = undefined;
    const ok = await caricaScript(file);
    if (ok && Array.isArray(window.EMBEDDED_RUNS) && window.EMBEDDED_RUNS.length) {
      const runs = await runsDaEmbedded(window.EMBEDDED_RUNS), percorso = leggiPercorso(window.PERCORSO);
      runs.forEach(r => { r.percorso = percorso; });
      return { runs, fonte: descr };
    }
  }
  return { runs: [], fonte: '' };
}

// Veicolo e percorso di un CSV aperto a mano: il file <nome>.js che mostra_nel_viewer gli mette
// accanto. Il browser dà il nome del file scelto ma non la sua cartella: il .js si cerca in
// ../risultati/ rispetto alla pagina, cioè dove stanno i CSV scritti dalle prove. null se non c'è.
async function caricaAmbiente(nome) {
  window.AMBIENTE = undefined;
  const ok = await caricaScript('../risultati/' + encodeURIComponent(nome) + '.js');
  const amb = ok ? window.AMBIENTE : null;
  window.AMBIENTE = undefined;
  return amb && typeof amb === 'object' ? amb : null;
}
// Lo stesso file scelto o trascinato insieme al CSV (serve se il CSV non sta in risultati/): si
// legge come testo, perché dopo "window.AMBIENTE = " c'è un oggetto JSON. null se non lo è.
function ambienteDaTesto(testo) {
  try {
    const amb = JSON.parse(testo.slice(testo.indexOf('{'), testo.lastIndexOf('}') + 1));
    return amb && typeof amb === 'object' ? amb : null;
  } catch (e) { return null; }
}

// Una run dal testo del suo CSV e dal suo ambiente {veicolo, percorso}. Senza ambiente (null) il
// veicolo è veicoloAltrui (quello di un'altra run; null = quello di default) e il percorso non c'è.
function runConAmbiente(nome, csv, amb, veicoloAltrui, etichetta) {
  const run = nuovaRun({ name: nome, label: etichetta || nome, csv, veicolo: amb && amb.veicolo ? amb.veicolo : veicoloAltrui });
  run.percorso = amb ? leggiPercorso(amb.percorso) : null;
  run.senzaAmbiente = !amb;
  return run;
}

// ---------------------------------------------------------------- prove pronte
// Se accanto alla pagina c'è dati/prove.js, il viewer parte da lì e la barra delle run mostra il
// menu "prova", con una scelta di simulazioni già fatte (il file non c'è nella cartella di lavoro:
// lo scrive chi mette il viewer in rete):
//   window.PROVE = [{"id": "sele", "titolo": "...", "descrizione": "...",
//                    "run": ["sele_profilo_dt"], "etichette": ["giro"]}, ...];
//   window.PROVE_VERSIONE = "20261119T1530";                  // cambia quando i dati vengono rifatti
//   window.PROVE_CREDITO = {"testo": "...", "link": "...", "nota": "..."};   // facoltativo, in fondo alla barra
//   window.PROVE_AVVIA = true;                                // facoltativo: la prova aperta parte da sola
// Ogni run sta in dati/prove/<nome>.js: il testo del suo CSV e, come nel file accanto ai CSV di
// risultati/, il suo ambiente:
//   window.CSV_RUN = "t,X,Y,...";
//   window.AMBIENTE = {"name": "<nome>", "veicolo": {...}, "percorso": {...}};
async function caricaElencoProve() {
  window.PROVE = undefined;
  const ok = await caricaScript('dati/prove.js');
  const elenco = ok && Array.isArray(window.PROVE) ? window.PROVE : [];
  return elenco.filter(p => p && p.id && Array.isArray(p.run) && p.run.length);
}
// {csv, amb} di una run di dati/prove/; null se il file non c'è o non porta il CSV.
async function caricaRunDiProva(nome) {
  window.CSV_RUN = undefined;
  window.AMBIENTE = undefined;
  const file = 'dati/prove/' + encodeURIComponent(nome) + '.js';
  // in rete una richiesta può cadere a metà: si riprova una volta
  const ok = await caricaScript(file, window.PROVE_VERSIONE) || await caricaScript(file, window.PROVE_VERSIONE);
  const csv = ok ? window.CSV_RUN : null, amb = ok ? window.AMBIENTE : null;
  window.CSV_RUN = undefined;
  window.AMBIENTE = undefined;
  return typeof csv === 'string' ? { csv, amb: amb && typeof amb === 'object' ? amb : null } : null;
}

// Per i test in node (node -e "require('./js/dati.js')"): esporta le funzioni pure.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCSV, nuovaRun, modelloDa, carichiStatici, idxAt, mfD, mfCoeff, mfF, mfPicco, leggiPercorso, centroPista, curvaParallela,
    ambienteDaTesto, VEICOLO_DEFAULT, RUOTE };
}
