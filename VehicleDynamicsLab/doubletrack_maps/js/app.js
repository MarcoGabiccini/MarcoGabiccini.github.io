// app.js - stato della dashboard e collegamenti: veicoli, curve, hover, curva scelta,
// replay, viste del veicolo.
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  // La pagina messa in rete porta window.MAPPE_RETE = {viewer, prove}: dove sta il suo viewer 3D
  // e come si chiamano gli elenchi delle prove ({veicolo} = nome del veicolo). Senza, la pagina
  // è quella di lavoro, accanto al viewer.
  const RETE = window.MAPPE_RETE || null;
  const VIEWER3D = RETE
    ? { pagina: RETE.viewer, prove: nome => RETE.prove.replace('{veicolo}', nome) }
    : { pagina: '../viewer/viewer.html', prove: nome => `../viewer_mappe/dati/prove_${nome}.js` };
  if ($('carico')) $('carico').remove();
  if (!window.MAPPE || !window.MAPPE.veicoli) {
    $('layout').innerHTML = '<div id="manca">Mancano i dati delle mappe (dati/mappe.js).' +
      (RETE ? '' : '<br>In MATLAB: <code>cd easy; avvio; es18_mappe</code>') + '</div>';
    return;
  }
  const VEICOLI = window.MAPPE.veicoli;

  // --- curve di un veicolo: chiocciole, curve di livello, bordo, con un id ciascuna ---
  const nan = a => a.map(x => (x === null ? NaN : x));
  const pulisci = d => { const o = {}; for (const k in d) if (Array.isArray(d[k])) o[k] = nan(d[k]); return o; };
  const PRONTI = [];
  function veicolo(i) {
    if (PRONTI[i]) return PRONTI[i];
    const w = VEICOLI[i], curve = [];
    const kmin = w.chiocciole[0].kmh, kmax = w.chiocciole[w.chiocciole.length - 1].kmh;
    for (const c of w.chiocciole) {
      const dati = pulisci(c.dati), n = dati.t.length;
      curve.push({ id: curve.length, tipo: 'chiocciola', kmh: c.kmh, motivo: c.motivo, fine: c.fine, dati, n,
        regime: c.regime === undefined ? c.fine : c.regime, finestre: c.finestre || [],
        // la prova finisce quando u scende sotto 1 m/s (simula_dt) o a fine rampa
        siFerma: dati.u[n - 1] < 1.5 ? 'u < 1 m/s' : 'volante a fine corsa',
        colore: coloreVelocita(c.kmh, kmin, kmax), nome: 'chiocciola a ' + c.kmh + ' km/h' });
    }
    for (const fam of FAMIGLIE) for (const q of (w.curve[fam.chiave] || [])) {
      const dati = pulisci(q.dati);
      curve.push({ id: curve.length, tipo: 'famiglia', famiglia: fam.chiave, valore: q.valore, dati, n: dati.u.length,
        nome: fam.voce + ': ' + fam.lungo(q.valore) });
    }
    const b = pulisci(w.bordo);
    // sul lato della fine delle chiocciole (lato 2), il motivo della chiocciola più vicina
    const motivo = b.kmh.map((k, i) => {
      if (b.lato[i] !== 2) return null;
      let m = null, d = Infinity;
      for (const c of w.chiocciole) if (Math.abs(c.kmh - k) < d) { d = Math.abs(c.kmh - k); m = c.motivo; }
      return m;
    });
    curve.push({ id: curve.length, tipo: 'bordo', dati: b, n: b.u.length, motivo, nome: 'bordo della mappa (picchi di ã<sub>y</sub>)' });
    return (PRONTI[i] = { indice: i, nome: w.nome, titolo: w.titolo, P: w.P, rif: w.rif && w.rif.ayt ? w.rif : null, curve,
      kmin, kmax });
  }

  // stato in una posizione frazionaria s lungo una curva
  function statoIn(c, s) {
    const i = Math.max(0, Math.min(c.n - 1, Math.floor(s))), j = Math.min(c.n - 1, i + 1), f = Math.max(0, Math.min(1, s - i));
    const o = {};
    for (const k in c.dati) {
      const a = c.dati[k][i], b = c.dati[k][j];
      o[k] = Number.isNaN(a) ? b : Number.isNaN(b) ? a : a + f * (b - a);
    }
    return o;
  }
  function rigaDelTempo(c, t) {
    const T = c.dati.t;
    if (t <= T[0]) return 0;
    if (t >= T[c.n - 1]) return c.n - 1;
    let lo = 0, hi = c.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo + (t - T[lo]) / (T[hi] - T[lo]);
  }
  function tempoDellaRiga(c, s) {
    const T = c.dati.t, i = Math.max(0, Math.min(c.n - 2, Math.floor(s)));
    return T[i] + Math.max(0, Math.min(1, s - i)) * (T[i + 1] - T[i]);
  }

  // --- stato dell'app ---
  const app = {
    V: veicolo(0), W: null,
    sel: { id: 0, s: 0 }, hover: null, stato: null, curva: null, riga: 0,
    mostra: { chiocciole: true, plateau: true, testacoda: true, bordo: true, rif: true, delta: false, ayt: false, rho: false, beta: false },
    k: 3, strati: { derive: true, forze: true, carichi: true, acc: true },
    piani: [],
  };
  let timerLascia = null;
  app.passaSopra = (id, i) => {
    clearTimeout(timerLascia);
    app.hover = { id, s: i };
    aggiorna(false);
  };
  app.lascia = () => {
    clearTimeout(timerLascia);
    timerLascia = setTimeout(() => { app.hover = null; aggiorna(false); }, 90);
  };
  app.scegli = (id, i) => {
    ferma();
    app.sel = { id, s: i };
    app.hover = null;
    aggiornaBarra();
    aggiorna(true);
  };

  // --- viste del veicolo ---
  const vBody = new VistaBody($('svgBody'));
  const vTerra = new VistaTerra($('svgTerra'));
  // Lo stato per le viste. Un equilibrio ha velocità d'imbardata ã_y/u (grandezze_mappa):
  // con quella il centro C = (S, R) delle viste è lo stesso dei piani. Nel testacoda non
  // è un equilibrio e vale la r della prova: C è il centro delle velocità di quell'istante
  // (transitorio: la vista lo scrive come (−v/r, u/r), perché non è l'(S, R) dei piani).
  function statoVista() {
    const st = app.stato, c = app.curva;
    if (!st || !(Math.abs(st.u) > 1e-6)) return st;
    if (c.tipo === 'chiocciola' && app.riga > c.regime + 0.5) return Object.assign({}, st, { transitorio: true });
    return Object.assign({}, st, { r: st.ayt / st.u });
  }
  function disegnaViste() {
    if (!app.stato) return;
    const st = statoVista();
    if ($('seguiC').checked) vBody.inquadraC(st, app.V.P, app.k);
    vBody.render(st, app.V.P, app.k, app.strati);
    vTerra.render(app.curva, app.riga, st, app.V.P, Number($('terraK').value) || 1);
  }
  vBody.suCambio = () => disegnaViste();
  vTerra.suCambio = tipo => { if (tipo === 'sposta') vTerra.modo = 'libero'; disegnaViste(); };

  // --- aggiornamento: punti nei piani, viste, valori ---
  // Due punti. Quello fissato con un clic (app.sel, magenta nei piani) sta sulla curva
  // scelta: da lì parte ▶, e ▶ e il cursore del tempo lo spostano. Quello sotto il mouse
  // (app.hover, bianco) c'è solo mentre il mouse è su una curva. Viste e valori mostrano
  // il punto sotto il mouse, se c'è, altrimenti quello fissato.
  function aggiorna(selCambiata) {
    app.fissato = statoIn(app.V.curve[app.sel.id], app.sel.s);
    const cur = app.hover || app.sel, c = app.V.curve[cur.id];
    app.curva = c;
    app.riga = cur.s;
    app.stato = app.hover ? statoIn(c, cur.s) : app.fissato;
    for (const p of app.piani) p.disegnaSopra(selCambiata);
    disegnaViste();
    scriviValori();
    sincIstante();
  }

  function scriviValori() {
    const st = app.stato, c = app.curva, s = app.riga;
    const v = (nome, cifre, unita) => fmt(valore(st, nome), cifre) + (unita === '°' ? '°' : ' ' + unita);
    const R = 1 / st.rho;
    const naso = Math.abs(st.beta * DEG) < 0.05 ? 'β ≈ 0' : (st.beta * st.r > 0 ? 'nose-out' : 'nose-in');
    const parti = [
      `<b>${c.nome}</b>`,
      c.tipo === 'chiocciola' ? `t = ${fmt(st.t, 1)} s` : '',
      `δ<sub>v</sub> = ${v('delta_v', 1, '°')}`, `δ = ${v('delta', 2, '°')}`, `u = ${v('u', 1, 'km/h')}`,
      `ã<sub>y</sub> = ${v('ayt', 2, 'm/s²')}`,
      `R = ${Math.abs(R) < 1e5 ? fmt(R, 0) + ' m' : '∞'} (ρ = ${v('rho', 4, '1/m')})`,
      `β = ${v('beta', 2, '°')} (${naso})`, `S = ${v('S', 2, 'm')}`,
      // le derive apparenti sono linearizzate (α1 = δ − (v + a1 r)/u): nel testacoda, con β grande, non vogliono dire nulla
      ...(Math.abs(st.beta) < 15 / DEG ? [`Δα = ${v('Dalpha', 2, '°')}`, `α<sub>1</sub> = ${v('alpha1', 2, '°')}`, `α<sub>2</sub> = ${v('alpha2', 2, '°')}`] : ['Δα, α<sub>1</sub>, α<sub>2</sub>: — (|β| > 15°)']),
    ].filter(Boolean);
    const [testo, classe, spiega] = statoDi(c, s);
    parti.splice(c.tipo === 'chiocciola' ? 2 : 1, 0, `<span class="${classe}" title="${spiega}">${testo}</span>`);
    // di quale punto sono i valori: quello fissato (magenta) o quello sotto il mouse (bianco)
    const segno = app.hover
      ? '<span class="segno mouse" title="valori del punto sotto il mouse (bianco nei piani)"></span>'
      : '<span class="segno fissato" title="valori del punto fissato (magenta nei piani): un clic su una curva lo sposta, ▶ parte da lì"></span>';
    $('valori').innerHTML = segno + parti.map(p => `<span class="v">${p}</span>`).join('');
  }

  // che cos'è il punto s di una curva: [testo breve, classe, spiegazione per il title]
  const PERCHE = {
    'picco di a_y': ['picco di ã<sub>y</sub>', 'il massimo di ãy fra gli equilibri: sterzando di più l\'accelerazione laterale cala, un assale ha passato il picco di aderenza (comincia il plateau)'],
    [GIRA]: ['il veicolo comincia a girarsi', 'ãy non cala prima che il veicolo smetta di seguire il volante a regime: β cambia in fretta, comincia il testacoda (la mappa si ferma 1,5 s prima)'],
    'volante massimo': ['volante a fine corsa', 'il volante è arrivato a 540° prima del limite di aderenza'],
  };
  function statoDi(c, s) {
    if (c.tipo === 'bordo') {
      const m = c.motivo[Math.round(s)];
      return m ? ['fine della mappa: ' + PERCHE[m][0], 'stato-ok', 'il picco della chiocciola a questa velocità, ultimo equilibrio della mappa: ' + PERCHE[m][1]]
               : ['equilibrio', 'stato-ok', 'un equilibrio sul bordo della mappa'];
    }
    if (c.tipo !== 'chiocciola' || s < c.fine - 0.5) return ['equilibrio', 'stato-ok', 'volante fermo, velocità costante: il veicolo gira in tondo'];
    const fineProva = s >= c.n - 1.5 ? ' · fine della prova: ' + c.siFerma : '';
    const spiegaFine = c.siFerma === 'u < 1 m/s' ? ' La prova si ferma quando u scende sotto 1 m/s.' : ' La rampa del volante finisce a 540°.';
    if (s <= c.fine + 0.5) return ['fine della mappa: ' + PERCHE[c.motivo][0] + fineProva, 'stato-limite', 'ultimo equilibrio della mappa: ' + PERCHE[c.motivo][1]];
    if (s <= c.regime + 0.5) return ['plateau: ancora equilibrio, oltre il picco di ã<sub>y</sub>' + fineProva, 'stato-limite',
      'oltre il picco la prova è ancora quasi statica: sono equilibri, ma un assale ha passato il picco di aderenza e il volante in più toglie un po\' di ãy.' + spiegaFine];
    return ['testacoda: non è più un equilibrio' + fineProva, 'stato-oltre',
      'il veicolo si gira: β e r cambiano in fretta. Qui ãy è l\'accelerazione laterale della prova, che non è più u r.' + spiegaFine];
  }

  // --- barra del replay ---
  const VELOCITA = [0.2, 0.5, 1, 2, 5, 10, 20];
  for (const x of VELOCITA) $('velSel').add(new Option('×' + fmt(x, x < 1 ? 1 : 0), x));
  $('velSel').value = 10;
  function aggiornaBarra() {
    const c = app.V.curve[app.sel.id];
    $('selNome').innerHTML = `<span class="segno fissato"></span><span class="pallino" style="background:${c.colore || coloreFamiglia(c)}"></span>${c.nome}`;
    const banda = $('banda');
    if (c.tipo === 'chiocciola') {
      const T = c.dati.t, q = i => (100 * (T[i] - T[0]) / (T[c.n - 1] - T[0])).toFixed(2) + '%';
      const a = q(c.fine), b = q(c.regime);
      banda.style.background = `linear-gradient(90deg, ${COLORE.scelta} 0 ${a}, ${COLORE.tenue} ${a} ${b}, ${COLORE.picco} ${b} 100%)`;
      banda.title = 'giallo: equilibri della mappa · grigio: plateau (ancora equilibri) · arancione: testacoda';
      banda.style.display = 'block';
    } else banda.style.display = 'none';
    // tratti che il viewer 3D ha di questa chiocciola: una riga azzurra sopra il cursore del tempo.
    // Di solito il viewer ha la prova intera, e la riga non serve.
    const f3 = $('finestre3d');
    const intera = c.tipo === 'chiocciola' && c.finestre.some(F => F.t0 <= c.dati.t[0] + 0.05 && F.t1 >= c.dati.t[c.n - 1] - 0.05);
    if (c.tipo === 'chiocciola' && c.finestre.length && !intera) {
      const T = c.dati.t, q = t => (100 * Math.max(0, Math.min(1, (t - T[0]) / (T[c.n - 1] - T[0])))).toFixed(2) + '%';
      const pezzi = ['transparent 0'];
      for (const F of c.finestre) pezzi.push(`transparent ${q(F.t0)}`, `${COLORE_3D} ${q(F.t0)}`, `${COLORE_3D} ${q(F.t1)}`, `transparent ${q(F.t1)}`);
      f3.style.background = `linear-gradient(90deg, ${pezzi.join(', ')}, transparent 100%)`;
      f3.title = 'tratti di questa prova che si aprono nel viewer 3D: ' + c.finestre.map(F => `da ${fmt(F.t0, 0)} a ${fmt(F.t1, 0)} s`).join(', ');
      f3.style.display = 'block';
    } else f3.style.display = 'none';
    $('btn3D').title = descrivi3D();
    aggiornaCursore();
  }
  function coloreFamiglia(c) {
    if (c.tipo === 'bordo') return COLORE.bordo;
    return FAMIGLIE.find(f => f.chiave === c.famiglia).colore;
  }
  function aggiornaCursore() {
    const c = app.V.curve[app.sel.id], s = app.sel.s;
    if (c.tipo === 'chiocciola') {
      const T = c.dati.t, t = tempoDellaRiga(c, s);
      $('slider').value = Math.round(1e4 * (t - T[0]) / (T[c.n - 1] - T[0]));
      $('tempo').textContent = `t = ${fmt(t, 1)} s di ${fmt(T[c.n - 1], 0)} s` + (rallentato && inCorso ? ' · ×0,5 nel testacoda' : '');
    } else {
      $('slider').value = Math.round(1e4 * s / Math.max(1, c.n - 1));
      $('tempo').textContent = `punto ${Math.round(s) + 1} di ${c.n}`;
    }
  }
  $('slider').addEventListener('input', () => {
    ferma();
    const c = app.V.curve[app.sel.id], f = Number($('slider').value) / 1e4;
    if (c.tipo === 'chiocciola') {
      const T = c.dati.t;
      app.sel.s = rigaDelTempo(c, T[0] + f * (T[c.n - 1] - T[0]));
    } else app.sel.s = f * (c.n - 1);
    app.hover = null;
    aggiornaCursore();
    aggiorna(false);
  });

  // replay: le chiocciole nel loro tempo, le altre curve in 200 s a ×1. Oltre il limite,
  // quando β cambia in fretta (il testacoda dura un paio di secondi), si rallenta a ×0,5.
  let inCorso = false, tPrec = 0, rallentato = false;
  function passo(adesso) {
    if (!inCorso) return;
    const dt = Math.min(0.1, (adesso - tPrec) / 1000);
    tPrec = adesso;
    const c = app.V.curve[app.sel.id];
    let vel = Number($('velSel').value);
    rallentato = false;
    if (c.tipo === 'chiocciola' && app.sel.s > c.fine && vel > 0.5) {
      const i = Math.min(c.n - 2, Math.floor(app.sel.s)), d = c.dati;
      if (Math.abs((d.beta[i + 1] - d.beta[i]) / (d.t[i + 1] - d.t[i])) > 3 / DEG) { vel = 0.5; rallentato = true; }
    }
    if (c.tipo === 'chiocciola') app.sel.s = rigaDelTempo(c, tempoDellaRiga(c, app.sel.s) + dt * vel);
    else app.sel.s += dt * vel * (c.n - 1) / 200;
    if (app.sel.s >= c.n - 1) { app.sel.s = c.n - 1; ferma(); }
    aggiornaCursore();
    aggiorna(false);                       // anche con il mouse su una curva: il punto fissato si sposta
    if (inCorso) requestAnimationFrame(passo);
  }
  function parti() {
    const c = app.V.curve[app.sel.id];
    if (app.sel.s >= c.n - 1 - 1e-6) app.sel.s = 0;
    inCorso = true;
    SINC.da = Date.now(); SINC.tAltro = 0;
    $('btnPlay').classList.add('attivo');
    tPrec = performance.now();
    requestAnimationFrame(passo);
  }
  function ferma() {
    inCorso = false;
    $('btnPlay').classList.remove('attivo');
    sincPausa();
  }
  $('btnPlay').onclick = parti;
  $('btnPausa').onclick = ferma;
  // --- viewer 3D di easy ---
  // La chiocciola e l'istante del punto scelto: per una chiocciola i suoi; per le altre curve la
  // chiocciola di velocità più vicina, nell'equilibrio della mappa con il volante più vicino. Poi
  // la finestra del viewer che contiene l'istante, o la più vicina (esporta_mappe, chiocciole).
  function destinazione3D() {
    const c = app.V.curve[app.sel.id], st = statoIn(c, app.sel.s);
    let ch = c, t = st.t;
    if (c.tipo !== 'chiocciola') {
      const kmh = st.u * 3.6;
      ch = app.V.curve.filter(x => x.tipo === 'chiocciola').reduce((a, b) => Math.abs(b.kmh - kmh) < Math.abs(a.kmh - kmh) ? b : a);
      let m = Infinity;
      for (let i = 0; i <= ch.fine; i++) { const d = Math.abs(ch.dati.delta_v[i] - st.delta_v); if (d < m) { m = d; t = ch.dati.t[i]; } }
    }
    if (!ch.finestre.length) return null;
    const lontano = F => (t < F.t0 ? F.t0 - t : t > F.t1 ? t - F.t1 : 0);
    const F = ch.finestre.reduce((a, b) => (lontano(b) < lontano(a) ? b : a));
    return { ch, F, t, t0: Math.min(Math.max(t, F.t0), F.t1) };
  }
  function descrivi3D() {
    const d = destinazione3D();
    if (!d) return 'il viewer 3D non ha questa prova' + (RETE ? '' : ': rilancia es18_mappe');
    const dove = d.t0 === d.t ? `da t = ${fmt(d.t, 1)} s` : `da t = ${fmt(d.t0, 1)} s (il viewer ha da ${fmt(d.F.t0, 0)} a ${fmt(d.F.t1, 0)} s; il punto è a ${fmt(d.t, 1)} s)`;
    return `apri nel viewer 3D${RETE ? '' : ' di easy'} (un'altra scheda): ${d.ch.nome}, ${dove}`;
  }
  $('btn3D').onmouseenter = () => { $('btn3D').title = descrivi3D(); };
  function apri3D() {
    const d = destinazione3D();
    if (!d) { $('btn3D').title = descrivi3D(); return; }
    ferma();
    const q = new URLSearchParams({ prove: VIEWER3D.prove(app.V.nome), prova: d.F.prova, t: d.t0.toFixed(2) });
    SINC.finestra = window.open(VIEWER3D.pagina + '?' + q.toString(), 'viewer3d');
    SINC.ultimo = null; SINC.tAltro = 0;
  }
  $('btn3D').onclick = e => { e.currentTarget.blur(); apri3D(); };

  // --- viewer 3D sincronizzato ---
  // Con la spunta «sincronizza», questa pagina e il viewer 3D aperto con «3D ↗» vanno insieme:
  // prova (la chiocciola), istante, ▶ e pausa. Le due pagine si parlano con postMessage (i
  // messaggi sono descritti in viewer/js/app.js); riproduce quella in cui ▶ è stato premuto per
  // ultimo, con la sua velocità, e l'altra la segue. Da qui parte il punto fissato: per una
  // chiocciola la sua prova e il suo istante, per le altre curve la chiocciola e l'istante di
  // destinazione3D. Dal viewer arrivano una prova e un istante: il punto fissato va lì, sulla
  // chiocciola di quella prova. Senza la spunta le due pagine non si scrivono.
  // Una scheda nascosta non si anima (il browser le ferma requestAnimationFrame): per vederle
  // muoversi insieme le due pagine vanno affiancate, in due finestre.
  const SINC = {
    finestra: null,     // il viewer aperto da qui (o quello che scrive, dopo un ricarico di questa pagina)
    applico: false,     // si sta applicando un messaggio: quello che cambia non torna indietro
    tAltro: 0,          // quando è arrivato l'ultimo istante del viewer che riproduce
    da: 0,              // quando è partita la riproduzione qui
    ultimo: null,       // {prova, t}: l'ultimo istante mandato o ricevuto
    origine: location.protocol === 'file:' ? '*' : location.origin,     // a chi si scrive e da chi si accetta
    pend: false, cambia: false,
  };
  const sincAperta = () => !!SINC.finestra && !SINC.finestra.closed;
  const sincAttiva = () => $('chkSincro').checked && sincAperta();
  // il viewer sta riproducendo: mentre lo fa manda un istante a ogni fotogramma
  const sincAltroInCorso = () => performance.now() - SINC.tAltro < 300;
  function sincManda(m) {
    if (!sincAperta()) return;
    try { SINC.finestra.postMessage(Object.assign({ dv: 'sincro' }, m), SINC.origine); } catch (e) { /* il viewer non c'è più */ }
  }
  // da aggiorna: se il punto fissato è cambiato da qui, il viewer va alla sua prova e al suo istante
  function sincIstante() {
    if (SINC.applico || !sincAttiva()) return;
    const d = destinazione3D();
    if (!d) return;
    const u = SINC.ultimo;
    if (!inCorso && u && u.prova === d.F.prova && Math.abs(u.t - d.t0) < 1e-6) return;
    SINC.ultimo = { prova: d.F.prova, t: d.t0 };
    sincManda({ tipo: 'istante', prova: d.F.prova, t: d.t0, inCorso, da: SINC.da });
  }
  // da ferma: una pausa, o il punto spostato a mano, ferma anche il viewer
  function sincPausa() {
    if (SINC.applico || !sincAttiva()) return;
    SINC.tAltro = 0;
    sincManda({ tipo: 'pausa' });
  }
  // fa una cosa chiesta dal viewer, senza che torni indietro come se fosse partita da qui
  function sincSenzaEco(f) {
    const prima = SINC.applico;
    SINC.applico = true;
    try { f(); } finally { SINC.applico = prima; }
  }
  function sincFerma() { sincSenzaEco(ferma); }
  // dice al viewer se si va insieme; se sì, lo porta al punto fissato
  function sincCollega() {
    SINC.ultimo = null; SINC.tAltro = 0;
    sincManda({ tipo: 'collega', attiva: $('chkSincro').checked });
    sincIstante();
  }
  $('chkSincro').onchange = e => { e.target.blur(); sincCollega(); };
  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.dv !== 'sincro' || !e.source || e.source === window) return;
    if (SINC.origine !== '*' && e.origin !== SINC.origine) return;
    if (sincAperta() && e.source !== SINC.finestra) return;       // solo dal viewer aperto da qui
    SINC.finestra = e.source;
    if (m.tipo === 'pronto' || !$('chkSincro').checked) { sincCollega(); return; }
    if (m.tipo === 'pausa') {
      SINC.tAltro = 0;
      if (inCorso) sincFerma(); else $('btnPlay').classList.remove('attivo');
      return;
    }
    if (m.tipo !== 'istante' || typeof m.prova !== 'string' || !Number.isFinite(m.t)) return;
    if (inCorso && m.inCorso && m.da < SINC.da) return;           // ▶ è stato premuto qui per ultimo: si ferma il viewer
    const c = app.V.curve.find(x => x.tipo === 'chiocciola' && x.finestre.some(F => F.prova === m.prova));
    if (!c) return;                                               // una prova di un altro veicolo
    if (inCorso) sincFerma();
    SINC.tAltro = m.inCorso ? performance.now() : 0;
    SINC.cambia = SINC.cambia || c.id !== app.sel.id;
    app.sel = { id: c.id, s: rigaDelTempo(c, m.t) };
    const d = destinazione3D();
    SINC.ultimo = d ? { prova: d.F.prova, t: d.t0 } : null;
    if (SINC.pend) return;                                        // si disegna una volta per fotogramma
    SINC.pend = true;
    requestAnimationFrame(() => {
      SINC.pend = false;
      sincSenzaEco(() => {
        if (SINC.cambia) aggiornaBarra(); else aggiornaCursore();
        aggiorna(SINC.cambia);
        SINC.cambia = false;
      });
      $('btnPlay').classList.toggle('attivo', inCorso || sincAltroInCorso());
    });
  });
  // il comando MATLAB che rifà la prova (a 100 campioni al secondo) e la apre nel viewer.
  // Nella pagina in rete il bottone non c'è: lì le prove non si rifanno, si guardano.
  if ($('btnMatlab')) {
    const comandoMatlab = () => {
      const d = destinazione3D();
      return d ? `chiocciola_nel_viewer('${app.V.nome}', ${d.ch.kmh})` : '';
    };
    $('btnMatlab').onmouseenter = () => {
      $('btnMatlab').title = 'copia il comando MATLAB che rifà la prova e apre nel viewer il tratto attorno al limite, a 100 campioni al secondo: ' + comandoMatlab();
    };
    $('btnMatlab').onclick = e => {
      e.currentTarget.blur();
      const t = comandoMatlab(), b = $('btnMatlab');
      const ok = () => { b.textContent = '✓ copiato'; b.classList.add('copiato'); setTimeout(() => { b.textContent = '⧉ MATLAB'; b.classList.remove('copiato'); }, 1200); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, () => {});
      else {
        const a = document.createElement('textarea');
        a.value = t; document.body.appendChild(a); a.select();
        try { document.execCommand('copy'); ok(); } catch (err) { /* niente */ }
        a.remove();
      }
    };
  }
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.code === 'Space') { e.preventDefault(); inCorso || sincAltroInCorso() ? ferma() : parti(); }
    if (e.key === 'Escape') $('aiuto').classList.remove('aperto');
    if (e.key === '?') $('aiuto').classList.toggle('aperto');
  });

  // --- veicoli ---
  // nei menu il nome breve, il titolo nel tooltip
  const opzione = (w, i) => { const o = new Option(w.nome, i); o.title = w.titolo; return o; };
  VEICOLI.forEach((w, i) => $('veicoloSel').add(opzione(w, i)));
  const titoloMenu = () => { $('veicoloSel').title = app.V.titolo; };
  function menuConfronto() {
    const s = $('confrontoSel'), prima = s.value;
    s.innerHTML = '';
    s.add(new Option('nessuno', ''));
    VEICOLI.forEach((w, i) => { if (i !== app.V.indice) s.add(opzione(w, i)); });
    s.value = [...s.options].some(o => o.value === prima) ? prima : '';
    app.W = s.value === '' ? null : veicolo(Number(s.value));
    s.title = app.W ? 'in grigio nei piani: ' + app.W.titolo : 'un secondo veicolo da disegnare in grigio nei piani';
    titoloMenu();
  }
  // passando a un altro veicolo si resta sulla "stessa" curva, se c'è. Per una chiocciola
  // allo stesso istante (cioè allo stesso volante); ma se il punto era un equilibrio della
  // mappa e l'altro veicolo a quel volante si è già girato, alla fine della sua mappa
  function curvaCorrispondente(V, c, s) {
    if (c.tipo === 'chiocciola') {
      const d = V.curve.find(x => x.tipo === 'chiocciola' && x.kmh === c.kmh);
      if (d) {
        const riga = rigaDelTempo(d, tempoDellaRiga(c, s));
        return { id: d.id, s: s <= c.fine ? Math.min(riga, d.fine) : riga };
      }
    } else if (c.tipo === 'famiglia') {
      const d = V.curve.find(x => x.famiglia === c.famiglia && Math.abs(x.valore - c.valore) < 1e-9);
      if (d) return { id: d.id, s: Math.min(d.n - 1, s * (d.n - 1) / Math.max(1, c.n - 1)) };
    } else {
      const d = V.curve.find(x => x.tipo === 'bordo');
      return { id: d.id, s: Math.min(d.n - 1, s * (d.n - 1) / Math.max(1, c.n - 1)) };
    }
    return inizio(V);
  }
  function inizio(V) {
    const c = V.curve.find(x => x.tipo === 'chiocciola' && x.kmh === 100) || V.curve[0];
    let s = 0, m = Infinity;
    for (let i = 0; i <= c.fine; i++) { const d = Math.abs(c.dati.ayt[i] - 4); if (d < m) { m = d; s = i; } }
    return { id: c.id, s };
  }
  $('veicoloSel').onchange = () => {
    ferma();
    const vecchio = app.V, c = vecchio.curve[app.sel.id];
    app.V = veicolo(Number($('veicoloSel').value));
    app.sel = curvaCorrispondente(app.V, c, app.sel.s);
    app.hover = null;
    menuConfronto();
    aggiornaVoci();
    ricostruisci();
    if (sincAttiva()) apri3D();            // il viewer ha le prove di un veicolo solo: si riapre su quelle del nuovo
  };
  $('confrontoSel').onchange = () => { menuConfronto(); ricostruisci(); };

  // --- curve accese (fa anche da legenda) ---
  const tratteggio = { solid: '', dot: '1.5 3', dash: '5 3', dashdot: '6 2.5 1.5 2.5', longdash: '9 3' };
  const campione = (colore, dash, w = 2) =>
    `<svg width="24" height="8" aria-hidden="true"><line x1="1" y1="4" x2="23" y2="4" stroke="${colore}" stroke-width="${w}" stroke-dasharray="${tratteggio[dash] || ''}"/></svg>`;
  const campioneBordo = `<svg width="24" height="8" aria-hidden="true"><line x1="1" y1="4" x2="12" y2="4" stroke="${COLORE.bordo}" stroke-width="2.5"/><line x1="12" y1="4" x2="23" y2="4" stroke="${COLORE.picco}" stroke-width="2.5"/></svg>`;
  // «mostra»: le parti delle prove (spunte); «curve di livello»: le famiglie iso (bottoni)
  function aggiornaVoci() {
    const V = app.V;
    const sf = `<span class="sfumatura" style="background:linear-gradient(90deg, ${coloreVelocita(V.kmin, V.kmin, V.kmax)}, ${coloreVelocita(V.kmax, V.kmin, V.kmax)})"></span>`;
    const voci = [
      ['chiocciole', 'chiocciole', sf, `prove a velocità costante, da ${V.kmin} a ${V.kmax} km/h, con il volante che cresce di 1°/s: sono le curve a u costante, colorate per velocità`],
      ['plateau', 'plateau', campione(COLORE.oltre, 'solid', 1.5), 'oltre il picco di ã_y, finché la prova è quasi statica: ancora equilibri, ma sterzando di più ã_y cala'],
      ['testacoda', 'testacoda', campione(COLORE.oltre, 'dot', 1.8), 'il veicolo si gira: non sono più equilibri. La prova finisce quando u scende sotto 1 m/s'],
      ['bordo', 'bordo', campioneBordo, 'il bordo della mappa: i picchi di ã_y a ogni velocità. In bianco dove dopo il picco c\'è il plateau (o il volante è a fine corsa), in arancione dove il veicolo comincia a girarsi prima che ã_y cali. Sotto il mouse o scelto con un clic si accende tutto in arancione: non è una prova, ▶ lo percorre un equilibrio dopo l\'altro'],
      ['rif', 'monotraccia', campione('#ffffff', 'dash', 1.6), V.rif ? 'il modello monotraccia con le caratteristiche degli assali (il suo handling diagram), solo in alcuni piani' : 'senza riferimento: il modello monotraccia usato qui non ha la deportanza'],
    ];
    $('voci').innerHTML = voci.map(([k, testo, sw, tit]) =>
      `<label title="${tit}"${k === 'rif' && !V.rif ? ' class="spento"' : ''}><input type="checkbox" data-k="${k}"${app.mostra[k] ? ' checked' : ''}${k === 'rif' && !V.rif ? ' disabled' : ''}>${sw}${testo}</label>`).join('');
    for (const el of $('voci').querySelectorAll('input')) {
      el.onchange = () => { app.mostra[el.dataset.k] = el.checked; for (const p of app.piani) p.costruisci(); };
    }
    $('chips').innerHTML = FAMIGLIE.map(f =>
      `<button class="chip${app.mostra[f.chiave] ? ' acceso' : ''}" data-k="${f.chiave}" aria-pressed="${!!app.mostra[f.chiave]}" title="curve di livello: ${f.voce.replace('iso-', '')} costante (clic: accendi o spegni)">${campione(f.colore, f.dash)}${f.voce}</button>`).join('');
    for (const el of $('chips').querySelectorAll('button')) {
      el.onclick = () => {
        const k = el.dataset.k;
        app.mostra[k] = !app.mostra[k];
        el.classList.toggle('acceso', app.mostra[k]);
        el.setAttribute('aria-pressed', app.mostra[k]);
        el.blur();
        for (const p of app.piani) p.costruisci();
      };
    }
  }

  // --- piani ---
  PRESET.forEach((p, i) => $('presetSel').add(new Option(p.voce, i)));
  for (let i = 0; i < 4; i++) app.piani.push(new Piano($('piani'), i, app));
  function applicaPreset(i) {
    PRESET[i].piani.forEach(([x, y], j) => app.piani[j].assi(x, y));
  }
  $('presetSel').onchange = () => { applicaPreset(Number($('presetSel').value)); for (const p of app.piani) p.costruisci(); };
  function ricostruisci() {
    for (const p of app.piani) p.costruisci();
    aggiornaBarra();
    aggiorna(true);
  }

  // --- comandi delle viste ---
  const kDa = x => Math.pow(10, x);
  $('k').value = Math.log10(app.k);
  const scriviK = () => { $('kVal').textContent = fmt(app.k, app.k < 9.95 ? 1 : 0) + '×'; };
  $('k').oninput = () => { app.k = Math.round(kDa(Number($('k').value)) * 10) / 10; scriviK(); disegnaViste(); };
  scriviK();
  for (const [id, k] of [['stDerive', 'derive'], ['stForze', 'forze'], ['stCarichi', 'carichi'], ['stAcc', 'acc']]) {
    $(id).onchange = () => { app.strati[k] = $(id).checked; disegnaViste(); };
  }
  $('btnBodyVeicolo').onclick = () => { $('seguiC').checked = false; vBody.sulVeicolo(); disegnaViste(); };
  $('btnBodyC').onclick = () => { vBody.inquadraC(statoVista(), app.V.P, app.k); disegnaViste(); };
  $('seguiC').onchange = () => disegnaViste();
  $('btnTerraVeicolo').onclick = () => { vTerra.modo = 'segui'; vTerra.zoomUtente = 1; disegnaViste(); };
  $('btnTerraTutto').onclick = () => { vTerra.tutto(app.curva, app.riga, statoVista()); disegnaViste(); };
  $('terraK').onchange = () => disegnaViste();
  for (const e of document.querySelectorAll('.icoIntera')) e.innerHTML = ICONA_INTERA;     // l'icona citata nell'aiuto
  $('btnAiuto').onclick = () => $('aiuto').classList.add('aperto');
  $('btnChiudiAiuto').onclick = () => $('aiuto').classList.remove('aperto');
  $('aiuto').onclick = e => { if (e.target === $('aiuto')) $('aiuto').classList.remove('aperto'); };

  // --- partenza ---
  menuConfronto();
  aggiornaVoci();
  applicaPreset(0);
  app.sel = inizio(app.V);
  ricostruisci();
  window.APP = app;          // per curiosare dalla console
})();
