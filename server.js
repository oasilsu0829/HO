// Zero-dependency server: static files + JSON API + Server-Sent Events.
// Rooms are saved to data/rooms.json so a restart (or a closed tab) never loses a game.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./public/poker.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const SAVE = path.join(__dirname, 'data', 'rooms.json');
const NEXT_HAND_MS = 5000;
const REVEAL_MS_PER_HAND = 1300; // matches the client's showdown tour
const BOT_MS = 900;
const AWAY_TIMEOUT_MS = 30000; // auto check/fold only for disconnected players

/** roomId -> { id, name, hostId, game, tokens: {token: playerId}, running } */
let rooms = {};
const clients = {}; // roomId -> Set<{res, playerId}>
const timers = {};

function load() {
  try {
    rooms = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
    for (const id in rooms) schedule(rooms[id]);
    console.log(`복원된 방: ${Object.keys(rooms).length}개`);
  } catch { rooms = {}; }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(SAVE), { recursive: true });
    fs.writeFileSync(SAVE + '.tmp', JSON.stringify(rooms));
    fs.renameSync(SAVE + '.tmp', SAVE);
  }, 200);
}

const online = (room, pid) => [...(clients[room.id] || [])].some((c) => c.playerId === pid);

function roomView(room, pid) {
  const v = P.viewFor(room.game, pid);
  for (const p of v.players) p.online = p.bot || online(room, p.id);
  return { room: { id: room.id, name: room.name, hostId: room.hostId, running: room.running }, game: v, me: pid, legal: P.legal(room.game, pid) };
}

function broadcast(room) {
  for (const c of clients[room.id] || []) send(c.res, roomView(room, c.playerId));
  save();
  schedule(room);
}
const send = (res, data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

// Drives anything that isn't a human click: bots, the next hand, away players.
function schedule(room) {
  clearTimeout(timers[room.id]);
  const g = room.game;
  if (!room.running) return;
  if (g.street === 'showdown' || g.street === 'waiting') {
    timers[room.id] = setTimeout(() => {
      if (!P.startHand(g)) { room.running = false; P.isLive(g) || (g.street = 'waiting'); }
      broadcast(room);
    }, g.street === 'waiting' ? 500 : NEXT_HAND_MS + revealTime(g));
    return;
  }
  const p = g.players[g.toAct];
  if (!p) return;
  if (p.bot) {
    const d = P.botDecide(g, p.id);
    timers[room.id] = setTimeout(() => { P.applyAction(g, p.id, d); broadcast(room); }, d ? d.think : BOT_MS);
  } else if (!online(room, p.id)) {
    timers[room.id] = setTimeout(() => {
      const L = P.legal(g, p.id);
      if (L) P.applyAction(g, p.id, { type: L.canCheck ? 'check' : 'fold' });
      broadcast(room);
    }, AWAY_TIMEOUT_MS);
  }
}

const revealTime = (g) => (g.result && !g.result.uncontested ? Object.keys(g.result.hands).length * REVEAL_MS_PER_HAND : 0);

const newId = (n) => crypto.randomBytes(n).toString('hex');
function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); while (rooms[c]);
  return c;
}
const clampInt = (v, lo, hi, d) => { v = parseInt(v, 10); return isNaN(v) ? d : Math.max(lo, Math.min(hi, v)); };
const cleanName = (s) => String(s || '').trim().slice(0, 12) || '플레이어';

function auth(body) {
  const room = rooms[String(body.room || '').toUpperCase()];
  if (!room) throw new Error('방을 찾을 수 없습니다');
  const pid = room.tokens[body.token];
  if (!pid) throw new Error('이 방의 참가자가 아닙니다');
  return { room, pid };
}

function seatPlayer(room, name) {
  if (room.game.players.length >= 8) throw new Error('방이 꽉 찼습니다 (최대 8명)');
  const pid = newId(4), token = newId(16);
  const p = P.addPlayer(room.game, { id: pid, name: cleanName(name) });
  if (P.isLive(room.game)) { p.inHand = false; p.folded = true; } // joins next hand
  room.tokens[token] = pid;
  return { pid, token };
}

