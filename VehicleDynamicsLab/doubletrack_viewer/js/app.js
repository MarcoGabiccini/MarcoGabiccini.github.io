// app.js — collega tutto: barra delle run, riproduzione, caricamento dei dati, comandi.
'use strict';

const $ = id => document.getElementById(id);
let velocita = 1, inLoop = false, suonando = false, rafId = null, t0Reale = 0, t0Sim = 0;
let customExpr = '';
try { customExpr = localStorage.getItem('dv.viewer.custom') || ''; } catch (e) { /* storage non disponibile */ }

function stato(msg) { $('status').textContent = msg; $('status').title = msg; }

// ---------------------------------------------------------------- run
function aggiornaBarraRun() {
  $('runSlots').innerHTML = V.runs.map((r, k) =>
    `<button class="runBtn${r.show ? '' : ' off'}" data-k="${k}" title="mostra / nascondi${r.veicoloDefault ? ' — veicolo: quello di default' : ''}${r.derivate.length ? '\ncolonne ricavate: ' + r.derivate.join(', ') : ''}">` +
    `<svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="${r.colore}" stroke-width="2.2" stroke-dasharray="${DASH_SVG[r.tratto] || ''}"/></svg>` +
    `<span>${r.label}</span><span class="badge ${r.modello}">${r.modello.toUpperCase()}</span>` +
    `<span class="rm" data-rm="${k}" title="togli la run">✕</span></button>`).join('');
  $('runSlots').querySelectorAll('.runBtn').forEach(b => b.addEventListener('click', e => {
    const k = +b.dataset.k;
    if (e.target.dataset.rm !== undefined) { togliRun(k); return; }
    if (k === V.ref && V.runs[k].show) return;       // il riferimento resta visibile
    V.runs[k].show = !V.runs[k].show;
    ridisegnaTutto(true);
  }));
  $('refSel').innerHTML = V.runs.map((r, k) => `<option value="${k}">${r.label}</option>`).join('');
  $('refSel').value = V.ref;
}
function togliRun(k) {
  V.runs.splice(k, 1);
  if (V.ref >= V.runs.length || V.ref === k) V.ref = primoDT();
  else if (V.ref > k) V.ref--;
  if (!V.runs.length) { stato('Nessuna run: carica un CSV.'); }
  ridisegnaTutto(true);
}
const primoDT = () => Math.max(0, V.runs.findIndex(r => r.modello === 'dt'));

function calcolaCustom(r) {
  r.cols = r.cols.filter(c => c !== 'custom');
  delete r.data.custom; delete r.disp.custom;
  const ex = customExpr.trim().replace(/;+$/, '');
  if (!ex) return;
  const nomi = r.cols.filter(c => /^[A-Za-z_$][\w$]*$/.test(c));
  const mat = Object.getOwnPropertyNames(Math).filter(m => !nomi.includes(m));
  const fn = new Function(...mat, ...nomi, '"use strict"; return (' + ex + ');');
  const mv = mat.map(m => Math[m]), ser = nomi.map(c => r.data[c]);
  const out = new Float64Array(r.n);
  for (let i = 0; i < r.n; i++) out[i] = Number(fn(...mv, ...ser.map(s => s[i])));
  r.data.custom = out; r.cols.push('custom');
}
function applicaCustom() {
  let err = '';
  V.runs.forEach(r => { try { calcolaCustom(r); } catch (e) { if (!err) err = r.label + ': ' + e.message; } });
  $('customErr').textContent = err;
}

function ridisegnaTutto(tieniSegnali) {
  assegnaStili();
  aggiornaBarraRun();
  const on = V.runs.length > 0;
  ['btnInizio', 'btnPlay', 'btnPause', 'btnLoop', 'velSel', 'btnTView', 'btnTFull', 'tView0', 'tView1', 'timeSlider'].forEach(id => { $(id).disabled = !on; });
  if (!on) { costruisciIstanze(); return; }
  if (!V.runs[V.ref]) V.ref = primoDT();
  V.runs[V.ref].show = true;
  V.percorso = percorsoDaMostrare();
  const R = refRun();
  $('timeSlider').max = R.n - 1;
  V.tNow = Math.min(Math.max(V.tNow, R.data.t[0]), R.data.t[R.n - 1]);
  if (tView) { const [a, b] = intervalloRun(); if (tView[0] < a || tView[1] > b) tView = null; }
  sincronizzaFinestra();
  initTraiettoria();
  initSegnali(tieniSegnali);
  preparaScalePneumatici();
  costruisciIstanze();
  aggiornaTempo();
}

