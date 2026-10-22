/* global Poker */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const PRACTICE_KEY = 'ho.practice';
const ONLINE_KEY = 'ho.online';
const NAME_KEY = 'ho.name';

const SUIT_CH = { s: '♠', h: '♥', d: '♦', c: '♣' };
let mode = null; // 'practice' | 'online'

// ---------- navigation ----------
function show(id) {
  if (typeof FX !== 'undefined') FX.blackout(false);
  if (typeof Celebrate !== 'undefined') Celebrate.stop();
  if (id !== 'table' && typeof Scene3D !== 'undefined' && renderTable.inited) Scene3D.clearStains();
  if (id !== 'table' && typeof FX !== 'undefined') { FX.tense(false); FX.lastSeq = null; FX.lastHand = null; FX.drone(0); }
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== id));
  if (id === 'menu') refreshContinue();
  if (id === 'lobby') loadRooms();
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2500);
}
function modal(html, buttons) {
  $('#modalBody').innerHTML = html + '<div class="row"></div>';
  const row = $('#modalBody .row');
  for (const [label, cls, fn] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls; b.textContent = label;
    b.onclick = () => { $('#modal').hidden = true; fn && fn(); };
    row.appendChild(b);
  }
  $('#modal').hidden = false;
}

function refreshContinue() {
  const btn = $('#btnContinue');
  const on = store.get(ONLINE_KEY), pr = store.get(PRACTICE_KEY);
  btn.hidden = !on && !pr;
  btn.textContent = on ? `이어하기 (온라인 ${on.room})` : '이어하기 (연습)';
  btn.onclick = () => (on ? Online.connect(on) : Practice.resume());
}

for (const id of ['pName', 'oName']) {
  $('#' + id).value = store.get(NAME_KEY) || '';
  $('#' + id).addEventListener('change', (e) => store.set(NAME_KEY, e.target.value));
}

// rules screen
const RANK_EXAMPLES = [
  ['로열 스트레이트 플러시', ['As', 'Ks', 'Qs', 'Js', 'Ts']],
  ['스트레이트 플러시', ['9h', '8h', '7h', '6h', '5h']],
  ['포카드', ['Qc', 'Qd', 'Qh', 'Qs', '3d']],
  ['풀하우스', ['Kh', 'Kd', 'Kc', '7s', '7h']],
  ['플러시', ['Ad', 'Jd', '8d', '5d', '2d']],
  ['스트레이트', ['Tc', '9d', '8h', '7s', '6c']],
  ['트리플', ['8s', '8h', '8d', 'Kc', '2s']],
  ['투페어', ['Jh', 'Js', '4c', '4d', 'Ah']],
  ['원페어', ['Ts', 'Td', 'Ah', '7c', '3s']],
  ['하이카드', ['Ah', 'Jd', '9c', '6s', '3h']],
];
$('#rankList').innerHTML = RANK_EXAMPLES.map(([n, cs]) => `<li><span class="nm">${n}</span>${cs.map((c) => cardHTML(c, 'sm')).join('')}</li>`).join('');


// ---------- tension & impact: synthesized sound, shake, flash ----------

