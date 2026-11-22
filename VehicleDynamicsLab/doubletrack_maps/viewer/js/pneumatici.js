// pneumatici.js — punti di lavoro dei pneumatici e trasferimenti di carico (canvas 2D).
// Per ogni ruota ij: (i) a sinistra il cerchio d'aderenza al carico corrente, di raggio
// D(Z_ij) = lambda_mu (pD1 + pD2 dfz) Z_ij (combinato isotropo, come in pneumatico.m), con il
// vettore (Fx, Fy) nella terna ruota e la sua scia; (ii) a destra la curva F(sigma) al carico
// corrente con il punto (sigma, |F|). Le quattro ruote sono disposte come sull'auto vista dall'alto
// (avanti in su, sinistra a sinistra), e il cerchio usa la stessa vista: Fx in su, Fy (positiva a
// sinistra) a sinistra.
// Colori: il cerchio nel colore della run; la forza attuale BIANCA finché il pneumatico lavora prima
// del picco, ARANCIONE oltre il picco (aumentando lo scorrimento la forza calerebbe), ROSSA quando
// la ruota è bloccata (oltre il picco e quasi ferma, vedi omegaBlocco).
'use strict';

const SCIA_S = 1.0;            // [s] lunghezza della scia
// Stato del pneumatico, con il colore della forza nei pannelli e dell'alone nel 3D
const PRIMA = 0, OLTRE = 1, BLOCCATA = 2;
const COL_SOTTO = '#f2f2f2';   // prima del picco
const COL_OLTRE = '#ff9d1a';   // oltre il picco
const COL_BLOCCO = '#ff2a2a';  // ruota bloccata
const COL_STATO = [COL_SOTTO, COL_OLTRE, COL_BLOCCO];
const NOME_STATO = ['', 'oltre il picco', 'bloccata'];
const PN = { schede: {}, scala: null };

// Sotto quale velocità di rotazione [rad/s] una ruota oltre il picco si dice bloccata.
// Nel modello il freno dà Tf tanh(omega/omega_eps) (ruote.m): vicino a omega = 0 cala, e la ruota
// bloccata non si ferma del tutto ma resta dove quel che rimane del freno fa equilibrio alla forza
// a terra, omega = omega_eps atanh(|Fx| rr / Tf). Sono 0.15-0.5 rad/s (10-30 gradi/s) con
// omega_eps = 0.5 rad/s: una soglia di 1 grado/s non scatterebbe mai. La soglia è 2 omega_eps
// (1 rad/s), dove il freno dà ancora il 96% della coppia chiesta: una ruota che frena rotolando
// sta sopra, una bloccata sta sotto. V_eps (il minimo del denominatore in scorrimenti.m) qui non
// conta: a ruota bloccata lo scorrimento è comunque enorme e la curva F(sigma) lì è piatta.
const omegaBlocco = ve => 2 * (ve.omega_eps > 0 ? ve.omega_eps : VEICOLO_DEFAULT.omega_eps);

function contenitoreCanvas(cls) {
  const w = document.createElement('div');
  w.className = 'cw ' + cls;
  const c = document.createElement('canvas');
  w.appendChild(c);
  return { w, c };
}
function creaPannelliPneumatici() {
  document.querySelectorAll('.wheelCard').forEach(card => {
    const ij = card.dataset.ij;
    card.innerHTML = `<header><b style="color:${COLORE_RUOTA[ij]}">${ij}</b>` +
      `<span class="stato" hidden></span>` +
      `<span>${NOME_RUOTA[ij]}</span><span class="info"></span></header>`;
    const cvs = document.createElement('div'); cvs.className = 'cvs';
    const fc = contenitoreCanvas('fcw'), mf = contenitoreCanvas('mfw');
    fc.c.title = 'Cerchio d\'aderenza al carico corrente, di raggio D(Z), e forza (Fx, Fy) nella terna ruota, ' +
      'vista dall\'alto: Fx in su, Fy positiva a sinistra. Forza bianca prima del picco, arancione oltre, ' +
      'rossa a ruota bloccata';
    mf.c.title = 'F(sigma) al carico corrente, punto = (sigma, |F|), sigma = sqrt(sigmax^2 + sigmay^2); ' +
      'zona arancione = oltre il picco';
    cvs.appendChild(fc.w); cvs.appendChild(mf.w); card.appendChild(cvs);
    PN.schede[ij] = { info: card.querySelector('.info'), stato: card.querySelector('.stato'), fc: fc.c, mf: mf.c };
  });
  const old = document.getElementById('loadCanvas');
  const lw = contenitoreCanvas('loadw');
  lw.c.id = 'loadCanvas';
  old.replaceWith(lw.w);
}

