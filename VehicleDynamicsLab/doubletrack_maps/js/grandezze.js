// grandezze.js - le grandezze delle mappe: come si leggono dai dati, in che unità si
// mostrano, con che colori. Nei dati (dati/mappe.js, scritto da esporta_mappe) gli
// angoli sono in radianti, le velocità in m/s, le forze in N.
'use strict';

const DEG = 180 / Math.PI;

// Colori semantici, gli stessi del deck: u blu, δ teal, ã_y rosso, ρ verde, β viola.
// Controllati sullo sfondo scuro (#1e1e24) con validate_palette della skill dataviz,
// su tutte le coppie: banda di luminosità, croma, separazione per i daltonismi
// (ΔE ≥ 8), distanza in visione normale (ΔE ≥ 15), contrasto ≥ 3:1. Le curve di
// livello sono continue e fini (tratteggiate non si vedevano): le distingue il
// colore, e ognuna porta l'etichetta del suo valore.
const COLORE = {
  u: '#0278e7', delta: '#19a7a7', ayt: '#d23855', rho: '#5cad13', beta: '#a94bbe',
  oltre: '#6c6c78',        // chiocciole dopo la fine degli equilibri
  bordo: '#e6e6ea',        // bordo della mappa
  scelta: '#ffd84d',       // curva scelta (quella che ▶ percorre)
  // punto fissato con un clic. Magenta chiaro: contro tutti gli altri colori di questa
  // lista, uno per uno, validate_palette dà ΔE ≥ 18 in visione normale e ≥ 9 nei
  // daltonismi rosso-verde (il più vicino è il viola di β)
  fissato: '#ff70dc',
  picco: '#ff9d1a',        // pneumatico oltre il picco (come nel viewer di easy)
  confronto: '#c2b280',    // veicolo di confronto
  testo: '#d0d0d8', tenue: '#8c8c98', griglia: '#2a2a32',
};

// motivo (ramo_primario) delle chiocciole in cui la mappa finisce perché il veicolo si gira
const GIRA = 'non più quasi statico';
// tratti delle chiocciole che si aprono nel viewer 3D (riga sopra il cursore del tempo)
const COLORE_3D = '#7fb2e6';

// Grandezze che si possono mettere sugli assi. col: colonna dei dati; k: fattore
// verso l'unità mostrata; f: trasformazione (al posto di k); lim: intervallo fisso
// dell'asse (R va all'infinito in rettilineo).
// ã_y è l'accelerazione laterale della prova (grandezze_mappa: forze laterali diviso
// massa), che all'equilibrio vale u r; ρ = ã_y/u² e S = −βR vengono da quella. Nella
// prova, vicino al limite, u r cresce con l'imbardata del veicolo che comincia a girarsi.
const GRANDEZZE = {
  delta_v: { voce: 'δv  volante', titolo: 'volante δ<sub>v</sub> [°]', col: 'delta_v', k: DEG, cifre: 1, unita: '°' },
  delta:   { voce: 'δ  sterzo alle ruote', titolo: 'sterzo alle ruote δ = τ<sub>1</sub>δ<sub>v</sub> [°]', col: 'delta', k: DEG, cifre: 2, unita: '°' },
  u:       { voce: 'u  velocità', titolo: 'velocità u [km/h]', col: 'u', k: 3.6, cifre: 1, unita: 'km/h' },
  ayt:     { voce: 'ãy  accelerazione laterale', titolo: 'accelerazione laterale ã<sub>y</sub> [m/s²]', col: 'ayt', k: 1, cifre: 2, unita: 'm/s²' },
  rho:     { voce: 'ρ  curvatura', titolo: 'curvatura ρ = ã<sub>y</sub>/u² [1/m]', col: 'rho', k: 1, cifre: 4, unita: '1/m' },
  R:       { voce: 'R  raggio', titolo: 'raggio R = 1/ρ [m]', col: 'rho', f: x => 1 / x, lim: [0, 250], cifre: 0, unita: 'm' },
  beta:    { voce: 'β  assetto', titolo: 'assetto β = v/u [°]', col: 'beta', k: DEG, cifre: 2, unita: '°' },
  S:       { voce: 'S  ascissa di C', titolo: 'S = −βR [m]', col: 'S', k: 1, cifre: 2, unita: 'm' },
  Dalpha:  { voce: 'Δα  α1 − α2', titolo: 'Δα = α<sub>1</sub> − α<sub>2</sub> [°]', col: 'Dalpha', k: DEG, cifre: 2, unita: '°' },
  alpha1:  { voce: 'α1  deriva anteriore', titolo: 'deriva anteriore α<sub>1</sub> [°]', col: 'alpha1', k: DEG, cifre: 2, unita: '°' },
  alpha2:  { voce: 'α2  deriva posteriore', titolo: 'deriva posteriore α<sub>2</sub> [°]', col: 'alpha2', k: DEG, cifre: 2, unita: '°' },
  Y1:      { voce: 'Y1  forza laterale anteriore', titolo: 'forza laterale anteriore Y<sub>1</sub> [kN]', col: 'Y1', k: 1e-3, cifre: 2, unita: 'kN' },
  Y2:      { voce: 'Y2  forza laterale posteriore', titolo: 'forza laterale posteriore Y<sub>2</sub> [kN]', col: 'Y2', k: 1e-3, cifre: 2, unita: 'kN' },
};

