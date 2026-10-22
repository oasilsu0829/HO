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
  if (typeof Celebrate !== 'undefined') { Celebrate.stop(); Duel.stop(); }
  if (typeof FX !== 'undefined') clearInterval(FX.clockT);
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
    if (this.lastHand !== null && g.handNo !== this.lastHand) {
      // shuffle, then a flick for every card dealt
      Sfx.riffle(0);
      const n = g.players.filter((p) => p.inHand).length;
      for (let i = 0; i < n * 2; i++) Sfx.flick(0.75 + i * 0.07, 0.25);
      this.lastBoard = 0;
    }
    // new board cards: flip each, with a sting on the late streets if I'm still in
    const bl = g.board.length;
    if (this.lastBoard != null && bl > this.lastBoard && g.handNo === this.lastHand) {
      Sfx.whoosh(0, 0.18);
      for (let i = 0; i < bl - this.lastBoard; i++) Sfx.flip(0.15 + i * 0.22);
      if (bl >= 4 && me.inHand && !me.folded) Sfx.sting(bl === 5 ? 45 : 48, 0.3);
    }
    this.lastBoard = bl;
    this.lastSeq = seq; this.lastHand = g.handNo;
    // my turn: a ding, then a clock if I sit on it
    const mine = Poker.isLive(g) && g.players[g.toAct]?.id === me.id;
    if (mine && !this.myTurn) {
      Sfx.ding(0.05);
      clearInterval(this.clockT);
      let k = 0;
      this.clockT = setInterval(() => { k++; if (k >= 6) Sfx.clock(0, k % 2); }, 1000);
    }
    if (!mine && this.myTurn) clearInterval(this.clockT);
    this.myTurn = mine;
    for (const line of fresh) {
      if (/올인/.test(line)) { this.sfx('rack'); setTimeout(() => { this.shake(false); this.stamp('ALL IN', 'var(--bone)'); }, 200); }
      else if (/레이즈|벳/.test(line)) { this.sfx('raise'); this.shake(false); const amt = +(line.match(/(\d+)$/) || [0, 0])[1]; Sfx.chips(Math.min(14, 3 + Math.round(amt / g.bb / 2)), 0.08); }
      else if (/ 콜 /.test(line)) { const amt = +(line.match(/(\d+)$/) || [0, 0])[1]; Sfx.chips(Math.min(10, 2 + Math.round(amt / g.bb / 3))); }
      else if (/체크/.test(line)) this.sfx('check');
      else if (/다이/.test(line)) { this.sfx('fold'); if (line.startsWith(me.name + ' ')) this.flash('rgba(0,0,0,.9)'); }
      else if (/승리/.test(line)) {
        const winners = g.result?.winners || [];
        const iWon = winners.some((w) => w.id === me.id);
        const big = winners.reduce((s, w) => s + w.amount, 0) >= g.bb * 20;
        const iWasIn = me.inHand && !me.folded;
        const delay = g.result?.uncontested ? 0 : Object.keys(g.result.hands).length * REVEAL_PER * 1000 + 300;
        const busted = bustedIn(g);
        const duel = Poker.duelMs(g);
        if (duel) setTimeout(() => Duel.play(g), delay);
        const celeb = Poker.celebMs(g);
        if (celeb) setTimeout(() => Celebrate.play(g), delay + duel);
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
        }, delay + duel + celeb);
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
// A tiny synth rack: everything goes through a compressor and a reverb so hits feel big.
const Sfx = {
  ac: null, bus: null, rev: null,
  init() {
    const ac = FX.audio(); if (!ac) return null;
    if (this.ac === ac && this.bus) return ac;
    this.ac = ac;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(ac.destination);
    this.bus = ac.createGain(); this.bus.gain.value = 0.9; this.bus.connect(comp);
    this.rev = ac.createConvolver();
    const len = ac.sampleRate * 2.4, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.rev.buffer = buf;
    const rg = ac.createGain(); rg.gain.value = 0.32; this.rev.connect(rg).connect(this.bus);
    return ac;
  },
  out(node, wet = 0.25) { node.connect(this.bus); if (wet) { const g = this.ac.createGain(); g.gain.value = wet; node.connect(g).connect(this.rev); } },
  hz: (m) => 440 * Math.pow(2, (m - 69) / 12),
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); },
  osc(type, f, t, dur, vol, { to, wet = 0.2, a = 0.004, filt } = {}) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.env(g, t, a, vol, dur);
    let n = o.connect(g);
    if (filt) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(filt[0], t); lp.frequency.exponentialRampToValueAtTime(filt[1], t + dur); n = g.connect(lp); }
    this.out(n, wet); o.start(t); o.stop(t + a + dur + 0.05);
  },
  noise(t, dur, vol, type, f0, f1, wet = 0.2) {
    const ac = this.ac, buf = ac.createBuffer(1, Math.max(1, ac.sampleRate * dur), ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf;
    const bq = ac.createBiquadFilter(); bq.type = type; bq.frequency.setValueAtTime(f0, t); if (f1) bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); this.env(g, t, 0.004, vol, dur);
    src.connect(bq).connect(g); this.out(g, wet); src.start(t); src.stop(t + dur + 0.05);
  },
  // instruments (t = seconds from now)
  play(fn) { const ac = this.init(); if (ac) fn(ac.currentTime); },
  boom(dt = 0, v = 1) { this.play((t) => { t += dt; this.osc('sine', 160, t, 0.7, v, { to: 30, wet: 0.05 }); this.noise(t, 0.04, v * 0.5, 'lowpass', 2000); }); },
  kick(dt = 0, v = 0.8) { this.play((t) => { t += dt; this.osc('sine', 120, t, 0.25, v, { to: 40, wet: 0 }); }); },
  snare(dt = 0, v = 0.5) { this.play((t) => { t += dt; this.noise(t, 0.18, v, 'bandpass', 1800); this.osc('triangle', 190, t, 0.1, v * 0.6); }); },
  crash(dt = 0, v = 0.5) { this.play((t) => { t += dt; this.noise(t, 1.6, v, 'highpass', 5000, 3000, 0.4); }); },
  bell(m, dt = 0, v = 0.35) { this.play((t) => { t += dt; const f = this.hz(m); this.osc('sine', f, t, 1.4, v, { wet: 0.5 }); this.osc('sine', f * 2.76, t, 0.5, v * 0.35, { wet: 0.5 }); this.osc('triangle', f / 2, t, 0.9, v * 0.5, { wet: 0.3 }); }); },
  stab(ms, dt = 0, dur = 0.5, v = 0.16) { this.play((t) => { t += dt; for (const m of ms) for (const d of [-9, 0, 9]) { const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = this.hz(m); o.detune.value = d; lp.type = 'lowpass'; lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(500, t + dur); this.env(g, t, 0.01, v, dur); o.connect(lp).connect(g); this.out(g, 0.35); o.start(t); o.stop(t + dur + 0.1); } this.osc('sine', this.hz(ms[0] - 24), t, dur, v * 2.2, { wet: 0 }); }); },
  coin(dt = 0, v = 0.22) { this.play((t) => { t += dt; this.osc('square', 1318, t, 0.06, v, { wet: 0.2 }); this.osc('square', 1760, t + 0.06, 0.35, v, { wet: 0.3 }); }); },
  riser(dt, dur, v = 0.35) { this.play((t) => { t += dt; this.noise(t, dur, v, 'bandpass', 300, 9000, 0.3); this.osc('sawtooth', 80, t, dur, v * 0.5, { to: 900, a: dur * 0.9, filt: [400, 6000] }); }); },
  whoosh(dt = 0, v = 0.4) { this.play((t) => { t += dt; this.noise(t, 0.35, v, 'bandpass', 600, 4000, 0.2); }); },
  siren(dt, dur, v = 0.18) { this.play((t) => { t += dt; const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(); o.type = 'sawtooth'; for (let k = 0; k < dur / 0.25; k++) o.frequency.setValueAtTime(k % 2 ? 660 : 880, t + k * 0.25); this.env(g, t, 0.02, v, dur); o.connect(g); this.out(g, 0.3); o.start(t); o.stop(t + dur + 0.1); }); },
  wobble(dt, dur, root = 33, v = 0.4) { this.play((t) => { t += dt; const ac = this.ac, o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = this.hz(root); lp.type = 'lowpass'; lp.Q.value = 12; lp.frequency.value = 400; lfo.frequency.value = 6; lg.gain.value = 900; lfo.connect(lg).connect(lp.frequency); this.env(g, t, 0.02, v, dur); o.connect(lp).connect(g); this.out(g, 0.1); o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1); }); },
  // table foley
  riffle(dt = 0) { this.play((t) => { t += dt; for (let i = 0; i < 16; i++) this.noise(t + i * 0.028 + Math.random() * 0.01, 0.025, 0.35, 'highpass', 3500, 0, 0.05); this.noise(t + 0.5, 0.12, 0.5, 'bandpass', 1200, 0, 0.1); }); },
  flick(dt = 0, v = 0.3) { this.play((t) => { t += dt; this.noise(t, 0.06, v, 'bandpass', 2600, 5200, 0.08); }); },
  flip(dt = 0, v = 0.35) { this.play((t) => { t += dt; this.noise(t, 0.09, v, 'bandpass', 1500, 4500, 0.15); this.osc('sine', 220, t + 0.05, 0.12, v * 0.7, { to: 110, wet: 0 }); }); },
  chips(n, dt = 0) { this.play((t) => { t += dt; for (let i = 0; i < n; i++) { const tt = t + i * 0.045 + Math.random() * 0.02; this.osc('triangle', 2400 + Math.random() * 900, tt, 0.05, 0.12, { wet: 0.1 }); this.noise(tt, 0.03, 0.12, 'highpass', 5000, 0, 0); } }); },
  ding(dt = 0) { this.bell(84, dt, 0.18); this.bell(91, dt + 0.12, 0.16); },
  clock(dt = 0, hi) { this.play((t) => { t += dt; this.osc('square', hi ? 1900 : 1400, t, 0.025, 0.07, { wet: 0 }); }); },
  click(dt = 0) { this.play((t) => { t += dt; this.osc('square', 900, t, 0.02, 0.06, { wet: 0 }); this.osc('square', 1300, t + 0.02, 0.02, 0.04, { wet: 0 }); }); },
  sting(m, dt = 0) { this.play((t) => { t += dt; this.osc('sawtooth', this.hz(m), t, 0.9, 0.08, { filt: [3000, 300], wet: 0.4 }); this.osc('sawtooth', this.hz(m + 1), t, 0.9, 0.06, { filt: [3000, 300], wet: 0.4 }); }); },
  drumroll(dt, dur, v = 0.25) { this.play((t) => { t += dt; for (let i = 0; i < dur / 0.045; i++) this.noise(t + i * 0.045, 0.04, v * (0.4 + 0.6 * i / (dur / 0.045)), 'bandpass', 900, 0, 0.1); }); },
  bwomp(dt = 0) { this.play((t) => { t += dt; this.osc('sawtooth', 147, t, 0.5, 0.18, { to: 98, filt: [1200, 300] }); }); },
  tick(i, dt = 0) { this.play((t) => { t += dt; this.osc('square', this.hz(72 + Math.min(24, i)), t, 0.05, 0.08, { wet: 0.1 }); }); },
};