const FX = {
  ac: null, on: store.get('ho.sound') !== false, heartTimer: null,
  audio() {
    if (!this.on) return null;
    try { this.ac ||= new (window.AudioContext || window.webkitAudioContext)(); if (this.ac.state === 'suspended') this.ac.resume(); } catch { return null; }
    return this.ac;
  },
  noise(dur, freq, gain, type = 'lowpass') {
    const ac = this.audio(); if (!ac) return;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(ac.destination); src.start();
  },
  tone(freq, dur, gain, type = 'sine', slideTo) {
    const ac = this.audio(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    g.gain.setValueAtTime(gain, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
  },
  sfx(kind) {
    if (kind === 'chip') { this.noise(0.05, 4000, 0.5, 'highpass'); setTimeout(() => this.noise(0.04, 5000, 0.3, 'highpass'), 60); }
    if (kind === 'check') { this.tone(180, 0.08, 0.4, 'square'); setTimeout(() => this.tone(160, 0.08, 0.3, 'square'), 110); } // two knocks on wood
    if (kind === 'fold') { this.noise(0.35, 900, 0.5); this.tone(220, 0.4, 0.15, 'sawtooth', 60); }
    if (kind === 'raise') { this.tone(90, 0.25, 0.8, 'sine', 40); this.noise(0.12, 1500, 0.6); }
    if (kind === 'rack') { // shell goes in, slide racks: nothing fired yet
      this.noise(0.06, 2500, 0.6, 'bandpass'); setTimeout(() => this.noise(0.09, 1600, 0.7, 'bandpass'), 180);
      setTimeout(() => this.tone(70, 0.2, 0.6, 'sine', 45), 190);
    }
    if (kind === 'blast') { this.noise(1.1, 650, 1.6); this.tone(55, 0.9, 1, 'sine', 22); }
    if (kind === 'click') { this.noise(0.03, 5000, 0.7, 'highpass'); } // empty chamber
    if (kind === 'heart') { this.tone(55, 0.12, 0.9, 'sine', 40); setTimeout(() => this.tone(50, 0.14, 0.7, 'sine', 35), 180); }
    if (kind === 'win') [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 0.2, 'triangle'), i * 90));
    if (kind === 'lose') { this.tone(110, 1.2, 0.4, 'sawtooth', 40); }
    if (kind === 'deal') this.noise(0.06, 3000, 0.25, 'bandpass');
    if (kind === 'creak') { this.tone(140, 0.9, 0.12, 'sawtooth', 85); this.noise(0.9, 500, 0.25, 'bandpass'); }
    if (kind === 'clunk') { this.tone(70, 0.3, 0.9, 'square', 32); this.noise(0.25, 400, 0.9); }
    if (kind === 'thud') this.tone(48, 0.6, 0.5, 'sine', 28);
    if (kind === 'whisper') for (let i = 0; i < 12; i++) setTimeout(() => { this.tone(180 + Math.random() * 60, 0.05, 0.04, 'sawtooth'); this.noise(0.04, 3000, 0.08, 'highpass'); }, i * 65);
    if (kind === 'sting') [311, 330, 349, 370].forEach((f) => this.tone(f, 1.1, 0.1, 'sawtooth'));
    if (kind === 'buzz') for (let i = 0; i < 18; i++) setTimeout(() => { this.tone(55 + Math.random() * 10, 0.11, 0.25, 'sawtooth'); this.noise(0.1, 2200, 0.25, 'bandpass'); }, i * 105);
    if (kind === 'pop') { this.noise(0.15, 3000, 0.9, 'highpass'); this.tone(90, 0.3, 0.6, 'sine', 40); }
    if (kind === 'ring') this.tone(3600, 2.6, 0.05, 'sine');
    if (kind === 'splat') { this.noise(0.25, 700, 0.9); setTimeout(() => this.noise(0.18, 500, 0.6), 90); setTimeout(() => this.noise(0.3, 350, 0.4), 220); }
    if (kind === 'crunch') { this.noise(0.12, 1800, 0.9, 'bandpass'); this.tone(80, 0.25, 0.8, 'square', 40); setTimeout(() => this.noise(0.1, 2600, 0.6, 'bandpass'), 70); }
  },
  shake(big) {
    if (typeof Scene3D !== 'undefined') Scene3D.shake(big);
    if (navigator.vibrate) try { navigator.vibrate(big ? [80, 40, 160] : 40); } catch {}
  },
  flash(color) {
    const f = $('#flash'); f.style.background = color;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  },
  // the usual win/lose effects once any executions have played
  payout(g, me, winners, iWon, iWasIn, big) {
    if (iWasIn && !iWon && me.allIn) {
      // the only time the gun goes off: you shoved and lost
      this.sfx('blast'); this.shake(true); this.flash('rgba(210,48,31,.85)'); this.stamp('탕!');
    } else if (iWon && me.allIn) {
      this.sfx('click');
      this.sweep(g, winners, me);
      setTimeout(() => { this.sfx('win'); this.flash('rgba(216,160,58,.5)'); this.stamp(big ? 'JACKPOT' : '생존', 'var(--amber)'); }, 500);
    } else if (iWon) {
      this.sweep(g, winners, me);
      this.sfx('win'); this.flash('rgba(216,160,58,.4)'); if (big) this.stamp('JACKPOT', 'var(--amber)');
    } else if (iWasIn) {
      this.sfx('lose'); this.flash('rgba(143,29,20,.4)');
    }
  },
  // pixel blood thrown across the screen, running down
  splatter(amount) {
    const el = $('#gore');
    const w = 160, h = Math.round(160 * innerHeight / innerWidth);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const blob = (cx, cy, r, col) => { x.fillStyle = col; for (let i = 0; i < r * 3; i++) { const a = Math.random() * 6.3, d = Math.random() * r; x.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1 + (Math.random() * 2 | 0), 1 + (Math.random() * 2 | 0)); } };
    const n = Math.round(3 + amount * 7);
    for (let i = 0; i < n; i++) {
      const cx = Math.random() * w, cy = Math.random() * h * 0.8, r = 3 + Math.random() * 9 * amount;
      for (let k = 0; k < 4; k++) blob(cx, cy, r * (1 - k * 0.2), k % 2 ? '#5e0604' : '#8e0e08'); // dense core
      for (let k = 0; k < r; k++) blob(cx + (Math.random() - 0.5) * r * 4, cy + (Math.random() - 0.5) * r * 4, 1, '#7a0b06'); // spatter
      const drips = 1 + (Math.random() * 3 | 0);
      for (let d = 0; d < drips; d++) { x.fillStyle = '#5c0704'; const dx = Math.round(cx + (Math.random() - 0.5) * r); x.fillRect(dx, Math.round(cy), 1 + (Math.random() * 2 | 0), Math.round(r * (1 + Math.random() * 3))); }
    }
    el.style.backgroundImage = `url(${c.toDataURL()})`;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  },
  blackout(on, autoOffMs) {
    const b = $('#blackout');
    clearTimeout(this.boT);
    b.classList.toggle('on', on);
    if (on && autoOffMs) this.boT = setTimeout(() => b.classList.remove('on'), autoOffMs);
  },
  stamp(text, color) {
    const s = $('#stamp'); s.textContent = text; s.style.color = color || '';
    s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
  },
  sweep(g, winners, me) {
    const w = winners.find((x) => x.id === me.id);
    if (w && typeof Scene3D !== 'undefined' && Scene3D.winSweep) Scene3D.winSweep(w.amount, g.bb);
  },
  // garbled murmur for table talk, one blip per syllable
  voice(text, seed) {
    if (!this.audio()) return;
    const base = 90 + (seed % 7) * 18;
    [...text].filter((ch) => ch.trim()).slice(0, 14).forEach((ch, i) => setTimeout(() => this.tone(base + (ch.charCodeAt(0) % 9) * 9, 0.07, 0.12, 'square'), i * 75));
  },
  droneNodes: null,
  drone(level) {
    const ac = this.audio();
    if (!ac) { if (this.droneNodes) this.droneNodes.g.gain.value = 0; return; }
    if (!this.droneNodes) {
      const g = ac.createGain(); g.gain.value = 0;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      for (const fr of [41, 41.6, 61.5]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); }
      f.connect(g).connect(ac.destination);
      this.droneNodes = { g, f };
    }
    const target = this.on ? Math.min(0.09, level * 0.09) : 0;
    this.droneNodes.g.gain.setTargetAtTime(target, ac.currentTime, 0.8);
    this.droneNodes.f.frequency.setTargetAtTime(180 + level * 400, ac.currentTime, 0.8);
  },
  lastVoice: 0,
  tense(on) {
    document.body.classList.toggle('tense', on);
    if (on && !this.heartTimer) { this.sfx('heart'); this.heartTimer = setInterval(() => this.sfx('heart'), 900); }
    if (!on && this.heartTimer) { clearInterval(this.heartTimer); this.heartTimer = null; }
  },
  lastSeq: null, lastHand: null,
  // React to whatever happened since the previous render.
  react(g, me) {
    const seq = g.logSeq || 0;
    const n = this.lastSeq === null ? 0 : Math.min(g.log.length, Math.max(0, seq - this.lastSeq));
    const fresh = g.log.slice(g.log.length - n);
    if (this.lastHand !== null && g.handNo !== this.lastHand) this.sfx('deal');
    this.lastSeq = seq; this.lastHand = g.handNo;
    for (const line of fresh) {
      if (/올인/.test(line)) { this.sfx('rack'); setTimeout(() => { this.shake(false); this.stamp('ALL IN', 'var(--bone)'); }, 200); }
      else if (/레이즈|벳/.test(line)) { this.sfx('raise'); this.shake(false); }
      else if (/ 콜 /.test(line)) this.sfx('chip');
      else if (/체크/.test(line)) this.sfx('check');
      else if (/다이/.test(line)) { this.sfx('fold'); if (line.startsWith(me.name + ' ')) this.flash('rgba(0,0,0,.9)'); }
      else if (/승리/.test(line)) {
        const winners = g.result?.winners || [];
        const iWon = winners.some((w) => w.id === me.id);
        const big = winners.reduce((s, w) => s + w.amount, 0) >= g.bb * 20;
        const iWasIn = me.inHand && !me.folded;
        const delay = g.result?.uncontested ? 0 : Object.keys(g.result.hands).length * REVEAL_PER * 1000 + 300;
        const busted = bustedIn(g);
        const celeb = Poker.celebMs(g);
        if (celeb) setTimeout(() => Celebrate.play(g), delay);
        setTimeout(() => {
          if (typeof Scene3D !== 'undefined') {
            if (busted.some((p) => p.id === me.id)) {
              // my own execution replaces every other effect; online you get to spectate afterwards
              Scene3D.execute(me.id, executionFor(g, me.id), true);
              if (mode === 'online') setTimeout(() => this.blackout(false), 6500);
              return;
            }
            busted.forEach((p, i) => setTimeout(() => Scene3D.execute(p.id, executionFor(g, p.id), false), i * 400));
          }
          const after = busted.length ? 3300 + (busted.length - 1) * 400 : 0;
          setTimeout(() => this.payout(g, me, winners, iWon, iWasIn, big), after);
        }, delay + celeb);
        break;
      }
    }

    // bots muttering at the table
    for (const p of g.players) if (p.say && p.say.seq > this.lastVoice && p.id !== me.id) { this.voice(p.say.text, p.name.length + p.say.seq); }
    this.lastVoice = Math.max(this.lastVoice, ...g.players.map((p) => p.say?.seq || 0));
    // low drone that swells with the pot relative to the stacks
    const potNow = g.pot + g.players.reduce((s, p) => s + p.bet, 0);
    const avgStack = g.players.reduce((s, p) => s + p.chips + p.total, 0) / Math.max(1, g.players.length);
    this.drone(Poker.isLive(g) ? Math.min(1, potNow / Math.max(1, avgStack)) : 0);
    // heartbeat when the decision is heavy: big call relative to stack, or someone is all-in against you
    const myTurn = g.players[g.toAct]?.id === me.id;
    const toCall = myTurn ? g.currentBet - me.bet : 0;
    const allInVsMe = Poker.isLive(g) && me.inHand && !me.folded && g.players.some((p) => p.allIn && !p.folded && p.inHand);
    const doomedNow = g.mode === 'death' && Poker.isLive(g) && !me.dead && (lowestAlive(g) || []).some((p) => p.id === me.id) && handInRound(g) >= g.roundLen - 1;
    const heavy = Poker.isLive(g) && ((myTurn && toCall > 0 && toCall >= me.chips * 0.3) || allInVsMe || (me.allIn && !me.folded) || doomedNow);
    this.tense(heavy);
    // while you sweat a big decision the camera creeps toward whoever bet
    if (typeof Scene3D !== 'undefined') Scene3D.stare(myTurn && toCall > 0 && toCall >= me.chips * 0.15 ? g.aggressor : null);
  },
};
window.FX = FX;
// gore can be turned off for friends who'd rather not
let goreOn = store.get('ho.gore') !== false;
const syncGore = () => { $('#btnGore').textContent = goreOn ? '잔혹 ON' : '잔혹 OFF'; if (typeof Scene3D !== 'undefined') Scene3D.setGore(goreOn); };
$('#btnGore').onclick = () => { goreOn = !goreOn; store.set('ho.gore', goreOn); syncGore(); };
const syncSound = () => ($('#btnSound').textContent = FX.on ? '소리 ON' : '소리 OFF');
$('#btnSound').onclick = () => { FX.on = !FX.on; store.set('ho.sound', FX.on); if (!FX.on) FX.tense(false); syncSound(); };
syncSound();
syncGore();

