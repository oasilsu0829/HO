/* global THREE */
// First-person 3D table: you sit at the near edge under a single lamp, opponents across.
// Rendered at low resolution and scaled up with hard pixels.
const Scene3D = (() => {
  const SCALE = 0.42;          // render resolution vs. screen
  const TABLE_Y = 0.78;
  const DECK = new THREE.Vector3(0, TABLE_Y + 0.25, -0.95);
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_COL = { s: '#111111', c: '#111111', h: '#b3150d', d: '#b3150d' };

  let renderer, scene, camera, lamp, lampBulb, root, labelsEl, tableGroup;
  const camBase = new THREE.Vector3(0, 1.5, 1.55);
  const camLook = new THREE.Vector3(0, 0.95, -0.55);
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
  function maskTex(seed) {
    return canvasTex(32, 32, (x, w, h) => {
      const r = (n) => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280) * n; };
      x.fillStyle = ['#c9c2a8', '#b9ad8a', '#9d9786', '#d1c7a0'][Math.floor(r(4))];
      x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 12; i++) x.fillRect(r(w), r(h), 1, r(4) + 1);
      x.fillStyle = '#000';
      const ey = 10 + Math.floor(r(4)), eh = 3 + Math.floor(r(3));
      x.fillRect(7, ey, 6, eh); x.fillRect(19, ey, 6, eh);
      const style = Math.floor(r(3));
      if (style === 0) for (let i = 8; i < 25; i += 3) x.fillRect(i, 23, 2, 2);          // stitched mouth
      else if (style === 1) x.fillRect(10, 23, 12, 2);                                  // flat slit
      else { x.fillRect(9, 22, 14, 1); x.fillRect(9, 25, 14, 1); for (let i = 9; i < 24; i += 2) x.fillRect(i, 22, 1, 4); } // teeth
    });
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

    scene.add(new THREE.AmbientLight(0x5a6650, 0.75));
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
    // red exit light far back, for menace
    const red = new THREE.PointLight(0x8f1d14, 0.8, 4); red.position.set(-2.2, 1.8, -3); scene.add(red);

    // room
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x14170f });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshLambertMaterial({ color: 0x0c0d0a }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), wallMat); back.position.set(0, 2.5, -3.4); scene.add(back);
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat); w.position.set(sx * 3.4, 2.5, 0); w.rotation.y = -sx * Math.PI / 2; scene.add(w); }

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
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(160, Math.floor(w * SCALE)), Math.max(120, Math.floor(h * SCALE)), false);
    camera.aspect = w / h;
    // portrait screens need a wider field of view to keep the table in frame
    camera.fov = w / h < 1 ? 80 : 60;
    camera.updateProjectionMatrix();
  }

  // ---------- figures ----------
  function makeFigure(id, i) {
    const g = new THREE.Group();
    let seed = 0; for (const ch of String(id)) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    const coat = [0x1d1f1a, 0x231b16, 0x161a1d, 0x1f1a20][seed % 4];
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.75, 8), new THREE.MeshLambertMaterial({ color: coat }));
    body.position.y = 1.0; body.castShadow = true; g.add(body);
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.26), new THREE.MeshLambertMaterial({ color: coat }));
    shoulders.position.y = 1.32; g.add(shoulders);
    const headMat = [0, 0, 0, 0, 0, 0].map(() => new THREE.MeshLambertMaterial({ color: 0x8a8370 }));
    headMat[4] = new THREE.MeshLambertMaterial({ map: maskTex(seed + 7) }); // +z face = mask
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.22), headMat);
    head.position.y = 1.58; head.castShadow = true; g.add(head);
    // eye glints, lit when it's their turn
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd2301f, transparent: true, opacity: 0 });
    for (const ex of [-0.05, 0.05]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.018), eyeMat); e.position.set(ex, 1.61, 0.112); g.add(e); }
    // hands resting on the table
    const handMat = new THREE.MeshLambertMaterial({ color: 0x8a8370 });
    for (const hx of [-0.22, 0.22]) { const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.12), handMat); hnd.position.set(hx, TABLE_Y + 0.02, 0.42); hnd.castShadow = true; g.add(hnd); }
    g.userData = { head, eyeMat, bob: (seed % 100) / 100 * 6 };
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
      const a = Math.PI + 0.42 + t * (Math.PI - 0.84); // angle around the table, far side
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

    // figures
    const live = new Set();
    for (const p of g.players) {
      const s = seatPos[p.id];
      if (s.me) continue;
      live.add(p.id);
      let f = figures.get(p.id);
      if (!f) { f = makeFigure(p.id); scene.add(f); figures.set(p.id, f); f.position.copy(s.figure); }
      f.userData.target = s.figure; f.rotation.y = s.yaw;
      f.userData.turn = g.players[g.toAct]?.id === p.id;
      f.userData.out = (p.folded && g.street !== 'waiting') || (p.chips === 0 && !p.inHand);
    }
    for (const [id, f] of figures) if (!live.has(id)) { scene.remove(f); figures.delete(id); }

    // hole cards
    g.players.forEach((p, pi) => {
      const s = seatPos[p.id];
      p.hole.forEach((c, i) => {
        const m = cardMesh(`h${g.handNo}-${p.id}-${i}`);
        const d = pi * 0.06 + i * 0.25;
        if (s.me) {
          // held up toward the camera
          const pos = s.cards.clone().add(new THREE.Vector3((i - 0.5) * 0.18, i * 0.004, i * 0.004));
          if (p.folded) pos.add(new THREE.Vector3(0, -0.1, -0.35));
          if (p.folded) pos.y = TABLE_Y + 0.002;
          setCard(m, c, pos, p.folded ? -Math.PI / 2 : -0.7, 0, (0.5 - i) * 0.12, d);
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
      f.position.lerp(u.target, 0.1);
      u.head.position.y = 1.58 + Math.sin(t / 900 + u.bob) * 0.008 - (u.out ? 0.08 : 0);
      u.head.rotation.x = u.out ? 0.35 : u.turn ? -0.08 : 0;
      u.eyeMat.opacity += ((u.turn ? 1 : 0) - u.eyeMat.opacity) * 0.15;
    }

    // camera: slight breathing, plus shake, plus the win cinematic
    shakeT = Math.max(0, shakeT - dt);
    const amp = shakeAmp * (shakeT > 0 ? shakeT : 0);
    const want = camBase.clone(), wantLook = camLook.clone();
    if (tourState) stepTour(dt, want, wantLook);
    const kc = 1 - Math.pow(0.015, dt);
    camCur.lerp(want, kc); lookCur.lerp(wantLook, kc);
    const cp = camCur.clone(), cl = lookCur.clone();
    if (sweep) stepSweep(dt, cp, cl);
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
      els[i].style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
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

  function shake(big) { shakeT = big ? 0.8 : 0.35; shakeAmp = big ? 0.12 : 0.04; }

  return { init, update, shake, winSweep, tour };
})();