const C = { // chord voicings (midi)
  I: [60, 64, 67, 72], IV: [65, 69, 72, 77], V: [67, 71, 74, 79], vi: [57, 60, 64, 69], i: [60, 63, 67, 72], bVI: [56, 60, 63, 68], bVII: [58, 62, 65, 70],
};

const Celebrate = {
  parts: [], raf: 0, cv: null, x: null, timers: [], anims: [],
  later(fn, at) { this.timers.push(setTimeout(fn, at)); },
  A(node, frames, opt) { if (!node) return; const a = node.animate(frames, { fill: 'both', ...opt }); this.anims.push(a); return a; },
  punch(s = 1.06, dur = 220) { const st = $('#stage'); if (st) st.animate([{ transform: 'scale(1)' }, { transform: `scale(${s})` }, { transform: 'scale(1)' }], { duration: dur, easing: 'cubic-bezier(.2,1.6,.4,1)' }); this.A($('#celeb .ccards'), [{ transform: 'scale(1)' }, { transform: `scale(${1 + (s - 1) * 2})` }, { transform: 'scale(1)' }], { duration: dur, fill: 'none' }); },
  ring(col = '#ffe08a', size = 1) { const r = document.createElement('div'); r.className = 'cring'; r.style.borderColor = col; $('#celeb').appendChild(r); this.A(r, [{ transform: 'translate(-50%,-50%) scale(.1)', opacity: 1 }, { transform: `translate(-50%,-50%) scale(${4 * size})`, opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.1,.8,.3,1)' }); this.later(() => r.remove(), 750); },
  crack(n = 1) { // jagged fracture lines on the "glass"
    const svg = $('#celeb .ccrack'); const W = innerWidth, H = innerHeight;
    for (let k = 0; k < n; k++) {
      let x = W * (0.2 + Math.random() * 0.6), y = H * (0.2 + Math.random() * 0.6); const pts = [[x, y]];
      const a = Math.random() * 6.28; for (let i = 0; i < 9; i++) { x += Math.cos(a + (Math.random() - 0.5) * 1.4) * 60; y += Math.sin(a + (Math.random() - 0.5) * 1.4) * 60; pts.push([x, y]); }
      svg.insertAdjacentHTML('beforeend', `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2"/><polyline points="${pts.map((p) => `${p[0] + 2},${p[1] + 1}`).join(' ')}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="2"/>`);
    }
  },
  bolt() {
    const svg = $('#celeb .ccrack'); const W = innerWidth, H = innerHeight;
    let x = W * (0.15 + Math.random() * 0.7), y = 0; const pts = [[x, y]];
    while (y < H * 0.75) { x += (Math.random() - 0.5) * 120; y += 40 + Math.random() * 50; pts.push([x, y]); }
    const id = 'b' + Math.random().toString(36).slice(2);
    svg.insertAdjacentHTML('beforeend', `<polyline id="${id}" points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="6" style="filter:drop-shadow(0 0 12px #9fd4ff)"/>`);
    this.later(() => document.getElementById(id)?.remove(), 160);
    FX.flash('rgba(220,235,255,.9)');
  },
  countUp(amount, dur, at, coins) {
    const el = $('#celeb .cnum'); if (!el) return;
    const steps = Math.min(30, Math.max(8, Math.round(dur / 60)));
    for (let i = 0; i <= steps; i++) this.later(() => {
      const v = Math.round(amount * Math.pow(i / steps, 1.6));
      el.textContent = '+$' + fmt(v);
      this.A(el, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 120, fill: 'none' });
      coins ? Sfx.coin(0, 0.12) : Sfx.tick(i);
      if (i === steps) { this.A(el, [{ transform: 'scale(2)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.3,1.8,.5,1)' }); Sfx.kick(0, 0.6); }
    }, at + (dur * i) / steps);
  },
  // ---- pixel particles ----
  spawn(kind, n, opt = {}) {
    const W = this.cv.width, H = this.cv.height;
    for (let i = 0; i < n; i++) {
      const p = { kind, x: opt.x ?? Math.random() * W, y: opt.y ?? -10 - Math.random() * H * 0.3, vx: (Math.random() - 0.5) * (opt.spread ?? 1.5), vy: opt.vy != null ? opt.vy * (0.55 + Math.random() * 0.9) : 0.6 + Math.random() * 1.6, life: opt.life ?? 240, g: opt.g ?? 0.04, size: opt.size ?? 3, col: Array.isArray(opt.col) ? opt.col[(Math.random() * opt.col.length) | 0] : opt.col, ch: opt.ch, rot: Math.random() * 6 };
      if (opt.burst) { const a = Math.random() * 6.28, sp = 0.8 + Math.random() * opt.burst; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; }
      this.parts.push(p);
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  },
  firework(col) { const W = this.cv.width, H = this.cv.height; this.parts.push({ kind: 'firework', x: W * (0.15 + Math.random() * 0.7), y: H, vx: (Math.random() - 0.5) * 0.6, vy: -3.8 - Math.random(), g: 0.05, life: 38 + (Math.random() * 15 | 0), size: 2, col }); if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); },
  tick() {
    const { x, cv } = this; x.clearRect(0, 0, cv.width, cv.height);
    this.parts = this.parts.filter((p) => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life--; p.rot += 0.12;
      if (p.kind === 'firework' && p.life <= 0) { this.spawn('spark', 46, { x: p.x, y: p.y, burst: 2.8, g: 0.03, life: 70, col: p.col, size: 2 }); Sfx.snare(0, 0.25); return false; }
      if (p.life <= 0 || p.y > cv.height + 20) return false;
      x.globalAlpha = Math.min(1, p.life / 40);
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
    this.anims.forEach((a) => { try { a.cancel(); } catch {} }); this.anims = [];
    this.parts = [];
    const el = $('#celeb'); if (el) { el.hidden = true; el.className = ''; el.querySelector('.ccrack').innerHTML = ''; }
    document.body.classList.remove('fx-glitch', 'fx-tilt');
  },

  play(g) {
    const best = Poker.bestWin(g);
    if (!best) return 0;
    this.stop();
    Sfx.init();
    const tier = Poker.celebTier(best.h.score);
    const ms = Poker.CELEB_MS[tier];
    const el = $('#celeb');
    this.cv = $('#celebFx'); this.x = this.cv.getContext('2d');
    this.cv.width = Math.round(innerWidth / 4); this.cv.height = Math.round(innerHeight / 4);
    const W = this.cv.width, H = this.cv.height;
    const cards = best.h.cards, core = coreCards(cards, best.h.score);
    const order = tier >= 8 ? cards.slice().reverse() : cards; // straight flushes rise low to high (A-2-3-4-5, 10-J-Q-K-A)
    const NAMES = ['HIGH CARD', 'ONE PAIR', 'TWO PAIR', 'THREE OF A KIND', 'STRAIGHT', 'FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH', 'ROYAL FLUSH'];
    const letters = (t) => t.split('').map((c, i) => `<i style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</i>`).join('');
    el.className = `t${tier}`; el.hidden = false; el.style.setProperty('--dur', ms + 'ms');
    const suit = cards[0][1];
    el.style.setProperty('--suit', { s: '#c9c2a8', c: '#7fbf6a', h: '#ff3a2a', d: '#ff8a2a' }[suit]);
    el.querySelector('.cbig').textContent = SUIT_CH[suit];
    el.querySelector('.ctitle').innerHTML = tier === 0 ? `<span class="ko">${best.h.name}</span>` : `<span class="big">${letters(NAMES[tier])}</span><span class="ko">${tier === 9 ? '로 티 플 !!!' : best.h.name}</span>`;
    el.querySelector('.csub').innerHTML = `${esc(best.w.name)} <span class="cnum">+$0</span>`;
    el.querySelector('.ccards').innerHTML = tier === 0 ? '' : order.map((c, i) => `<span class="cc ${core.has(c) ? 'core' : 'kicker'}" style="--i:${i}">${cardHTML(c, 'lg')}</span>`).join('');
    el.querySelectorAll('*').forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
    const cc = [...el.querySelectorAll('.cc')], coreEls = cc.filter((n) => n.classList.contains('core'));
    const title = el.querySelector('.ctitle'), big = el.querySelector('.ctitle .big'), ltr = [...el.querySelectorAll('.ctitle .big i')];
    const S = typeof Scene3D !== 'undefined' ? Scene3D : null;
    const BOUNCE = 'cubic-bezier(.3,1.9,.5,1)';
    const dealIn = (stagger = 70, from = 'translateY(-160px) rotate(-25deg) scale(.5)') => cc.forEach((n, i) => this.A(n, [{ transform: from, opacity: 0 }, { transform: 'translateY(10px) scale(1.15,.85)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: i * stagger, easing: BOUNCE }));
    const titleIn = (at = 300) => { ltr.forEach((n, i) => this.A(n, [{ transform: 'translateY(40px) scale(.3,1.8)', opacity: 0 }, { transform: 'translateY(-14px) scale(1.25,.75)', opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: at + i * 38, easing: BOUNCE })); this.A(el.querySelector('.ctitle .ko'), [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 400, delay: at + 250, easing: BOUNCE }); };
    const clack = (a, b, at, note, col) => { // two cards lean in and smash together
      this.A(a, [{ transform: 'none' }, { transform: 'translateX(26px) rotate(14deg) translateY(-26px)', offset: 0.5 }, { transform: 'translateY(-14px)' }], { duration: 380, delay: at, easing: BOUNCE });
      this.A(b, [{ transform: 'none' }, { transform: 'translateX(-26px) rotate(-14deg) translateY(-26px)', offset: 0.5 }, { transform: 'translateY(-14px)' }], { duration: 380, delay: at, easing: BOUNCE });
      this.later(() => { Sfx.bell(note, 0, 0.4); Sfx.boom(0, 0.5); Sfx.snare(0, 0.35); this.punch(1.03); const r = a.getBoundingClientRect(); this.spawn('spark', 26, { x: (r.right / 4), y: (r.top + r.height / 2) / 4, burst: 2.4, col: col || '#ffe08a', life: 40 }); }, at + 190);
    };
    // dim the felt behind
    this.A(el.querySelector('.cbg'), [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: ms });
    this.A(el, [{ opacity: 1 }, { opacity: 1, offset: 0.93 }, { opacity: 0 }], { duration: ms, fill: 'none' });

    switch (tier) {
      case 0: // deadpan
        this.A(title, [{ transform: 'translateY(-20px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: BOUNCE });
        Sfx.bwomp(0.05);
        this.countUp(best.w.amount, 300, 200);
        break;

      case 1: // a clean, satisfying clack
        dealIn(60); titleIn(250);
        Sfx.bell(72, 0.05, 0.25); Sfx.bell(76, 0.12, 0.2);
        clack(coreEls[0], coreEls[1], 650, 79);
        this.later(() => Sfx.stab(C.I, 0, 0.6, 0.1), 900);
        this.countUp(best.w.amount, 700, 1000);
        break;

      case 2: { // two clacks, two punches
        dealIn(55); titleIn(250);
        const pairs = []; const val = (n) => n.textContent.trim()[0];
        coreEls.forEach((n) => { const p = pairs.find((q) => val(q[0]) === val(n) && q.length < 2); p ? p.push(n) : pairs.push([n]); });
        clack(pairs[0][0], pairs[0][1], 600, 76);
        if (pairs[1]) clack(pairs[1][0], pairs[1][1], 1000, 83);
        this.later(() => { Sfx.stab(C.IV, 0, 0.35, 0.12); Sfx.stab(C.I, 0.22, 0.6, 0.14); Sfx.kick(0.22); this.punch(1.05); }, 1350);
        this.later(() => coreEls.forEach((n, i) => this.A(n, [{ transform: 'translateY(-14px)' }, { transform: 'translateY(-40px) scale(.9,1.15)', offset: 0.4 }, { transform: 'translateY(-14px) scale(1.15,.85)', offset: 0.75 }, { transform: 'translateY(-14px)' }], { duration: 420, delay: i * 50, iterations: 2, fill: 'forwards' })), 1350);
        this.countUp(best.w.amount, 800, 1500);
        break;
      }

      case 3: // three hammer blows that crack the screen
        cc.forEach((n) => this.A(n, [{ opacity: 0 }, { opacity: n.classList.contains('core') ? 0 : 1 }], { duration: 200 }));
        titleIn(1500);
        coreEls.forEach((n, k) => {
          this.A(n, [{ transform: 'translateY(-60px) scale(3.2) rotate(-10deg)', opacity: 0 }, { transform: 'translateY(8px) scale(1.2,.8)', opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }], { duration: 360, delay: 450 + k * 300, easing: 'cubic-bezier(.5,0,.6,1.6)' });
          this.later(() => { Sfx.boom(0, 0.9); Sfx.bell(55 + k * 4, 0, 0.3); this.punch(1.07, 260); this.crack(2); FX.shake(k === 2); this.spawn('spark', 30, { x: W / 2, y: H * 0.55, burst: 3, col: '#c9c2a8', g: 0.08 }); }, 450 + k * 300 + 200);
        });
        this.later(() => { Sfx.stab(C.i, 0, 0.8, 0.16); Sfx.crash(0, 0.4); this.ring('#fff'); }, 1450);
        this.countUp(best.w.amount, 900, 1700);
        break;

      case 4: // riser, dominoes, DROP
        el.classList.add('speed');
        Sfx.riser(0, 1.3);
        cc.forEach((n, i) => { this.A(n, [{ transform: 'translateX(-120vw) skewX(-25deg)', opacity: 1 }, { transform: 'translateX(14px) skewX(10deg)', offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 150 + i * 190, easing: 'cubic-bezier(.2,.9,.3,1.3)' }); this.later(() => { Sfx.whoosh(0, 0.25); Sfx.bell(67 + [0, 2, 4, 7, 9][i], 0, 0.3); }, 150 + i * 190 + 250); });
        titleIn(1300);
        this.later(() => { Sfx.boom(0, 1); Sfx.stab(C.I, 0, 0.9, 0.18); Sfx.crash(0, 0.5); this.punch(1.1, 300); this.ring('#ffe08a', 1.5); el.classList.remove('speed'); this.spawn('spark', 70, { x: W / 2, y: H * 0.55, burst: 4, col: ['#ffe08a', '#fff'] }); }, 1350);
        this.later(() => cc.forEach((n, i) => this.A(n, [{ transform: 'none' }, { transform: 'translateY(-34px) rotate(-8deg)', offset: 0.4 }, { transform: 'none' }], { duration: 380, delay: i * 70, iterations: 3, fill: 'none' })), 1500);
        [0, 0.4, 0.8].forEach((d) => Sfx.kick(1.55 + d, 0.5));
        this.countUp(best.w.amount, 1000, 1900);
        break;

      case 5: // a giant suit rises on spinning rays; cards cartwheel; harp + choir
        el.classList.add('rays');
        this.A(el.querySelector('.cbig'), [{ transform: 'translate(-50%,-50%) scale(0) rotate(-180deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.3) rotate(10deg)', opacity: .9, offset: 0.6 }, { transform: 'translate(-50%,-50%) scale(1) rotate(0)', opacity: .8 }], { duration: 900, delay: 200, easing: BOUNCE });
        this.A(el.querySelector('.cwipe'), [{ transform: 'translateX(-110%) skewX(-20deg)' }, { transform: 'translateX(110%) skewX(-20deg)' }], { duration: 600, easing: 'ease-in-out' });
        for (let k = 0; k < 14; k++) Sfx.bell(60 + [0, 4, 7, 11, 12, 16, 19, 23, 24, 28, 31, 35, 36, 40][k], 0.05 + k * 0.045, 0.22);
        cc.forEach((n, i) => this.A(n, [{ transform: 'perspective(400px) rotateY(720deg) scale(.3)', opacity: 0 }, { transform: 'perspective(400px) rotateY(0) scale(1.15)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 800, delay: 300 + i * 110, easing: 'cubic-bezier(.2,.8,.3,1.2)' }));
        titleIn(900);
        this.later(() => { Sfx.boom(0, 0.9); Sfx.stab(C.vi, 0, 0.4, 0.13); Sfx.stab(C.IV, 0.35, 0.4, 0.13); Sfx.stab(C.I, 0.7, 1.4, 0.15); Sfx.crash(0.7, 0.4); this.punch(1.08, 300); this.spawn('suit', 90, { ch: SUIT_CH[suit], col: getComputedStyle(el).getPropertyValue('--suit').trim(), size: 4 }); }, 1500);
        this.later(() => { this.punch(1.05); this.spawn('suit', 60, { ch: SUIT_CH[suit], col: '#fff', size: 3 }); }, 2200);
        this.countUp(best.w.amount, 1100, 2100);
        break;

      case 6: { // slot reels lock in letter by letter, then a coin geyser
        FX.blackout(true); this.later(() => FX.blackout(false), 250);
        el.classList.add('rays', 'gold');
        const GLY = 'ABCDEFGHJKLMNOPQRSTUVWXYZ$#%7♠♥♦♣';
        ltr.forEach((n, i) => { const fin = n.innerHTML; if (fin === '&nbsp;') return; this.A(n, [{ opacity: 1 }, { opacity: 1 }], { duration: 10 }); const spin = setInterval(() => (n.textContent = GLY[(Math.random() * GLY.length) | 0]), 50); this.timers.push(spin); this.later(() => { clearInterval(spin); n.innerHTML = fin; this.A(n, [{ transform: 'scale(1.8,.5)', color: '#fff' }, { transform: 'none' }], { duration: 260, easing: BOUNCE }); Sfx.coin(0, 0.14); Sfx.kick(0, 0.3); }, 400 + i * 85); });
        this.A(el.querySelector('.ctitle .ko'), [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 400, delay: 1400, easing: BOUNCE });
        cc.forEach((n, i) => { this.A(n, [{ transform: 'translateY(-90vh)', opacity: 1 }, { transform: 'translateY(12px) scale(1.2,.8)', offset: 0.75 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: 1500 + i * 130, easing: 'cubic-bezier(.5,0,.7,1)' }); this.later(() => { Sfx.kick(0, 0.7); FX.shake(false); }, 1500 + i * 130 + 290); });
        this.later(() => {
          Sfx.boom(0, 1); Sfx.crash(0, 0.5); Sfx.stab(C.I, 0, 0.3, 0.16); Sfx.stab(C.V, 0.3, 0.3, 0.16); Sfx.stab(C.I, 0.6, 1.2, 0.18);
          for (let k = 0; k < 10; k++) Sfx.coin(k * 0.07, 0.15);
          this.punch(1.12, 320); this.ring('#ffd84a', 2); FX.shake(true);
          this.spawn('coin', 140, { x: W / 2, y: H * 0.6, vy: -4.2, spread: 4.5, g: 0.08, size: 3 });
        }, 2250);
        this.later(() => this.spawn('coin', 90, { x: W / 2, y: H * 0.6, vy: -3.6, spread: 5, g: 0.08 }), 2900);
        S && S.hype(6, ms / 1000);
        this.countUp(best.w.amount, 1300, 2500, true);
        break;
      }

      case 7: // alarm, lightning on each of the four, the glass breaks
        S && S.hype(7, ms / 1000);
        FX.blackout(true); this.later(() => FX.blackout(false), 500);
        el.classList.add('alarm');
        Sfx.siren(0.1, 2.6);
        cc.forEach((n) => { if (!n.classList.contains('core')) this.A(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 400 }); else this.A(n, [{ opacity: 0 }, { opacity: 0 }], { duration: 10 }); });
        coreEls.forEach((n, k) => {
          const at = 800 + k * 480;
          this.later(() => { this.bolt(); Sfx.noise && Sfx.play((t) => Sfx.noise(t, 0.25, 0.8, 'highpass', 2000)); Sfx.boom(0, 1); Sfx.bell(48 + k * 5, 0, 0.45); FX.shake(k === 3); this.crack(3); this.punch(1.09, 260); }, at);
          this.A(n, [{ transform: 'translateY(-80vh) scale(2)', opacity: 0, filter: 'brightness(5)' }, { transform: 'translateY(10px) scale(1.25,.75)', opacity: 1, filter: 'brightness(3)', offset: 0.6 }, { transform: 'none', opacity: 1, filter: 'none' }], { duration: 300, delay: at - 120, easing: 'cubic-bezier(.6,0,.8,1)' });
        });
        // the title flies in shattered
        ltr.forEach((n, i) => this.A(n, [{ transform: `translate(${(Math.random() - 0.5) * 900}px, ${(Math.random() - 0.5) * 600}px) rotate(${(Math.random() - 0.5) * 720}deg) scale(3)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 2900 + i * 20, easing: 'cubic-bezier(.2,1.4,.4,1)' }));
        this.A(el.querySelector('.ctitle .ko'), [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 400, delay: 3300, easing: BOUNCE });
        this.later(() => { el.classList.remove('alarm'); Sfx.boom(0, 1); Sfx.crash(0, 0.6); Sfx.stab(C.i, 0, 0.35, 0.18); Sfx.stab(C.bVI, 0.35, 0.35, 0.18); Sfx.stab(C.I, 0.7, 1.4, 0.2); this.punch(1.15, 360); this.ring('#ff3a2a', 2); this.spawn('spark', 160, { x: W / 2, y: H * 0.5, burst: 5, g: 0.05, col: ['#ff3a2a', '#ff8a2a', '#ffe08a'] }); }, 3050);
        this.countUp(best.w.amount, 1300, 3400, true);
        break;

      case 8: // glitch storm, orbiting cards, wobble drop
        S && S.hype(8, ms / 1000);
        document.body.classList.add('fx-glitch');
        Sfx.riser(0, 2.4, 0.4); Sfx.wobble(0.3, 2.0, 31, 0.35);
        cc.forEach((n, i) => { const a0 = (i / cc.length) * 360; this.A(n, Array.from({ length: 9 }, (_, k) => ({ transform: `rotate(${a0 + k * 90}deg) translateY(-${200 - k * 14}px) rotate(${-(a0 + k * 90)}deg) scale(${0.6 + k * 0.05})`, opacity: k ? 1 : 0 })).concat([{ transform: 'none', opacity: 1 }]), { duration: 2300, delay: 100, easing: 'ease-in' }); });
        for (let k = 0; k < 8; k++) this.later(() => { Sfx.whoosh(0, 0.2); Sfx.bell(64 + k * 2, 0, 0.18); }, 200 + k * 260);
        titleIn(2400);
        this.later(() => {
          document.body.classList.remove('fx-glitch'); el.classList.add('rays', 'rainbow');
          FX.flash('rgba(255,255,255,1)'); Sfx.boom(0, 1); Sfx.boom(0.12, 0.8); Sfx.crash(0, 0.6);
          Sfx.stab(C.vi, 0, 0.3, 0.17); Sfx.stab(C.IV, 0.3, 0.3, 0.17); Sfx.stab(C.V, 0.6, 0.3, 0.17); Sfx.stab(C.I, 0.9, 1.6, 0.2);
          this.punch(1.2, 400); this.ring('#5fd4ff', 2.5); FX.shake(true);
          for (let k = 0; k < 4; k++) this.later(() => { this.firework(['#ff4a3a', '#ffd84a', '#5fd4ff', '#9fff7a'][k]); this.punch(1.05); Sfx.kick(0, 0.6); }, k * 300);
          this.spawn('coin', 80, { x: W / 2, y: H, vy: -5, spread: 4, g: 0.09 });
        }, 2450);
        this.later(() => cc.forEach((n, i) => this.A(n, [{ transform: 'none' }, { transform: 'translateY(-40px) scale(.9,1.15)', offset: 0.4 }, { transform: 'scale(1.15,.85)', offset: 0.75 }, { transform: 'none' }], { duration: 300, delay: i * 40, iterations: 5, fill: 'none' })), 2700);
        this.countUp(best.w.amount, 1600, 2900, true);
        break;

      case 9: { // the whole circus
        S && S.hype(9, (ms - 1500) / 1000);
        FX.tense(false); FX.drone(0);
        el.classList.add('royal');
        Sfx.kick(0.3, 0.5); Sfx.kick(0.6, 0.5); // heartbeat in the dark
        cc.forEach((n, i) => {
          const at = 1200 + i * 420;
          this.A(n, [{ transform: 'translateY(200px) scale(.4)', opacity: 0, filter: 'brightness(.2)' }, { transform: 'translateY(-40px) scale(1.3,.8)', opacity: 1, filter: 'brightness(2.2) drop-shadow(0 0 30px #ffd84a)', offset: 0.6 }, { transform: 'none', opacity: 1, filter: 'brightness(1.25) drop-shadow(0 0 16px #ffd84a)' }], { duration: 600, delay: at, easing: BOUNCE });
          this.later(() => { Sfx.bell(60 + [0, 4, 7, 12, 16][i], 0, 0.5); Sfx.boom(0, 0.5); this.punch(1.03); this.spawn('spark', 24, { x: W * (0.3 + i * 0.1), y: H * 0.55, burst: 2, col: '#ffd84a', life: 50 }); }, at + 250);
        });
        Sfx.riser(3.1, 1.1, 0.5);
        this.later(() => { // DROP
          el.classList.add('rays', 'gold');
          FX.flash('rgba(255,240,180,1)'); FX.shake(true); Sfx.boom(0, 1); Sfx.crash(0, 0.7);
          this.ring('#ffd84a', 3); this.punch(1.2, 450);
          this.spawn('confetti', 200, { col: ['#ffd84a', '#ff4a3a', '#e8e2c8', '#5fd4ff', '#9fff7a'] });
          this.spawn('coin', 120, { x: W / 2, y: H, vy: -5.5, spread: 6, g: 0.09 });
        }, 4200);
        titleIn(4250);
        // brass fanfare on the beat, the screen pulses with it
        const prog = [C.I, C.I, C.IV, C.IV, C.V, C.V, C.bVI, C.bVII, C.I];
        prog.forEach((ch, k) => {
          const at = 4200 + k * 380;
          this.later(() => { Sfx.stab(ch, 0, k === prog.length - 1 ? 2 : 0.32, 0.17); Sfx.kick(0, 0.8); if (k % 2) Sfx.snare(0, 0.4); this.punch(k === prog.length - 1 ? 1.18 : 1.06, 240); if (k % 2) this.firework(['#ffd84a', '#ff4a3a', '#5fd4ff', '#9fff7a', '#ff8adf'][k % 5]); if (k === prog.length - 1) { Sfx.crash(0, 0.7); FX.shake(true); this.ring('#fff', 3); } }, at);
        });
        for (let k = 0; k < 14; k++) this.later(() => Sfx.coin(0, 0.1), 4300 + k * 170);
        this.later(() => this.spawn('suit', 120, { ch: '♠', col: '#ffd84a', size: 4 }), 5200);
        this.later(() => { document.body.classList.add('fx-glitch'); this.later(() => document.body.classList.remove('fx-glitch'), 500); }, 6900);
        this.later(() => cc.forEach((n, i) => this.A(n, [{ transform: 'none' }, { transform: 'translateY(-50px) rotate(-10deg) scale(.9,1.15)', offset: 0.4 }, { transform: 'scale(1.15,.85)', offset: 0.75 }, { transform: 'none' }], { duration: 380, delay: i * 45, iterations: 8, fill: 'none' })), 4300);
        this.countUp(best.w.amount, 2400, 4600, true);
        break;
      }
    }
    this.later(() => this.stop(), ms);
    return ms;
  },
};

// ---------- close calls: same rank, so compare kicker by kicker, slowly ----------
function tieLabels(cat, n) {
  const L = {
    0: ['최고 카드', '2번째', '3번째', '4번째', '5번째'], 5: ['최고 카드', '2번째', '3번째', '4번째', '5번째'],
    1: ['페어', '키커 1', '키커 2', '키커 3'], 2: ['높은 페어', '낮은 페어', '키커'], 3: ['트리플', '키커 1', '키커 2'],
    4: ['꼭대기'], 8: ['꼭대기'], 6: ['트리플', '페어'], 7: ['포카드', '키커'],
  }[cat] || [];
  return Array.from({ length: n }, (_, i) => L[i] || `#${i + 1}`);
}
const Duel = {
  timers: [],
  later(fn, at) { this.timers.push(setTimeout(fn, at)); },
  stop() { this.timers.forEach(clearTimeout); this.timers = []; const el = $('#duel'); if (el) el.hidden = true; },
  play(g) {
    const d = Poker.duelInfo(g); if (!d) return 0;
    this.stop(); Sfx.init();
    const el = $('#duel'), H = g.result.hands;
    const name = (id) => esc(g.players.find((p) => p.id === id)?.name || '');
    const ws = H[d.wid].score, ls = H[d.lid].score, cat = ws[0];
    const labels = tieLabels(cat, ws.length - 1);
    const rows = labels.map((lab, i) => `<div class="drow" data-i="${i + 1}"><span class="dl">${rankName(ws[i + 1])}</span><span class="dlab">${lab}</span><span class="dr">${rankName(ls[i + 1])}</span></div>`).join('');
    el.innerHTML = `<div class="dhead">접 전</div>
      <div class="dsub">둘 다 <b>${H[d.wid].name}</b></div>
      <div class="dvs"><div class="dside L"><div class="dname">${name(d.wid)}</div><div class="dcards">${H[d.wid].cards.map((c) => cardHTML(c, 'sm')).join('')}</div></div>
      <div class="dmid">VS</div>
      <div class="dside R"><div class="dname">${name(d.lid)}</div><div class="dcards">${H[d.lid].cards.map((c) => cardHTML(c, 'sm')).join('')}</div></div></div>
      <div class="drows">${rows}</div>`;
    el.hidden = false;
    el.className = '';
    // heartbeat into the comparison
    Sfx.kick(0.1, 0.6); Sfx.kick(0.4, 0.5); Sfx.sting(48, 0.1);
    if (typeof Scene3D !== 'undefined') Scene3D.shake(false);
    FX.tense(true);
    const STEP = Poker.DUEL_STEP;
    for (let i = 1; i <= d.depth; i++) {
      const at = 1300 + (i - 1) * STEP;
      const row = el.querySelector(`.drow[data-i="${i}"]`);
      const decided = !d.tie && i === d.depth;
      Sfx.drumroll((at - 520) / 1000, 0.5, decided ? 0.35 : 0.22);
      this.later(() => {
        row.classList.add('show');
        if (decided) {
          row.classList.add('win');
          el.classList.add('decided');
          Sfx.boom(0, 1); Sfx.crash(0, 0.4); Sfx.bell(72, 0, 0.4);
          FX.flash('rgba(255,224,138,.5)'); FX.shake(true);
          if (typeof Celebrate !== 'undefined') Celebrate.punch && Celebrate.punch(1.06);
        } else {
          row.classList.add('eq');
          Sfx.snare(0, 0.3); Sfx.bell(60 + i * 2, 0, 0.2);
        }
      }, at);
    }
    this.later(() => {
      FX.tense(false);
      if (d.tie) { el.classList.add('tie'); Sfx.bwomp(0); Sfx.stab([60, 65, 67], 0.1, 0.8, 0.12); }
      else el.querySelector('.dside.R').classList.add('lose');
    }, 1300 + d.depth * STEP);
    this.later(() => (el.hidden = true), Poker.duelMs(g));
    return Poker.duelMs(g);
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
  order.forEach((id, i) => {
    const d = i * REVEAL_PER;
    for (let j = 0; j < 5; j++) Sfx.flip(d + j * 0.09, 0.22);
    const cat = hands[id].score[0];
    Sfx.bell(60 + cat * 2, d + 0.55, 0.22 + cat * 0.02);
    if (winIds.has(id)) Sfx.kick(d + 0.8, 0.5);
  });
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

document.addEventListener('pointerdown', (e) => { if (e.target.closest('.btn')) Sfx.click(); });

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
      const revealMs = (g.result && !g.result.uncontested ? Object.keys(g.result.hands).length * REVEAL_PER * 1000 + 2600 : 1500) + execMs + Poker.celebMs(g) + Poker.duelMs(g);
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
      this.timer = setTimeout(() => this.next(), 5000 + reveal + Poker.celebMs(g) + Poker.duelMs(g) + (bustedIn(g).length ? EXEC_MS : 0));
    }
  },
  next() {
    clearTimeout(this.timer);
    FX.blackout(false);
    Celebrate.stop(); Duel.stop();
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
const CELEB_LABELS = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스티플', '로티플'];
const CELEB_HANDS = [['As', 'Jd', '8c', '6h', '3s', '2d', '9c'], ['Ah', 'Ad', 'Kc', '9s', '5h', '3d', '2c'], ['Kh', 'Kd', '7c', '7s', 'Ah', '3d', '2c'], ['Qh', 'Qd', 'Qs', '9c', '5h', '3d', '2c'],
  ['9h', '8d', '7c', '6s', '5h', '2d', 'Kc'], ['Ah', 'Jh', '8h', '5h', '2h', 'Kd', '3c'], ['Kh', 'Kd', 'Kc', '7s', '7h', '3d', '2c'], ['9h', '9d', '9c', '9s', '5h', '3d', '2c'],
  ['9s', '8s', '7s', '6s', '5s', '2d', 'Kc'], ['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']];
const Preview = {
  g: null, pov: 'them', busy: false, tab: 'exec',
  enter() {
    mode = 'preview';
    const g = Poker.createGame({});
    Poker.addPlayer(g, { id: 'me', name: store.get(NAME_KEY) || '나' });
    Poker.addPlayer(g, { id: 'victim', name: '희생양', bot: true });
    this.g = g;
    show('table');
    $('#roomInfo').innerHTML = '<b>연출 미리보기</b><span class="wide-only"> · 아무것도 걸려있지 않아요</span>';
    $('#hostCtl').innerHTML = '';
    this.render();
  },
  render() {
    const mk = (label, cls, fn, disabled) => { const b = document.createElement('button'); b.className = `btn ${cls}`; b.textContent = label; b.onclick = fn; b.disabled = !!disabled; return b; };
    renderTable({
      game: Poker.viewFor(this.g, 'me'), me: 'me', legal: null,
      waitingMsg: this.busy ? '…' : this.tab === 'celeb' ? '보고 싶은 족보를 고르세요' : `처형 방식을 고르세요 · 시점: <b>${this.pov === 'me' ? '1인칭 (내가 당함)' : '지켜보기'}</b>`,
      extraButtons: () => this.tab === 'celeb' ? [
        mk('처형 보기', 'gray', () => { this.tab = 'exec'; this.render(); }, this.busy),
        ...CELEB_LABELS.map((label, tier) => mk(label, tier >= 7 ? 'orange' : tier >= 4 ? 'blue' : 'gray', () => this.celeb(tier), this.busy)),
        mk('접전 ⚔', 'red', () => this.duel(), this.busy),
        mk('전부 ▶', 'red', () => this.celebAll(), this.busy),
      ] : [
        mk('결산 연출 보기', 'orange', () => { this.tab = 'celeb'; this.render(); }, this.busy),
        ...EXECUTIONS.map((m) => mk(EXEC_NAMES[m], 'red', () => this.run(m), this.busy)),
        mk(this.pov === 'me' ? '시점: 1인칭' : '시점: 지켜보기', 'blue', () => { this.pov = this.pov === 'me' ? 'them' : 'me'; this.render(); }, this.busy),
        mk('테이블 청소', 'gray', () => Scene3D.clearStains(), this.busy),
      ],
    });
  },
  // fake a showdown for each tier, one after another
  fakeShowdown(tier) {
    const h = Poker.bestHand(CELEB_HANDS[tier]);
    return { result: { uncontested: false, winners: [{ id: 'victim', name: '희생양', amount: 100 * (tier + 1) * (tier + 1) }], hands: { victim: { name: h.name, cards: h.cards, score: h.score } } } };
  },
  celeb(tier) {
    if (this.busy) return;
    this.busy = true; this.render();
    FX.audio(); // the tap unlocks sound on phones
    Celebrate.play(this.fakeShowdown(tier));
    setTimeout(() => { this.busy = false; if (mode === 'preview') this.render(); }, Poker.CELEB_MS[tier] + 300);
  },
  duel() { // two aces each, decided on the third kicker
    if (this.busy) return;
    this.busy = true; this.render(); FX.audio();
    const A = Poker.bestHand(['Ah', 'Ad', 'Kc', 'Qs', '9h', '4d', '2c']), B = Poker.bestHand(['As', 'Ac', 'Kd', 'Qh', '7s', '4d', '2c']);
    const fake = { players: [{ id: 'victim', name: '희생양' }, { id: 'me', name: store.get(NAME_KEY) || '나' }],
      result: { uncontested: false, winners: [{ id: 'victim', name: '희생양', amount: 640 }], hands: { victim: { name: A.name, cards: A.cards, score: A.score }, me: { name: B.name, cards: B.cards, score: B.score } } } };
    const dm = Duel.play(fake);
    setTimeout(() => Celebrate.play(fake), dm);
    setTimeout(() => { this.busy = false; if (mode === 'preview') this.render(); }, dm + Poker.celebMs(fake) + 300);
  },
  celebAll() {
    this.busy = true; this.render();
    FX.audio();
    let at = 0;
    CELEB_HANDS.forEach((_, tier) => {
      setTimeout(() => { if (mode === 'preview') Celebrate.play(this.fakeShowdown(tier)); }, at);
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
      const wait = (v.game.result && !v.game.result.uncontested ? Object.keys(v.game.result.hands).length * REVEAL_PER * 1000 + EXEC_MS + 2600 : EXEC_MS + 1500) + Poker.celebMs(v.game) + Poker.duelMs(v.game);
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
