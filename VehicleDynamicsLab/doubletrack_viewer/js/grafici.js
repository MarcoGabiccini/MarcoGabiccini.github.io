// grafici.js — traiettoria (X, Y) e pannelli dei segnali (Plotly).
'use strict';

const N_SEGNALI = 6;
const RAD2DEG = 180 / Math.PI;
const MODEBAR = { displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toImage'], scrollZoom: true, responsive: false };
const LAYOUT_SCURO = {
  paper_bgcolor: '#1e1e24', plot_bgcolor: '#1e1e24', font: { color: '#ddd', size: 11 },
  margin: { t: 8, r: 8, b: 34, l: 48 }, dragmode: 'zoom', showlegend: false,
};
let tView = null;          // finestra temporale dei pannelli [t0, t1]; null = tutto

// Angoli in gradi nei grafici (docs/convenzioni.md: gradi solo nei grafici).
const ANGOLI = /^(psi|beta|delta_v|delta_\d+|gamma_\d\d|alpha_\d+|phi[12]|theta)$/;
const UNITA = [
  [/^t$/, 's'], [/^[XY]$/, 'm'], [/^(u|v)$/, 'm/s'], [/^r$/, '°/s'], [/^(ax|ay)(_f)?$/, 'm/s²'],
  [ANGOLI, '°'], [/^(Tt|Tb)$/, 'N·m'], [/^(Z|Fx|Fy|X|Y)_\d+$/, 'N'], [/^(sigmax|sigmay|kappax)_/, '–'],
  [/^omega_/, 'rad/s'],
];
function unitaDi(col) {
  if (COMPOSITI[col]) return COMPOSITI[col].unita;
  for (const [re, u] of UNITA) if (re.test(col)) return u;
  return '';
}
// Serie da disegnare (convertita in gradi se è un angolo), in cache sulla run.
function serieDisp(run, col) {
  if (!run.data[col]) return null;
  if (run.disp[col]) return run.disp[col];
  const a = run.data[col];
  let out = a;
  if (ANGOLI.test(col) || col === 'r') { out = new Float64Array(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] * RAD2DEG; }
  run.disp[col] = out;
  return out;
}

// Segnali compositi: più colonne nello stesso pannello, ciascuna col suo colore.
const perRuota = q => RUOTE.map(ij => ({ col: q + '_' + ij, colore: COLORE_RUOTA[ij], nome: ij }));
const perAssale = q => ['1', '2'].map(i => ({ col: q + '_' + i, colore: COLORE_ASSALE[i], nome: i === '1' ? 'ant.' : 'post.' }));
const COMPOSITI = {
  'ax, ay': { unita: 'm/s²', parti: [{ col: 'ax', colore: '#ffd54f', nome: 'ax' }, { col: 'ay', colore: '#4dd0e1', nome: 'ay' },
    { col: 'ax_f', colore: '#a1887f', nome: 'ax_f' }, { col: 'ay_f', colore: '#80cbc4', nome: 'ay_f' }] },
  'u, v': { unita: 'm/s', parti: [{ col: 'u', colore: '#ffd54f', nome: 'u' }, { col: 'v', colore: '#4dd0e1', nome: 'v' }] },
  'Tt, Tb': { unita: 'N·m', parti: [{ col: 'Tt', colore: '#00e676', nome: 'Tt motrice' }, { col: 'Tb', colore: '#f44336', nome: 'Tb frenante' }] },
  'rollio e beccheggio': { unita: '°', parti: [{ col: 'phi1', colore: '#00e5ff', nome: 'phi1' }, { col: 'phi2', colore: '#ff4de8', nome: 'phi2' },
    { col: 'theta', colore: '#ffd54f', nome: 'theta' }] },
  'alpha assali': { unita: '°', parti: perAssale('alpha') },
  'Y assali': { unita: 'N', parti: perAssale('Y') },
  'delta assali': { unita: '°', parti: perAssale('delta') },
  'Z ruote': { unita: 'N', parti: perRuota('Z') },
  'Fx ruote': { unita: 'N', parti: perRuota('Fx') },
  'Fy ruote': { unita: 'N', parti: perRuota('Fy') },
  'X ruote ({B})': { unita: 'N', parti: perRuota('X') },
  'Y ruote ({B})': { unita: 'N', parti: perRuota('Y') },
  'alpha ruote': { unita: '°', parti: perRuota('alpha') },
  'sigmax ruote': { unita: '–', parti: perRuota('sigmax') },
  'sigmay ruote': { unita: '–', parti: perRuota('sigmay') },
  'kappax ruote': { unita: '–', parti: perRuota('kappax') },
  'omega ruote': { unita: 'rad/s', parti: perRuota('omega') },
  'delta ruote': { unita: '°', parti: perRuota('delta') },
  'gamma ruote': { unita: '°', parti: perRuota('gamma') },
};
// Le parti di un composito presenti in almeno una run caricata.
function partiComposito(nome) {
  const c = COMPOSITI[nome];
  return c ? c.parti.filter(p => V.runs.some(r => r.data[p.col])) : null;
}
const GRUPPI = [
  ['Posizione', /^(X|Y|psi)$/], ['Cinematica', /^(u|v|r|beta|ax|ay|ax_f|ay_f)$/], ['Ingressi', /^(delta_v|Tt|Tb)$/],
  ['Cassa', /^(phi1|phi2|theta)$/], ['Assali', /^(alpha|Y|delta)_[12]$/], ['Carichi', /^Z_\d\d$/],
  ['Forze', /^(Fx|Fy|X|Y)_\d\d$/], ['Scorrimenti', /^(alpha|sigmax|sigmay|kappax)_\d\d$/],
  ['Ruote', /^(delta|gamma|omega)_\d\d$/],
];
function opzioniRaggruppate(opz) {
  const preso = new Set(); let html = '';
  const blocco = (lab, l) => `<optgroup label="${lab}">` + l.map(o => `<option value="${o}">${o}</option>`).join('') + '</optgroup>';
  const comp = opz.filter(o => COMPOSITI[o]); comp.forEach(o => preso.add(o));
  if (comp.length) html += blocco('Compositi', comp);
  for (const [lab, re] of GRUPPI) {
    const g = opz.filter(o => !preso.has(o) && re.test(o)); g.forEach(o => preso.add(o));
    if (g.length) html += blocco(lab, g);
  }
  const resto = opz.filter(o => !preso.has(o));
  if (resto.length) html += blocco('Altro', resto);
  return html;
}
function tutteLeColonne() {
  const s = new Set(); V.runs.forEach(r => r.cols.forEach(c => s.add(c))); s.delete('t'); return [...s];
}

function intervalloRun() {
  const act = visibili().length ? visibili() : V.runs.map((r, k) => k);
  if (!act.length) return [0, 1];
  return [Math.min(...act.map(k => V.runs[k].data.t[0])), Math.max(...act.map(k => { const r = V.runs[k]; return r.data.t[r.n - 1]; }))];
}

// ---------------------------------------------------------------- traiettoria
let dimMarker = 1;
function triangolo(x, y, psi, s) {
  const p = [[s, 0], [-0.6 * s, 0.45 * s], [-0.6 * s, -0.45 * s], [s, 0]];
  const c = Math.cos(psi), sn = Math.sin(psi);
  return { x: p.map(q => x + q[0] * c - q[1] * sn), y: p.map(q => y + q[0] * sn + q[1] * c) };
}
// ---------------------------------------------------------------- overlay del cursore
// Plotly ricalcola e ridisegna tutte le tracce a ogni restyle (15-25 ms per pannello): le tracce
// restano ferme e il cursore (linea del tempo, punti correnti, futuro attenuato, auto) va su un
// canvas sovrapposto, posizionato con le trasformazioni degli assi di Plotly.
function conOverlay(div, disegna) {
  if (!div || !div._fullLayout) return;
  if (!div._ovl) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;pointer-events:none;';
    div.parentNode.appendChild(cv);
    div._ovl = cv;
    div.on('plotly_afterplot', () => { if (div._ovlDraw) div._ovlDraw(); });
  }
  const cv = div._ovl;
  cv.style.left = div.offsetLeft + 'px'; cv.style.top = div.offsetTop + 'px';
  cv.style.width = div.clientWidth + 'px'; cv.style.height = div.clientHeight + 'px';
  const { ctx } = prepCanvas(cv);
  const xa = div._fullLayout.xaxis, ya = div._fullLayout.yaxis;
  if (!xa || !ya || !xa._length || !ya._length) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(xa._offset, ya._offset, xa._length, ya._length); ctx.clip();
  disegna({ ctx, xa, ya, X: x => xa._offset + xa.l2p(x), Y: y => ya._offset + ya.l2p(y) });
  ctx.restore();
}

