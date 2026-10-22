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
  if (id !== 'table' && typeof FX !== 'undefined') { FX.tense(false); FX.lastSeq = null; FX.lastHand = null; }
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
  },
  shake(big) {
    if (typeof Scene3D !== 'undefined') Scene3D.shake(big);
    if (navigator.vibrate) try { navigator.vibrate(big ? [80, 40, 160] : 40); } catch {}
  },
  flash(color) {
    const f = $('#flash'); f.style.background = color;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  },
  stamp(text, color) {
    const s = $('#stamp'); s.textContent = text; s.style.color = color || '';
    s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
  },
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
        // someone who shoved and lost takes the shot
        const shotLoser = g.players.some((p) => p.allIn && p.inHand && !p.folded && !winners.some((w) => w.id === p.id));
        const delay = g.result?.uncontested ? 0 : 900;
        setTimeout(() => {
          if (iWasIn && !iWon && me.allIn) {
            this.sfx('blast'); this.shake(true); this.flash('rgba(210,48,31,.85)'); this.stamp('탕!');
          } else if (iWon) {
            if (me.allIn) this.sfx('click');
            setTimeout(() => { this.sfx('win'); this.flash('rgba(216,160,58,.5)'); if (big) this.stamp('JACKPOT', 'var(--amber)'); }, me.allIn ? 450 : 0);
            if (shotLoser) setTimeout(() => { this.sfx('blast'); this.shake(false); }, me.allIn ? 0 : 200);
          } else {
            if (shotLoser) { this.sfx('blast'); this.shake(true); }
            if (iWasIn) { this.sfx('lose'); this.flash('rgba(143,29,20,.5)'); }
          }
        }, delay);
        break;
      }
    }
    // heartbeat when the decision is heavy: big call relative to stack, or someone is all-in against you
    const myTurn = g.players[g.toAct]?.id === me.id;
    const toCall = myTurn ? g.currentBet - me.bet : 0;
    const allInVsMe = Poker.isLive(g) && me.inHand && !me.folded && g.players.some((p) => p.allIn && !p.folded && p.inHand);
    this.tense(Poker.isLive(g) && ((myTurn && toCall > 0 && toCall >= me.chips * 0.3) || allInVsMe || (me.allIn && !me.folded)));
  },
};
const syncSound = () => ($('#btnSound').textContent = FX.on ? '소리 ON' : '소리 OFF');
$('#btnSound').onclick = () => { FX.on = !FX.on; store.set('ho.sound', FX.on); if (!FX.on) FX.tense(false); syncSound(); };
syncSound();

