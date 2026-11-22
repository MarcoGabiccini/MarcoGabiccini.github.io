// scena3d.js — vista 3D (three.js r128): telecamera che insegue la run di riferimento, auto con
// ruote che sterzano e girano, rollio e beccheggio esagerati, forze per ruota, auto fantasma.
// Terna dell'auto (= {B} traslata a terra): x avanti, y a sinistra, z in alto, origine a terra
// sotto G. La scena è solidale all'auto di riferimento (chase frame): il mondo le scorre sotto.
'use strict';

const S3 = {
  pronto: false, renderer: null, scene: null, camera: null, controls: null,
  mondo: null, griglia: null, scie: null, percorso: null, percorsoDati: null, istanze: [], base: null, baseNome: '',
  geomCache: new Map(), meshScelta: 'lowpoly', esag: 2, forze: true, scieOn: true, vista: 'insegui',
};
const PASSO_GRIGLIA = 5;

// Colori per nome di parte del GLB (il file non porta materiali).
const PAINT = {
  body:     { color: 0x9b1220, metalness: 0.6, roughness: 0.35 },
  interior: { color: 0x2e2f33, metalness: 0.0, roughness: 0.85 },
  bay:      { color: 0x141416, metalness: 0.1, roughness: 0.9 },
  mirrors:  { color: 0x26262a, metalness: 0.35, roughness: 0.35 },
  glass:    { color: 0x0e1a24, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.5 },
  lights_f: { color: 0xf2f0e6, metalness: 0.3, roughness: 0.15, emissive: 0xfff0c0, emissiveIntensity: 0.5 },
  lights_r: { color: 0x8c1418, metalness: 0.3, roughness: 0.2, emissive: 0xff2200, emissiveIntensity: 0.4 },
  plate_f:  { color: 0xffffff, metalness: 0.0, roughness: 0.55 },
  plate_r:  { color: 0xffffff, metalness: 0.0, roughness: 0.55 },
  rims:     { color: 0xb8bcc4, metalness: 0.9, roughness: 0.28 },
  gomma:    { color: 0x1b1b1e, metalness: 0.0, roughness: 0.92 },
};
const MESH = {
  lowpoly:  { nome: 'Ghibli low-poly', file: 'lib/ghibli_lowpoly_embed.js', leggi: () => window.EMBEDDED_GLB && window.EMBEDDED_GLB.ghibli_lowpoly },
  completa: { nome: 'Ghibli completa', file: 'lib/Maserati_Ghibli_embed.js', leggi: () => window.EMBEDDED_GLB_GZIP_B64 },
};

// ---------------------------------------------------------------- scena
function initScena() {
  const canvas = document.getElementById('anim3d');
  S3.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  S3.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  S3.renderer.setClearColor(0x0b1220, 1);
  canvas.addEventListener('webglcontextlost', e => e.preventDefault(), false);
  canvas.addEventListener('webglcontextrestored', () => { ridimensionaScena(); renderScena(); }, false);

  S3.scene = new THREE.Scene();
  S3.scene.fog = new THREE.Fog(0x0b1220, 70, 190);
  S3.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  S3.camera.up.set(0, 0, 1);
  S3.controls = new THREE.OrbitControls(S3.camera, canvas);
  S3.controls.enableDamping = false;
  S3.controls.minDistance = 2; S3.controls.maxDistance = 80;
  S3.controls.maxPolarAngle = Math.PI / 2 - 0.02;
  S3.controls.addEventListener('change', renderScena);
  impostaVista(S3.vista);

  S3.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303034, 0.75));
  const sole = new THREE.DirectionalLight(0xffffff, 0.8);
  sole.position.set(-4, 6, 10);
  S3.scene.add(sole);

  // asfalto uniforme solidale all'auto; griglia, percorso e traiettorie solidali a terra (nel gruppo "mondo")
  const asfalto = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: 0x2a2c31 }));
  S3.scene.add(asfalto);
  S3.mondo = new THREE.Group();
  S3.scene.add(S3.mondo);
  S3.griglia = new THREE.GridHelper(400, 400 / PASSO_GRIGLIA, 0x4a4d56, 0x3a3d45);
  S3.griglia.rotation.x = Math.PI / 2;
  S3.griglia.position.z = 0.005;
  S3.mondo.add(S3.griglia);
  S3.percorso = new THREE.Group();
  S3.mondo.add(S3.percorso);
  S3.scie = new THREE.Group();
  S3.mondo.add(S3.scie);

  S3.pronto = true;
  ridimensionaScena();
  new ResizeObserver(ridimensionaScena).observe(document.getElementById('animWrap'));
}
function ridimensionaScena() {
  if (!S3.pronto) return;
  const w = document.getElementById('animWrap');
  const W = Math.max(w.clientWidth, 1), H = Math.max(w.clientHeight, 1);
  S3.camera.aspect = W / H; S3.camera.updateProjectionMatrix();
  S3.renderer.setSize(W, H, false);
  renderScena();
}
function renderScena() { if (S3.pronto) S3.renderer.render(S3.scene, S3.camera); }