// Insiemi di quattro piani.
const PRESET = [
  { voce: 'MAP classiche', piani: [['delta', 'ayt'], ['delta', 'u'], ['rho', 'beta'], ['delta', 'rho']] },
  { voce: 'handling diagram', piani: [['Dalpha', 'ayt'], ['delta', 'ayt'], ['alpha1', 'Y1'], ['alpha2', 'Y2']] },
  { voce: 'derive degli assali', piani: [['alpha1', 'ayt'], ['alpha2', 'ayt'], ['Dalpha', 'ayt'], ['ayt', 'beta']] },
  { voce: 'assetto e centro C', piani: [['u', 'beta'], ['rho', 'beta'], ['S', 'R'], ['delta', 'beta']] },
];

// Famiglie di curve di livello (esporta_mappe: curve.delta, .ayt, .rho, .beta).
const FAMIGLIE = [
  { chiave: 'delta', voce: 'iso-δ', colore: COLORE.delta, dash: 'solid', testo: v => 'δ ' + fmt(v * DEG, 0) + '°', lungo: v => 'δ = ' + fmt(v * DEG, 0) + '° alle ruote' },
  { chiave: 'ayt', voce: 'iso-ãy', colore: COLORE.ayt, dash: 'solid', testo: v => 'ã<sub>y</sub> ' + fmt(v, 0), lungo: v => 'ãy = ' + fmt(v, 0) + ' m/s²' },
  { chiave: 'rho', voce: 'iso-ρ', colore: COLORE.rho, dash: 'solid', testo: v => 'R ' + fmt(1 / v, 0), lungo: v => 'R = ' + fmt(1 / v, 0) + ' m (steering pad)' },
  { chiave: 'beta', voce: 'iso-β', colore: COLORE.beta, dash: 'solid', testo: v => 'β ' + fmt(v * DEG, 0) + '°', lungo: v => 'β = ' + fmt(v * DEG, 0) + '°' },
];

// Il monotraccia di riferimento (riferimento_monotraccia): curve note per alcune
// coppie di assi. Restituisce {x, y} oppure null.
function riferimento(rif, gx, gy) {
  if (!rif || !rif.ayt) return null;
  const deg = a => a.map(x => x * DEG), kN = a => a.map(x => x / 1e3);
  const coppie = {
    'Dalpha|ayt': () => [deg(rif.Dalpha), rif.ayt],
    'alpha1|ayt': () => [deg(rif.alpha1), rif.ayt],
    'alpha2|ayt': () => [deg(rif.alpha2), rif.ayt],
    'alpha1|Y1': () => [deg(rif.alpha), kN(rif.Y1)],
    'alpha2|Y2': () => [deg(rif.alpha), kN(rif.Y2)],
  };
  if (coppie[gx + '|' + gy]) { const [x, y] = coppie[gx + '|' + gy](); return { x, y }; }
  if (coppie[gy + '|' + gx]) { const [y, x] = coppie[gy + '|' + gx](); return { x, y }; }
  return null;
}

// Una colonna di dati nell'unità della grandezza.
function valori(dati, nome) {
  const g = GRANDEZZE[nome], col = dati[g.col];
  if (!col) return [];
  const out = new Array(col.length);
  for (let i = 0; i < col.length; i++) {
    const x = col[i];
    out[i] = (x === null || x === undefined) ? NaN : (g.f ? g.f(x) : x * g.k);
  }
  return out;
}

// Il valore di una grandezza in uno stato (oggetto con le colonne come campi).
function valore(stato, nome) {
  const g = GRANDEZZE[nome], x = stato[g.col];
  if (x === undefined || x === null || Number.isNaN(x)) return NaN;
  return g.f ? g.f(x) : x * g.k;
}

// Numeri all'italiana: virgola decimale e segno meno tipografico.
function fmt(x, cifre) {
  if (!Number.isFinite(x)) return '—';
  const s = x.toFixed(cifre);
  return (Number(s) === 0 ? s.replace('-', '') : s).replace('.', ',').replace('-', '−');
}

// Blu sequenziale per le chiocciole (che sono le curve a u costante): più chiaro
// alle velocità alte. Colori in OKLCH, convertiti in sRGB.
function oklch(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
               -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return '#' + rgb.map(x => {
    x = Math.min(1, Math.max(0, x));
    x = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(x * 255).toString(16).padStart(2, '0');
  }).join('');
}
function coloreVelocita(kmh, kmin, kmax) {
  const f = (kmh - kmin) / Math.max(1, kmax - kmin);
  return oklch(0.46 + 0.42 * f, 0.15 - 0.06 * f, 258);
}