// ---------- rendering ----------
function cardHTML(c, size = '', extra = '') {
  if (!c) return `<div class="card empty ${size}"></div>`;
  if (c === '??') return `<div class="card back ${size}"></div>`;
  const r = c[0] === 'T' ? '10' : c[0];
  return `<div class="card suit-${c[1]} ${size} ${extra}"><span class="r">${r}</span><span class="s1">${SUIT_CH[c[1]]}</span><span class="pip">${SUIT_CH[c[1]]}</span></div>`;
}
const STREET_KO = { waiting: '대기 중', preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', showdown: '쇼다운' };
const fmt = (n) => n.toLocaleString('en-US');

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
        <div class="name">${esc(p.name)}</div>
        <div class="chips">$${fmt(p.chips)}${p.bet ? ` <span class="betamt">▸${fmt(p.bet)}</span>` : ''}</div>
        ${shown[p.id] ? `<div class="handname">${shown[p.id].name}</div>` : ''}
        ${p.chips === 0 && !p.inHand ? '<div class="handname">파산</div>' : ''}
        ${ctx.isHost ? `<button class="btn tiny red kick" data-kick="${p.id}">✕</button>` : ''}
      </div>`;
    },
  });

  const livePot = g.pot + g.players.reduce((s, p) => s + p.bet, 0);
  $('#pot').textContent = `POT $${fmt(livePot)}`;
  $('#pot').hidden = livePot === 0 && g.street !== 'showdown';
  $('#street').textContent = `${STREET_KO[g.street]} · 블라인드 ${g.sb}/${g.bb}${g.handNo ? ` · #${g.handNo}` : ''}`;

  const banner = $('#banner');
  if (g.street === 'showdown' && g.result) {
    banner.hidden = false;
    const meIn = g.players.find((p) => p.id === ctx.me);
    banner.className = winIds.has(ctx.me) ? 'win' : meIn && meIn.inHand && !meIn.folded ? 'lose' : '';
    banner.innerHTML = g.result.winners.map((w) => `${esc(w.name)} +$${fmt(w.amount)}${w.hand ? ` <small>(${w.hand})</small>` : ''}`).join('<br>');
  } else banner.hidden = true;

  const myP = g.players.find((p) => p.id === ctx.me);
  ctx.myLine = myP ? `<span class="mystack">${esc(myP.name)} · $${fmt(myP.chips)}${isDealer(g, ctx.me) ? ' · D' : ''}${myP.lastAction ? ` · ${myP.lastAction}` : ''}</span>` : '';
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
  if (me && me.hole.length && me.hole[0] !== '??' && g.board.length >= 3 && !me.folded) mine = `내 패: <b>${Poker.bestHand(me.hole.concat(g.board)).name}</b>`;
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
    const g = Poker.createGame({ sb: Math.floor(bb / 2), bb, startChips: Math.max(bb * 10, parseInt($('#pChips').value, 10) || 1000) });
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
    $('#roomInfo').innerHTML = '<b>연습 모드</b> · 언제든 나가도 자동 저장됩니다';
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
        if (g.street !== 'showdown') return [];
        const b = document.createElement('button');
        b.className = 'btn orange'; b.textContent = '다음 핸드 ▶';
        b.onclick = () => this.next();
        return [b];
      },
    };
    renderTable(ctx);
    if (Poker.isLive(g)) {
      const p = g.players[g.toAct];
      if (p.bot) this.timer = setTimeout(() => { Poker.applyAction(g, p.id, Poker.botDecide(g, p.id)); this.tick(); }, 700 + Math.random() * 500);
      return;
    }
    if (g.street === 'showdown') {
      const alive = g.players.filter((p) => p.chips > 0);
      if (me.chips === 0) {
        return modal('<h2>파산!</h2><p>칩을 모두 잃었습니다.</p>', [
          ['메뉴로', 'gray', () => { store.del(PRACTICE_KEY); show('menu'); }],
          ['리바이', 'orange', () => { me.chips = g.startChips; this.next(); }],
        ]);
      }
      if (alive.length === 1) {
        store.del(PRACTICE_KEY);
        return modal('<h2>🏆 우승!</h2><p>모든 봇을 이겼습니다!</p>', [['메뉴로', 'orange', () => show('menu')]]);
      }
      this.timer = setTimeout(() => this.next(), 5000);
    }
  },
  next() {
    clearTimeout(this.timer);
    Poker.startHand(this.g);
    this.tick();
  },
  exit() { clearTimeout(this.timer); this.save(); show('menu'); },
};
$('#btnPracticeStart').onclick = () => Practice.start();

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
      ? list.map((r) => `<li data-room="${r.id}"><span><span class="code">${r.id}</span> ${esc(r.name)}</span><span>${r.players}/8 · ${r.blinds}${r.running ? ' · 진행중' : ''}</span></li>`).join('')
      : '<li style="cursor:default;opacity:.6">열린 방이 없습니다</li>';
    $('#roomList').querySelectorAll('[data-room]').forEach((li) => (li.onclick = () => { $('#oCode').value = li.dataset.room; join(); }));
  } catch { $('#roomList').innerHTML = '<li style="cursor:default;opacity:.6">서버에 연결할 수 없습니다 (node server.js 실행 필요)</li>'; }
}
$('#btnRefresh').onclick = loadRooms;
const oName = () => { const n = $('#oName').value.trim(); if (n) store.set(NAME_KEY, n); return n; };
$('#btnCreate').onclick = async () => {
  if (!oName()) return toast('닉네임을 입력하세요');
  try {
    const s = await api('/api/create', { name: oName(), roomName: $('#oRoomName').value, chips: $('#oChips').value, bb: $('#oBB').value });
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
    const me = v.game.players.find((p) => p.id === v.me);
    $('#roomInfo').innerHTML = `<b>${esc(v.room.name)}</b> · 코드 <b>${v.room.id}</b> · ${v.room.running ? '진행중' : '일시정지'}`;
    const host = $('#hostCtl');
    host.innerHTML = '';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = `btn tiny ${cls}`; b.textContent = label; b.onclick = fn; return b; };
    if (isHost) {
      host.append(v.room.running ? mk('일시정지', 'gray', () => this.call('/api/pause')) : mk('게임 시작', 'orange', () => this.call('/api/start')));
      host.append(mk('+봇', 'blue', () => this.call('/api/addbot')));
    }
    renderTable({
      game: v.game, me: v.me, legal: v.legal, isHost,
      onAction: (a) => this.call('/api/action', { action: a }),
      onKick: (id) => modal('<h2>내보낼까요?</h2>', [['취소', 'gray'], ['내보내기', 'red', () => this.call('/api/kick', { target: id })]]),
      waitingMsg: isHost ? `친구에게 방 코드 <b>${v.room.id}</b>를 알려주고 [게임 시작]을 누르세요` : '방장이 게임을 시작하길 기다리는 중…',
      showdownMsg: v.room.running ? '5초 후 다음 핸드…' : '일시정지됨 (방장이 재개하면 계속)',
      extraButtons: () => (me.chips === 0 && !(Poker.isLive(v.game) && me.inHand)
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

$('#btnExit').onclick = () => (mode === 'online' ? Online.exit() : Practice.exit());

// auto-resume an online seat after a refresh
const saved = store.get(ONLINE_KEY);
if (saved && location.hash !== '#menu') Online.connect(saved);
else show('menu');