// Canvas alla risoluzione del dispositivo; restituisce contesto e dimensioni in px CSS.
function prepCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(cv.clientWidth, 1), h = Math.max(cv.clientHeight, 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const runConRuote = () => visibili().filter(k => haRuote(V.runs[k]));

// Regime di lavoro di ogni campione, calcolato una volta per run:
//   sg     sigma = |(sigma_x, sigma_y)| (dalle colonne sigmax_ij, sigmay_ij)
//   rp     sigma / sigma_picco al carico corrente
//   stato  PRIMA del picco, OLTRE (sigma > sigma_picco) o BLOCCATA (oltre il picco e
//          |omega_ij| < omegaBlocco; senza la colonna omega_ij resta OLTRE)
// Lo spostamento S_H del camber non è nella telemetria e qui si trascura.
function preparaRegime(r) {
  const ve = r.veicolo, omB = omegaBlocco(ve);
  r.pn = {};
  RUOTE.forEach(ij => {
    const n = r.n, Z = r.data['Z_' + ij], sx = r.data['sigmax_' + ij], sy = r.data['sigmay_' + ij];
    const om = r.data['omega_' + ij];
    const sg = new Float64Array(n), rp = new Float64Array(n), stato = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const s = sx && sy ? Math.hypot(sx[i], sy[i]) : NaN;
      sg[i] = s; rp[i] = NaN;
      const k = mfCoeff(Z[i], ve);
      if (!k || !Number.isFinite(s)) continue;
      rp[i] = s / mfPicco(k);
      if (rp[i] > 1) stato[i] = om && Math.abs(om[i]) < omB ? BLOCCATA : OLTRE;
    }
    r.pn[ij] = { sg, rp, stato };
  });
}

// Stato (PRIMA, OLTRE, BLOCCATA) della ruota ij della run r al campione i (lo usa anche il 3D)
function statoPneumatico(r, ij, i) {
  if (!haRuote(r)) return PRIMA;
  if (!r.pn) preparaRegime(r);
  return r.pn[ij].stato[i];
}

// Scale fisse su tutta la registrazione (le stesse per le quattro ruote, così i cerchi si confrontano).
function preparaScalePneumatici() {
  let R = 0, dZ = 0, smax = 0;
  const sig = [];
  runConRuote().forEach(k => {
    const r = V.runs[k], ve = r.veicolo, d = r.data;
    if (!r.pn) preparaRegime(r);
    RUOTE.forEach(ij => {
      const Z = d['Z_' + ij], Fx = d['Fx_' + ij], Fy = d['Fy_' + ij], sg = r.pn[ij].sg;
      for (let i = 0; i < r.n; i++) {
        R = Math.max(R, mfD(Z[i], ve), Math.hypot(Fx[i], Fy[i]) || 0);
        if (r.statico) dZ = Math.max(dZ, Math.abs(Z[i] - r.statico.Z[ij]));
        if (Number.isFinite(sg[i])) sig.push(sg[i]);
      }
    });
    smax = Math.max(smax, 2.5 * (mfPicco(mfCoeff(ve.Fz0, ve)) || 0.1));   // picco al carico nominale
  });
  sig.sort((a, b) => a - b);
  const p99 = sig.length ? sig[Math.floor(0.99 * (sig.length - 1))] : 0;
  smax = Math.min(Math.max(smax, 1.15 * p99, 0.05), 1.0);
  PN.scala = R > 0 ? { R: 1.08 * R, smax, dZ: Math.max(1.12 * dZ, 100) } : null;
  aggiornaLegendaPneumatici();
}

