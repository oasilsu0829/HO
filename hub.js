// Room logic shared by the Node server (server.js) and the Cloudflare Worker (worker/index.js).
// The host supplies persistence; clients are anything with send(data).
const P = require('./public/poker.js');

const NEXT_HAND_MS = 5000;
const REVEAL_MS_PER_HAND = 1300; // matches the client's showdown tour
const BOT_MS = 900;
const AWAY_TIMEOUT_MS = 30000; // auto check/fold only for disconnected players

/**
 * persist = { save(room), remove(roomId) }
 * rooms: roomId -> { id, name, hostId, game, tokens: {token: playerId}, running }
 */
function createHub(persist, initialRooms = {}) {
  const rooms = initialRooms;
  const clients = {}; // roomId -> Set<{ send, playerId }>
  const timers = {};

  const online = (room, pid) => [...(clients[room.id] || [])].some((c) => c.playerId === pid);

  function roomView(room, pid) {
    const v = P.viewFor(room.game, pid);
    for (const p of v.players) p.online = p.bot || online(room, p.id);
    return { room: { id: room.id, name: room.name, hostId: room.hostId, running: room.running }, game: v, me: pid, legal: P.legal(room.game, pid) };
  }

  function broadcast(room) {
    for (const c of clients[room.id] || []) {
      try { c.send(roomView(room, c.playerId)); } catch { clients[room.id].delete(c); }
    }
    persist.save(room);
    schedule(room);
  }

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

  const EXEC_MS = 3600; // matches the client's execution scenes
  const revealTime = (g) => (g.result && !g.result.uncontested ? Object.keys(g.result.hands).length * REVEAL_MS_PER_HAND : 0) + P.celebMs(g)
    + (g.result?.deaths?.length || g.players.some((p) => p.inHand && p.chips === 0) ? EXEC_MS : 0);

  const newId = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
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
    if (room.game.mode === 'death' && room.game.handNo > 0 && !room.game.champion) { p.dead = true; p.spectator = true; p.chips = 0; } // a deathmatch in progress: watch only
    room.tokens[token] = pid;
    return { pid, token };
  }

  const api = {
    'GET /api/rooms': () => Object.values(rooms).map((r) => ({
      id: r.id, name: r.name, players: r.game.players.length, running: r.running, blinds: `${r.game.sb}/${r.game.bb}`, mode: r.game.mode,
    })),
    'POST /api/create': (b) => {
      const id = roomCode();
      const bb = clampInt(b.bb, 2, 100000, 20);
      const room = {
        id, name: String(b.roomName || '').trim().slice(0, 20) || `${cleanName(b.name)}의 방`,
        game: P.createGame({ mode: b.mode, sb: Math.floor(bb / 2), bb, startChips: clampInt(b.chips, bb * 10, 10000000, 1000) }),
        tokens: {}, running: false, hostId: null,
      };
      rooms[id] = room;
      const s = seatPlayer(room, b.name);
      room.hostId = s.pid;
      persist.save(room);
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
      const g = room.game;
      if (g.mode === 'death' && g.champion) {
        // a fresh deathmatch with everyone at the table
        for (const p of g.players) { p.dead = false; p.spectator = false; p.chips = g.startChips; }
        Object.assign(g, { round: 1, roundHand: 0, champion: null, resetPending: false, street: 'waiting', result: null, board: [], handNo: 0 });
      }
      if (g.players.filter((p) => p.chips > 0 && !p.dead).length < 2) throw new Error('칩이 있는 플레이어가 2명 이상 필요합니다');
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
      if (room.game.mode === 'death' && room.game.handNo > 0 && !room.game.champion) throw new Error('데스매치 도중에는 봇을 추가할 수 없습니다');
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
      if (room.game.mode === 'death') throw new Error('데스매치에는 리바이가 없습니다');
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
      if (!humans.length) { clearTimeout(timers[room.id]); delete rooms[room.id]; persist.remove(room.id); return {}; }
      if (room.hostId === pid) room.hostId = humans[0].id;
      broadcast(room);
      return {};
    },
  };

  // Subscribe a client to a room; returns an unsubscribe function.
  function connect(roomId, token, send) {
    const { room, pid } = auth({ room: roomId, token });
    const c = { send, playerId: pid };
    (clients[room.id] = clients[room.id] || new Set()).add(c);
    broadcast(room);
    return () => {
      clients[room.id]?.delete(c);
      if (rooms[room.id]) broadcast(room);
    };
  }

  function handle(method, path, body) {
    const fn = api[`${method} ${path}`];
    if (!fn) return undefined;
    return fn(body || {});
  }

  for (const id in rooms) schedule(rooms[id]);
  return { handle, connect, rooms };
}

module.exports = { createHub };