// Percorso da seguire (V.percorso), sotto le traiettorie: pista come nastro grigio con i bordi
// (attorno alla mezzeria, se i dati la portano, altrimenti attorno al percorso), percorso
// tratteggiato, coni arancioni.
function traccePercorso() {
  const p = V.percorso;
  if (!p) return [];
  const tracce = [], muta = { hoverinfo: 'skip', showlegend: false };
  if (p.larghezza > 0) {
    const centro = centroPista(p), sx = curvaParallela(centro, p.larghezza / 2), dx = curvaParallela(centro, -p.larghezza / 2);
    // un solo poligono: bordo sinistro all'andata e destro al ritorno (per un circuito è un anello)
    tracce.push(Object.assign({ x: sx.x.concat(dx.x.slice().reverse()), y: sx.y.concat(dx.y.slice().reverse()),
      mode: 'lines', type: 'scatter', fill: 'toself', fillcolor: 'rgba(150,155,170,0.18)', line: { width: 0 } }, muta));
    tracce.push(Object.assign({ x: sx.x.concat([null], dx.x), y: sx.y.concat([null], dx.y),
      mode: 'lines', type: 'scatter', line: { color: 'rgba(200,200,215,0.5)', width: 1 } }, muta));
  }
  const c = curvaParallela(p, 0);
  tracce.push({ x: c.x, y: c.y, mode: 'lines', type: 'scattergl', line: { color: COLORE_PERCORSO, width: 1, dash: 'dash' },
    name: 'percorso', hovertemplate: 'percorso<br>X %{x:.2f} m<br>Y %{y:.2f} m<extra></extra>' });
  if (p.coniX.length) tracce.push({ x: p.coniX, y: p.coniY, mode: 'markers', type: 'scattergl',
    marker: { symbol: 'triangle-up', size: 7, color: COLORE_CONI }, name: 'coni', hovertemplate: 'cono<br>X %{x:.2f} m<br>Y %{y:.2f} m<extra></extra>' });
  return tracce;
}