// ---------- result celebrations: tidy for a pair, unhinged for a royal ----------
const NOTE = (i) => 523.25 * Math.pow(2, [0, 2, 4, 7, 9][((i % 5) + 5) % 5] / 12 + Math.floor(i / 5)); // C-major pentatonic, i=0 is C5
const Celebrate = {
  parts: [], raf: 0, cv: null, x: null, timers: [],
  xylo(i, at = 0, vol = 0.35) { // a bright wooden "tok": fundamental + inharmonic partial, very fast decay
    this.timers.push(setTimeout(() => {
      const ac = FX.audio(); if (!ac) return;
      const f = NOTE(i), t = ac.currentTime;
      for (const [mult, v, dec] of [[1, vol, 0.45], [3.98, vol * 0.35, 0.12], [9.1, vol * 0.12, 0.05]]) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = mult === 1 ? 'triangle' : 'sine'; o.frequency.value = f * mult;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dec + 0.02);
      }
    }, at));
  },
  run(seq, step, base = 0, vol) { seq.forEach((n, k) => n != null && this.xylo(n, base + k * step, vol)); },
  later(fn, at) { this.timers.push(setTimeout(fn, at)); },
  // ---- pixel particles ----
  spawn(kind, n, opt = {}) {
    const W = this.cv.width, H = this.cv.height;
    for (let i = 0; i < n; i++) {
      const p = { kind, x: opt.x ?? Math.random() * W, y: opt.y ?? -10 - Math.random() * H * 0.3, vx: (Math.random() - 0.5) * (opt.spread ?? 1.5), vy: opt.vy ?? (0.6 + Math.random() * 1.6), life: opt.life ?? 240, g: opt.g ?? 0.04, size: opt.size ?? 3, col: opt.col, ch: opt.ch, rot: Math.random() * 6 };
      if (opt.burst) { const a = Math.random() * 6.28, s = 0.8 + Math.random() * (opt.burst); p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; }
      this.parts.push(p);
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  },
  tick() {
    const { x, cv } = this; x.clearRect(0, 0, cv.width, cv.height);
    this.parts = this.parts.filter((p) => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life--; p.rot += 0.1;
      if (p.kind === 'firework' && p.life <= 0) { this.spawn('spark', 40, { x: p.x, y: p.y, burst: 2.6, g: 0.03, life: 70, col: p.col, size: 2 }); return false; }
      if (p.life <= 0 || p.y > cv.height + 20) return false;
      const a = Math.min(1, p.life / 40); x.globalAlpha = a;
      if (p.kind === 'suit') { x.fillStyle = p.col; x.font = `${p.size * 5}px monospace`; x.fillText(p.ch, p.x | 0, p.y | 0); }
      else if (p.kind === 'coin') { const w = Math.max(1, Math.abs(Math.cos(p.rot)) * p.size * 2) | 0; x.fillStyle = '#b5830f'; x.fillRect((p.x - w / 2) | 0, p.y | 0, w, p.size * 2); x.fillStyle = '#ffd84a'; x.fillRect((p.x - w / 2) | 0, p.y | 0, Math.max(1, w - 1), p.size * 2 - 1); }
      else if (p.kind === 'confetti') { x.fillStyle = p.col; x.fillRect(p.x | 0, p.y | 0, Math.max(1, Math.abs(Math.sin(p.rot)) * p.size * 2) | 0, p.size); }
      else { x.fillStyle = p.col || '#ffe08a'; x.fillRect(p.x | 0, p.y | 0, p.size, p.size); }
      return true;
    });
    x.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.tick()) : 0;
  },
  stop() {
    this.timers.forEach(clearTimeout); this.timers = [];
    this.parts = []; const el = $('#celeb'); if (el) { el.hidden = true; el.className = ''; }
  },

  // returns how long it runs (ms), from the shared table so the server waits the same
  play(g) {
    const best = Poker.bestWin(g);
    if (!best) return 0;
    this.stop();
    const tier = Poker.celebTier(best.h.score);
    const ms = Poker.CELEB_MS ? Poker.CELEB_MS[tier] : Poker.celebMs(g);
    const el = $('#celeb');
    this.cv = $('#celebFx'); this.x = this.cv.getContext('2d');
    this.cv.width = Math.round(innerWidth / 4); this.cv.height = Math.round(innerHeight / 4); // chunky pixels
    const cards = best.h.cards;
    const core = coreCards(cards, best.h.score);
    const order = tier === 9 ? cards.slice().sort((a, b) => '23456789TJQKA'.indexOf(a[0]) - '23456789TJQKA'.indexOf(b[0])) : cards;
    const NAMES = ['HIGH CARD', 'ONE PAIR', 'TWO PAIR', 'THREE OF A KIND', 'STRAIGHT', 'FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH', 'ROYAL FLUSH'];
    const ko = tier === 9 ? '로 열 플 러 시' : best.h.name;
    const who = esc(best.w.name);
    el.className = `t${tier}`; el.hidden = false;
    el.style.setProperty('--dur', ms + 'ms');
    const title = tier >= 7
      ? `<span class="big" data-t="${NAMES[tier]}">${NAMES[tier].split('').map((c, i) => `<i style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</i>`).join('')}</span><span class="ko">${ko}</span>`
      : `<span class="big">${NAMES[tier].split('').map((c, i) => `<i style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</i>`).join('')}</span><span class="ko">${ko}</span>`;
    el.querySelector('.ctitle').innerHTML = tier === 0 ? `<span class="ko">${ko}</span>` : title;
    el.querySelector('.csub').innerHTML = `${who} · +$${fmt(best.w.amount)}`;
    el.querySelector('.ccards').innerHTML = tier === 0 ? '' : order.map((c, i) => `<span class="cc ${core.has(c) ? 'core' : 'kick'}" style="--i:${i}">${cardHTML(c, 'lg')}</span>`).join('');
    // restart CSS animations
    el.querySelectorAll('*').forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });

    const S = typeof Scene3D !== 'undefined' ? Scene3D : null;
    const coreIdx = order.map((c, i) => (core.has(c) ? i : -1)).filter((i) => i >= 0);
    const suitCol = { s: '#e8e2c8', c: '#9fc28a', h: '#ff4a3a', d: '#ff8a3a' };
    switch (tier) {
      case 0: this.xylo(2, 80, 0.2); break;
      case 1: // tidy: two clean hops
        this.run([0, 1, 2, 3, 4].map((k) => 4 + k), 70, 0, 0.12);
        coreIdx.forEach((i, k) => this.xylo(9 + k * 2, 650 + k * 180));
        break;
      case 2:
        this.run([4, 5, 6, 7, 8], 60, 0, 0.12);
        coreIdx.forEach((i, k) => this.xylo(7 + k, 600 + k * 140));
        this.later(() => this.run([10, 12], 120), 1250);
        break;
      case 3:
        this.run([3, 4, 5, 6, 7], 55, 0, 0.12);
        coreIdx.forEach((i, k) => this.later(() => { this.xylo(5 + k * 2, 0, 0.45); FX.sfx('thud'); FX.shake(false); }, 600 + k * 260));
        this.later(() => this.run([10, 11, 12, 15], 70), 1450);
        break;
      case 4: // a run up the scale as each card lights
        order.forEach((c, k) => this.xylo(5 + k, 500 + k * 130, 0.4));
        this.later(() => { this.run([10, 12, 14, 15, 17], 55); S && S.shake(false); }, 1250);
        this.later(() => this.spawn('spark', 30, { y: this.cv.height * 0.45, vy: -1.5, spread: 3, col: '#ffe08a' }), 1250);
        break;
      case 5: { // suit rain
        const s = cards[0][1];
        this.run([5, 7, 9, 10, 12, 14, 15, 17], 60);
        this.spawn('suit', 70, { ch: SUIT_CH[s], col: suitCol[s], size: 3 });
        this.later(() => this.spawn('suit', 50, { ch: SUIT_CH[s], col: suitCol[s], size: 4 }), 700);
        this.later(() => this.run([15, 14, 12, 15, 17, 20], 80), 1500);
        break;
      }
      case 6: // coins fountain, big stamp
        FX.flash('rgba(0,0,0,.6)');
        this.run([5, 7, 10, 12, 15], 90);
        this.later(() => { FX.shake(true); FX.sfx('raise'); this.spawn('coin', 90, { x: this.cv.width / 2, y: this.cv.height * 0.55, vy: -3.2, spread: 3.2, g: 0.07, size: 3 }); this.run([15, 17, 20, 17, 20, 22], 70); }, 900);
        this.later(() => this.spawn('coin', 60, { x: this.cv.width / 2, y: this.cv.height * 0.55, vy: -2.6, spread: 4, g: 0.07 }), 1800);
        S && S.hype(6, ms / 1000);
        break;
      case 7: // lights out, four slams with thunder
        FX.blackout(true); this.later(() => FX.blackout(false), 450);
        S && S.hype(7, ms / 1000);
        coreIdx.forEach((i, k) => this.later(() => { this.xylo(0 + k * 2, 0, 0.6); FX.sfx('clunk'); FX.flash('rgba(210,48,31,.45)'); FX.shake(k === coreIdx.length - 1); }, 700 + k * 330));
        this.later(() => { this.run([10, 12, 15, 17, 20, 22, 25], 55); this.spawn('spark', 120, { x: this.cv.width / 2, y: this.cv.height * 0.45, burst: 3.5, g: 0.05, col: '#ff8a3a' }); }, 2100);
        break;
      case 8: // glitch, rainbow, everything
        S && S.hype(8, ms / 1000);
        FX.sfx('raise');
        order.forEach((c, k) => this.xylo(5 + k * 2, 300 + k * 110, 0.45));
        this.later(() => { FX.shake(true); FX.flash('rgba(255,255,255,.7)'); this.run([10, 12, 14, 15, 17, 19, 20, 22, 24, 25], 45); }, 1000);
        for (let k = 0; k < 4; k++) this.later(() => { this.spawn('coin', 40, { x: Math.random() * this.cv.width, y: this.cv.height, vy: -4, spread: 2, g: 0.08 }); this.spawn('spark', 50, { x: Math.random() * this.cv.width, y: this.cv.height * 0.4, burst: 3, col: ['#ff4a3a', '#ffd84a', '#5fd4ff', '#9fff7a'][k] }); this.run([20, 22, 25], 60, 0, 0.25); }, 1200 + k * 600);
        break;
      case 9: { // royal flush: silence, spotlight, gold rising one card at a time, then chaos
        S && S.hype(9, (ms - 1500) / 1000);
        FX.blackout(true); FX.tense(false); FX.drone(0);
        this.later(() => FX.blackout(false), 900);
        order.forEach((c, k) => this.later(() => { this.xylo(5 + k * 2, 0, 0.55); this.xylo(10 + k * 2, 60, 0.3); this.spawn('spark', 16, { x: this.cv.width * (0.3 + k * 0.1), y: this.cv.height * 0.5, burst: 1.6, col: '#ffd84a', life: 50 }); }, 1100 + k * 380));
        this.later(() => {
          FX.flash('rgba(255,230,140,.95)'); FX.shake(true); FX.sfx('blast');
          this.run([10, 12, 14, 15, 17, 19, 20, 22, 24, 25, 27, 29, 30], 40, 0, 0.4);
          this.spawn('confetti', 160, { col: undefined }); this.parts.slice(-160).forEach((p) => (p.col = ['#ffd84a', '#ff4a3a', '#e8e2c8', '#5fd4ff', '#9fff7a'][(Math.random() * 5) | 0]));
        }, 3100);
        for (let k = 0; k < 7; k++) this.later(() => {
          const W = this.cv.width, H = this.cv.height;
          this.parts.push({ kind: 'firework', x: W * (0.15 + Math.random() * 0.7), y: H, vx: (Math.random() - 0.5) * 0.6, vy: -3.6 - Math.random(), g: 0.05, life: 40 + (Math.random() * 15 | 0), size: 2, col: ['#ffd84a', '#ff4a3a', '#5fd4ff', '#9fff7a', '#ff8adf'][k % 5] });
          if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
          this.run([15 + (k % 3), 20, 25], 70, 300, 0.25); // jackpot bell
          if (k % 2) FX.shake(false);
        }, 3300 + k * 520);
        this.later(() => this.spawn('suit', 90, { ch: '♠', col: '#ffd84a', size: 4 }), 4200);
        this.later(() => this.run([25, 24, 22, 20, 22, 25, 30], 90, 0, 0.45), 6200);
        break;
      }
    }
    this.later(() => { el.hidden = true; el.className = ''; }, ms);
    return ms;
  },
};