function impostaVista(v) {
  S3.vista = v;
  const P = { insegui: [[-7.5, 0, 3.0], [0.4, 0, 0.6]], alto: [[-0.01, 0, 24], [0, 0, 0]],
    lato: [[0.3, -9.5, 1.3], [0.3, 0, 0.6]], dietro: [[-9, 0, 1.1], [0, 0, 0.7]] }[v] || [[-7.5, 0, 3], [0.4, 0, 0.6]];
  S3.camera.position.set(...P[0]);
  S3.controls.target.set(...P[1]);
  S3.controls.update();
  renderScena();
}

// ---------------------------------------------------------------- modello 3D
// Dal GLB (X laterale, Y longitudinale con l'avanti a -Y, Z in alto, terra a z = 0) alla terna
// "canonica" x avanti, y sinistra, z su (rotZ(+90°)); centri ruota dai quattro quadranti di 'rims';
// pneumatici tolti dal 'body' (nel viewer sono procedurali); cerchi separati per ruota.
function preparaBase(parti) {
  const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const P = {};
  parti.forEach(p => { const g = p.geometry.clone(); g.deleteAttribute('normal'); g.applyMatrix4(rot); P[p.name] = g; });
  if (!P.rims || !P.body) throw new Error('il GLB non ha le parti body e rims');
  const quad = (x, y) => (x > 0 ? '1' : '2') + (y > 0 ? '1' : '2');
  // centri: bounding box dei vertici di ogni quadrante
  const pr = P.rims.attributes.position, bb = {};
  for (let i = 0; i < pr.count; i++) {
    const x = pr.getX(i), y = pr.getY(i), z = pr.getZ(i), q = quad(x, y);
    const b = bb[q] || (bb[q] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    [x, y, z].forEach((v, a) => { if (v < b.min[a]) b.min[a] = v; if (v > b.max[a]) b.max[a] = v; });
  }
  if (!RUOTE.every(ij => bb[ij])) throw new Error('rims: mancano dei quadranti');
  const centri = {}; let largh = 0;
  RUOTE.forEach(ij => {
    const b = bb[ij];
    centri[ij] = b.min.map((v, a) => 0.5 * (v + b.max[a]));
    largh = Math.max(largh, b.max[1] - b.min[1]);
  });
  const zc = RUOTE.reduce((s, ij) => s + centri[ij][2], 0) / 4;     // raggio della ruota nel modello
  const yIn = Math.min(...RUOTE.map(ij => Math.min(Math.abs(bb[ij].min[1]), Math.abs(bb[ij].max[1])))) - 0.06;
  const yOut = Math.max(...RUOTE.map(ij => Math.max(Math.abs(bb[ij].min[1]), Math.abs(bb[ij].max[1])))) + 0.06;
  P.body = togliPneumatici(P.body, centri, 1.063 * zc, yIn, yOut);
  // cerchi: triangoli per quadrante del baricentro, riportati al centro della ruota
  const cerchi = {};
  const rn = P.rims.index ? P.rims.toNonIndexed() : P.rims;
  const pos = rn.attributes.position.array, buf = { '11': [], '12': [], '21': [], '22': [] };
  for (let t = 0; t < pos.length; t += 9) {
    const q = quad((pos[t] + pos[t + 3] + pos[t + 6]) / 3, (pos[t + 1] + pos[t + 4] + pos[t + 7]) / 3), c = centri[q];
    for (let v = 0; v < 9; v += 3) buf[q].push(pos[t + v] - c[0], pos[t + v + 1] - c[1], pos[t + v + 2] - c[2]);
  }
  RUOTE.forEach(ij => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf[ij], 3));
    cerchi[ij] = g;
  });
  delete P.rims;
  const nf = Object.values(P).reduce((s, g) => s + (g.index ? g.index.count : g.attributes.position.count) / 3, 0) +
    RUOTE.reduce((s, ij) => s + cerchi[ij].attributes.position.count / 3, 0);
  return { parti: P, centri, cerchi, zc, largh, facce: Math.round(nf) };
}
function togliPneumatici(g, centri, R, yIn, yOut) {
  if (!g.index) g = THREE.BufferGeometryUtils ? THREE.BufferGeometryUtils.mergeVertices(g) : g;
  if (!g.index) return g;
  const p = g.attributes.position, idx = g.index.array, tieni = [];
  const dentro = i => {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ay = Math.abs(y);
    if (ay < yIn || ay > yOut) return false;
    return RUOTE.some(ij => { const c = centri[ij]; return Math.sign(y) === Math.sign(c[1]) && Math.hypot(x - c[0], z - c[2]) < R; });
  };
  for (let t = 0; t < idx.length; t += 3)
    if (!(dentro(idx[t]) && dentro(idx[t + 1]) && dentro(idx[t + 2]))) tieni.push(idx[t], idx[t + 1], idx[t + 2]);
  const out = g.clone();
  out.setIndex(tieni);
  return out;
}