function initTraiettoria() {
  let xr = [Infinity, -Infinity], yr = [Infinity, -Infinity];
  const estendi = (x, y) => { if (x < xr[0]) xr[0] = x; if (x > xr[1]) xr[1] = x; if (y < yr[0]) yr[0] = y; if (y > yr[1]) yr[1] = y; };
  V.runs.forEach(r => { for (let i = 0; i < r.n; i++) estendi(r.data.X[i], r.data.Y[i]); });
  if (V.percorso) V.percorso.X.forEach((x, i) => estendi(x, V.percorso.Y[i]));
  dimMarker = Math.max(xr[1] - xr[0], yr[1] - yr[0], 10) * 0.025;
  const tracce = traccePercorso().concat(visibili().map(k => {
    const r = V.runs[k];
    return { x: r.data.X, y: r.data.Y, mode: 'lines', type: 'scattergl', line: { color: r.colore, width: 1.2, dash: r.tratto },
      opacity: 0.45, name: r.label, hovertemplate: r.label + '<br>X %{x:.2f} m<br>Y %{y:.2f} m<extra></extra>' };
  }));
  const layout = Object.assign({}, LAYOUT_SCURO, {
    margin: { t: 24, r: 8, b: 36, l: 50 },
    title: { text: 'Traiettoria di G in {S}', font: { size: 12 }, x: 0.02, y: 0.98 },
    xaxis: { title: { text: 'X (m)' }, automargin: true, gridcolor: '#3a3a44', zerolinecolor: '#555' },
    yaxis: { title: { text: 'Y (m)' }, automargin: true, gridcolor: '#3a3a44', zerolinecolor: '#555', scaleanchor: 'x', scaleratio: 1 },
    showlegend: visibili().length > 1 || !!V.percorso, legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.0, yanchor: 'bottom', font: { size: 10 } },
  });
  const div = document.getElementById('trajPlot');
  Plotly.react(div, tracce, layout, MODEBAR);
  div._ovlDraw = aggiornaTraiettoria;
}
// Percorso già fatto in evidenza e auto (triangolo verde in trazione, rosso in frenata).
function aggiornaTraiettoria() {
  conOverlay(document.getElementById('trajPlot'), o => {
    const ctx = o.ctx;
    visibili().forEach(k => {
      const r = V.runs[k], d = r.data, i = idxAt(r, V.tNow);
      ctx.strokeStyle = r.colore; ctx.lineWidth = 2.4; ctx.setLineDash(DASH_CANVAS[r.tratto] || []);
      ctx.beginPath(); ctx.moveTo(o.X(d.X[0]), o.Y(d.Y[0]));
      for (let q = 1; q <= i; q++) ctx.lineTo(o.X(d.X[q]), o.Y(d.Y[q]));
      ctx.stroke();
      const tri = triangolo(d.X[i], d.Y[i], val(r, 'psi', i, 0), dimMarker);
      const Tb = val(r, 'Tb', i, 0), Tt = val(r, 'Tt', i, 0);
      ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.strokeStyle = r.colore;
      ctx.fillStyle = Tb > 1 ? '#f44336' : Tt > 1 ? '#4caf50' : hexAlpha(r.colore, 0.8);
      ctx.beginPath(); tri.x.forEach((x, q) => q ? ctx.lineTo(o.X(x), o.Y(tri.y[q])) : ctx.moveTo(o.X(x), o.Y(tri.y[q])));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
  });
}

// ---------------------------------------------------------------- pannelli dei segnali
function creaSlotSegnali() {
  const sec = document.getElementById('sigSec');
  sec.innerHTML = '';
  for (let k = 0; k < N_SEGNALI; k++) {
    const s = document.createElement('div');
    s.className = 'slot';
    s.innerHTML = `<select id="sel${k}"></select><div id="plot${k}" class="plot"></div>` +
      '<span class="legInfo">i<div class="legBox"></div></span>';
    sec.appendChild(s);
  }
}
function initSegnali(tieni) {
  const comp = Object.keys(COMPOSITI).filter(n => (partiComposito(n) || []).length);
  const opz = comp.concat(tutteLeColonne());
  const scegli = (...w) => w.find(x => opz.includes(x));
  const def = [
    scegli('ax, ay', 'ay') || opz[0],
    scegli('delta_v') || opz[1],
    scegli('r') || opz[2],
    scegli('alpha assali', 'beta') || opz[3],
    scegli('Y assali', 'Fy ruote') || opz[4],
    scegli('rollio e beccheggio', 'beta', 'u') || opz[5],
  ];
  for (let k = 0; k < N_SEGNALI; k++) {
    const sel = document.getElementById('sel' + k);
    const prima = sel.value;
    sel.innerHTML = opzioniRaggruppate(opz);
    sel.value = tieni && opz.includes(prima) ? prima : (def[k] || opz[0]);
    sel.onchange = () => disegnaSegnale(k);
    disegnaSegnale(k);
  }
}
// Le serie di un pannello per la run r: [{y, colore, nome}] (vuoto se la run non ha la colonna).
function serieDelPannello(nome, r) {
  const parti = partiComposito(nome);
  if (parti) return parti.map(p => ({ y: serieDisp(r, p.col), colore: p.colore, nome: p.nome }));
  return [{ y: serieDisp(r, nome), colore: r.colore, nome }];
}
function disegnaSegnale(k) {
  const nome = document.getElementById('sel' + k).value;
  const act = visibili();
  const tracce = [], legenda = [];
  act.forEach(kr => {
    const r = V.runs[kr];
    serieDelPannello(nome, r).forEach(s => {
      if (!s.y) return;
      const lab = (act.length > 1 ? r.label + ' ' : '') + (s.nome === nome ? '' : s.nome);
      tracce.push({ x: r.data.t, y: s.y, mode: 'lines', type: 'scattergl', line: { color: s.colore, width: 1.6, dash: r.tratto },
        name: lab || nome, hovertemplate: (lab || nome) + ': %{y:.4g}<extra></extra>' });
      legenda.push({ colore: s.colore, tratto: r.tratto, nome: lab || nome });
    });
  });
  const layout = Object.assign({}, LAYOUT_SCURO, {
    hovermode: 'x',
    xaxis: { title: { text: 't (s)', standoff: 4 }, automargin: true, gridcolor: '#3a3a44', range: tView ? tView.slice() : intervalloRun(), autorange: false },
    yaxis: { title: { text: '(' + (unitaDi(nome) || '–') + ')', standoff: 4 }, automargin: true, gridcolor: '#3a3a44', zerolinecolor: '#666', autorange: true },
  });
  const div = document.getElementById('plot' + k);
  Plotly.react(div, tracce, layout, MODEBAR);
  div._ovlDraw = () => aggiornaSegnale(k);
  legendaPannello(k, legenda);
  aggiornaSegnale(k);
}
function legendaPannello(k, voci) {
  const info = document.getElementById('plot' + k).parentNode.querySelector('.legInfo');
  info.style.display = voci.length > 1 ? 'block' : 'none';
  info.firstElementChild.innerHTML = voci.map(v => '<div><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="' +
    v.colore + '" stroke-width="2" stroke-dasharray="' + (DASH_SVG[v.tratto] || '') + '"/></svg>' + v.nome + '</div>').join('');
}
// Cursore: futuro attenuato, linea del tempo, punto corrente di ogni serie.
function aggiornaSegnale(k) {
  const sel = document.getElementById('sel' + k), div = document.getElementById('plot' + k);
  if (!sel || !div || div.offsetParent === null) return;
  conOverlay(div, o => {
    const ctx = o.ctx, x0 = o.X(V.tNow), xe = o.xa._offset + o.xa._length;
    ctx.fillStyle = 'rgba(30,30,36,0.6)';
    if (xe > x0) ctx.fillRect(x0, o.ya._offset, xe - x0, o.ya._length);
    ctx.strokeStyle = 'rgba(220,220,220,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, o.ya._offset); ctx.lineTo(x0, o.ya._offset + o.ya._length); ctx.stroke();
    visibili().forEach(kr => {
      const r = V.runs[kr], i = idxAt(r, V.tNow);
      serieDelPannello(sel.value, r).forEach(s => {
        if (!s.y || !Number.isFinite(s.y[i])) return;
        ctx.fillStyle = s.colore; ctx.strokeStyle = '#1e1e24'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(o.X(r.data.t[i]), o.Y(s.y[i]), 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      });
    });
  });
}
function aggiornaSegnali() { for (let k = 0; k < N_SEGNALI; k++) aggiornaSegnale(k); }

function impostaFinestra(t0, t1) {
  const [lo, hi] = intervalloRun();
  if (!Number.isFinite(t0)) t0 = lo;
  if (!Number.isFinite(t1)) t1 = hi;
  if (t1 < t0) [t0, t1] = [t1, t0];
  t0 = Math.max(lo, t0); t1 = Math.min(hi, t1);
  if (t1 - t0 < 1e-6) t1 = Math.min(hi, t0 + 1e-3);
  tView = [t0, t1];
  sincronizzaFinestra();
  for (let k = 0; k < N_SEGNALI; k++) {
    const div = document.getElementById('plot' + k);
    if (div && div.data) Plotly.relayout(div, { 'xaxis.range': [t0, t1], 'yaxis.autorange': true });
  }
}
function finestraCompleta() {
  tView = null;
  sincronizzaFinestra();
  for (let k = 0; k < N_SEGNALI; k++) {
    const div = document.getElementById('plot' + k);
    if (div && div.data) Plotly.relayout(div, { 'xaxis.range': intervalloRun(), 'yaxis.autorange': true });
  }
}
function sincronizzaFinestra() {
  const [a, b] = tView || intervalloRun();
  document.getElementById('tView0').value = a.toFixed(3);
  document.getElementById('tView1').value = b.toFixed(3);
}
function ridimensionaGrafici() {
  ['trajPlot'].concat([...Array(N_SEGNALI).keys()].map(k => 'plot' + k)).forEach(id => {
    const div = document.getElementById(id);
    if (div && div.data && div.offsetParent !== null) Plotly.Plots.resize(div);
  });
}