// ---------- rendering ----------
function cardHTML(c, size = '', extra = '') {
  if (!c) return `<div class="card empty ${size}"></div>`;
  if (c === '??') return `<div class="card back ${size}"></div>`;
  const r = c[0] === 'T' ? '10' : c[0];
  return `<div class="card suit-${c[1]} ${size} ${extra}"><span class="r">${r}</span><span class="s1">${SUIT_CH[c[1]]}</span><span class="pip">${SUIT_CH[c[1]]}</span></div>`;
}
const STREET_KO = { waiting: '대기 중', preflop: '프리플랍', flop: '플랍 (2장)', turn: '턴 (3장)', fourth: '포스 (4장)', river: '리버 (5장)', showdown: '쇼다운' };
const fmt = (n) => n.toLocaleString('en-US');

const REVEAL_PER = 1.3; // seconds the camera spends on each revealed hand
const RANK_KO = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
const rankName = (v) => RANK_KO[v] || String(v);

// Which cards in a best-five actually make the hand (the rest are kickers).
function coreCards(cards, score) {
  const cat = score[0];
  if (cat === 4 || cat === 5 || cat === 8) return new Set(cards);
  const val = (c) => '23456789TJQKA'.indexOf(c[0]) + 2;
  if (cat === 0) return new Set([cards.slice().sort((a, b) => val(b) - val(a))[0]]);
  const cnt = {};
  for (const c of cards) cnt[val(c)] = (cnt[val(c)] || 0) + 1;
  return new Set(cards.filter((c) => cnt[val(c)] >= 2));
}