function passoBello(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}
function freccia(ctx, x0, y0, x1, y1, col, lw) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (L < 4) return;
  const a = Math.atan2(y1 - y0, x1 - x0), hl = Math.min(9, 0.35 * L);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - hl * Math.cos(a - 0.4), y1 - hl * Math.sin(a - 0.4));
  ctx.lineTo(x1 - hl * Math.cos(a + 0.4), y1 - hl * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}
function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function messaggio(ctx, w, h, testo) {
  ctx.fillStyle = '#777'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(testo, w / 2, h / 2);
}
const coloreForza = stato => COL_STATO[stato];
// opacità della scia: da a0 (un secondo fa) a a0 + a1 (adesso)
const alfaScia = (tq, a0, a1) => a0 + a1 * (tq - (V.tNow - SCIA_S)) / SCIA_S;

// ---------------------------------------------------------------- cerchio d'aderenza e forza
function disegnaCerchio(ij) {
  const { ctx, w, h } = prepCanvas(PN.schede[ij].fc);
  const S = PN.scala, rs = runConRuote();
  if (!S || !rs.length) {
    messaggio(ctx, w, h, 'solo double track');
    PN.schede[ij].info.textContent = ''; PN.schede[ij].stato.hidden = true;
    return;
  }
  const cx = w / 2, cy = h / 2 + 4, rp = Math.max(Math.min(w, h - 8) / 2 - 10, 5), s = rp / S.R;
  // griglia: cerchi ogni "passo" N, assi
  const passo = passoBello(S.R / 3);
  ctx.strokeStyle = '#34343e'; ctx.lineWidth = 1; ctx.setLineDash([]);
  for (let q = passo; q <= S.R; q += passo) { ctx.beginPath(); ctx.arc(cx, cy, q * s, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.strokeStyle = '#4a4a55';
  ctx.beginPath(); ctx.moveTo(cx - rp, cy); ctx.lineTo(cx + rp, cy); ctx.moveTo(cx, cy - rp); ctx.lineTo(cx, cy + rp); ctx.stroke();
  ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; ctx.fillText('Fx', cx + 3, cy - rp - 2);
  ctx.textAlign = 'left'; ctx.fillText('← Fy', cx - rp, cy + 2);
  ctx.textAlign = 'right'; ctx.fillText((passo / 1000) + ' kN', w - 2, 2);

  rs.forEach((k, n) => {
    const r = V.runs[k], ve = r.veicolo, d = r.data, i = idxAt(r, V.tNow);
    const D = mfD(d['Z_' + ij][i], ve);
    const dash = DASH_CANVAS[r.tratto] || [];
    // cerchio al carico statico, di riferimento
    if (n === 0 && r.statico) {
      ctx.strokeStyle = '#666'; ctx.setLineDash([1, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, mfD(r.statico.Z[ij], ve) * s, 0, 2 * Math.PI); ctx.stroke();
    }
    // cerchio d'aderenza al carico corrente (il picco), nel colore della run
    ctx.strokeStyle = r.colore; ctx.lineWidth = 1.6; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(D * s, 0), 0, 2 * Math.PI); ctx.stroke();
    // scia e forza attuale: bianca prima del picco, arancione oltre, rossa a ruota bloccata
    const Fx = d['Fx_' + ij], Fy = d['Fy_' + ij], t = d.t, ol = r.pn[ij].stato;
    const i0 = idxAt(r, V.tNow - SCIA_S);
    ctx.setLineDash([]); ctx.lineWidth = 1.5;
    for (let q = i0 + 1; q <= i; q++) {
      ctx.strokeStyle = hexAlpha(coloreForza(ol[q]), alfaScia(t[q], 0.1, 0.6));
      ctx.beginPath(); ctx.moveTo(cx - Fy[q - 1] * s, cy - Fx[q - 1] * s); ctx.lineTo(cx - Fy[q] * s, cy - Fx[q] * s); ctx.stroke();
    }
    const xf = cx - Fy[i] * s, yf = cy - Fx[i] * s;
    freccia(ctx, cx, cy, xf, yf, coloreForza(ol[i]), n === 0 ? 2.4 : 1.6);
    if (n > 0) {                            // altre run: un pallino col colore della run in punta
      ctx.fillStyle = r.colore; ctx.beginPath(); ctx.arc(xf, yf, 2.5, 0, 2 * Math.PI); ctx.fill();
    }
  });
  // intestazione: valori della prima run double track visibile
  const r = V.runs[rs[0]], i = idxAt(r, V.tNow), d = r.data, p = r.pn[ij];
  const Z = d['Z_' + ij][i], uso = Math.hypot(d['Fx_' + ij][i], d['Fy_' + ij][i]) / mfD(Z, r.veicolo);
  const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '–');
  PN.schede[ij].info.textContent = `Z ${Z.toFixed(0)} N · uso ${Number.isFinite(uso) ? (100 * uso).toFixed(0) : '–'}% · ` +
    `σ ${Number.isFinite(p.sg[i]) ? p.sg[i].toFixed(3) : '–'} (σ/σp ${f2(p.rp[i])})` + (rs.length > 1 ? ' (' + r.label + ')' : '');
  PN.schede[ij].info.title = 'uso = |F|/D: 100% sul cerchio d\'aderenza; σp = scorrimento del picco al carico corrente';
  // etichetta dello stato: "oltre il picco" (arancione) o "bloccata" (rossa)
  const st = p.stato[i], et = PN.schede[ij].stato;
  et.hidden = st === PRIMA;
  if (st !== PRIMA) {
    et.textContent = NOME_STATO[st];
    et.style.background = COL_STATO[st];
    et.title = st === BLOCCATA
      ? `Ruota bloccata: lavora oltre il picco e gira a meno di ${+omegaBlocco(r.veicolo).toFixed(2)} rad/s` +
        (d['omega_' + ij] ? ` (adesso ${d['omega_' + ij][i].toFixed(2)} rad/s)` : '')
      : 'Il pneumatico lavora oltre il picco: aumentando lo scorrimento la forza calerebbe';
  }
}

// ---------------------------------------------------------------- curva F(sigma)
function disegnaMF(ij) {
  const { ctx, w, h } = prepCanvas(PN.schede[ij].mf);
  const S = PN.scala, rs = runConRuote();
  if (!S || !rs.length) return;
  const ml = 30, mr = 6, mt = 8, mb = 16;
  const pw = Math.max(w - ml - mr, 5), ph = Math.max(h - mt - mb, 5);
  const X = sg => ml + Math.min(sg, S.smax) / S.smax * pw, Y = F => mt + ph - F / S.R * ph;
  // zona oltre il picco della prima run (sigma > sigma_picco al carico corrente)
  const r0 = V.runs[rs[0]];
  const sp0 = mfPicco(mfCoeff(r0.data['Z_' + ij][idxAt(r0, V.tNow)], r0.veicolo));
  if (Number.isFinite(sp0) && sp0 < S.smax) {
    ctx.fillStyle = hexAlpha(COL_OLTRE, 0.07);
    ctx.fillRect(X(sp0), mt, ml + pw - X(sp0), ph);
  }
  // assi e griglia
  ctx.strokeStyle = '#34343e'; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.fillStyle = '#888'; ctx.font = '10px sans-serif';
  const pF = passoBello(S.R / 3);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let F = 0; F <= S.R; F += pF) {
    ctx.beginPath(); ctx.moveTo(ml, Y(F)); ctx.lineTo(ml + pw, Y(F)); ctx.stroke();
    ctx.fillText((F / 1000).toFixed(F % 1000 ? 1 : 0), ml - 3, Y(F));
  }
  const pS = passoBello(S.smax / 3);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let sg = 0; sg <= S.smax + 1e-9; sg += pS) {
    ctx.beginPath(); ctx.moveTo(X(sg), mt); ctx.lineTo(X(sg), mt + ph); ctx.stroke();
    ctx.fillText(+sg.toFixed(3), X(sg), mt + ph + 2);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('|F| kN', ml + 3, mt);
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('σ', ml + pw - 2, mt + ph - 2);

  const NP = 90;
  const curva = (k, col, lw, dash) => {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash);
    ctx.beginPath();
    for (let q = 0; q <= NP; q++) { const sg = S.smax * q / NP; q ? ctx.lineTo(X(sg), Y(mfF(sg, k))) : ctx.moveTo(X(sg), Y(mfF(sg, k))); }
    ctx.stroke();
  };
  const picco = (k, col) => {               // trattino verticale al picco
    const sp = mfPicco(k);
    if (!Number.isFinite(sp) || sp >= S.smax) return;
    ctx.setLineDash([]); ctx.strokeStyle = col; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(sp), Y(k.D) - 5); ctx.lineTo(X(sp), Y(k.D) + 5); ctx.stroke();
  };
  const punto = (sg, F, col, raggio) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(sg), Y(F), raggio, 0, 2 * Math.PI); ctx.fill();
  };

  rs.forEach((k, n) => {
    const r = V.runs[k], ve = r.veicolo, d = r.data, i = idxAt(r, V.tNow), p = r.pn[ij];
    const dash = DASH_CANVAS[r.tratto] || [];
    const ky = mfCoeff(d['Z_' + ij][i], ve), t = d.t, q0 = idxAt(r, V.tNow - SCIA_S);
    if (n === 0 && r.statico) curva(mfCoeff(r.statico.Z[ij], ve), '#666', 1, [1, 3]);   // carico statico
    curva(ky, r.colore, 1.6, dash);
    picco(ky, r.colore);
    // scia e punto corrente (sigma, |F|): bianco prima del picco, arancione oltre, rosso a ruota bloccata
    const Fx = d['Fx_' + ij], Fy = d['Fy_' + ij];
    for (let q = q0; q <= i; q++) {
      const sg = p.sg[q];
      if (!Number.isFinite(sg)) continue;
      const a = q === i ? 1 : alfaScia(t[q], 0.1, 0.5);
      punto(sg, Math.hypot(Fx[q], Fy[q]), hexAlpha(coloreForza(p.stato[q]), a), q === i ? 4 : 1.6);
    }
    const Fi = Math.hypot(Fx[i], Fy[i]);
    if (n > 0 && Number.isFinite(p.sg[i])) {   // altre run: anello col colore della run
      ctx.strokeStyle = r.colore; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(X(p.sg[i]), Y(Fi), 5.5, 0, 2 * Math.PI); ctx.stroke();
    }
    if (p.sg[i] > S.smax) {                // fuori scala (ruota bloccata o in pattinamento)
      ctx.fillStyle = coloreForza(p.stato[i]); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('▶ ' + p.sg[i].toFixed(2), ml + pw, Y(Fi) - 8);
    }
  });
}