const api = {
  'GET /api/rooms': () => Object.values(rooms).map((r) => ({
    id: r.id, name: r.name, players: r.game.players.length, running: r.running, blinds: `${r.game.sb}/${r.game.bb}`,
  })),
  'POST /api/create': (b) => {
    const id = roomCode();
    const bb = clampInt(b.bb, 2, 100000, 20);
    const room = {
      id, name: String(b.roomName || '').trim().slice(0, 20) || `${cleanName(b.name)}의 방`,
      game: P.createGame({ sb: Math.floor(bb / 2), bb, startChips: clampInt(b.chips, bb * 10, 10000000, 1000) }),
      tokens: {}, running: false, hostId: null,
    };
    rooms[id] = room;
    const s = seatPlayer(room, b.name);
    room.hostId = s.pid;
    save();
    return { room: id, token: s.token };
  },
  'POST /api/join': (b) => {
    const room = rooms[String(b.room || '').toUpperCase()];
    if (!room) throw new Error('방을 찾을 수 없습니다');
    const s = seatPlayer(room, b.name);
    broadcast(room);
    return { room: room.id, token: s.token };
  },
  'POST /api/action': (b) => {
    const { room, pid } = auth(b);
    const r = P.applyAction(room.game, pid, b.action || {});
    if (!r.ok) throw new Error(r.error);
    broadcast(room);
    return {};
  },
  'POST /api/start': (b) => {
    const { room, pid } = auth(b);
    if (pid !== room.hostId) throw new Error('방장만 시작할 수 있습니다');
    if (room.game.players.filter((p) => p.chips > 0).length < 2) throw new Error('칩이 있는 플레이어가 2명 이상 필요합니다');
    room.running = true;
    broadcast(room);
    return {};
  },
  'POST /api/pause': (b) => {
    const { room, pid } = auth(b);
    if (pid !== room.hostId) throw new Error('방장만 멈출 수 있습니다');
    room.running = false; // current hand still plays out; no new hand is dealt
    broadcast(room);
    return {};
  },
  'POST /api/addbot': (b) => {
    const { room, pid } = auth(b);
    if (pid !== room.hostId) throw new Error('방장만 봇을 추가할 수 있습니다');
    if (room.game.players.length >= 8) throw new Error('방이 꽉 찼습니다');
    const n = room.game.players.filter((p) => p.bot).length + 1;
    const p = P.addPlayer(room.game, { id: 'bot' + newId(3), name: `봇${n}`, bot: true });
    if (P.isLive(room.game)) { p.inHand = false; p.folded = true; }
    broadcast(room);
    return {};
  },
  'POST /api/kick': (b) => {
    const { room, pid } = auth(b);
    if (pid !== room.hostId) throw new Error('방장만 내보낼 수 있습니다');
    P.removePlayer(room.game, b.target);
    for (const t in room.tokens) if (room.tokens[t] === b.target) delete room.tokens[t];
    broadcast(room);
    return {};
  },
  'POST /api/rebuy': (b) => {
    const { room, pid } = auth(b);
    const p = room.game.players.find((q) => q.id === pid);
    if (p.chips > 0 || (P.isLive(room.game) && p.inHand)) throw new Error('칩이 남아있을 때는 리바이할 수 없습니다');
    p.chips = room.game.startChips;
    p.rebuys = (p.rebuys || 0) + 1;
    broadcast(room);
    return {};
  },
  'POST /api/leave': (b) => {
    const { room, pid } = auth(b);
    P.removePlayer(room.game, pid);
    delete room.tokens[b.token];
    const humans = room.game.players.filter((p) => !p.bot && !p.leaving);
    if (!humans.length) { clearTimeout(timers[room.id]); delete rooms[room.id]; save(); return {}; }
    if (room.hostId === pid) room.hostId = humans[0].id;
    broadcast(room);
    return {};
  },
};

function events(req, res, q) {
  let a;
  try { a = auth({ room: q.get('room'), token: q.get('token') }); } catch (e) { res.writeHead(404); return res.end(e.message); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const c = { res, playerId: a.pid };
  (clients[a.room.id] ||= new Set()).add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients[a.room.id]?.delete(c); if (rooms[a.room.id]) broadcast(a.room); });
  broadcast(a.room);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/events') return events(req, res, url.searchParams);
  const handler = api[`${req.method} ${url.pathname}`];
  if (handler) {
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        res.end(JSON.stringify(handler(raw ? JSON.parse(raw) : {})));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  const file = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  load();
  console.log(`♠ 홀덤 서버 실행 중: http://localhost:${PORT}`);
});