// Plain-language reason the winner beat the best losing hand.
function explain(g) {
  const r = g.result, hands = r.hands;
  const winIds = new Set(r.winners.map((w) => w.id));
  const nameOf = (id) => esc(g.players.find((p) => p.id === id)?.name || '');
  const ws = r.winners.filter((w) => hands[w.id]);
  if (!ws.length) return '';
  const losers = Object.keys(hands).filter((id) => !winIds.has(id))
    .sort((a, b) => cmpScore(hands[b].score, hands[a].score));
  const notes = [];
  const suitCount = {}; for (const c of g.board) suitCount[c[1]] = (suitCount[c[1]] || 0) + 1;
  const flushes = Object.values(hands).filter((h) => h.score[0] === 5 || h.score[0] === 8).length;
  const [fs, fn] = Object.entries(suitCount).sort((a, b) => b[1] - a[1])[0] || [];
  if (flushes >= 2 && fn >= 3) notes.push(`보드에 ${SUIT_CH[fs]}가 ${fn}장 → ${SUIT_CH[fs]} ${5 - fn}장만 있어도 플러시`);
  if (r.bluffer) notes.push(`<b>${nameOf(r.bluffer)}</b> 블러핑 들킴!`);
  const tail = notes.length ? `<br><small>${notes.join(' · ')}</small>` : '';
  if (!losers.length) return `${ws.map((w) => nameOf(w.id)).join(', ')} — 같은 패라서 팟을 나눕니다${tail}`;
  const w = hands[ws[0].id].score, l = hands[losers[0]].score;
  const who = `<b>${nameOf(ws[0].id)}</b>${ws.length > 1 ? ' 외' : ''}`;
  if (w[0] !== l[0]) return `${who}의 <b>${hands[ws[0].id].name}</b>가 ${nameOf(losers[0])}의 ${hands[losers[0]].name}보다 높은 족보${tail}`;
  let i = 1; while (i < w.length && w[i] === l[i]) i++;
  const cat = w[0];
  const label = ({
    0: i === 1 ? '가장 높은 카드' : '키커', 5: i === 1 ? '가장 높은 카드' : '키커',
    1: i === 1 ? '페어 숫자' : '키커', 2: i === 1 ? '높은 페어' : i === 2 ? '낮은 페어' : '키커',
    3: i === 1 ? '트리플 숫자' : '키커', 4: '스트레이트 꼭대기', 8: '스트레이트 꼭대기',
    6: i === 1 ? '트리플 숫자' : '페어 숫자', 7: i === 1 ? '포카드 숫자' : '키커',
  })[cat];
  return `둘 다 <b>${hands[ws[0].id].name}</b> → ${label} 비교: ${who} <b>${rankName(w[i])}</b> &gt; ${nameOf(losers[0])} ${rankName(l[i])}${tail}`;
}
function cmpScore(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }

// Order the reveal: losers first, the winner last.
const revealOrder = (g) => Object.keys(g.result.hands).sort((a, b) => cmpScore(g.result.hands[a].score, g.result.hands[b].score));

function deathNote(g) {
  const d = g.result?.deathInfo;
  if (!d) return '';
  return `<div class="sddeath">☠ ${d.map((x) => `<b>${esc(x.name)}</b> 처형 — ${x.reason === 'bust' ? '파산' : `라운드 ${g.result.round} 최하위 ($${fmt(x.chips)})`}`).join(' · ')}${g.champion ? '' : `<br><small>라운드 ${g.round} 시작 · 모두 칩 리셋</small>`}</div>`;
}

function renderShowdownPanel(g, meId) {
  const el = $('#sdPanel');
  if (g.street !== 'showdown' || !g.result || g.result.uncontested) { el.hidden = true; el.dataset.hand = ''; return; }
  if (el.dataset.hand === String(g.handNo)) return; // already animating this hand
  el.dataset.hand = String(g.handNo);
  const hands = g.result.hands, winIds = new Set(g.result.winners.map((w) => w.id));
  const order = revealOrder(g);
  const rows = order.map((id, i) => {
    const h = hands[id], p = g.players.find((q) => q.id === id), d = i * REVEAL_PER;
    const core = coreCards(h.cards, h.score);
    const cards = h.cards.map((c, j) => `<span class="sdc" style="animation-delay:${(d + j * 0.09).toFixed(2)}s">${cardHTML(c, 'sm', (core.has(c) ? 'core' : 'kicker') + (p.hole.includes(c) ? ' hole' : ''))}</span>`).join('');
    return `<div class="sdrow ${winIds.has(id) ? 'win' : 'lose'} ${id === meId ? 'me' : ''}" style="animation-delay:${d}s">
      <span class="sdname">${esc(p.name)}</span><span class="sdcards">${cards}</span>
      <span class="sdhand" style="animation-delay:${(d + 0.55).toFixed(2)}s">${h.name}</span>
      <span class="sdtag" style="animation-delay:${(d + 0.8).toFixed(2)}s">${winIds.has(id) ? 'WIN' : ''}</span>
    </div>`;
  }).join('');
  el.innerHTML = `${rows}<div class="sdwhy" style="animation-delay:${(order.length * REVEAL_PER).toFixed(2)}s">${explain(g)}${deathNote(g)}</div>`;
  el.hidden = false;
  if (typeof Scene3D !== 'undefined') Scene3D.tour(order, REVEAL_PER);
}

// Who went broke this hand, and how they go out. Seeded so every viewer sees the same execution.
const EXECUTIONS = ['shotgun', 'drop', 'lightsout', 'electric'];
const bustedIn = (g) => (g.street !== 'showdown' ? []
  : g.result?.deaths ? g.players.filter((p) => g.result.deaths.includes(p.id))
  : g.mode === 'death' ? []
  : g.players.filter((p) => p.inHand && p.chips === 0));
// death mode: who is on the chopping block right now
function lowestAlive(g) {
  const alive = g.players.filter((p) => !p.dead);
  if (alive.length < 2) return null;
  const val = (p) => p.chips + p.bet;
  const low = Math.min(...alive.map(val));
  const tied = alive.filter((p) => val(p) === low);
  return tied.length === alive.length ? null : tied;
}
const handInRound = (g) => Math.min(g.roundLen, g.roundHand + (Poker.isLive(g) ? 1 : 0));
function executionFor(g, id) {
  let h = g.handNo * 7919;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXECUTIONS[h % EXECUTIONS.length];
}
const EXEC_MS = 3600;

let raiseDraft = null; // keep slider value across re-renders of the same decision

/**
 * Draws the whole table.
 * ctx = { game, me, legal, onAction, hostTools, isHost, onKick }
 */