// Mesh incorporate in lib/*_embed.js come GLB compresso gzip e codificato base64.
function b64ToUint8(b64) {
  const passo = 0x80000;               // multiplo di 4
  const parti = []; let tot = 0;
  for (let i = 0; i < b64.length; i += passo) {
    const bin = atob(b64.slice(i, i + passo));
    const b = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) b[j] = bin.charCodeAt(j);
    parti.push(b); tot += b.length;
  }
  const out = new Uint8Array(tot); let off = 0;
  for (const p of parti) { out.set(p, off); off += p.length; }
  return out;
}
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('il browser non ha DecompressionStream (serve Chrome/Edge 80+, Firefox 113+, Safari 16.4+)');
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).arrayBuffer();
}

async function caricaBase(scelta) {
  const m = MESH[scelta];
  if (!m) return null;
  if (!m.leggi()) await caricaScript(m.file);
  const b64 = m.leggi();
  if (!b64) throw new Error(m.file + ' non trovato');
  const buf = await gunzip(b64ToUint8(b64));
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, '', res, rej));
  const parti = [];
  gltf.scene.traverse(o => { if (o.isMesh) parti.push({ name: o.name, geometry: o.geometry }); });
  if (!parti.length) throw new Error('il GLB non ha mesh');
  return preparaBase(parti);
}

// Geometrie del modello deformate sul veicolo: passo e carreggiate esatti (scala non uniforme
// della cassa, carreggiata interpolata fra i due assali), raggio della ruota = rr.
function chiaveVeicolo(ve) { return ['a1', 'a2', 't1', 't2', 'rr', 'h'].map(k => ve[k]).join('|'); }
function geometrieVeicolo(ve) {
  const key = S3.baseNome + '|' + chiaveVeicolo(ve);
  if (S3.geomCache.has(key)) return S3.geomCache.get(key);
  const B = S3.base, c = B.centri;
  const xf = 0.5 * (c['11'][0] + c['12'][0]), xr = 0.5 * (c['21'][0] + c['22'][0]);
  const yf = 0.5 * (c['11'][1] - c['12'][1]), yr = 0.5 * (c['21'][1] - c['22'][1]);
  const sx = ve.l / (xf - xr), xm = 0.5 * (xf + xr), sz = ve.rr / B.zc;
  const syf = ve.t1 / (2 * yf), syr = ve.t2 / (2 * yr);
  const parti = {};
  for (const [nome, g0] of Object.entries(B.parti)) {
    const g = g0.clone(), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), s = Math.min(Math.max((x - xr) / (xf - xr), 0), 1);
      p.setXYZ(i, (x - xm) * sx + 0.5 * (ve.a1 - ve.a2), p.getY(i) * (syr + (syf - syr) * s), p.getZ(i) * sz);
    }
    g.computeVertexNormals();
    if (nome === 'plate_f' || nome === 'plate_r') uvTarga(g, nome === 'plate_r');
    parti[nome] = g;
  }
  const sw = ve.rr / B.zc, cerchi = {};
  RUOTE.forEach(ij => { const g = B.cerchi[ij].clone(); g.scale(sw, sw, sw); g.computeVertexNormals(); cerchi[ij] = g; });
  const out = { parti, cerchi, largh: B.largh * sw };
  S3.geomCache.set(key, out);
  return out;
}

