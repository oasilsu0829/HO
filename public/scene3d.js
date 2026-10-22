/* global THREE */
// First-person 3D table: you sit at the near edge under a single lamp, opponents across.
// Rendered at low resolution and scaled up with hard pixels.
const Scene3D = (() => {
  const SCALE = 0.42;          // render resolution vs. screen
  const TABLE_Y = 0.78;
  const DECK = new THREE.Vector3(0, TABLE_Y + 0.25, -0.95);
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_COL = { s: '#111111', c: '#111111', h: '#b3150d', d: '#b3150d' };

  let renderer, scene, camera, lamp, lampBulb, root, labelsEl, tableGroup, ambient;
  const camBase = new THREE.Vector3(0, 1.5, 1.55);
  const camLook = new THREE.Vector3(0, 0.95, -0.55);
  const LOOK_WIDE = camLook.clone(), LOOK_TALL = new THREE.Vector3(0, 0.82, -0.2); // tall screens look further down so the board sits higher
  let shakeT = 0, shakeAmp = 0, flicker = 0;
  const texCache = {};
  const cards = new Map();   // key -> mesh
  const chips = new Map();   // key -> group
  const figures = new Map(); // playerId -> group
  let seatPos = {};          // playerId -> {figure, cards, chips, label}
  let labelData = [];
  let lastW = 0, lastH = 0;
  let sweep = null;          // win cinematic state
  let tourState = null;      // showdown close-ups
  let stareId = null, stareAmt = 0;
  let lookPoint = null;
  let execs = [];            // running executions
  const deadPose = {};       // playerId -> 'slump' | 'limp' | 'gone'
  const headless = {};       // playerId -> true once their head is gone
  let gore = true;
  let particles = [], stains = null, stainList = [];
  const BLOOD = 0x6a0905, BLOOD_DARK = 0x1e0201;
  let dropGeo = null, bloodMat = null, stainMat = null;
  let lampDim = 1, lampSpike = 0, zapLevel = 0, zap = null, gunProto = null, eyesProto = null;
  const camCur = new THREE.Vector3(0, 1.5, 1.55), lookCur = new THREE.Vector3(0, 0.95, -0.55);
  let hands = null;
  const POT_POS = new THREE.Vector3(-0.05, TABLE_Y, 0.22);
  const TUCK = new THREE.Vector3(), TUCK_OFF = new THREE.Vector3(0, -0.4, 0.3);

  // ---------- textures ----------
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    return t;
  }
  function cardTex(c) {
    if (texCache[c]) return texCache[c];
    return (texCache[c] = canvasTex(64, 90, (x, w, h) => {
      if (c === '??') {
        x.fillStyle = '#2a0c09'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#3d120d';
        for (let i = -h; i < w; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.lineTo(i + h + 3, h); x.lineTo(i + 3, 0); x.fill(); }
        x.strokeStyle = '#5b4d3a'; x.lineWidth = 4; x.strokeRect(4, 4, w - 8, h - 8);
        x.fillStyle = '#c9c2a8'; x.globalAlpha = .25; x.beginPath(); x.arc(w / 2, h / 2, 10, 0, 7); x.fill();
        return;
      }
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#ddd5b8'); g.addColorStop(1, '#a39a7c');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#000'; x.lineWidth = 3; x.strokeRect(1, 1, w - 2, h - 2);
      x.fillStyle = SUIT_COL[c[1]];
      x.font = 'bold 30px monospace'; x.textBaseline = 'top';
      x.fillText(c[0] === 'T' ? '10' : c[0], 5, 4);
      x.font = '22px monospace'; x.fillText(SUIT[c[1]], 6, 34);
      x.font = '44px monospace'; x.textAlign = 'right'; x.textBaseline = 'bottom'; x.fillText(SUIT[c[1]], w - 4, h - 2);
    }));
  }
  function feltTex() {
    return canvasTex(128, 80, (x, w, h) => {
      x.fillStyle = '#2c4034'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .25})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
      x.strokeStyle = 'rgba(201,194,168,.12)'; x.lineWidth = 1;
      x.beginPath(); x.ellipse(w / 2, h / 2, w * .3, h * .25, 0, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(201,194,168,.08)';
      for (let i = 0; i < 6; i++) { x.beginPath(); const a = Math.random() * w, b = Math.random() * h; x.moveTo(a, b); x.lineTo(a + Math.random() * 30 - 15, b + Math.random() * 20 - 10); x.stroke(); }
      x.fillStyle = 'rgba(70,10,8,.35)'; x.beginPath(); x.arc(w * .78, h * .3, 5, 0, 7); x.fill(); // old stain
    });
  }
  function woodTex() {
    return canvasTex(64, 16, (x, w, h) => {
      x.fillStyle = '#2a1d14'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .35})`; x.fillRect(0, Math.random() * h, w, 1); }
    });
  }

  // ---------- build ----------
  function init(container) {
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    renderer.setClearColor(0x030403);
    const cv = renderer.domElement;
    cv.id = 'canvas3d';
    container.appendChild(cv);
    labelsEl = document.createElement('div'); labelsEl.id = 'labels'; container.appendChild(labelsEl);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x030403, 3, 7.5);
    camera = new THREE.PerspectiveCamera(58, 1, 0.05, 20);

    ambient = new THREE.AmbientLight(0x5a6650, 0.75);
    scene.add(ambient);
    lamp = new THREE.SpotLight(0xf0e8c8, 3.3, 7, 0.85, 0.5, 1);
    lamp.position.set(0, 2.45, -0.1);
    lamp.target.position.set(0, TABLE_Y, -0.1);
    lamp.castShadow = true; lamp.shadow.mapSize.set(512, 512);
    scene.add(lamp, lamp.target);
    // hanging lamp shade + bulb
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0x1a1c18, side: THREE.DoubleSide }));
    shade.position.set(0, 2.6, -0.1); scene.add(shade);
    lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    lampBulb.position.set(0, 2.52, -0.1); scene.add(lampBulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.set(0, 3.7, -0.1); scene.add(cord);

    buildRoom();

    // table
    tableGroup = new THREE.Group(); scene.add(tableGroup);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.06, 1.9), [
      new THREE.MeshLambertMaterial({ map: woodTex() }), new THREE.MeshLambertMaterial({ map: woodTex() }),
      new THREE.MeshLambertMaterial({ map: feltTex() }), new THREE.MeshLambertMaterial({ color: 0x1a120c }),
      new THREE.MeshLambertMaterial({ map: woodTex() }), new THREE.MeshLambertMaterial({ map: woodTex() }),
    ]);
    top.position.y = TABLE_Y - 0.03; top.receiveShadow = true; tableGroup.add(top);
    const rimMat = new THREE.MeshLambertMaterial({ map: woodTex() });
    for (const [w, d, x, z] of [[3.1, 0.08, 0, 0.97], [3.1, 0.08, 0, -0.97], [0.08, 1.9, 1.52, 0], [0.08, 1.9, -1.52, 0]]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), rimMat); r.position.set(x, TABLE_Y + 0.01, z); r.castShadow = true; tableGroup.add(r);
    }
    for (const [x, z] of [[-1.35, -0.8], [1.35, -0.8], [-1.35, 0.8], [1.35, 0.8]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, TABLE_Y, 0.08), rimMat); leg.position.set(x, TABLE_Y / 2, z); tableGroup.add(leg);
    }
    // a low rail the community cards lean on
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.05), rimMat);
    rail.position.set(0, TABLE_Y + 0.02, -0.42); rail.castShadow = true; tableGroup.add(rail);
    // the deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.24), [0, 0, 0, 0, 0, 0].map((_, i) => new THREE.MeshLambertMaterial(i === 2 ? { map: cardTex('??') } : { color: 0x9b9274 })));
    deck.position.set(0.55, TABLE_Y + 0.025, -0.75); deck.rotation.y = 0.3; deck.castShadow = true; tableGroup.add(deck);
    // an ashtray, because of course
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.04, 10), new THREE.MeshLambertMaterial({ color: 0x2b2e2a }));
    ash.position.set(-1.1, TABLE_Y + 0.02, 0.55); tableGroup.add(ash);

    root = new THREE.Group(); scene.add(root);
    // my hands, only seen when raking in a pot
    hands = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x6f6757 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x1a1c18 });
    for (const sx of [-1, 1]) {
      const h = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.13), skin); palm.castShadow = true; h.add(palm);
      for (let f = 0; f < 4; f++) { const fi = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.025, 0.07), skin); fi.position.set(-0.04 + f * 0.027, -0.005, -0.09); fi.castShadow = true; h.add(fi); }
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.06), skin); thumb.position.set(-sx * 0.065, 0, -0.03); thumb.rotation.y = sx * 0.6; h.add(thumb);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.6), sleeve); arm.position.set(0, 0.02, 0.36); arm.castShadow = true; h.add(arm);
      h.position.x = sx * 0.17; h.rotation.y = -sx * 0.35;
      hands.add(h);
    }
    hands.visible = false; scene.add(hands);
    buildExecProps();
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setPixelRatio(1);
    const scale = Math.min(w, h) < 600 ? 0.75 : SCALE; // small screens need more pixels to read the cards
    renderer.setSize(Math.max(160, Math.floor(w * scale)), Math.max(120, Math.floor(h * scale)), false);
    camera.aspect = w / h;
    // portrait screens need a wider field of view to keep the table in frame
    camera.fov = w / h < 1 ? 80 : 60;
    camLook.copy(w / h < 0.75 ? LOOK_TALL : LOOK_WIDE);
    camera.updateProjectionMatrix();
  }

  // ---------- the room ----------
  function tiledTex(w, h, rx, ry, draw) { const t = canvasTex(w, h, draw); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t; }
  let dust = null, shaft = null;
  function buildRoom() {
    const floorTex = tiledTex(64, 64, 10, 10, (x, w, h) => {
      for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) { x.fillStyle = (tx + ty) % 2 ? '#1c1d18' : '#2a2a22'; x.fillRect(tx * 32, ty * 32, 32, 32); }
      x.fillStyle = '#0c0c0a'; for (let k = 0; k <= 64; k += 32) { x.fillRect(k, 0, 1, 64); x.fillRect(0, k, 64, 1); }
      for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      x.fillStyle = 'rgba(50,8,5,.35)'; x.beginPath(); x.arc(44, 18, 6, 0, 7); x.fill();
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const wallTex = tiledTex(64, 64, 6, 3, (x, w, h) => {
      x.fillStyle = '#26271f'; x.fillRect(0, 0, w, h);
      for (let by = 0; by < h; by += 16) for (let bx = (by / 16) % 2 ? -16 : 0; bx < w; bx += 32) { x.fillStyle = `rgb(${34 + Math.random() * 10},${35 + Math.random() * 8},${28 + Math.random() * 6})`; x.fillRect(bx + 1, by + 1, 30, 14); }
      for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 1 + Math.random() * 4); }
      x.fillStyle = 'rgba(20,25,10,.45)'; for (let i = 0; i < 6; i++) x.fillRect(Math.random() * w, 0, 2, h * Math.random()); // damp streaks
    });
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), wallMat); back.position.set(0, 2.5, -3.4); back.receiveShadow = true; scene.add(back);
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat); w.position.set(sx * 3.4, 2.5, 0); w.rotation.y = -sx * Math.PI / 2; scene.add(w); }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshLambertMaterial({ color: 0x0a0a08 })); ceil.rotation.x = Math.PI / 2; ceil.position.y = 4.2; scene.add(ceil);

    const rust = new THREE.MeshLambertMaterial({ color: 0x3a2a1e });
    const iron = new THREE.MeshLambertMaterial({ color: 0x2a2b27 });
    // iron door with a peephole, red bulb above it
    const doorTex = canvasTex(32, 64, (x, w, h) => {
      x.fillStyle = '#3a2e24'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(${90 + Math.random() * 40},${40 + Math.random() * 20},10,${Math.random() * 0.5})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      x.fillStyle = '#1a1510'; for (const y of [6, 30, 54]) x.fillRect(2, y, 28, 2);
      x.fillStyle = '#050505'; x.fillRect(11, 14, 10, 6); x.fillStyle = '#6a6a5a'; x.fillRect(24, 34, 3, 4);
    });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1), new THREE.MeshLambertMaterial({ map: doorTex })); door.position.set(-1.9, 1.05, -3.38); scene.add(door);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.22, 0.06), iron); frame.position.set(-1.9, 1.1, -3.4); scene.add(frame);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a24 })); bulb.position.set(-1.9, 2.4, -3.3); scene.add(bulb);
    const red = new THREE.PointLight(0x8f1d14, 1.1, 4.5); red.position.set(-1.9, 2.3, -3.0); scene.add(red);
    // pipes along the walls
    const pipe = (a, b, r) => scene.add(limb(a, b, r, rust));
    pipe(new THREE.Vector3(-3.4, 3.4, -3.3), new THREE.Vector3(3.4, 3.4, -3.3), 0.06);
    pipe(new THREE.Vector3(-3.4, 3.15, -3.32), new THREE.Vector3(3.4, 3.15, -3.32), 0.035);
    pipe(new THREE.Vector3(2.6, 0, -3.3), new THREE.Vector3(2.6, 3.4, -3.3), 0.05);
    pipe(new THREE.Vector3(3.3, 3.3, -3.3), new THREE.Vector3(3.3, 3.3, 2), 0.06);
    pipe(new THREE.Vector3(-3.3, 2.9, -3.3), new THREE.Vector3(-3.3, 2.9, 2), 0.05);
    // shelf of bottles on the right
    const shelfWood = new THREE.MeshLambertMaterial({ color: 0x2a1c12 });
    for (const y of [1.2, 1.75]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 1.6), shelfWood); shelf.position.set(3.22, y, -1.6); scene.add(shelf);
      for (let k = 0; k < 7; k++) {
        if (Math.random() < 0.25) continue;
        const glass = new THREE.MeshLambertMaterial({ color: [0x24401c, 0x4a2a10, 0x1a2a2a, 0x3a1010][(Math.random() * 4) | 0] });
        const hgt = 0.18 + Math.random() * 0.14;
        const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, hgt, 6), glass); bt.position.set(3.2, y + hgt / 2 + 0.02, -2.3 + k * 0.22); scene.add(bt);
        const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.07, 5), glass); nk.position.set(3.2, y + hgt + 0.05, -2.3 + k * 0.22); scene.add(nk);
      }
    }
    // crates in the corner
    const crateTex = canvasTex(32, 32, (x, w, h) => {
      x.fillStyle = '#3a2816'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1e140a'; x.fillRect(0, 0, w, 2); x.fillRect(0, h - 2, w, 2); x.fillRect(0, 0, 2, h); x.fillRect(w - 2, 0, 2, h);
      for (let i = 0; i < 32; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`; x.fillRect(0, i, w, 1); }
      x.fillStyle = '#2a1c0e'; for (let i = 0; i < w; i++) x.fillRect(i, i, 2, 2);
    });
    const crateMat = new THREE.MeshLambertMaterial({ map: crateTex });
    for (const [cx, cy, cz, s, ry] of [[2.7, 0.3, -2.7, 0.6, 0.2], [2.85, 0.85, -2.75, 0.5, -0.1], [2.1, 0.25, -2.9, 0.5, 0.5], [-2.9, 0.3, 1.0, 0.6, 0.3]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat); c.position.set(cx, cy, cz); c.rotation.y = ry; c.castShadow = true; c.receiveShadow = true; scene.add(c);
    }
    // chains hanging out of the dark
    for (const [cx, cz, len] of [[-2.2, -1.6, 1.6], [2.0, -0.8, 2.1], [-1.2, -2.6, 1.2], [1.4, -2.9, 1.8]]) {
      for (let k = 0; k < len / 0.09; k++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 3, 6), iron);
        link.position.set(cx, 4.2 - k * 0.09, cz); link.rotation.y = k % 2 ? Math.PI / 2 : 0; scene.add(link);
      }
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 3, 8, Math.PI * 1.4), iron); hook.position.set(cx, 4.2 - len - 0.07, cz); scene.add(hook);
    }
    // the beam of the lamp, and dust drifting through it
    shaft = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.7, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8e0b0, transparent: true, opacity: 0.018, depthWrite: false, side: THREE.DoubleSide }));
    shaft.position.set(0, 1.62, -0.1); scene.add(shaft);
    const n = 70, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.3, rr = Math.random() * 1.1; pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = 0.85 + Math.random() * 1.6; pos[i * 3 + 2] = -0.1 + Math.sin(a) * rr; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd8d0a0, size: 0.007, transparent: true, opacity: 0.35, depthWrite: false }));
    scene.add(dust);
  }

  // ---------- figures ----------
  // ---------- masks ----------
  const MASKS = ['porcelain', 'sack', 'gasmask', 'grin', 'plague'];
  function maskFace(style, seed) {
    return canvasTex(64, 80, (x, w, h) => {
      const r = (n) => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280) * n; };
      const px = (c, X, Y, W = 1, H = 1) => { x.fillStyle = c; x.fillRect(X, Y, W, H); };
      const grime = (alpha) => { for (let i = 0; i < 160; i++) px(`rgba(0,0,0,${r(alpha)})`, r(w) | 0, r(h) | 0, 1 + (r(2) | 0), 1 + (r(3) | 0)); };
      if (style === 'porcelain') {
        px('#cfc7ad', 0, 0, w, h); grime(0.18);
        for (let i = 0; i < 3; i++) { let cx = r(w) | 0, cy = r(h) | 0; for (let k = 0; k < 14; k++) { px('#5b5546', cx, cy); cx += (r(3) | 0) - 1; cy += 1; } } // cracks
        px('#000', 14, 26, 12, 9); px('#000', 38, 26, 12, 9);   // hollow eyes
        px('#2a2620', 13, 35, 14, 2); px('#2a2620', 37, 35, 14, 2); // tear stains
        px('#3a0a06', 18, 37, 2, 10); px('#3a0a06', 44, 37, 2, 7);
        px('#000', 26, 56, 12, 3);                              // thin mouth
      } else if (style === 'sack') {
        px('#7a6644', 0, 0, w, h);
        for (let y = 0; y < h; y += 2) for (let X = (y / 2) % 2; X < w; X += 2) px('rgba(40,30,15,.35)', X, y); // weave
        grime(0.25);
        const X_ = (cx, cy) => { for (let k = -5; k <= 5; k++) { px('#1a120a', cx + k, cy + k, 2, 2); px('#1a120a', cx + k, cy - k, 2, 2); } };
        X_(20, 30); X_(44, 30);                                  // stitched-shut eyes
        for (let X = 14; X < 50; X += 4) { px('#1a120a', X, 56, 3, 1); px('#1a120a', X + 1, 54, 1, 5); } // sewn mouth
        px('#4a0a06', 30, 60, 3, 8);
      } else if (style === 'gasmask') {
        px('#23251f', 0, 0, w, h); grime(0.3);
        for (const cx of [20, 44]) { px('#55584c', cx - 10, 24, 20, 18); px('#0b0d0a', cx - 8, 26, 16, 14); px('#6f8a6a', cx - 5, 28, 4, 3); } // lenses with a glint
        px('#3a3d34', 24, 50, 16, 20); px('#15170f', 26, 54, 12, 2); px('#15170f', 26, 60, 12, 2); px('#15170f', 26, 66, 12, 2);
      } else if (style === 'grin') {
        px('#bfb79a', 0, 0, w, h); grime(0.22);
        px('#000', 12, 20, 14, 14); px('#000', 38, 20, 14, 14);  // deep sockets
        px('#e8e2c8', 17, 25, 3, 3); px('#e8e2c8', 43, 25, 3, 3); // pinprick pupils
        px('#000', 6, 48, 52, 18);                               // the grin
        for (let X = 7; X < 57; X += 4) { px('#e3dcc0', X, 48, 3, 7); px('#e3dcc0', X + 1, 59, 3, 7); }
        px('#000', 4, 46, 3, 4); px('#000', 57, 46, 3, 4);
      } else {
        px('#2b2a26', 0, 0, w, h); grime(0.2);                   // plague doctor: dark leather, glass eyes
        for (const cx of [20, 44]) { px('#5a4a2a', cx - 9, 22, 18, 18); px('#131510', cx - 7, 24, 14, 14); px('#8a6b3a', cx - 4, 26, 3, 3); }
        for (let y = 0; y < h; y += 9) px('rgba(0,0,0,.4)', 0, y, w, 1);
      }
    });
  }
  function jacketFront(coat, shirt, tie) {
    return canvasTex(48, 56, (x, w, h) => {
      const hex = (c) => '#' + c.toString(16).padStart(6, '0');
      x.fillStyle = hex(coat); x.fillRect(0, 0, w, h);
      x.fillStyle = hex(shirt); x.beginPath(); x.moveTo(15, 0); x.lineTo(33, 0); x.lineTo(24, 30); x.fill();
      x.fillStyle = hex(tie); x.fillRect(22, 2, 4, 26);
      x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.moveTo(10, 0); x.lineTo(15, 0); x.lineTo(24, 32); x.lineTo(20, 32); x.fill(); x.beginPath(); x.moveTo(38, 0); x.lineTo(33, 0); x.lineTo(24, 32); x.lineTo(28, 32); x.fill(); // lapels
      x.fillStyle = 'rgba(0,0,0,.5)'; for (const by of [36, 44]) x.fillRect(23, by, 2, 2); // buttons
      for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    });
  }

  // a cylinder stretched between two points, for arms
  function limb(a, b, r, mat) {
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, d.length(), 6), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    return m;
  }

  function makeFigure(id, i) {
    const g = new THREE.Group();
    let seed = 0; for (const ch of String(id)) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    const coat = [0x1d1f1a, 0x2a1d16, 0x161b20, 0x231a24, 0x2b2a22][seed % 5];
    const shirt = [0x8f8a78, 0x5d1410, 0x6e6a5c][seed % 3];
    const tie = [0x5d0e09, 0x101010, 0x2f3a28, 0x3a2a12][(seed >> 2) % 4];
    const coatMat = new THREE.MeshLambertMaterial({ color: coat });
    const skin = new THREE.MeshLambertMaterial({ color: 0x7d7562 });
    // chair behind them
    const wood = new THREE.MeshLambertMaterial({ color: 0x24170e });
    // the chair lives outside the body group so it stays upright when they slump (an empty chair when they vanish)
    const chair = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.8, 0.05), wood); back.position.set(0, 1.0, -0.28); back.castShadow = true; chair.add(back);
    for (const px of [-0.24, 0.24]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), wood); post.position.set(px, 0.9, -0.28); chair.add(post); }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.45), wood); seat.position.set(0, 0.5, -0.08); chair.add(seat);
    // torso with a suit front
    const torsoMats = [coatMat, coatMat, coatMat, coatMat, new THREE.MeshLambertMaterial({ map: jacketFront(coat, shirt, tie) }), coatMat];
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), torsoMats);
    torso.position.y = 1.07; torso.castShadow = true; g.add(torso);
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.28), coatMat);
    shoulders.position.y = 1.33; shoulders.castShadow = true; g.add(shoulders);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6), skin); neck.position.y = 1.42; g.add(neck);
    // arms down to the table
    for (const sx of [-1, 1]) {
      const sh = new THREE.Vector3(sx * 0.29, 1.3, 0.02), el = new THREE.Vector3(sx * 0.34, 0.92, 0.16), wr = new THREE.Vector3(sx * 0.23, TABLE_Y + 0.04, 0.38);
      g.add(limb(sh, el, 0.065, coatMat));
      g.add(limb(el, wr, 0.055, coatMat));
    }
    // head: material slot 4 (+z) is the mask; accessories ride along as children
    const style = MASKS[seed % MASKS.length];
    const headMat = [0, 0, 0, 0, 0, 0].map(() => new THREE.MeshLambertMaterial({ color: 0x8a8370 }));
    headMat[4] = new THREE.MeshLambertMaterial({ map: maskFace(style, seed + 7) });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.22), headMat);
    head.position.y = 1.58; head.castShadow = true; g.add(head);
    if (style === 'sack') { headMat.forEach((m, k) => k !== 4 && m.color.setHex(0x6a5838)); const rope = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 4, 10), new THREE.MeshLambertMaterial({ color: 0x4a3a20 })); rope.rotation.x = Math.PI / 2; rope.position.y = -0.14; head.add(rope); }
    if (style === 'gasmask') { headMat.forEach((m, k) => k !== 4 && m.color.setHex(0x1d1f1a)); const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x3b3e33 })); can.rotation.x = Math.PI / 2; can.position.set(0, -0.08, 0.15); head.add(can); }
    if (style === 'plague') { headMat.forEach((m, k) => k !== 4 && m.color.setHex(0x23221e)); const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 6), new THREE.MeshLambertMaterial({ color: 0x3a362c })); beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.05, 0.22); beak.castShadow = true; head.add(beak); }
    if (style === 'grin') { head.scale.y = 1.15; }
    // some wear hats
    const hat = (seed >> 3) % 3;
    if (hat && style !== 'sack') {
      const felt = new THREE.MeshLambertMaterial({ color: 0x121210 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 10), felt); brim.position.y = 0.16; head.add(brim);
      const crown = hat === 1 ? new THREE.Mesh(new THREE.SphereGeometry(0.125, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), felt) : new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.24, 10), felt);
      crown.position.y = hat === 1 ? 0.165 : 0.29; crown.castShadow = true; head.add(crown);
      if (hat === 2) { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.127, 0.127, 0.035, 10), new THREE.MeshLambertMaterial({ color: 0x4a0b07 })); band.position.y = 0.2; head.add(band); }
    }
    // eye glints, lit when it's their turn (children of the head so they follow its gaze)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd2301f, transparent: true, opacity: 0 });
    for (const ex of [-0.055, 0.055]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.018), eyeMat); e.position.set(ex, 0.03, 0.112); head.add(e); }
    // hands resting on the table
    const hands = [];
    for (const hx of [-0.22, 0.22]) { const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.12), skin); hnd.position.set(hx, TABLE_Y + 0.02, 0.42); hnd.castShadow = true; g.add(hnd); hands.push(hnd); }
    g.userData = { chair, head, eyeMat, torso, shoulders, hands, bob: (seed % 100) / 100 * 6, pid: id };
    g.rotation.order = 'YXZ'; // yaw outermost so rotation.x tilts toward/away from the table
    return g;
  }

  // seats other than me spread across the far side, me at the near edge
  function layout(players, meId) {
    const n = players.length;
    const meIdx = Math.max(0, players.findIndex((p) => p.id === meId));
    const others = [];
    for (let k = 1; k < n; k++) others.push(players[(meIdx + k) % n]);
    const out = {};
    const m = others.length;
    others.forEach((p, k) => {
      // left-to-right in seat order (clockwise from my left)
      const t = m === 1 ? 0.5 : k / (m - 1);
      // tall screens see less to the sides, so seat everyone more toward the far edge
      const edge = window.innerWidth / window.innerHeight < 0.75 ? 0.95 : 0.42;
      const a = Math.PI + edge + t * (Math.PI - 2 * edge); // angle around the table, far side
      const ex = Math.cos(a), ez = Math.sin(a);
      const fig = new THREE.Vector3(ex * 1.5, 0, ez * 1.3);
      const toward = (r) => new THREE.Vector3(ex * 1.5 * r, TABLE_Y, ez * 1.3 * r);
      out[p.id] = { figure: fig, cards: toward(0.55), chips: toward(0.38), label: new THREE.Vector3(fig.x * 0.78, TABLE_Y + 0.02, fig.z * 0.78), yaw: Math.atan2(-fig.x, -fig.z) };
    });
    out[meId] = { cards: new THREE.Vector3(0.05, TABLE_Y + 0.24, 0.98), chips: new THREE.Vector3(0.38, TABLE_Y, 0.55), me: true };
    return out;
  }

  // ---------- per-state update ----------
  function cardMesh(key) {
    let m = cards.get(key);
    if (!m) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.24), new THREE.MeshLambertMaterial({ map: cardTex('??'), side: THREE.DoubleSide }));
      m.castShadow = true;
      m.position.copy(DECK);
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.userData = { pos: new THREE.Vector3(), rot: new THREE.Euler(), face: '??', delay: 0 };
      root.add(m); cards.set(key, m);
    }
    m.userData.seen = true;
    return m;
  }
  function setCard(m, face, pos, rx, ry, rz, delay) {
    const u = m.userData;
    if (u.face !== face) { u.face = face; m.material.map = cardTex(face); m.material.needsUpdate = true; if (face !== '??') u.flip = 1; }
    u.pos.copy(pos); u.rot.set(rx, ry, rz);
    if (delay && !u.started) u.delay = delay;
    u.started = true;
  }

  function stack(key, pos, amount, bb) {
    let g = chips.get(key);
    const count = amount > 0 ? Math.min(14, Math.max(1, Math.ceil(Math.log2(amount / bb + 1) * 2.2))) : 0;
    if (!g) { g = new THREE.Group(); g.userData = { count: -1, pos: pos.clone() }; g.position.copy(DECK); root.add(g); chips.set(key, g); }
    g.userData.seen = true; g.userData.pos.copy(pos);
    if (g.userData.count !== count) {
      while (g.children.length) g.remove(g.children[0]);
      for (let i = 0; i < count; i++) {
        const col = [0x8f1d14, 0xc9c2a8, 0x8f1d14, 0x1b1d1a][i % 4];
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.011, 10), new THREE.MeshLambertMaterial({ color: col }));
        c.position.set((i % 3 === 2 ? 0.004 : 0) + Math.floor(i / 7) * 0.075, 0.006 + (i % 7) * 0.012, 0); c.castShadow = true;
        g.add(c);
      }
      g.userData.count = count;
    }
  }

  function update(g, ctx) {
    for (const m of cards.values()) m.userData.seen = false;
    for (const s of chips.values()) s.userData.seen = false;
    seatPos = layout(g.players, ctx.me);
    const reveal = new Set();
    if (g.street === 'showdown' && g.result) for (const w of g.result.winners) for (const c of g.result.hands?.[w.id]?.cards || []) reveal.add(c);

    // where everyone glances: the player to act (me = the camera)
    const actor = g.players[g.toAct];
    lookPoint = !actor ? camera.position.clone() : seatPos[actor.id]?.me ? camera.position.clone() : seatPos[actor.id]?.figure ? seatPos[actor.id].figure.clone().setY(1.55) : null;

    // figures
    const live = new Set();
    for (const p of g.players) {
      const s = seatPos[p.id];
      if (s.me || p.spectator) continue; // spectators who joined a running deathmatch have no body at the table
      live.add(p.id);
      let f = figures.get(p.id);
      if (!f) { f = makeFigure(p.id); scene.add(f); scene.add(f.userData.chair); figures.set(p.id, f); f.position.copy(s.figure); }
      // busted and not yet seen dying (e.g. after a reload): just slumped
      if (p.chips === 0 && !p.inHand && !deadPose[p.id]) deadPose[p.id] = 'slump';
      if (p.chips > 0 && deadPose[p.id] && !f.userData.exec) { delete deadPose[p.id]; delete headless[p.id]; f.visible = true; f.userData.head.visible = true; f.userData.head.material.forEach((m, i) => m.color.setHex(i === 4 ? 0xffffff : 0x8a8370)); f.rotation.x = 0; f.rotation.z = 0; f.position.copy(s.figure); }
      f.userData.target = s.figure; f.rotation.y = s.yaw;
      f.userData.turn = g.players[g.toAct]?.id === p.id;
      f.userData.out = (p.folded && g.street !== 'waiting') || (p.chips === 0 && !p.inHand);
      f.userData.shaky = p.tell === 'shaky' && !p.folded && g.street !== 'showdown';
      f.userData.thinking = f.userData.turn;
    }
    for (const [id, f] of figures) if (!live.has(id)) { scene.remove(f); scene.remove(f.userData.chair); figures.delete(id); }

    // hole cards
    g.players.forEach((p, pi) => {
      const s = seatPos[p.id];
      p.hole.forEach((c, i) => {
        const m = cardMesh(`h${g.handNo}-${p.id}-${i}`);
        const d = pi * 0.06 + i * 0.25;
        if (s.me) {
          // face down on the felt in front of me; the faces are shown once, in the HUD
          const pos = new THREE.Vector3(0.62 + i * 0.12, TABLE_Y + 0.003 + i * 0.002, 0.42);
          if (p.folded) pos.lerp(new THREE.Vector3(0, TABLE_Y + 0.002, -0.45), 0.6);
          setCard(m, '??', pos, -Math.PI / 2, 0, (0.5 - i) * 0.1, d);
        } else {
          const side = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw)).multiplyScalar((i - 0.5) * 0.12);
          const pos = s.cards.clone().add(side); pos.y = TABLE_Y + 0.003 + i * 0.002;
          if (p.folded) pos.lerp(new THREE.Vector3(0, TABLE_Y + 0.002, -0.45), 0.6);
          const shown = c !== '??';
          // revealed cards are stood up so you can read them
          if (shown) { pos.y = TABLE_Y + 0.13; setCard(m, c, pos, -0.35, s.yaw * 0.6, 0, d); m.scale.setScalar(1.35); }
          else setCard(m, c, pos, -Math.PI / 2, 0, s.yaw + (i - 0.5) * 0.15, d);
        }
        m.userData.dim = p.folded && !s.me;
        m.userData.mine = !!s.me;
        m.userData.glow = reveal.has(c);
      });
    });
    // board
    g.board.forEach((c, i) => {
      const m = cardMesh(`b${g.handNo}-${i}`);
      // propped up on a rail so they read from your seat
      setCard(m, c, new THREE.Vector3((i - 2) * 0.21, TABLE_Y + 0.1, -0.32), -0.75, 0, 0, i < 3 ? i * 0.15 : 0);
      m.scale.setScalar(1.2);
      m.userData.board = true;
      m.userData.glow = reveal.has(c);
      m.userData.dim = reveal.size > 0 && !reveal.has(c);
    });
    // chips
    for (const p of g.players) if (p.bet > 0) stack(`bet-${p.id}`, seatPos[p.id].chips, p.bet, g.bb);
    const pot = g.pot;
    if (pot > 0) stack('pot', new THREE.Vector3(-0.05, TABLE_Y, 0.22), pot, g.bb);
    // winner gets the pot slid to them
    if (g.street === 'showdown' && g.result) {
      for (const w of g.result.winners) {
        const s = seatPos[w.id];
        if (s && !s.me) stack(`win-${g.handNo}-${w.id}`, s.chips.clone().setY(TABLE_Y), w.amount, g.bb);
      }
    }
    for (const [k, m] of cards) if (!m.userData.seen) { root.remove(m); cards.delete(k); }
    for (const [k, s] of chips) if (!s.userData.seen) { root.remove(s); chips.delete(k); }

    labelData = g.players.filter((p) => !seatPos[p.id].me).map((p) => ({ id: p.id, html: ctx.labelHTML(p), pos: seatPos[p.id].label }));
    labelsEl.innerHTML = labelData.map((l) => `<div class="lbl" data-id="${l.id}">${l.html}</div>`).join('');
    labelsEl.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => ctx.onKick(b.dataset.kick)));
  }

  // ---------- frame loop ----------
  let tPrev = performance.now();
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - tPrev) / 1000); tPrev = t;
    resize();
    // lamp flicker and sway
    flicker -= dt;
    if (flicker < 0) flicker = Math.random() < 0.04 ? 0.12 : 0.6 + Math.random() * 2;
    const dimNow = flicker < 0.12 && Math.random() < 0.5;
    lamp.intensity = (dimNow ? 1.2 : 3.3) * (document.body.classList.contains('tense') ? 0.8 + 0.2 * Math.sin(t / 140) : 1);
    lampBulb.material.color.setHex(dimNow ? 0x6e6650 : 0xfff2c0);
    const sway = Math.sin(t / 1900) * 0.04;
    lamp.position.x = sway; lampBulb.position.x = sway;

    for (const m of cards.values()) {
      const u = m.userData;
      if (u.delay > 0) { u.delay -= dt; continue; }
      const k = 1 - Math.pow(0.0008, dt);
      // my hand drops out of frame while I rake in a pot
      m.position.lerp(sweep && u.mine ? TUCK.copy(u.pos).add(TUCK_OFF) : u.pos, k);
      m.rotation.x += (u.rot.x - m.rotation.x) * k;
      m.rotation.y += (u.rot.y - m.rotation.y) * k;
      m.rotation.z += (u.rot.z - m.rotation.z) * k;
      if (u.flip > 0) { u.flip -= dt * 3; m.rotation.y += Math.sin(u.flip * Math.PI) * 0.6; m.position.y += Math.sin(u.flip * Math.PI) * 0.03; }
      m.material.color.setScalar(u.dim ? 0.35 : u.board ? 0.72 : 1);
      m.material.emissive?.setHex(u.glow ? 0x3a2e10 : u.mine && !u.dim ? 0x34322a : 0x000000);
    }
    for (const s of chips.values()) s.position.lerp(s.userData.pos, 1 - Math.pow(0.002, dt));
    for (const f of figures.values()) {
      const u = f.userData;
      u.chair.position.set(u.target.x, 0, u.target.z); u.chair.rotation.y = f.rotation.y;
      if (u.exec) continue; // an execution is driving this one
      const dead = deadPose[u.pid];
      if (dead === 'gone') { f.visible = false; continue; }
      f.visible = true;
      f.position.lerp(u.target, 0.1);
      f.rotation.x += ((dead === 'slump' ? 0.6 : dead === 'limp' ? -0.25 : 0) - f.rotation.x) * 0.1;
      u.head.visible = !headless[u.pid];
      if (dead) { u.head.rotation.x = dead === 'limp' ? 0.6 : 0.2; u.eyeMat.opacity = 0; continue; }
      u.head.position.y = 1.58 + Math.sin(t / 900 + u.bob) * 0.008 - (u.out ? 0.08 : 0);
      const breath = Math.sin(t / 1100 + u.bob);
      u.torso.scale.set(1 + breath * 0.012, 1 + breath * 0.008, 1 + breath * 0.02);
      u.shoulders.position.y = 1.33 + breath * 0.005;
      // glance at whoever is acting (or at me), the actor looks down at their cards
      let yawT = 0;
      if (lookPoint && !u.turn && !u.out) {
        const lp = f.worldToLocal(lookPoint.clone());
        yawT = Math.max(-0.7, Math.min(0.7, Math.atan2(lp.x, lp.z)));
      }
      u.head.rotation.y += (yawT - u.head.rotation.y) * 0.06;
      u.hands.forEach((h, k) => { h.position.y = TABLE_Y + 0.02 + (u.turn ? Math.max(0, Math.sin(t / 110 + k * 1.7)) * 0.025 : 0); });
      u.head.rotation.x = u.out ? 0.35 : u.turn ? -0.08 + Math.sin(t / 600) * 0.04 : 0;
      // a tell: the head and hands tremble
      u.head.rotation.z = u.shaky ? Math.sin(t / 38) * 0.03 : 0;
      u.head.position.x = u.shaky ? Math.sin(t / 45) * 0.004 : 0;
      u.eyeMat.opacity += ((u.turn ? 1 : 0) - u.eyeMat.opacity) * 0.15;
    }

    // camera: slight breathing, plus shake, plus the win cinematic
    shakeT = Math.max(0, shakeT - dt);
    const amp = shakeAmp * (shakeT > 0 ? shakeT : 0);
    const want = camBase.clone(), wantLook = camLook.clone();
    if (tourState) stepTour(dt, want, wantLook);
    else {
      stareAmt += ((stareId && seatPos[stareId] && !seatPos[stareId].me ? 1 : 0) - stareAmt) * Math.min(1, dt * (stareId ? 0.18 : 1.5));
      if (stareAmt > 0.001 && stareId && seatPos[stareId]?.figure) {
        const head = seatPos[stareId].figure.clone().setY(1.55);
        want.lerp(head, 0.32 * stareAmt).setY(want.y - 0.05 * stareAmt);
        wantLook.lerp(head, 0.6 * stareAmt);
      }
    }
    const kc = 1 - Math.pow(0.015, dt);
    camCur.lerp(want, kc); lookCur.lerp(wantLook, kc);
    const cp = camCur.clone(), cl = lookCur.clone();
    if (sweep) stepSweep(dt, cp, cl);
    if (execs.length) stepExecs(dt, cp, cl, t);
    if (particles.length) stepParticles(dt);
    if (dust) { dust.rotation.y += dt * 0.03; dust.position.y = Math.sin(t / 4000) * 0.05; dust.material.opacity = 0.35 * lampDim; shaft.material.opacity = 0.018 * lampDim * (lamp.intensity > 2 ? 1 : 0.6); shaft.position.x = lamp.position.x; }
    lamp.intensity = lamp.intensity * lampDim + lampSpike;
    if (lampDim < 0.3) lampBulb.material.color.setHex(0x1a1810);
    zap.intensity = zapLevel;
    ambient.intensity = 0.75 * Math.max(0.12, lampDim);
    lampSpike = Math.max(0, lampSpike - dt * 30);
    camera.position.set(
      cp.x + Math.sin(t / 2300) * 0.015 + (Math.random() - 0.5) * amp,
      cp.y + Math.sin(t / 1700) * 0.01 + (Math.random() - 0.5) * amp,
      cp.z,
    );
    camera.lookAt(cl.x + (Math.random() - 0.5) * amp * 0.5, cl.y, cl.z);
    renderer.render(scene, camera);

    // pin HTML labels over the 3D heads
    const els = labelsEl.children;
    for (let i = 0; i < els.length; i++) {
      const l = labelData[i]; if (!l) continue;
      const v = l.pos.clone().project(camera);
      const half = els[i].offsetWidth / 2 + 4; // keep labels on screen
      const sx = Math.max(half, Math.min(window.innerWidth - half, (v.x * 0.5 + 0.5) * window.innerWidth));
      els[i].style.transform = `translate(${sx}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
      els[i].style.display = v.z > 1 ? 'none' : '';
    }
  }

  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const seg = (t, a, b) => ease((t - a) / (b - a));

  // Win cinematic: camera leans in over the felt, hands reach out and drag the pile home.
  function winSweep(amount, bb) {
    if (sweep) { root.remove(sweep.pile); }
    const pile = new THREE.Group();
    const n = Math.min(40, Math.max(8, Math.round(Math.log2(amount / bb + 1) * 6)));
    for (let i = 0; i < n; i++) {
      const col = [0x8f1d14, 0xc9c2a8, 0x8f1d14, 0x1b1d1a][i % 4];
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.011, 10), new THREE.MeshLambertMaterial({ color: col }));
      const col3 = i % 5, h = Math.floor(i / 5);
      c.position.set((col3 - 2) * 0.075 + (Math.random() - 0.5) * 0.02, 0.006 + (h % 6) * 0.012, (Math.floor(h / 6) - 0.5) * 0.08 + (Math.random() - 0.5) * 0.02);
      c.castShadow = true; pile.add(c);
    }
    pile.position.copy(POT_POS);
    root.add(pile);
    for (const [k, st] of chips) if (k === 'pot') st.visible = false;
    sweep = { t: 0, pile };
    hands.visible = true;
  }

  function stepSweep(dt, cp, cl) {
    sweep.t += dt;
    const t = sweep.t;
    // camera: lean in (0-0.7), hold, pull back (2.3-3.1)
    const camIn = seg(t, 0, 0.7) * (1 - seg(t, 2.3, 3.1));
    cp.lerp(new THREE.Vector3(0.12, 1.2, 1.05), camIn);
    cl.lerp(new THREE.Vector3(0, TABLE_Y, 0.3), camIn);
    // hands: reach to the pile (0.3-0.9), rake back (1.1-2.1), drop away (2.2-2.8)
    const reach = seg(t, 0.3, 0.9), rake = seg(t, 1.1, 2.1), away = seg(t, 2.2, 2.8);
    const startZ = 1.35, pileZ = POT_POS.z + 0.12, homeZ = 0.92;
    const z = startZ + (pileZ - startZ) * reach + (homeZ - pileZ) * rake + 0.4 * away;
    hands.position.set(0, TABLE_Y + 0.025 - away * 0.25 + Math.sin(reach * Math.PI) * 0.03, z);
    hands.children[0].position.x = -0.17 - 0.06 * (1 - rake) + 0.06 * reach;
    hands.children[1].position.x = 0.17 + 0.06 * (1 - rake) - 0.06 * reach;
    // the pile gets dragged along, squeezing together
    sweep.pile.position.z = POT_POS.z + (homeZ - 0.1 - POT_POS.z) * rake;
    sweep.pile.scale.x = 1 - rake * 0.35;
    if (rake > 0 && rake < 1 && !sweep.clacked) { sweep.clacked = true; if (window.FX) FX.sfx('chip'); }
    if (t > 3.2) {
      hands.visible = false;
      root.remove(sweep.pile);
      for (const [k, st] of chips) if (k === 'pot') st.visible = true;
      sweep = null;
    }
  }

  // Showdown: swing the camera to each revealed hand in turn, then back to the seat.
  function tour(ids, per) {
    const stops = ids.map((id) => seatPos[id]).filter((s) => s && !s.me);
    if (!stops.length) return;
    tourState = { stops, per, t: 0 };
  }
  function stepTour(dt, want, wantLook) {
    tourState.t += dt;
    const i = Math.floor(tourState.t / tourState.per);
    if (i >= tourState.stops.length) { tourState = null; return; }
    const tgt = tourState.stops[i].cards.clone().setY(TABLE_Y + 0.13);
    const back = camBase.clone().sub(tgt).setY(0).normalize();
    want.copy(tgt).addScaledVector(back, 0.75).setY(TABLE_Y + 0.42);
    wantLook.copy(tgt);
  }

  // ---------- executions ----------
  function buildExecProps() {
    // a sawn-off double barrel, built pointing down +z so lookAt aims it
    gunProto = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x2b2d2a });
    const wood = new THREE.MeshLambertMaterial({ color: 0x3a2416 });
    for (const bx of [-0.028, 0.028]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.62, 8), metal);
      b.rotation.x = Math.PI / 2; b.position.set(bx, 0, 0.2); b.castShadow = true; gunProto.add(b);
    }
    const hole = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const bx of [-0.028, 0.028]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), hole); m.position.set(bx, 0, 0.512); gunProto.add(m); }
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.34), wood); stock.position.set(0, -0.03, -0.25); stock.rotation.x = 0.18; gunProto.add(stock);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.16), wood); pump.position.set(0, -0.04, 0.12); gunProto.add(pump);
    eyesProto = new THREE.Group();
    const red = new THREE.MeshBasicMaterial({ color: 0xff2414 });
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.42), new THREE.MeshBasicMaterial({ color: 0x020202 }));
    shade.position.set(0, -0.04, -0.01); eyesProto.add(shade);
    for (const ex of [-0.055, 0.055]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.012), red); e.position.x = ex; eyesProto.add(e); }
    zap = new THREE.PointLight(0x6aa8ff, 0, 3); scene.add(zap);
    dropGeo = new THREE.BoxGeometry(1, 1, 1);
    bloodMat = new THREE.MeshLambertMaterial({ color: BLOOD });
    stainMat = new THREE.MeshLambertMaterial({ color: BLOOD_DARK, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    stains = new THREE.Group(); scene.add(stains);
  }

  // ---------- blood ----------
  const onTable = (x, z) => Math.abs(x) < 1.48 && Math.abs(z) < 0.94;
  function stain(x, y, z, size, wall) {
    // a lumpy low-poly blob rather than a square
    const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 5 + (Math.random() * 3 | 0)), stainMat);
    m.scale.y = 0.6 + Math.random() * 0.8;
    if (wall) m.position.set(x, y, -3.39); else { m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 3; m.position.set(x, y, z); }
    stains.add(m); stainList.push(m);
    if (stainList.length > 320) stains.remove(stainList.shift());
  }
  // a burst of droplets (or chunks, given a material) that fall, land and leave stains
  function spray(origin, dir, n, speed, spread, mat, size = 0.022) {
    if (!gore) return;
    for (let i = 0; i < n; i++) {
      if (particles.length > 450) break;
      const m = new THREE.Mesh(dropGeo, mat || bloodMat);
      const s = size * (0.5 + Math.random());
      m.scale.set(s, s, s); m.position.copy(origin);
      const v = dir.clone().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      v.x += (Math.random() - 0.5) * spread; v.y += (Math.random() - 0.3) * spread; v.z += (Math.random() - 0.5) * spread;
      scene.add(m);
      particles.push({ m, v, chunk: !!mat, spin: (Math.random() - 0.5) * 12 });
    }
  }
  function stepParticles(dt) {
    particles = particles.filter((p) => {
      p.v.y -= 9.8 * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.chunk) { p.m.rotation.x += p.spin * dt; p.m.rotation.z += p.spin * dt; }
      const { x, y, z } = p.m.position;
      if (z < -3.36) { stain(x, y, z, 0.05 + Math.random() * 0.12, true); scene.remove(p.m); return false; }
      const floor = onTable(x, z) ? TABLE_Y + 0.004 : 0.003;
      if (y > floor) return true;
      if (p.chunk) { p.m.position.y = floor + p.m.scale.y / 2; scene.remove(p.m); stains.add(p.m); stainList.push(p.m); return false; }
      stain(x, floor, z, 0.025 + Math.random() * 0.06);
      scene.remove(p.m); return false;
    });
  }
  // voxel chunks of a mask, flying off
  function burstHead(f, dir) {
    if (!gore) return;
    const head = f.userData.head;
    const pos = head.getWorldPosition(new THREE.Vector3());
    const tex = head.material[4];
    const mats = [tex, new THREE.MeshLambertMaterial({ color: 0x8a8370 }), bloodMat, new THREE.MeshLambertMaterial({ color: 0x5a0805 })];
    spray(pos, dir, 14, 3.2, 1.6, null, 0.06); // big gobbets first
    for (let i = 0; i < 12; i++) spray(pos, dir, 1, 2.6, 1.8, mats[i % mats.length], 0.07);
    spray(pos, dir.clone().add(new THREE.Vector3(0, 0.4, 0)), 70, 3.6, 1.4);
  }
  function clearStains() {
    if (!stains) return;
    for (const m of stainList) stains.remove(m);
    stainList = [];
  }

  const sfx = (k) => window.FX && window.FX.sfx(k);
  const fx = (fn) => window.FX && fn(window.FX);
  const DUR = { me: 4.8, other: 3.2 };

  function execute(id, method, me) {
    const e = { id, method, me, t: 0, fired: {} };
    if (method === 'shotgun') { e.gun = gunProto.clone(); e.gun.visible = false; scene.add(e.gun); }
    if (method === 'lightsout') { e.eyes = eyesProto.clone(); e.eyes.visible = false; scene.add(e.eyes); }
    execs.push(e);
    return me ? DUR.me : DUR.other;
  }
  const cue = (e, key, at, fn) => { if (e.t >= at && !e.fired[key]) { e.fired[key] = 1; fn(); } };
  const sputter = () => (Math.random() < 0.5 ? 0.15 + Math.random() * 0.3 : 1);

  function stepExecs(dt, cp, cl, t) {
    lampDim = 1; zapLevel = 0;
    for (const e of execs) {
      e.t += dt;
      if (e.me) stepMine(e, cp, cl); else stepTheirs(e, t);
    }
    execs = execs.filter((e) => {
      const end = e.me ? DUR.me + 1.2 : DUR.other;
      if (e.t < end) return true;
      if (e.gun) scene.remove(e.gun);
      if (e.eyes) scene.remove(e.eyes);
      const f = figures.get(e.id); if (f) f.userData.exec = false;
      return false;
    });
  }

  // someone else at the table
  function stepTheirs(e, t) {
    const f = figures.get(e.id);
    if (!f) return;
    const u = f.userData; u.exec = true; u.eyeMat.opacity = 0;
    const yaw = f.rotation.y;
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const head = f.position.clone().setY(1.58);
    const k = e.t;
    if (e.method === 'shotgun') {
      const g = e.gun;
      g.visible = k < 2.4;
      g.position.copy(head).addScaledVector(side, 0.6 - 0.1 * Math.min(1, k / 0.6)).add(new THREE.Vector3(0, 0.04 + Math.sin(t / 50) * 0.004, 0));
      g.lookAt(head);
      g.scale.setScalar(Math.min(1, k / 0.4));
      cue(e, 'rack', 1.1, () => sfx('rack'));
      cue(e, 'bang', 1.8, () => {
        sfx('blast'); lampSpike = 6; fx((F) => F.shake(false));
        if (gore) { sfx('splat'); burstHead(f, side.clone().negate().add(new THREE.Vector3(0, 0.25, 0))); headless[e.id] = true; u.head.visible = false; }
      });
      if (gore && k > 1.85 && k < 3.0 && Math.random() < 0.5) spray(head.clone().setY(1.42 - (k > 2.3 ? 0.25 : 0)).addScaledVector(fwd, k > 2.3 ? 0.3 : 0), new THREE.Vector3(0, 1, 0).addScaledVector(fwd, 0.5), 3, 1.2, 0.5);
      if (k > 1.8) {
        const a = Math.min(1, (k - 1.8) / 0.5);
        u.head.rotation.z = -0.6 * Math.exp(-(k - 1.8) * 6);
        f.rotation.x = 0.6 * a;
        u.head.rotation.x = 0.2 * a;
        if (k > 2.4) deadPose[e.id] = 'slump';
      }
    } else if (e.method === 'drop') {
      if (k < 0.8) lampDim = sputter();
      cue(e, 'creak', 0.05, () => sfx('creak'));
      cue(e, 'clunk', 0.8, () => { sfx('clunk'); fx((F) => F.shake(false)); });
      cue(e, 'crunch', 1.35, () => {
        if (!gore) return;
        sfx('crunch'); sfx('splat');
        const hole = f.position.clone().setY(0.05);
        spray(hole, new THREE.Vector3(0, 1, 0).addScaledVector(fwd, 0.25), 60, 3.4, 1.0);
        stain(hole.x, 0.002, hole.z, 0.7);
      });
      if (k > 0.8) {
        f.position.y = -Math.pow(k - 0.8, 2) * 7;
        u.head.rotation.x = -0.35;
        if (k > 1.6) { f.visible = false; deadPose[e.id] = 'gone'; }
      }
    } else if (e.method === 'lightsout') {
      lampDim = k < 0.4 ? sputter() : k < 2.0 ? 0.03 : k < 2.4 ? sputter() : 1;
      e.eyes.visible = k > 0.5 && k < 1.6;
      e.eyes.position.copy(head).addScaledVector(fwd, -0.32).add(new THREE.Vector3(0, 0.1, 0));
      e.eyes.lookAt(camera.position);
      cue(e, 'whisper', 0.6, () => sfx('whisper'));
      cue(e, 'sting', 1.3, () => sfx('sting'));
      cue(e, 'wet', 1.35, () => { if (gore) { sfx('crunch'); sfx('splat'); } });
      cue(e, 'mess', 1.45, () => {
        if (!gore) return;
        spray(head, fwd.clone().add(new THREE.Vector3(0, 0.3, 0)), 50, 2.2, 2.2);
        spray(head.clone().setY(1.0), new THREE.Vector3(0, 0.2, 0), 40, 1.5, 2.6);
        for (let i = 0; i < 6; i++) { const p = f.position.clone().addScaledVector(fwd, 0.3 + Math.random() * 0.4).addScaledVector(side, (Math.random() - 0.5) * 0.6); stain(p.x, onTable(p.x, p.z) ? TABLE_Y + 0.004 : 0.003, p.z, 0.1 + Math.random() * 0.18); }
      });
      if (k > 1.4) { f.visible = false; deadPose[e.id] = 'gone'; }
    } else if (e.method === 'electric') {
      cue(e, 'buzz', 0, () => sfx('buzz'));
      if (k < 1.9) {
        f.rotation.z = (Math.random() - 0.5) * 0.12;
        u.head.rotation.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4);
        zap.position.copy(head); zapLevel = Math.random() < 0.6 ? 1.5 + Math.random() * 3 : 0;
      } else {
        f.rotation.z = 0; u.head.rotation.y = 0; u.head.rotation.z = 0;
        f.rotation.x += (-0.25 - f.rotation.x) * 0.15;
        u.head.rotation.x += (0.6 - u.head.rotation.x) * 0.15;
        deadPose[e.id] = 'limp';
        if (gore && !e.fired.char) {
          e.fired.char = 1;
          for (const m of u.head.material) m.color.setHex(0x3a2a1c);
          spray(head, new THREE.Vector3(0, -0.2, 0).addScaledVector(fwd, 0.6), 18, 0.9, 0.5);
        }
        if (gore && k < 2.8 && Math.random() < 0.3) spray(head.clone().addScaledVector(fwd, 0.12), new THREE.Vector3(0, -1, 0), 1, 0.3, 0.1);
      }
      cue(e, 'pop', 1.9, () => sfx('pop'));
    }
  }

  // me, in first person
  function stepMine(e, cp, cl) {
    const k = e.t;
    if (e.method === 'shotgun') {
      const g = e.gun;
      g.visible = k < 2.75;
      const rise = ease(Math.min(1, k / 1.4));
      g.position.set(0.06 + Math.sin(k * 23) * 0.003, 0.82 + (1.3 - 0.82) * rise, -0.25 + 0.7 * rise);
      g.lookAt(camera.position.clone().add(new THREE.Vector3(0.12, -0.05, 0))); // a hair off-axis so it reads as a barrel
      cue(e, 'tense', 0, () => fx((F) => F.tense(true)));
      cue(e, 'rack', 1.6, () => sfx('rack'));
      cue(e, 'hush', 2.3, () => fx((F) => { F.tense(false); F.drone(0); }));
      cue(e, 'bang', 2.7, () => { sfx('blast'); sfx('ring'); fx((F) => { F.flash('rgba(255,255,255,1)'); F.blackout(true); if (gore) { F.sfx('splat'); F.splatter(1); } }); });
      cue(e, 'word', 3.3, () => fx((F) => F.stamp('탕.', 'var(--bone)')));
      if (k > 2.7) cp.y += (Math.random() - 0.5) * 0.08 * Math.max(0, 1 - (k - 2.7));
    } else if (e.method === 'drop') {
      if (k < 0.7) lampDim = sputter();
      cue(e, 'creak', 0.05, () => sfx('creak'));
      cue(e, 'clunk', 0.7, () => sfx('clunk'));
      if (k > 0.7) { const fall = Math.pow(k - 0.7, 2) * 5; cp.y -= fall; cl.y -= fall * 0.35; }
      cue(e, 'dark', 1.6, () => fx((F) => F.blackout(true)));
      cue(e, 'thud', 2.1, () => { sfx('thud'); if (gore) fx((F) => { F.sfx('crunch'); F.splatter(0.6); }); });
    } else if (e.method === 'lightsout') {
      lampDim = k < 0.5 ? sputter() : 0.02;
      const g = e.eyes;
      g.visible = k > 0.8 && k < 2.15;
      g.position.lerpVectors(new THREE.Vector3(0, 1.55, -2.2), new THREE.Vector3(0, 1.48, 1.25), ease(Math.max(0, (k - 0.8) / 1.3)));
      g.lookAt(camera.position);
      cue(e, 'whisper', 0.9, () => sfx('whisper'));
      cue(e, 'sting', 2.0, () => sfx('sting'));
      cue(e, 'dark', 2.15, () => fx((F) => { F.blackout(true); if (gore) { F.sfx('crunch'); F.sfx('splat'); F.splatter(1); } }));
    } else if (e.method === 'electric') {
      cue(e, 'buzz', 0, () => sfx('buzz'));
      if (k < 2.2) {
        cp.x += (Math.random() - 0.5) * 0.06; cp.y += (Math.random() - 0.5) * 0.06;
        cl.x += (Math.random() - 0.5) * 0.2;
        zap.position.set(0, 1.2, 1.2); zapLevel = Math.random() < 0.5 ? 3 : 0;
        if (Math.random() < 0.12) fx((F) => F.flash('rgba(90,150,255,.55)'));
      }
      cue(e, 'pop', 2.2, () => { sfx('pop'); fx((F) => { F.blackout(true); if (gore) F.splatter(0.45); }); });
    }
  }

  function shake(big) { shakeT = big ? 0.8 : 0.35; shakeAmp = big ? 0.12 : 0.04; }

  function stare(id) { stareId = id || null; }

  function setGore(v) { gore = !!v; if (!gore) clearStains(); }

  return { init, update, shake, winSweep, tour, stare, execute, setGore, clearStains };
})();