// ---------------------------------------------------------------- trasferimenti di carico
function disegnaCarichi() {
  const { ctx, w, h } = prepCanvas(document.getElementById('loadCanvas'));
  const info = document.getElementById('loadInfo');
  const S = PN.scala, rs = runConRuote().filter(k => V.runs[k].statico);
  if (!S || !rs.length) {
    messaggio(ctx, w, h, 'servono run double track');
    info.textContent = 'Il monotraccia non ha carichi per ruota.';
    return;
  }
  // due righe come sull'auto: anteriore sopra, posteriore sotto; barre verso l'alto = più carico
  const righe = [['11', '12', 'anteriore'], ['21', '22', 'posteriore']];
  const hr = h / 2, ml = 4, mr = 4;
  const wcol = (w - ml - mr) / 2;
  righe.forEach(([a, b, nome], rI) => {
    const y0 = rI * hr, yz = y0 + hr / 2 + 4, amp = hr / 2 - 16;
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(nome, w / 2, y0 + 2);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ml, yz); ctx.lineTo(w - mr, yz); ctx.stroke();
    [a, b].forEach((ij, c) => {
      const x0 = ml + c * wcol, bw = Math.min(26, (wcol - 10) / rs.length);
      const xs = x0 + wcol / 2 - bw * rs.length / 2;
      rs.forEach((k, n) => {
        const r = V.runs[k], i = idxAt(r, V.tNow), dz = r.data['Z_' + ij][i] - r.statico.Z[ij];
        const hpx = dz / S.dZ * amp;
        ctx.fillStyle = hexAlpha(r.colore, 0.85);
        ctx.fillRect(xs + n * bw + 1, Math.min(yz, yz - hpx), bw - 2, Math.abs(hpx));
        if (n === 0) {
          ctx.fillStyle = '#ddd'; ctx.textBaseline = dz >= 0 ? 'bottom' : 'top';
          ctx.fillText((dz >= 0 ? '+' : '') + dz.toFixed(0), x0 + wcol / 2, yz - hpx + (dz >= 0 ? -1 : 1));
        }
      });
      ctx.fillStyle = COLORE_RUOTA[ij]; ctx.textBaseline = 'bottom';
      ctx.fillText(ij, x0 + wcol / 2, y0 + hr - 1);
    });
  });
  const r = V.runs[rs[0]], i = idxAt(r, V.tNow), d = r.data, Z0 = r.statico.Z;
  const z = ij => d['Z_' + ij][i];
  const gr = c => d[c] ? (d[c][i] * RAD2DEG).toFixed(2) + '°' : '–';
  info.innerHTML =
    `ΔZ = Z11+Z12−2Z1⁰ = ${(z('11') + z('12') - 2 * Z0['11']).toFixed(0)} N<br>` +
    `ΔZ1 = (Z12−Z11)/2 = ${((z('12') - z('11')) / 2).toFixed(0)} N<br>` +
    `ΔZ2 = (Z22−Z21)/2 = ${((z('22') - z('21')) / 2).toFixed(0)} N<br>` +
    `φ ${gr('phi1')} · θ ${gr('theta')}<br>` +
    `<span title="carico statico per ruota">Z1⁰ ${Z0['11'].toFixed(0)} N, Z2⁰ ${Z0['21'].toFixed(0)} N` +
    (r.statico.stimato ? ' (m g dai dati)' : '') + '</span>' + (rs.length > 1 ? `<br>(${r.label})` : '');
}