// Targa: testo su canvas proiettato sulla geometria del modello (UV planari: u lungo y, v lungo z).
let texTarga = null;
function uvTarga(g, specchia) {
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const u = (p.getY(i) - b.min.y) / Math.max(b.max.y - b.min.y, 1e-9);
    uv[2 * i] = specchia ? 1 - u : u;
    uv[2 * i + 1] = (p.getZ(i) - b.min.z) / Math.max(b.max.z - b.min.z, 1e-9);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function textureTarga() {
  if (texTarga) return texTarga;
  const W = 1024, H = 250, f = 78, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2f2ec'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0d2b8f'; g.fillRect(0, 0, f, H); g.fillRect(W - f, 0, f, H);
  g.fillStyle = '#f2f2ec'; g.textAlign = 'center'; g.font = 'bold 54px sans-serif'; g.fillText('I', f / 2, H - 26);
  g.font = 'bold 38px sans-serif'; g.fillText('PI', W - f / 2, H - 26);
  g.fillStyle = '#16161a'; g.textBaseline = 'middle'; g.font = 'bold 168px sans-serif'; g.fillText('DV 001 PI', W / 2, H / 2 + 6);
  texTarga = new THREE.CanvasTexture(cv);
  return texTarga;
}

// ---------------------------------------------------------------- istanze dell'auto
function materiale(nome, fantasma, colore) {
  if (fantasma) return new THREE.MeshLambertMaterial({ color: new THREE.Color(colore), transparent: true, opacity: nome === 'gomma' ? 0.3 : 0.16,
    depthWrite: false, side: THREE.DoubleSide });
  const p = Object.assign({ side: THREE.DoubleSide }, PAINT[nome] || PAINT.body);
  if (nome === 'plate_f' || nome === 'plate_r') p.map = textureTarga();
  return new THREE.MeshStandardMaterial(p);
}
function geomPneumatico(rr, w) {
  const ri = 0.76 * rr, h = w / 2;
  const prof = [[ri, -h], [0.93 * rr, -h], [0.985 * rr, -0.82 * h], [rr, -0.45 * h], [rr, 0.45 * h], [0.985 * rr, 0.82 * h], [0.93 * rr, h], [ri, h]];
  return new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 40);
}
// Cerchio procedurale (senza modello): disco con cinque razze, così la rotazione si vede.
function cerchioProcedurale(rr, w, mat) {
  const g = new THREE.Group();
  const disco = new THREE.Mesh(new THREE.CylinderGeometry(0.76 * rr, 0.76 * rr, 0.5 * w, 24, 1, true), mat);
  g.add(disco);
  for (let k = 0; k < 5; k++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.12 * rr, 0.3 * w, 1.45 * rr), mat);
    r.rotation.y = k * 2 * Math.PI / 5;
    g.add(r);
  }
  return g;
}
function cassaProcedurale(ve, mat, matVetro) {
  const g = new THREE.Group(), L1 = ve.a1 + 0.85, L2 = ve.a2 + 1.0, W = Math.max(ve.t1, ve.t2) + 0.28, r = ve.rr;
  const bassa = new THREE.Mesh(new THREE.BoxGeometry(L1 + L2, W, 2.0 * r), mat);
  bassa.position.set(0.5 * (L1 - L2), 0, 0.55 * r + r);
  const abit = new THREE.Mesh(new THREE.BoxGeometry(0.5 * (L1 + L2), 0.86 * W, 1.6 * r), matVetro);
  abit.position.set(0.5 * (L1 - L2) - 0.25, 0, 2.55 * r + 0.8 * r);
  g.add(bassa); g.add(abit);
  return g;
}
// Frecce disegnate sopra a tutto: stanno a terra, sotto la cassa, e altrimenti non si vedrebbero.
function freccia3D(colore) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.01, colore, 0.18, 0.1);
  [a.line, a.cone].forEach(o => { o.material.depthTest = false; o.material.transparent = true; o.renderOrder = 10; });
  a.visible = false;
  return a;
}
function impostaFreccia(a, fx, fy, fz, scala) {
  const L = Math.hypot(fx, fy, fz) * scala;
  if (!(L > 0.02) || !Number.isFinite(L)) { a.visible = false; return; }
  a.visible = true;
  a.setDirection(new THREE.Vector3(fx, fy, fz).normalize());
  a.setLength(L, Math.min(0.25, 0.3 * L), Math.min(0.14, 0.18 * L));
}