const isDealer = (g, id) => g.street !== 'waiting' && g.players[g.dealer]?.id === id;
function renderTable(ctx) {
  const g = ctx.game;
  const winIds = new Set((g.result?.winners || []).map((w) => w.id));
  const shown = g.result?.hands || {};

  if (!renderTable.inited) { Scene3D.init($('#stage')); renderTable.inited = true; }
  Scene3D.update(g, {
    me: ctx.me,
    onKick: ctx.onKick,
    labelHTML: (p) => {
      const danger = new Set((g.mode === 'death' && lowestAlive(g) || []).map((q) => q.id));
      const i = g.players.indexOf(p);
      const cls = ['plate'];
      if (i === g.toAct) cls.push('turn');
      if (p.folded && g.street !== 'waiting') cls.push('folded');
      if (p.online === false) cls.push('offline');
      if (winIds.has(p.id) && g.street === 'showdown') cls.push('win');
      const badgeCls = p.lastAction === '다이' ? 'fold' : p.lastAction === '올인' ? 'allin' : /레이즈|벳/.test(p.lastAction) ? 'raise' : '';
      return `<div class="${cls.join(' ')}">
        ${i === g.dealer && g.street !== 'waiting' ? '<div class="dealer">D</div>' : ''}
        ${p.lastAction ? `<div class="badge ${badgeCls}">${p.lastAction}</div>` : ''}
        ${p.say && p.say.seq >= (g.logSeq || 0) - 1 && Poker.isLive(g) ? `<div class="bubble">${esc(p.say.text)}</div>` : ''}
        <div class="name">${esc(p.name)}${p.bot ? `<span class="persona">${Poker.personaOf(p).name}</span>` : ''}</div>
        <div class="chips">$${fmt(p.chips)}${p.bet ? ` <span class="betamt">▸${fmt(p.bet)}</span>` : ''}</div>
        ${shown[p.id] ? `<div class="handname">${shown[p.id].name}</div>` : ''}
        ${p.dead ? `<div class="handname dead">${p.spectator ? '관전' : '☠ 사망'}</div>` : p.chips === 0 && !p.inHand ? '<div class="handname">파산</div>' : ''}
        ${g.mode === 'death' && Poker.isLive(g) && danger.has(p.id) ? '<div class="danger">☠ 최하위</div>' : ''}
        ${ctx.isHost ? `<button class="btn tiny red kick" data-kick="${p.id}">✕</button>` : ''}
      </div>`;
    },
  });

  const livePot = g.pot + g.players.reduce((s, p) => s + p.bet, 0);
  $('#pot').textContent = `POT $${fmt(livePot)}`;
  $('#pot').hidden = livePot === 0 && g.street !== 'showdown';
  if (g.mode === 'death') {
    const hr = handInRound(g), last = Poker.isLive(g) && hr === g.roundLen;
    const alive = g.players.filter((p) => !p.dead).length;
    const handTxt = !Poker.isLive(g) && g.result?.deaths ? '라운드 종료' : `핸드 ${hr || 0}/${g.roundLen}${last ? ' 마지막!' : ''}`;
    $('#street').innerHTML = `<span class="dm">☠ R${g.round}</span> · <span class="${last ? 'dm-last' : ''}">${handTxt}</span> · 생존 ${alive} · ${STREET_KO[g.street]}`;
  } else $('#street').textContent = `${STREET_KO[g.street]} · 블라인드 ${g.sb}/${g.bb}${g.handNo ? ` · #${g.handNo}` : ''}`;

  const banner = $('#banner');
  renderShowdownPanel(g, ctx.me);
  if (g.street === 'showdown' && g.result && g.result.uncontested) {
    banner.hidden = false;
    const meIn = g.players.find((p) => p.id === ctx.me);
    banner.className = winIds.has(ctx.me) ? 'win' : meIn && meIn.inHand && !meIn.folded ? 'lose' : '';
    banner.innerHTML = deathNote(g) + g.result.winners.map((w) => `${esc(w.name)} +$${fmt(w.amount)}${w.hand ? ` <small>(${w.hand})</small>` : ''}`).join('<br>');
  } else banner.hidden = true;

  const myP = g.players.find((p) => p.id === ctx.me);
  // flip my two cards open at the start of each hand (negative delay keeps re-renders from restarting it)
  if (renderTable.flipHand !== g.handNo) { renderTable.flipHand = g.handNo; renderTable.flipAt = performance.now(); }
  const flipAge = ((performance.now() - renderTable.flipAt) / 1000).toFixed(2);
  const myCards = myP && myP.hole.length && myP.hole[0] !== '??'
    ? `<span class="myhand">${myP.hole.map((c, i) => `<span class="flip" style="animation-delay:${(0.5 + i * 0.35 - flipAge).toFixed(2)}s">${cardHTML(c, '')}</span>`).join('')}</span>` : '';
  const meDanger = myP && g.mode === 'death' && Poker.isLive(g) && !myP.dead && (lowestAlive(g) || []).some((p) => p.id === myP.id);
  ctx.myLine = myP ? `${myCards}${meDanger ? `<span class="danger-me">☠ 최하위${handInRound(g) >= g.roundLen ? ' · 이번 판이 끝나면 처형' : ''}</span>` : ''}<span class="mystack">${esc(myP.name)} · $${fmt(myP.chips)}${isDealer(g, ctx.me) ? ' · D' : ''}${myP.lastAction ? ` · ${myP.lastAction}` : ''}</span>` : '';
  $('#log').innerHTML = g.log.map((l) => `<div>${esc(l)}</div>`).join('');
  $('#log').scrollTop = 1e6;

  const meP = g.players.find((p) => p.id === ctx.me);
  if (meP) FX.react(g, meP);
  const potEl = $('#pot');
  if (renderTable.lastPot !== livePot) { potEl.classList.remove('bump'); void potEl.offsetWidth; if (livePot) potEl.classList.add('bump'); renderTable.lastPot = livePot; }
  renderActions(ctx);
}

function renderActions(ctx) {
  const g = ctx.game, L = ctx.legal, box = $('#actions');
  const me = g.players.find((p) => p.id === ctx.me);
  let mine = '';
  if (me && me.hole.length && me.hole[0] !== '??' && g.board.length >= 2 && !me.folded) mine = `내 패: <b>${Poker.bestHand(me.hole.concat(g.board)).name}</b>`;
  if (!L) {
    raiseDraft = null;
    let msg = '';
    if (g.street === 'waiting') msg = ctx.waitingMsg || '게임 시작 대기 중…';
    else if (g.street === 'showdown') msg = ctx.showdownMsg || '다음 핸드 준비 중…';
    else if (me && !me.inHand) msg = '다음 핸드부터 참가합니다';
    else if (me?.folded) msg = '다이했습니다';
    else if (me?.allIn) msg = '올인!';
    else msg = `${esc(g.players[g.toAct]?.name || '')}의 차례…`;
    box.innerHTML = `<div class="info">${ctx.myLine || ''}<br>${mine ? mine + '<br>' : ''}${msg}</div>`;
    if (ctx.extraButtons) box.append(...ctx.extraButtons());
    return;
  }
  const key = `${g.handNo}-${g.street}-${g.currentBet}`;
  if (!raiseDraft || raiseDraft.key !== key) raiseDraft = { key, val: L.minTo };
  const betWord = g.currentBet === 0 ? '벳' : '레이즈';
  box.innerHTML = `
    <div class="info">${ctx.myLine || ''}${mine ? '<br>' + mine : ''}</div>
    <button class="btn red" data-a="fold">다이</button>
    ${L.canCheck ? '<button class="btn blue" data-a="check">체크</button>' : `<button class="btn blue" data-a="call">${L.callAmt < L.toCall ? '올인' : '콜'} $${fmt(L.callAmt)}</button>`}
    ${L.canRaise ? `<div class="raisebox">
      <input type="range" min="${L.minTo}" max="${L.maxTo}" step="${g.bb / 2 >= 1 ? Math.floor(g.bb / 2) : 1}" value="${raiseDraft.val}">
      <input class="amt" type="number" min="${L.minTo}" max="${L.maxTo}" value="${raiseDraft.val}">
      <button class="btn tiny gray" data-q="min">최소</button>
      <button class="btn tiny gray" data-q="half">½팟</button>
      <button class="btn tiny gray" data-q="pot">팟</button>
      <button class="btn tiny gray" data-q="max">올인</button>
      <button class="btn orange" data-a="raise">${betWord}</button>
    </div>` : ''}`;
  const range = box.querySelector('input[type=range]'), amt = box.querySelector('.amt');
  const setVal = (v) => {
    v = Math.max(L.minTo, Math.min(L.maxTo, Math.floor(+v || 0)));
    raiseDraft.val = v;
    if (range) { range.value = v; amt.value = v; }
    const rb = box.querySelector('[data-a=raise]');
    if (rb) rb.textContent = v >= L.maxTo ? `올인 $${fmt(v)}` : `${betWord} $${fmt(v)}`;
  };
  if (range) {
    range.oninput = () => setVal(range.value);
    amt.onchange = () => setVal(amt.value);
    const potAfterCall = L.pot + L.toCall;
    box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => setVal({
      min: L.minTo, max: L.maxTo, half: g.currentBet + potAfterCall / 2, pot: g.currentBet + potAfterCall,
    }[b.dataset.q])));
    setVal(raiseDraft.val);
  }
  box.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
    const type = b.dataset.a;
    ctx.onAction(type === 'raise' ? { type, amount: raiseDraft.val } : { type });
  }));
}

// keyboard shortcuts: F fold, C check/call, R raise
document.addEventListener('keydown', (e) => {
  if ($('#table').hidden || e.target.tagName === 'INPUT') return;
  const map = { f: 'fold', c: 'check', r: 'raise' };
  const a = map[e.key.toLowerCase()];
  if (!a) return;
  const b = $(`#actions [data-a=${a}]`) || (a === 'check' && $('#actions [data-a=call]'));
  if (b) b.click();
});