const solo3D = () => $('layout').classList.contains('solo-3d');

function aggiornaTempo() {
  if (!V.runs.length) return;
  const R = refRun();
  V.iRef = idxAt(R, V.tNow);
  $('timeSlider').value = V.iRef;
  $('timeLabel').textContent = 't = ' + V.tNow.toFixed(3) + ' s';
  if (!solo3D()) {                 // con "solo 3D" gli altri pannelli sono nascosti: non si ridisegnano
    aggiornaTraiettoria();
    aggiornaSegnali();
    disegnaPneumatici();
  }
  aggiornaScena();
}
function vaiAIndice(i) {
  const R = refRun();
  i = Math.min(Math.max(i, 0), R.n - 1);
  V.tNow = R.data.t[i];
  aggiornaTempo();
}

// ---------------------------------------------------------------- riproduzione
function ferma() { suonando = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; fermaRegistrazione(); }
function passo() {
  if (!suonando) return;
  const R = refRun(), tFine = R.data.t[R.n - 1];
  V.tNow = Math.min(t0Sim + (performance.now() - t0Reale) / 1000 * velocita, tFine);
  aggiornaTempo();
  if (V.tNow >= tFine) {
    if (!inLoop) { ferma(); return; }
    V.tNow = R.data.t[0]; t0Sim = V.tNow; t0Reale = performance.now();    // loop: si riparte dall'inizio
  }
  rafId = requestAnimationFrame(passo);
}
function avvia() {
  if (!V.runs.length || suonando || REC.inAttesa) return;
  if ($('chkRec').checked && !REC.rec) { avviaConRegistrazione(); return; }
  parti();
}
function parti() {
  const R = refRun();
  if (V.tNow >= R.data.t[R.n - 1]) V.tNow = R.data.t[0];
  t0Sim = V.tNow; t0Reale = performance.now(); suonando = true;
  rafId = requestAnimationFrame(passo);
}
function inizio() { ferma(); vaiAIndice(0); }
function impostaLoop(on) {
  inLoop = on;
  $('btnLoop').classList.toggle('attivo', on);
  $('btnLoop').setAttribute('aria-pressed', on ? 'true' : 'false');
}

// ---------------------------------------------------------------- registrazione
// Con "registra" spuntato, ▶ chiede al browser di catturare questa scheda e ne fa un video:
// dall'avvio fino alla fine della simulazione o, con il loop attivo, fino alla pausa.
// Il permesso si chiede una volta sola: la cattura resta aperta finché c'è la spunta.
const REC = { flusso: null, rec: null, inAttesa: false };
const TIPI_VIDEO = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const registrazionePossibile = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);

function segnaRegistrazione(on) { $('recBox').classList.toggle('attivo', on); }