function creaIstanza(k, fantasma) {
  const run = V.runs[k], ve = run.veicolo;
  const root = new THREE.Group();
  const pivot = new THREE.Group(), off = new THREE.Group();
  // perno di rollio e beccheggio: altezza del centro di rollio se il veicolo la porta, altrimenti 0.1 m
  const zp = ve.q1 !== undefined && ve.q2 !== undefined ? (ve.a2 * ve.q1 + ve.a1 * ve.q2) / ve.l : 0.1;
  pivot.position.set(0, 0, zp); off.position.set(0, 0, -zp);
  pivot.add(off); root.add(pivot);
  const G = S3.base ? geometrieVeicolo(ve) : null;
  if (G) {
    // il fantasma ha solo carrozzeria e vetri: con tutte le parti gli strati trasparenti si sommano e coprono l'auto vera
    for (const [nome, g] of Object.entries(G.parti)) {
      if (fantasma && nome !== 'body' && nome !== 'glass') continue;
      const m = new THREE.Mesh(g, materiale(nome, fantasma, run.colore));
      if (fantasma) m.renderOrder = 2;
      off.add(m);
    }
  } else {
    off.add(cassaProcedurale(ve, materiale('body', fantasma, run.colore), materiale('glass', fantasma, run.colore)));
  }
  const xw = { '1': ve.a1, '2': -ve.a2 }, tw = { '1': ve.t1, '2': ve.t2 };
  const lw = G ? Math.max(G.largh, 0.55 * ve.rr) : 0.68 * ve.rr;
  const geoT = geomPneumatico(ve.rr, lw), matR = materiale('rims', fantasma, run.colore);
  // alone del pneumatico (pneumatici.js, statoPneumatico): un guscio trasparente poco più grande
  // della gomma, arancione oltre il picco e rosso (più coprente) a ruota bloccata; la ruota si
  // vede sotto, la carrozzeria davanti lo nasconde
  const geoA = geomPneumatico(1.05 * ve.rr, 1.15 * lw);
  const matAlone = [null, [COL_OLTRE, 0.45], [COL_BLOCCO, 0.55]].map(c => c && new THREE.MeshBasicMaterial({ color: c[0],
    transparent: true, opacity: c[1], depthWrite: false, side: THREE.DoubleSide }));
  const ruote = {}, frecce = {};
  RUOTE.forEach(ij => {
    const y = (ij[1] === '1' ? 1 : -1) * tw[ij[0]] / 2;
    const sterzo = new THREE.Group();
    sterzo.rotation.order = 'ZXY';
    sterzo.position.set(xw[ij[0]], y, ve.rr);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(geoT, materiale('gomma', fantasma, run.colore)));
    if (G) spin.add(new THREE.Mesh(G.cerchi[ij], matR));
    else { const c = cerchioProcedurale(ve.rr, lw, matR); c.position.y = (ij[1] === '1' ? 1 : -1) * 0.1 * lw; spin.add(c); }
    const alone = new THREE.Mesh(geoA, matAlone[OLTRE]);
    alone.visible = false; alone.renderOrder = 3;
    sterzo.add(spin); sterzo.add(alone); root.add(sterzo);
    ruote[ij] = { sterzo, spin, alone, matAlone };
    if (!fantasma) {
      const g = new THREE.Group(); g.position.set(xw[ij[0]], y, 0.03);
      // Z in grigio chiaro: l'arancione è il colore del pneumatico oltre il picco
      const f = { g, fx: freccia3D(0x4caf50), fy: freccia3D(0x42a5f5), fz: freccia3D(0xdcdce4) };
      g.add(f.fx); g.add(f.fy); g.add(f.fz); root.add(g);
      frecce[ij] = f;
    }
  });
  const assi = {};
  if (!fantasma) ['1', '2'].forEach(i => {
    const g = new THREE.Group(); g.position.set(xw[i], 0, 0.03);
    const fy = freccia3D(0x42a5f5); g.add(fy); root.add(g);
    assi[i] = { g, fy };
  });
  S3.scene.add(root);
  return { k, run, root, pivot, ruote, frecce, assi, fantasma, spin: angoliRuote(run) };
}
// Angolo di rotazione delle ruote: integrale di omega_ij (o di u/rr se la run non ha le ruote).
function angoliRuote(run) {
  const d = run.data, out = {};
  RUOTE.forEach(ij => {
    const om = d['omega_' + ij], a = new Float64Array(run.n);
    for (let i = 1; i < run.n; i++) {
      const w0 = om ? om[i - 1] : (d.u ? d.u[i - 1] : 0) / run.veicolo.rr, w1 = om ? om[i] : (d.u ? d.u[i] : 0) / run.veicolo.rr;
      a[i] = a[i - 1] + 0.5 * (w0 + w1) * (d.t[i] - d.t[i - 1]);
    }
    out[ij] = a;
  });
  return out;
}
function costruisciIstanze() {
  if (!S3.pronto) return;
  S3.istanze.forEach(s => S3.scene.remove(s.root));
  S3.istanze = [];
  if (!V.runs.length) { renderScena(); return; }
  S3.istanze.push(creaIstanza(V.ref, false));
  visibili().filter(k => k !== V.ref).forEach(k => S3.istanze.push(creaIstanza(k, true)));
  costruisciScie();
  costruisciPercorso();
  legenda3D();
}
function costruisciScie() {
  while (S3.scie.children.length) S3.scie.remove(S3.scie.children[0]);
  visibili().forEach(k => {
    const r = V.runs[k], pts = [];
    const passo = Math.max(1, Math.floor(r.n / 3000));
    for (let i = 0; i < r.n; i += passo) pts.push(r.data.X[i], r.data.Y[i], 0.02 + 0.002 * k);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const st = r.modello === 'st';
    const mat = st ? new THREE.LineDashedMaterial({ color: r.colore, dashSize: 1.2, gapSize: 0.8 }) : new THREE.LineBasicMaterial({ color: r.colore });
    const line = new THREE.Line(g, mat);
    if (st) line.computeLineDistances();
    S3.scie.add(line);
  });
  S3.scie.visible = S3.scieOn;
}