// ---------- practice mode (runs entirely in the browser) ----------
const Practice = {
  g: null, timer: null,
  start() {
    const name = $('#pName').value.trim() || '나';
    store.set(NAME_KEY, name);
    const bb = Math.max(2, parseInt($('#pBB').value, 10) || 20);
    const g = Poker.createGame({ mode: $('#pMode').value, sb: Math.floor(bb / 2), bb, startChips: Math.max(bb * 10, parseInt($('#pChips').value, 10) || 1000) });
    Poker.addPlayer(g, { id: 'me', name });
    const names = ['조커', '지미', '루시', '마크', '에디', '샤샤', '토니'];
    const nb = parseInt($('#pBots').value, 10);
    for (let i = 0; i < nb; i++) Poker.addPlayer(g, { id: 'bot' + i, name: names[i], bot: true });
    this.g = g;
    Poker.startHand(g);
    this.enter();
  },
  resume() {
    const g = store.get(PRACTICE_KEY);
    if (!g) return show('menu');
    this.g = g;
    this.enter();
  },
  enter() {
    mode = 'practice';
    show('table');
    $('#roomInfo').innerHTML = '<b>연습 모드</b><span class="wide-only"> · 언제든 나가도 자동 저장됩니다</span>';
    $('#hostCtl').innerHTML = '';
    this.tick();
  },
  save() { store.set(PRACTICE_KEY, this.g); },
  tick() {
    const g = this.g;
    clearTimeout(this.timer);
    this.save();
    const me = g.players.find((p) => p.id === 'me');
    const ctx = {
      game: Poker.viewFor(g, 'me'), me: 'me', legal: Poker.legal(g, 'me'),
      onAction: (a) => { const r = Poker.applyAction(g, 'me', a); if (!r.ok) toast(r.error); this.tick(); },
      showdownMsg: '다음 핸드 준비 중…',
      extraButtons: () => {
        if (g.street !== 'showdown' || (me.chips === 0 && !me.dead) || g.champion || (me.dead && !g.meDeathShown)) return [];
        const b = document.createElement('button');
        b.className = 'btn orange'; b.textContent = '다음 핸드 ▶';
        b.onclick = () => this.next();
        return [b];
      },
    };
    renderTable(ctx);
    if (Poker.isLive(g)) {
      const p = g.players[g.toAct];
      if (p.bot) { const d = Poker.botDecide(g, p.id); this.timer = setTimeout(() => { Poker.applyAction(g, p.id, d); this.tick(); }, d.think); }
      return;
    }
    if (g.street === 'showdown') {
      const alive = g.players.filter((p) => p.chips > 0);
      // let the reveal and the shot play before any popup covers the table
      const execMs = bustedIn(g).length ? EXEC_MS + 1800 : 0;
      const revealMs = (g.result && !g.result.uncontested ? Object.keys(g.result.hands).length * REVEAL_PER * 1000 + 2600 : 1500) + execMs + Poker.celebMs(g);
      if (g.mode === 'death') {
        const wait = (key, fn) => { if (!this[key]) { this[key] = true; this.timer = setTimeout(() => this.tick(), revealMs); return true; } this[key] = false; fn(); return true; };
        if (g.champion) return wait('winShown', () => {
          store.del(PRACTICE_KEY);
          const champ = g.players.find((p) => p.id === g.champion);
          modal(g.champion === 'me' ? '<h2>🏆 최후의 1인</h2><p>모두를 묻고 살아남았습니다.</p>' : `<h2>☠ 게임 종료</h2><p><b>${esc(champ.name)}</b>이(가) 최후의 1인입니다.</p>`,
            [['메뉴로', 'gray', () => show('menu')], ['다시 하기', 'orange', () => this.start()]]);
        });
        if (me.dead && !g.meDeathShown) return wait('bustShown', () => modal(`<h2>☠ 처형당했습니다</h2><p>라운드 ${me.deathRound}에서 탈락했습니다.</p>`, [
          ['메뉴로', 'gray', () => { store.del(PRACTICE_KEY); show('menu'); }],
          ['끝까지 관전', 'orange', () => { g.meDeathShown = true; this.next(); }],
        ]));
      } else if (me.chips === 0) {
        if (!this.bustShown) { this.bustShown = true; this.timer = setTimeout(() => this.tick(), revealMs); return; }
        this.bustShown = false;
        return modal('<h2>파산!</h2><p>칩을 모두 잃었습니다.</p>', [
          ['메뉴로', 'gray', () => { store.del(PRACTICE_KEY); show('menu'); }],
          ['리바이', 'orange', () => { me.chips = g.startChips; this.next(); }],
        ]);
      }
      if (g.mode !== 'death' && alive.length === 1) {
        if (!this.winShown) { this.winShown = true; this.timer = setTimeout(() => this.tick(), revealMs); return; }
        this.winShown = false;
        store.del(PRACTICE_KEY);
        return modal('<h2>🏆 우승!</h2><p>모든 봇을 이겼습니다!</p>', [['메뉴로', 'orange', () => show('menu')]]);
      }
      const reveal = g.result && !g.result.uncontested ? Object.keys(g.result.hands).length * REVEAL_PER * 1000 : 0;
      this.timer = setTimeout(() => this.next(), 5000 + reveal + Poker.celebMs(g) + (bustedIn(g).length ? EXEC_MS : 0));
    }
  },
  next() {
    clearTimeout(this.timer);
    FX.blackout(false);
    Celebrate.stop();
    Poker.startHand(this.g);
    this.tick();
  },
  exit() { clearTimeout(this.timer); this.save(); show('menu'); },
};
$('#btnPracticeStart').onclick = () => Practice.start();
const DM_HINT = '8핸드마다 칩이 가장 적은 사람이 처형됩니다. 파산하면 그 자리에서 처형되고 다음 라운드로. 라운드마다 칩은 리셋, 최후의 1인까지.';
for (const id of ['pMode', 'oMode']) $('#' + id).addEventListener('change', (e) => { $('#pModeHint').textContent = $('#pMode').value === 'death' ? DM_HINT : ''; if (e.target.value === 'death') toast('☠ ' + DM_HINT); });

// ---------- execution preview: an empty table and a victim, nothing at stake ----------
const EXEC_NAMES = { shotgun: '샷건', drop: '바닥 꺼짐', lightsout: '소등', electric: '전기의자' };
const Preview = {
  g: null, pov: 'them', busy: false,
  enter() {
    mode = 'preview';
    const g = Poker.createGame({});
    Poker.addPlayer(g, { id: 'me', name: store.get(NAME_KEY) || '나' });
    Poker.addPlayer(g, { id: 'victim', name: '희생양', bot: true });
    this.g = g;
    show('table');
    $('#roomInfo').innerHTML = '<b>처형 미리보기</b><span class="wide-only"> · 아무것도 걸려있지 않아요</span>';
    $('#hostCtl').innerHTML = '';
    this.render();
  },
  render() {
    const mk = (label, cls, fn, disabled) => { const b = document.createElement('button'); b.className = `btn ${cls}`; b.textContent = label; b.onclick = fn; b.disabled = !!disabled; return b; };
    renderTable({
      game: Poker.viewFor(this.g, 'me'), me: 'me', legal: null,
      waitingMsg: this.busy ? '…' : `처형 방식을 고르세요 · 시점: <b>${this.pov === 'me' ? '1인칭 (내가 당함)' : '지켜보기'}</b>`,
      extraButtons: () => [
        ...EXECUTIONS.map((m) => mk(EXEC_NAMES[m], 'red', () => this.run(m), this.busy)),
        mk(this.pov === 'me' ? '시점: 1인칭' : '시점: 지켜보기', 'blue', () => { this.pov = this.pov === 'me' ? 'them' : 'me'; this.render(); }, this.busy),
        mk('테이블 청소', 'gray', () => Scene3D.clearStains(), this.busy),
        mk('결산 연출 ▶', 'orange', () => this.celebAll(), this.busy),
      ],
    });
  },
  // fake a showdown for each tier, one after another
  celebAll() {
    const HANDS = [['As', 'Jd', '8c', '6h', '3s', '2d', '9c'], ['Ah', 'Ad', 'Kc', '9s', '5h', '3d', '2c'], ['Kh', 'Kd', '7c', '7s', 'Ah', '3d', '2c'], ['Qh', 'Qd', 'Qs', '9c', '5h', '3d', '2c'],
      ['9h', '8d', '7c', '6s', '5h', '2d', 'Kc'], ['Ah', 'Jh', '8h', '5h', '2h', 'Kd', '3c'], ['Kh', 'Kd', 'Kc', '7s', '7h', '3d', '2c'], ['9h', '9d', '9c', '9s', '5h', '3d', '2c'],
      ['9s', '8s', '7s', '6s', '5s', '2d', 'Kc'], ['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']];
    this.busy = true; this.render();
    let at = 0;
    HANDS.forEach((seven, tier) => {
      setTimeout(() => {
        if (mode !== 'preview') return;
        const h = Poker.bestHand(seven);
        const fake = { result: { uncontested: false, winners: [{ id: 'victim', name: '희생양', amount: 100 * (tier + 1) * (tier + 1) }], hands: { victim: { name: h.name, cards: h.cards, score: h.score } } } };
        Celebrate.play(fake);
      }, at);
      at += Poker.CELEB_MS[tier] + 400;
    });
    setTimeout(() => { this.busy = false; if (mode === 'preview') this.render(); }, at);
  },
  run(method) {
    if (this.busy) return;
    this.busy = true; this.render();
    FX.audio(); // the click unlocks sound on phones
    const me = this.pov === 'me';
    Scene3D.execute(me ? 'me' : 'victim', method, me);
    setTimeout(() => {
      FX.blackout(false);
      this.busy = false;
      if (mode === 'preview') this.render(); // brings the victim back for another go
    }, me ? 6200 : 3800);
  },
};
$('#btnPreview').onclick = () => Preview.enter();