async function flussoScheda() {
  if (REC.flusso && REC.flusso.active) return REC.flusso;
  const f = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false, preferCurrentTab: true });
  // "Interrompi condivisione" nella barra del browser: si chiude il video in corso
  f.getVideoTracks()[0].addEventListener('ended', () => { REC.flusso = null; fermaRegistrazione(true); });
  REC.flusso = f;
  // il browser aggiunge la sua barra di condivisione e la pagina si ridisegna: si aspetta che si assesti
  await new Promise(r => setTimeout(r, 500));
  return f;
}
async function avviaConRegistrazione() {
  REC.inAttesa = true;
  try {
    const flusso = await flussoScheda();
    const tipo = TIPI_VIDEO.find(t => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(flusso, tipo ? { mimeType: tipo, videoBitsPerSecond: 12e6 } : {});
    const pezzi = [], nome = nomeVideo(rec.mimeType || tipo || 'video/webm');
    rec.ondataavailable = e => { if (e.data && e.data.size) pezzi.push(e.data); };
    rec.onstop = () => salvaVideo(pezzi, rec.mimeType || tipo || 'video/webm', nome);
    rec.start();
    REC.rec = rec;
    segnaRegistrazione(true);
    stato('registrazione in corso…');
    parti();
  } catch (e) {
    console.error(e);
    $('chkRec').checked = false;
    stato('registrazione non avviata: ' + (e.name === 'NotAllowedError' ? 'il permesso di catturare la scheda non è stato dato' : e.message));
  } finally { REC.inAttesa = false; }
}
// subito = false: mezzo secondo di coda, così nel video c'è anche l'ultimo fotogramma
function fermaRegistrazione(subito) {
  const rec = REC.rec;
  if (!rec) return;
  REC.rec = null;
  segnaRegistrazione(false);
  const chiudi = () => { if (rec.state !== 'inactive') rec.stop(); };
  if (subito) chiudi(); else setTimeout(chiudi, 500);
}
function rilasciaFlusso() {
  fermaRegistrazione(true);
  if (REC.flusso) REC.flusso.getTracks().forEach(tr => tr.stop());
  REC.flusso = null;
}
function nomeVideo(tipo) {
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const run = (refRun().label || 'run').replace(/[^\w.-]+/g, '_');
  return `viewer_${run}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}` +
    (/mp4/.test(tipo) ? '.mp4' : '.webm');
}
function salvaVideo(pezzi, tipo, nome) {
  if (!pezzi.length) { stato('registrazione vuota: nessun video salvato'); return; }
  const blob = new Blob(pezzi, { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  stato('video salvato nei download: ' + nome + ' (' + (blob.size / 1e6).toFixed(1) + ' MB)');
}

// ---------------------------------------------------------------- caricamento CSV
// Ogni CSV si porta dietro veicolo e percorso se c'è il suo <nome>.js: quello scelto o trascinato
// insieme al CSV, altrimenti quello di risultati/ (caricaAmbiente). Senza, il veicolo è quello di
// un'altra run (o di default) e il percorso non c'è.
async function caricaFileCSV(files) {
  const accanto = files.filter(f => /\.js$/i.test(f.name));
  const nuovi = [];
  for (const f of files.filter(x => /\.csv$/i.test(x.name))) {
    try {
      const testo = await f.text();
      const nome = f.name.replace(/\.csv$/i, '');
      const scelto = accanto.find(a => a.name.replace(/\.js$/i, '') === nome);
      const amb = scelto ? ambienteDaTesto(await scelto.text()) : await caricaAmbiente(nome);
      const base = V.runs.find(r => !r.veicoloDefault);
      nuovi.push(runConAmbiente(nome, testo, amb, base ? base.veicolo : null));
    } catch (e) { stato(f.name + ': ' + e.message); console.error(e); }
  }
  if (!nuovi.length) return;
  // i CSV sostituiscono i dati di esempio, altrimenti si aggiungono (fino a MAX_RUN)
  if (V.fonte.startsWith('esempio')) { V.runs = []; V.fonte = 'CSV'; tView = null; }
  V.runs = V.runs.concat(nuovi).slice(-MAX_RUN);
  // il riferimento passa alla prima run appena aperta (double track, se c'è): è quella che si vuole
  // guardare, e il percorso disegnato è il suo
  const k = V.runs.findIndex(r => nuovi.includes(r) && r.modello === 'dt');
  V.ref = k >= 0 ? k : primoDT();
  applicaCustom();
  ridisegnaTutto(true);
  const senza = nuovi.filter(r => r.senzaAmbiente);
  stato('caricati: ' + nuovi.map(r => r.label).join(', ') +
    (senza.length ? ' — in risultati/ manca ' + senza.map(r => r.label + '.js').join(', ') + ' (veicolo ' +
      (senza.some(r => r.veicoloDefault) ? 'di default' : 'di un\'altra run') + ')' : '') +
    ' — riferimento ' + refRun().label + descriviPercorso());
}

// ---------------------------------------------------------------- prove pronte
// Il menu "prova" c'è solo se dati/prove.js elenca delle prove (dati.js, "prove pronte").
let PROVE = [], provaChiesta = 0;
function preparaMenuProve(prove) {
  PROVE = prove;
  if (!prove.length) return;
  $('provaSel').innerHTML = prove.map(p => `<option value="${p.id}">${p.titolo || p.id}</option>`).join('');
  $('provaSel').onchange = e => { apriProva(e.target.value); e.target.blur(); };
  $('provaBox').hidden = false;
  const c = window.PROVE_CREDITO;
  if (c && c.testo) {
    $('credito').textContent = c.testo;
    if (c.link) $('credito').href = c.link;
    if (c.nota) $('credito').title = c.nota;
    $('credito').hidden = false;
  }
}
// Mette al posto delle run presenti quelle della prova. false se non se ne carica nessuna.
async function apriProva(id) {
  const p = PROVE.find(x => x.id === id);
  if (!p) return false;
  const questa = ++provaChiesta, titolo = p.titolo || p.id;
  ferma();
  $('provaSel').value = p.id;
  $('provaBox').title = p.descrizione || '';
  stato('carico: ' + titolo + '…');
  const nuovi = [], mancano = [];
  for (const [k, nome] of p.run.slice(0, MAX_RUN).entries()) {
    try {
      const d = await caricaRunDiProva(nome);
      if (questa !== provaChiesta) return false;       // nel frattempo è stata scelta un'altra prova
      if (d) nuovi.push(runConAmbiente(nome, d.csv, d.amb, null, p.etichette && p.etichette[k]));
      else mancano.push(nome);
    } catch (e) { mancano.push(nome); console.error(e); }
  }
  if (!nuovi.length) { stato(titolo + ': dati non trovati (' + mancano.join(', ') + ')'); return false; }
  V.runs = nuovi; V.fonte = 'prova'; V.ref = primoDT();
  V.tNow = refRun().data.t[0]; tView = null;
  applicaCustom();
  ridisegnaTutto(true);
  // l'indirizzo della pagina porta la prova scelta: copiato, la riapre direttamente
  try { history.replaceState(null, '', '?prova=' + encodeURIComponent(p.id)); } catch (e) { /* non permesso: resta com'è */ }
  stato(titolo + (p.descrizione ? ' — ' + p.descrizione : '') + (mancano.length ? ' — non trovate: ' + mancano.join(', ') : ''));
  if (window.PROVE_AVVIA) avvia();
  return true;
}

// ---------------------------------------------------------------- comandi
function collegaComandi() {
  $('btnPlay').onclick = avvia;
  $('btnPause').onclick = ferma;
  $('btnInizio').onclick = inizio;
  $('btnLoop').onclick = () => impostaLoop(!inLoop);
  $('velSel').onchange = e => {
    velocita = parseFloat(e.target.value);
    if (suonando) { t0Sim = V.tNow; t0Reale = performance.now(); }
    e.target.blur();                       // così la barra spaziatrice torna ad avviare e fermare
  };
  $('timeSlider').addEventListener('input', e => { ferma(); vaiAIndice(+e.target.value); });
  $('btnTView').onclick = () => impostaFinestra(parseFloat($('tView0').value), parseFloat($('tView1').value));
  $('btnTFull').onclick = finestraCompleta;
  ['tView0', 'tView1'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('btnTView').click(); }));
  $('refSel').onchange = e => { V.ref = +e.target.value; ridisegnaTutto(true); };
  $('panelSel').onchange = e => {
    const v = e.target.value;
    $('layout').classList.toggle('solo-3d', v === 'solo-3d');
    $('right').className = (v === 'entrambi' || v === 'solo-3d') ? '' : v;
    e.target.blur();                       // così la barra spaziatrice torna ad avviare e fermare
    requestAnimationFrame(() => { ridimensionaGrafici(); disegnaPneumatici(); aggiornaTempo(); });
  };
  if (registrazionePossibile()) {
    $('chkRec').onchange = e => { if (!e.target.checked) rilasciaFlusso(); e.target.blur(); };
  } else {
    $('chkRec').disabled = true;
    $('recBox').title = 'Questo browser non permette di catturare la scheda: per registrare serve Chrome, Edge o Firefox aggiornato.';
  }
  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { caricaFileCSV([...e.target.files]); e.target.value = ''; };
  $('customExpr').value = customExpr;
  const invia = () => {
    customExpr = $('customExpr').value;
    try { localStorage.setItem('dv.viewer.custom', customExpr); } catch (e) { /* niente */ }
    applicaCustom();
    if (V.runs.length) { initSegnali(true); aggiornaTempo(); }
  };
  $('btnCustom').onclick = invia;
  $('customExpr').addEventListener('keydown', e => { if (e.key === 'Enter') invia(); });

  $('camSel').onchange = e => impostaVista(e.target.value);
  $('meshSel').onchange = e => cambiaModello(e.target.value);
  $('esag').oninput = e => { S3.esag = +e.target.value; $('esagVal').innerHTML = S3.esag + '&times;'; aggiornaScena(); };
  $('chkForze').onchange = e => { S3.forze = e.target.checked; legenda3D(); aggiornaScena(); };
  $('chkScie').onchange = e => { S3.scieOn = e.target.checked; S3.scie.visible = S3.scieOn; renderScena(); };

  document.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (!V.runs.length) return;
    if (e.key === ' ') { e.preventDefault(); suonando ? ferma() : avvia(); }
    else if (e.key === 'Home') { e.preventDefault(); inizio(); }
    else if (e.key === 'l' || e.key === 'L') impostaLoop(!inLoop);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); ferma(); vaiAIndice(V.iRef + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    }
  });
  // CSV trascinati sulla pagina (anche con il loro .js, se non stanno in risultati/)
  let nDrag = 0;
  document.addEventListener('dragenter', e => { e.preventDefault(); nDrag++; document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', () => { if (--nDrag <= 0) { nDrag = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault(); nDrag = 0; document.body.classList.remove('dragging');
    const f = [...e.dataTransfer.files].filter(x => /\.(csv|js)$/i.test(x.name));
    if (f.length) caricaFileCSV(f);
  });

  let pend = null;
  const rid = () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(() => { ridimensionaGrafici(); disegnaPneumatici(); }); };
  window.addEventListener('resize', rid);
  new ResizeObserver(rid).observe($('layout'));
}