// ---------------------------------------------------------------- percorso, pista e coni
// Stanno nel gruppo "mondo", in coordinate {S} come le scie. Tutto opaco: le auto fantasma e
// l'alone dei pneumatici (trasparenti, disegnati dopo) li lasciano vedere. Quote sopra la griglia (0.005)
// e sotto le scie (0.02), ben separate: con la telecamera radente la differenza di profondità
// cresce con la distanza, e così non ci sono sfarfallii.
const Z_ASFALTO = 0.007, Z_CORDOLO = 0.01, Z_PERCORSO = 0.012;
const CORDOLO = { largh: 0.9, striscia: 2.5, linea: 0.12, rosso: '#d62828', bianco: '#f2f2f2' };
const CONO = { h: 0.7, r: 0.18, base: 0.22 };

// Si rifà solo quando arrivano dati nuovi (V.percorso cambia).
function costruisciPercorso() {
  const p = V.percorso;
  if (S3.percorsoDati === p) return;
  S3.percorsoDati = p;
  while (S3.percorso.children.length) {
    const o = S3.percorso.children[0];
    o.geometry.dispose(); S3.percorso.remove(o);
  }
  if (!p) return;
  if (p.larghezza > 0) { S3.percorso.add(meshAsfalto(p)); S3.percorso.add(meshCordoli(p)); }
  S3.percorso.add(lineaPercorso(p));
  if (p.coniX.length) S3.percorso.add(meshConi(p));
}