// ---------- online mode ----------
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '서버 오류');
  return data;
}
async function loadRooms() {
  try {
    const list = await api('/api/rooms');
    $('#roomList').innerHTML = list.length
      ? list.map((r) => `<li data-room="${r.id}"><span><span class="code">${r.id}</span> ${esc(r.name)}</span><span>${r.mode === 'death' ? '☠ ' : ''}${r.players}/8 · ${r.blinds}${r.running ? ' · 진행중' : ''}</span></li>`).join('')
      : '<li style="cursor:default;opacity:.6">열린 방이 없습니다</li>';
    $('#roomList').querySelectorAll('[data-room]').forEach((li) => (li.onclick = () => { $('#oCode').value = li.dataset.room; join(); }));
  } catch { $('#roomList').innerHTML = '<li style="cursor:default;opacity:.6">서버에 연결할 수 없습니다 (node server.js 실행 필요)</li>'; }
}
$('#btnRefresh').onclick = loadRooms;
const oName = () => { const n = $('#oName').value.trim(); if (n) store.set(NAME_KEY, n); return n; };
$('#btnCreate').onclick = async () => {
  if (!oName()) return toast('닉네임을 입력하세요');
  try {
    const s = await api('/api/create', { name: oName(), mode: $('#oMode').value, roomName: $('#oRoomName').value, chips: $('#oChips').value, bb: $('#oBB').value });
    Online.connect(s);
  } catch (e) { toast(e.message); }
};
async function join() {
  if (!oName()) return toast('닉네임을 입력하세요');
  try { Online.connect(await api('/api/join', { name: oName(), room: $('#oCode').value.trim() })); } catch (e) { toast(e.message); }
}
$('#btnJoin').onclick = join;

const Online = {
  s: null, es: null, last: null,
  connect(s) {
    mode = 'online';
    this.s = s;
    store.set(ONLINE_KEY, s);
    this.es?.close();
    show('table');
    $('#roomInfo').textContent = '연결 중…';
    const es = (this.es = new EventSource(`/api/events?room=${s.room}&token=${s.token}`));
    es.onmessage = (e) => { this.last = JSON.parse(e.data); this.render(); };
    es.onerror = async () => {
      // distinguish "server restarting" (EventSource retries) from "room/seat is gone"
      try { await api('/api/rooms').then((list) => { if (!list.some((r) => r.id === s.room)) throw new Error('gone'); }); }
      catch (err) {
        if (err.message === 'gone') { es.close(); store.del(ONLINE_KEY); modal('<h2>방이 사라졌습니다</h2>', [['로비로', 'gray', () => show('lobby')]]); }
        else $('#roomInfo').textContent = '서버 재연결 중…';
      }
    };
  },
  render() {
    const v = this.last;
    if (!v.game.players.some((p) => p.id === v.me)) {
      this.es.close(); store.del(ONLINE_KEY);
      return modal('<h2>방에서 나갔습니다</h2>', [['로비로', 'gray', () => show('lobby')]]);
    }
    const isHost = v.room.hostId === v.me;
    if (v.game.champion && this.champShown !== v.game.handNo) {
      this.champShown = v.game.handNo;
      const champ = v.game.players.find((p) => p.id === v.game.champion);
      const wait = (v.game.result && !v.game.result.uncontested ? Object.keys(v.game.result.hands).length * REVEAL_PER * 1000 + EXEC_MS + 2600 : EXEC_MS + 1500) + Poker.celebMs(v.game);
      setTimeout(() => modal(v.game.champion === v.me ? '<h2>🏆 최후의 1인</h2><p>모두를 묻고 살아남았습니다.</p>' : `<h2>☠ 게임 종료</h2><p><b>${esc(champ?.name || '')}</b>이(가) 최후의 1인입니다.</p>`, [['확인', 'orange']]), wait);
    }
    const me = v.game.players.find((p) => p.id === v.me);
    $('#roomInfo').innerHTML = `<b>${esc(v.room.name)}</b> · 코드 <b>${v.room.id}</b> · ${v.room.running ? '진행중' : '일시정지'}`;
    const host = $('#hostCtl');
    host.innerHTML = '';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = `btn tiny ${cls}`; b.textContent = label; b.onclick = fn; return b; };
    if (isHost) {
      host.append(v.room.running ? mk('일시정지', 'gray', () => this.call('/api/pause')) : mk(v.game.champion ? '새 게임' : '게임 시작', 'orange', () => this.call('/api/start')));
      host.append(mk('+봇', 'blue', () => this.call('/api/addbot')));
    }
    renderTable({
      game: v.game, me: v.me, legal: v.legal, isHost,
      onAction: (a) => this.call('/api/action', { action: a }),
      onKick: (id) => modal('<h2>내보낼까요?</h2>', [['취소', 'gray'], ['내보내기', 'red', () => this.call('/api/kick', { target: id })]]),
      waitingMsg: v.game.champion ? `🏆 <b>${esc(v.game.players.find((p) => p.id === v.game.champion)?.name || '')}</b> 최후의 1인${isHost ? ' · [새 게임]으로 다시' : ''}` : isHost ? `친구에게 방 코드 <b>${v.room.id}</b>를 알려주고 [게임 시작]을 누르세요` : '방장이 게임을 시작하길 기다리는 중…',
      showdownMsg: v.room.running ? '5초 후 다음 핸드…' : '일시정지됨 (방장이 재개하면 계속)',
      extraButtons: () => (v.game.mode !== 'death' && me.chips === 0 && !(Poker.isLive(v.game) && me.inHand)
        ? [mk('리바이', 'orange', () => this.call('/api/rebuy'))] : []),
    });
  },
  async call(path, extra = {}) {
    try { await api(path, { room: this.s.room, token: this.s.token, ...extra }); } catch (e) { toast(e.message); }
  },
  exit() {
    modal('<h2>나가기</h2><p>잠시 나가면 자리가 유지되고<br>메뉴의 [이어하기]로 돌아올 수 있습니다.</p>', [
      ['취소', 'gray'],
      ['잠시 나가기', 'blue', () => { this.es?.close(); show('menu'); }],
      ['방 떠나기', 'red', async () => { await this.call('/api/leave'); this.es?.close(); store.del(ONLINE_KEY); show('menu'); }],
    ]);
  },
};

$('#btnExit').onclick = () => (mode === 'online' ? Online.exit() : mode === 'preview' ? show('menu') : Practice.exit());

// auto-resume an online seat after a refresh
const saved = store.get(ONLINE_KEY);
if (saved && location.hash !== '#menu') Online.connect(saved);
else show('menu');