// Per la barra di stato: che percorso è disegnato (e di quale run, se non è quella di riferimento).
function descriviPercorso() {
  const p = V.percorso;
  if (!p) return '';
  const di = refRun().percorso === p ? '' : ' di ' + V.runs.find(r => r.percorso === p).label + ':';
  return ' — percorso' + di + ' ' + (p.chiuso ? 'chiuso' : 'aperto') + (p.larghezza > 0 ? ', pista larga ' + p.larghezza + ' m' : '') +
    (p.coniX.length ? ', ' + p.coniX.length + ' coni' : '');
}

// ---------------------------------------------------------------- avvio
(async function main() {
  creaSlotSegnali();
  creaPannelliPneumatici();
  collegaComandi();
  try { initScena(); } catch (e) { console.error(e); $('animHint').textContent = '3D non disponibile: ' + e.message; }
  const modello = S3.pronto ? cambiaModello($('meshSel').value) : Promise.resolve();
  try {
    // con dati/prove.js si parte da una prova: quella dell'indirizzo (?prova=<id>) o la prima
    const prove = await caricaElencoProve();
    preparaMenuProve(prove);
    const id = new URLSearchParams(location.search).get('prova');
    if (prove.length && await apriProva(prove.some(p => p.id === id) ? id : prove[0].id)) { await modello; return; }
    const { runs, fonte } = await caricaDatiIniziali();
    V.runs = runs; V.fonte = fonte; V.ref = primoDT();
    if (runs.length) {
      V.tNow = refRun().data.t[0];
      applicaCustom();
      ridisegnaTutto(false);
      stato('dati/' + fonte + ': ' + runs.map(r => r.label).join(' · ') + ' — riferimento ' + refRun().label + descriviPercorso());
    } else {
      ridisegnaTutto(false);
      stato('Nessun dato in dati/: lancia un esempio di easy, oppure apri un CSV di risultati/ o trascinalo sulla pagina.');
    }
  } catch (e) {
    console.error(e);
    stato('dati illeggibili: ' + e.message + ' — usa "Apri CSV…"');
  }
  await modello;
})();