// Stazioni {x, y, nx, ny} lungo una linea, il percorso o la mezzeria della pista (n = normale a
// sinistra): i punti della linea così come sono, ripetendo il primo in fondo se è chiusa.
function puntiPercorso(p) {
  const st = [];
  for (let i = 0; i <= (p.chiuso ? p.n : p.n - 1); i++) {
    const j = i % p.n;
    st.push({ x: p.X[j], y: p.Y[j], nx: p.nx[j], ny: p.ny[j] });
  }
  return st;
}
// Stazioni a passo costante (circa "passo" metri) in ascissa curvilinea s, interpolando punti
// e normali. Su un circuito il numero di tratti è pari: i colori alternati tornano giusti alla chiusura.
function stazioniPercorso(p, passo) {
  const pt = puntiPercorso(p), s = [0];
  for (let i = 1; i < pt.length; i++) s.push(s[i - 1] + Math.hypot(pt[i].x - pt[i - 1].x, pt[i].y - pt[i - 1].y));
  const L = s[s.length - 1];
  let nt = Math.max(1, Math.round(L / passo));
  if (p.chiuso && nt % 2) nt++;
  const st = [];
  for (let k = 0, j = 0; k <= nt; k++) {
    const sk = L * k / nt;
    while (j < pt.length - 2 && s[j + 1] < sk) j++;
    const a = pt[j], b = pt[j + 1], u = (sk - s[j]) / ((s[j + 1] - s[j]) || 1);
    const nx = a.nx + u * (b.nx - a.nx), ny = a.ny + u * (b.ny - a.ny), nn = Math.hypot(nx, ny) || 1;
    st.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), nx: nx / nn, ny: ny / nn });
  }
  return st;
}
// Striscia piana fra le distanze dLo < dHi dalla linea delle stazioni (positive a sinistra), alla quota z:
// due triangoli per tratto fra stazioni vicine, in senso antiorario visti dall'alto. Se c'è
// colore(k), ogni tratto ha il suo colore (un colore per vertice, tutti uguali nel tratto).
function striscia(st, dLo, dHi, z, pos, col, colore) {
  const P = (s, d) => [s.x + d * s.nx, s.y + d * s.ny, z];
  for (let k = 0; k + 1 < st.length; k++) {
    const a = st[k], b = st[k + 1];
    pos.push(...P(a, dLo), ...P(b, dLo), ...P(b, dHi), ...P(a, dLo), ...P(b, dHi), ...P(a, dHi));
    if (col) { const c = colore(k); for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b); }
  }
}
// Un'unica geometria per tutte le strisce, con la normale verso l'alto.
function meshPiana(pos, col, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 2; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, mat);
}
// Asfalto della pista: larga p.larghezza, attorno alla mezzeria se i dati la portano, altrimenti
// attorno al percorso (centroPista).
function meshAsfalto(p) {
  const pos = [];
  striscia(puntiPercorso(centroPista(p)), -p.larghezza / 2, p.larghezza / 2, Z_ASFALTO, pos);
  return meshPiana(pos, null, new THREE.MeshLambertMaterial({ color: 0x3c3f46 }));
}
// Cordoli appena fuori dai due bordi della pista, a strisce rosse e bianche, e una linea bianca
// sul bordo dell'asfalto.
function meshCordoli(p) {
  const st = stazioniPercorso(centroPista(p), CORDOLO.striscia), w = p.larghezza / 2, C = CORDOLO;
  const rosso = new THREE.Color(C.rosso), bianco = new THREE.Color(C.bianco);
  const alterna = k => (k % 2 ? bianco : rosso), tuttoBianco = () => bianco;
  const pos = [], col = [];
  striscia(st, w, w + C.largh, Z_CORDOLO, pos, col, alterna);
  striscia(st, -w - C.largh, -w, Z_CORDOLO, pos, col, alterna);
  striscia(st, w - C.linea, w, Z_CORDOLO, pos, col, tuttoBianco);
  striscia(st, -w, -w + C.linea, Z_CORDOLO, pos, col, tuttoBianco);
  return meshPiana(pos, col, new THREE.MeshLambertMaterial({ vertexColors: true }));
}
function lineaPercorso(p) {
  const c = curvaParallela(p, 0), pts = [];
  c.x.forEach((x, i) => pts.push(x, c.y[i], Z_PERCORSO));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: COLORE_PERCORSO, dashSize: 1.5, gapSize: 1.0 }));
  line.computeLineDistances();
  return line;
}
// Cono stradale: profilo ruotato attorno all'asse (LatheGeometry), base scura, corpo arancione con
// una fascia bianca. Ogni tratto del profilo ha i suoi due punti, così spigoli e cambi di colore
// restano netti; il colore va per vertice, scelto dal tratto.
function geometriaCono() {
  const { h, r, base } = CONO, zb = 0.03, rz = z => r - (r - 0.03) * (z - zb) / (h - zb);
  const scuro = new THREE.Color('#3a2a1a'), arancio = new THREE.Color(COLORE_CONI), bianco = new THREE.Color('#f2f2f2');
  const tratti = [
    [[0.001, 0], [base, 0], scuro], [[base, 0], [base, zb], scuro], [[base, zb], [r, zb], scuro],
    [[r, zb], [rz(0.3), 0.3], arancio], [[rz(0.3), 0.3], [rz(0.48), 0.48], bianco],
    [[rz(0.48), 0.48], [rz(h), h], arancio], [[rz(h), h], [0, h], arancio],
  ];
  const profilo = [], colori = [];
  tratti.forEach(([a, b, c]) => { profilo.push(new THREE.Vector2(...a), new THREE.Vector2(...b)); colori.push(c, c); });
  const g = new THREE.LatheGeometry(profilo, 20);
  g.rotateX(Math.PI / 2);             // asse del tornio (y) in verticale (z)
  const col = [];
  for (let i = 0; i < g.attributes.position.count; i++) { const c = colori[i % profilo.length]; col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
// Tutti i coni in una sola InstancedMesh: una geometria, una matrice (traslazione) per cono.
function meshConi(p) {
  const nc = p.coniX.length, m = new THREE.InstancedMesh(geometriaCono(), new THREE.MeshLambertMaterial({ vertexColors: true }), nc);
  const T = new THREE.Matrix4();
  for (let i = 0; i < nc; i++) m.setMatrixAt(i, T.makeTranslation(p.coniX[i], p.coniY[i], 0));
  m.frustumCulled = false;            // three r128 non calcola l'ingombro delle istanze, solo quello del primo cono
  return m;
}

function legenda3D() {
  const voci = S3.istanze.map(s => `<span style="color:${s.run.colore}">■</span> ${s.run.label} (${s.run.modello.toUpperCase()}${s.fantasma ? ', fantasma' : ''})`);
  const p = V.percorso;
  document.getElementById('animLegend').innerHTML = voci.join('<br>') +
    (p ? `<br><span style="color:${COLORE_PERCORSO}">- -</span> percorso` + (p.larghezza > 0 ? ` · pista larga ${p.larghezza} m` : '') : '') +
    (p && p.coniX.length ? `<br><span style="color:${COLORE_CONI}">▲</span> coni` : '') +
    (S3.istanze.some(s => haRuote(s.run)) ? `<br><span style="color:${COL_OLTRE}">●</span> pneumatico oltre il picco` +
      `<br><span style="color:${COL_BLOCCO}">●</span> ruota bloccata` : '') +
    (S3.forze ? '<br><span style="color:#4caf50">Fx</span> · <span style="color:#42a5f5">Fy</span> · <span style="color:#dcdce4">Z</span>' : '');
}

// Sterzo della ruota: delta_ij (DT); per il monotraccia delta_1, delta_2 ricavati dalle derive;
// altrimenti tau delta_v (tau1, tau2 dal veicolo se ci sono).
function sterzoRuota(run, ij, i) {
  const d = run.data;
  if (d['delta_' + ij]) return d['delta_' + ij][i];
  if (d['delta_' + ij[0]]) return d['delta_' + ij[0]][i];
  const tau = ij[0] === '1' ? (run.veicolo.tau1 ?? 0.05) : (run.veicolo.tau2 ?? 0);
  return tau * val(run, 'delta_v', i, 0);
}

function aggiornaScena() {
  if (!S3.pronto || !S3.istanze.length) { renderScena(); return; }
  const R = refRun(), iR = idxAt(R, V.tNow);
  const X0 = val(R, 'X', iR, 0), Y0 = val(R, 'Y', iR, 0), psi0 = val(R, 'psi', iR, 0);
  const c = Math.cos(psi0), s = Math.sin(psi0);
  S3.mondo.rotation.z = -psi0;
  S3.mondo.position.set(-(X0 * c + Y0 * s), -(-X0 * s + Y0 * c), 0);
  S3.griglia.position.x = Math.round(X0 / PASSO_GRIGLIA) * PASSO_GRIGLIA;
  S3.griglia.position.y = Math.round(Y0 / PASSO_GRIGLIA) * PASSO_GRIGLIA;

  S3.istanze.forEach(ist => {
    const r = ist.run, i = idxAt(r, V.tNow), ve = r.veicolo;
    const dx = val(r, 'X', i, 0) - X0, dy = val(r, 'Y', i, 0) - Y0;
    ist.root.position.set(dx * c + dy * s, -dx * s + dy * c, 0);
    ist.root.rotation.z = val(r, 'psi', i, 0) - psi0;
    const phi = 0.5 * (val(r, 'phi1', i, 0) + val(r, 'phi2', i, 0));
    ist.pivot.rotation.set(S3.esag * phi, S3.esag * val(r, 'theta', i, 0), 0);
    RUOTE.forEach(ij => {
      const w = ist.ruote[ij];
      w.sterzo.rotation.set(val(r, 'gamma_' + ij, i, 0), 0, sterzoRuota(r, ij, i));
      w.spin.rotation.y = ist.spin[ij][i] % (2 * Math.PI);
      const st = statoPneumatico(r, ij, i);
      w.alone.visible = st !== PRIMA;
      if (st !== PRIMA) w.alone.material = w.matAlone[st];
      const f = ist.frecce[ij];
      if (!f) return;
      const sc = 0.9 / ve.Fz0;          // carico nominale = 0.9 m
      const on = S3.forze && r.modello === 'dt';
      f.g.rotation.z = sterzoRuota(r, ij, i);
      impostaFreccia(f.fx, on ? val(r, 'Fx_' + ij, i, 0) : 0, 0, 0, sc);
      impostaFreccia(f.fy, 0, on ? val(r, 'Fy_' + ij, i, 0) : 0, 0, sc);
      impostaFreccia(f.fz, 0, 0, on ? val(r, 'Z_' + ij, i, 0) : 0, sc);
    });
    ['1', '2'].forEach(a => {
      const f = ist.assi[a];
      if (!f) return;
      const on = S3.forze && r.modello === 'st';
      f.g.rotation.z = sterzoRuota(r, a + '1', i);
      impostaFreccia(f.fy, 0, on ? val(r, 'Y_' + a, i, 0) : 0, 0, 0.9 / (2 * ve.Fz0));
    });
  });
  renderScena();
}

async function cambiaModello(scelta) {
  S3.meshScelta = scelta;
  const hint = document.getElementById('animHint');
  if (scelta === 'procedurale') { S3.base = null; S3.baseNome = ''; }
  else {
    hint.textContent = 'carico ' + MESH[scelta].nome + '…';
    try { S3.base = await caricaBase(scelta); S3.baseNome = scelta; }
    catch (e) { console.error(e); S3.base = null; S3.baseNome = ''; hint.textContent = 'modello non caricato (' + e.message + '): auto procedurale'; }
  }
  if (S3.base) hint.textContent = MESH[scelta].nome + ' — ' + S3.base.facce + ' facce · trascina per ruotare, rotella per lo zoom';
  else if (scelta === 'procedurale') hint.textContent = 'auto procedurale · trascina per ruotare, rotella per lo zoom';
  costruisciIstanze();
  aggiornaScena();
}