// Legenda dei pannelli dei pneumatici (sotto i trasferimenti).
function aggiornaLegendaPneumatici() {
  const el = document.getElementById('tyreLegend');
  if (!el) return;
  const rs = runConRuote();
  const col = rs.length ? V.runs[rs[0]].colore : RUN_COLORI[0];
  el.innerHTML =
    `<b>Pneumatici</b><br>` +
    `<span style="color:${col}">━</span> cerchio D(Z): il picco al carico attuale<br>` +
    `<span style="color:#888">┈</span> lo stesso al carico statico<br>` +
    `<span style="color:${COL_SOTTO}">➜</span> forza attuale, prima del picco<br>` +
    `<span style="color:${COL_OLTRE}">➜</span> oltre il picco: con più scorrimento la forza calerebbe<br>` +
    `<span style="color:${COL_BLOCCO}">➜</span> ruota bloccata: oltre il picco e sotto ` +
    `${+omegaBlocco(rs.length ? V.runs[rs[0]].veicolo : VEICOLO_DEFAULT).toFixed(2)} rad/s` +
    (rs.length > 1 ? '<br>valori e linee di riferimento: la prima run; le altre hanno un pallino del loro colore' : '');
}

function disegnaPneumatici() {
  if (document.getElementById('right').classList.contains('solo-segnali')) return;
  RUOTE.forEach(ij => { disegnaCerchio(ij); disegnaMF(ij); });
  disegnaCarichi();
}
