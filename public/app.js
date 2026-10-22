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
function renderTable(ctx) {
  const g = ctx.game;
  const n = g.players.length;
  const meIdx = Math.max(0, g.players.findIndex((p) => p.id === ctx.me));
  const winIds = new Set((g.result?.winners || []).map((w) => w.id));
  const shown = g.result?.hands || {};
  const highlight = new Set();
  if (g.street === 'showdown') for (const w of g.result?.winners || []) for (const c of shown[w.id]?.cards || []) highlight.add(c);

  // seats around an ellipse, me at the bottom
  let seatsHTML = '';
  g.players.forEach((p, i) => {
    const k = (i - meIdx + n) % n;
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const x = 50 + 50 * Math.cos(a), y = 50 + 52 * Math.sin(a);
    const bx = 50 + 30 * Math.cos(a), by = 50 + 30 * Math.sin(a);
    const cls = ['seat'];
    if (i === g.toAct) cls.push('turn');
    if (p.folded && g.street !== 'waiting') cls.push('folded');
    if (p.online === false) cls.push('offline');
    if (winIds.has(p.id) && g.street === 'showdown') cls.push('win');
    if (p.id === ctx.me) cls.push('me', 'mine');
    const badgeCls = p.lastAction === '폴드' ? 'fold' : p.lastAction === '올인' ? 'allin' : /레이즈|벳/.test(p.lastAction) ? 'raise' : '';
    const size = p.id === ctx.me ? '' : 'sm';
    const cards = p.hole.length ? p.hole.map((c) => cardHTML(c, size, highlight.has(c) ? 'hl' : '')).join('') : '';
    const hn = shown[p.id] ? `<div class="handname">${shown[p.id].name}</div>` : '';
    const status = p.chips === 0 && !p.inHand ? '<div class="handname">파산</div>' : '';
    seatsHTML += `<div class="${cls.join(' ')}" style="left:${x}%;top:${y}%">
      <div class="cards">${cards}</div>${hn}
      <div class="plate">
        ${i === g.dealer && g.street !== 'waiting' ? '<div class="dealer">D</div>' : ''}
        ${p.lastAction ? `<div class="badge ${badgeCls}">${p.lastAction}</div>` : ''}
        <div class="name">${p.bot ? '🤖 ' : ''}${esc(p.name)}</div>
        <div class="chips">$${fmt(p.chips)}</div>
        ${ctx.isHost && p.id !== ctx.me ? `<button class="btn tiny red kick" data-kick="${p.id}">✕</button>` : ''}
      </div>${status}
    </div>`;
    if (p.bet > 0) seatsHTML += `<div class="bet" style="left:${bx}%;top:${by}%"><span class="chip"></span>${fmt(p.bet)}</div>`;
  });
  $('#seats').innerHTML = seatsHTML;
  $('#seats').querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => ctx.onKick(b.dataset.kick)));

  const board = [];
  for (let i = 0; i < 5; i++) board.push(cardHTML(g.board[i], 'lg', g.board[i] && highlight.size && !highlight.has(g.board[i]) ? 'dim' : highlight.has(g.board[i]) ? 'hl' : ''));
  $('#board').innerHTML = board.join('');
  const livePot = g.pot + g.players.reduce((s, p) => s + p.bet, 0);
  $('#pot').textContent = `POT $${fmt(livePot)}`;
  $('#pot').hidden = livePot === 0 && g.street !== 'showdown';
  $('#street').textContent = `${STREET_KO[g.street]} · 블라인드 ${g.sb}/${g.bb}${g.handNo ? ` · #${g.handNo}` : ''}`;

  const banner = $('#banner');
  if (g.street === 'showdown' && g.result) {
    banner.hidden = false;
    banner.innerHTML = g.result.winners.map((w) => `${esc(w.name)} +$${fmt(w.amount)}${w.hand ? ` <small>(${w.hand})</small>` : ''}`).join('<br>');
  } else banner.hidden = true;

  $('#log').innerHTML = g.log.map((l) => `<div>${esc(l)}</div>`).join('');
  $('#log').scrollTop = 1e6;

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
    else if (me?.folded) msg = '폴드했습니다';
    else if (me?.allIn) msg = '올인!';
    else msg = `${esc(g.players[g.toAct]?.name || '')}의 차례…`;
    box.innerHTML = `<div class="info">${mine ? mine + '<br>' : ''}${msg}</div>`;
    if (ctx.extraButtons) box.append(...ctx.extraButtons());
    return;
  }
  const key = `${g.handNo}-${g.street}-${g.currentBet}`;
  if (!raiseDraft || raiseDraft.key !== key) raiseDraft = { key, val: L.minTo };
  const betWord = g.currentBet === 0 ? '벳' : '레이즈';
  box.innerHTML = `
    ${mine ? `<div class="info">${mine}</div>` : ''}
    <button class="btn red" data-a="fold">폴드</button>
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
