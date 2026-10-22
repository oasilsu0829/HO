// Texas Hold'em engine — shared by the browser (practice mode) and the server (online mode).
(function (root) {
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

  const rv = (c) => RANKS.indexOf(c[0]) + 2;

  function newDeck() {
    const d = [];
    for (const r of RANKS) for (const s of SUITS) d.push(r + s);
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  // ---------- hand evaluation ----------
  function eval5(cards) {
    const vals = cards.map(rv).sort((a, b) => b - a);
    const flush = cards.every((c) => c[1] === cards[0][1]);
    const uniq = [...new Set(vals)];
    let straightHigh = 0;
    if (uniq.length === 5) {
      if (vals[0] - vals[4] === 4) straightHigh = vals[0];
      else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5; // wheel
    }
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const groups = Object.entries(counts)
      .map(([v, n]) => [n, +v])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const byGroup = groups.map((g) => g[1]);
    if (straightHigh && flush) return [8, straightHigh];
    if (groups[0][0] === 4) return [7, ...byGroup];
    if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...byGroup];
    if (flush) return [5, ...vals];
    if (straightHigh) return [4, straightHigh];
    if (groups[0][0] === 3) return [3, ...byGroup];
    if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...byGroup];
    if (groups[0][0] === 2) return [1, ...byGroup];
    return [0, ...vals];
  }

  function cmp(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function bestHand(cards) {
    let best = null;
    const n = cards.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
      for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
        const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
        const score = eval5(five);
        if (!best || cmp(score, best.score) > 0) best = { score, cards: five };
      }
    best.name = handName(best.score);
    return best;
  }

  function handName(score) {
    if (score[0] === 8 && score[1] === 14) return '로열 스트레이트 플러시';
    return HAND_NAMES[score[0]];
  }

  // ---------- game state ----------
  function createGame(opts = {}) {
    return {
      sb: opts.sb || 10,
      bb: opts.bb || 20,
      startChips: opts.startChips || 1000,
      players: [],
      dealer: -1,
      street: 'waiting', // waiting | preflop | flop | turn | river | showdown
      board: [],
      deck: [],
      pot: 0,
      currentBet: 0,
      minRaise: 0,
      toAct: -1,
      handNo: 0,
      log: [],
      result: null,
    };
  }

  function addPlayer(g, { id, name, bot = false }) {
    const p = {
      id, name, bot,
      chips: g.startChips,
      hole: [], folded: true, allIn: false,
      bet: 0, total: 0, acted: false, inHand: false,
      lastAction: '',
    };
    g.players.push(p);
    return p;
  }

  function removePlayer(g, id) {
    const i = g.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = g.players[i];
    if (p.inHand && isLive(g)) {
      // fold them out first so the hand can continue
      if (!p.folded) { p.folded = true; }
      if (g.toAct === i) { advance(g); }
    }
    // only safe to splice between hands; mid-hand we keep a folded ghost
    if (!isLive(g)) {
      g.players.splice(i, 1);
      if (g.dealer >= i) g.dealer--;
    } else {
      p.leaving = true;
    }
  }

  const isLive = (g) => ['preflop', 'flop', 'turn', 'river'].includes(g.street);

  function log(g, msg) {
    g.log.push(msg);
    g.logSeq = (g.logSeq || 0) + 1;
    if (g.log.length > 40) g.log.shift();
  }

  function nextIdx(g, i, pred) {
    const n = g.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k + n) % n;
      if (pred(g.players[j])) return j;
    }
    return -1;
  }

  const canAct = (p) => p.inHand && !p.folded && !p.allIn;

  function put(g, p, amt) {
    amt = Math.min(amt, p.chips);
    p.chips -= amt;
    p.bet += amt;
    p.total += amt;
    if (p.chips === 0) p.allIn = true;
    return amt;
  }

  function startHand(g) {
    // remove ghosts of players who left
    for (let i = g.players.length - 1; i >= 0; i--) {
      if (g.players[i].leaving) {
        g.players.splice(i, 1);
        if (g.dealer >= i) g.dealer--;
      }
    }
    const seated = g.players.filter((p) => p.chips > 0 && !p.sitOut);
    if (seated.length < 2) return false;

    g.handNo++;
    g.deck = newDeck();
    g.board = [];
    g.pot = 0;
    g.result = null;
    for (const p of g.players) {
      p.hole = []; p.bet = 0; p.total = 0; p.acted = false; p.allIn = false; p.lastAction = '';
      p.inHand = p.chips > 0 && !p.sitOut;
      p.folded = !p.inHand;
    }
    g.dealer = nextIdx(g, g.dealer, (p) => p.inHand);
    let sbI, bbI;
    if (seated.length === 2) {
      sbI = g.dealer;
      bbI = nextIdx(g, sbI, (p) => p.inHand);
    } else {
      sbI = nextIdx(g, g.dealer, (p) => p.inHand);
      bbI = nextIdx(g, sbI, (p) => p.inHand);
    }
    put(g, g.players[sbI], g.sb); g.players[sbI].lastAction = 'SB';
    put(g, g.players[bbI], g.bb); g.players[bbI].lastAction = 'BB';
    for (let r = 0; r < 2; r++) for (const p of g.players) if (p.inHand) p.hole.push(g.deck.pop());
    g.currentBet = g.bb;
    g.minRaise = g.bb;
    g.street = 'preflop';
    log(g, `── 핸드 #${g.handNo} ──`);
    g.toAct = nextIdx(g, bbI, canAct);
    // everyone may already be all-in from the blinds
    if (g.toAct < 0 || roundDone(g)) endRound(g);
    return true;
  }

  function legal(g, id) {
    const i = g.players.findIndex((p) => p.id === id);
    if (i < 0 || i !== g.toAct || !isLive(g)) return null;
    const p = g.players[i];
    const toCall = g.currentBet - p.bet;
    const maxTo = p.bet + p.chips;
    return {
      toCall,
      callAmt: Math.min(toCall, p.chips),
      canCheck: toCall <= 0,
      canRaise: maxTo > g.currentBet,
      minTo: Math.min(g.currentBet + g.minRaise, maxTo),
      maxTo,
      pot: g.pot + g.players.reduce((s, q) => s + q.bet, 0),
    };
  }

  function applyAction(g, id, action) {
    const L = legal(g, id);
    if (!L) return { ok: false, error: '당신 차례가 아닙니다' };
    const p = g.players[g.toAct];
    let type = action.type;
    if (type === 'check' && !L.canCheck) return { ok: false, error: '체크할 수 없습니다' };
    if (type === 'call' && L.canCheck) type = 'check';
    if (type === 'raise' && !L.canRaise) type = L.canCheck ? 'check' : 'call';
    if (type === 'allin') { type = L.canRaise ? 'raise' : 'call'; action = { type, amount: L.maxTo }; }

    if (type === 'fold') {
      p.folded = true; p.lastAction = '다이';
      log(g, `${p.name} 다이`);
    } else if (type === 'check') {
      p.lastAction = '체크';
      log(g, `${p.name} 체크`);
    } else if (type === 'call') {
      const amt = put(g, p, L.toCall);
      p.lastAction = p.allIn ? '올인' : '콜';
      log(g, `${p.name} 콜 ${amt}`);
    } else if (type === 'raise') {
      let to = Math.floor(Number(action.amount) || 0);
      to = Math.max(L.minTo, Math.min(to, L.maxTo));
      put(g, p, to - p.bet);
      const raiseBy = to - g.currentBet;
      if (raiseBy >= g.minRaise) g.minRaise = raiseBy;
      const wasBet = g.currentBet === 0;
      g.currentBet = to;
      for (const q of g.players) if (q !== p && canAct(q)) q.acted = false;
      p.lastAction = p.allIn ? '올인' : wasBet ? '벳' : '레이즈';
      log(g, `${p.name} ${p.lastAction} ${to}`);
    } else {
      return { ok: false, error: '알 수 없는 액션' };
    }
    p.acted = true;
    advance(g);
    return { ok: true };
  }

  function roundDone(g) {
    const actors = g.players.filter(canAct);
    if (actors.length === 0) return true;
    // a lone player who can still bet only needs to match; nobody is left to raise against
    if (actors.length === 1) return actors[0].bet >= g.currentBet;
    return actors.every((p) => p.acted && p.bet === g.currentBet);
  }

  function advance(g) {
    const alive = g.players.filter((p) => p.inHand && !p.folded);
    if (alive.length === 1) return finishUncontested(g, alive[0]);
    if (!roundDone(g)) {
      g.toAct = nextIdx(g, g.toAct, (p) => canAct(p) && (!p.acted || p.bet < g.currentBet));
      return;
    }
    endRound(g);
  }

  function endRound(g) {
    for (;;) {
      for (const p of g.players) { g.pot += p.bet; p.bet = 0; p.acted = false; }
      g.currentBet = 0;
      g.minRaise = g.bb;
      if (g.street === 'river') return showdown(g);
      if (g.street === 'preflop') { g.board.push(g.deck.pop(), g.deck.pop(), g.deck.pop()); g.street = 'flop'; }
      else if (g.street === 'flop') { g.board.push(g.deck.pop()); g.street = 'turn'; }
      else if (g.street === 'turn') { g.board.push(g.deck.pop()); g.street = 'river'; }
      for (const p of g.players) if (canAct(p) && p.lastAction !== '올인') p.lastAction = '';
      if (g.players.filter(canAct).length >= 2) {
        g.toAct = nextIdx(g, g.dealer, canAct);
        return;
      }
      // nobody (or only one player) can still bet: run out the board
    }
  }

  function finishUncontested(g, w) {
    for (const p of g.players) { g.pot += p.bet; p.bet = 0; }
    w.chips += g.pot;
    log(g, `${w.name} 승리 (+${g.pot})`);
    g.result = { uncontested: true, winners: [{ id: w.id, name: w.name, amount: g.pot }], hands: {} };
    g.pot = 0;
    g.street = 'showdown';
    g.toAct = -1;
  }

  function showdown(g) {
    const alive = g.players.filter((p) => p.inHand && !p.folded);
    const hands = {};
    for (const p of alive) hands[p.id] = bestHand(p.hole.concat(g.board));

    // build side pots from total contributions
    const levels = [...new Set(g.players.filter((p) => p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const p of g.players) amount += Math.max(0, Math.min(p.total, lv) - prev);
      const eligible = alive.filter((p) => p.total >= lv).map((p) => p.id);
      const last = pots[pots.length - 1];
      if (last && (eligible.length === 0 || last.eligible.join() === eligible.join())) last.amount += amount;
      else if (eligible.length) pots.push({ amount, eligible });
      prev = lv;
    }

    const won = {};
    for (const pot of pots) {
      let best = null, winners = [];
      for (const id of pot.eligible) {
        const c = best ? cmp(hands[id].score, best) : 1;
        if (c > 0) { best = hands[id].score; winners = [id]; } else if (c === 0) winners.push(id);
      }
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      // odd chips go to the first winner left of the dealer
      const order = winners.slice().sort((a, b) => seatDist(g, a) - seatDist(g, b));
      for (const id of order) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        won[id] = (won[id] || 0) + amt;
      }
    }
    const winners = [];
    for (const [id, amount] of Object.entries(won)) {
      const p = g.players.find((q) => q.id === id);
      p.chips += amount;
      winners.push({ id, name: p.name, amount, hand: hands[id].name });
      log(g, `${p.name} ${hands[id].name}로 승리 (+${amount})`);
    }
    const shown = {};
    for (const p of alive) shown[p.id] = { name: hands[p.id].name, cards: hands[p.id].cards };
    g.result = { uncontested: false, winners, hands: shown, pots: pots.length };
    g.pot = 0;
    g.street = 'showdown';
    g.toAct = -1;
  }

  function seatDist(g, id) {
    const n = g.players.length;
    const i = g.players.findIndex((p) => p.id === id);
    return (i - g.dealer + n - 1) % n;
  }

  // What a given player is allowed to see.
  function viewFor(g, id) {
    const v = JSON.parse(JSON.stringify(g));
    delete v.deck;
    const reveal = g.street === 'showdown' && g.result && !g.result.uncontested;
    for (const p of v.players) {
      if (p.id === id) continue;
      if (reveal && p.inHand && !p.folded) continue;
      p.hole = p.hole.map(() => '??');
    }
    return v;
  }

  // ---------- bot ----------
  function equity(hole, board, opponents, sims = 250) {
    const known = new Set(hole.concat(board));
    const rest = [];
    for (const r of RANKS) for (const s of SUITS) if (!known.has(r + s)) rest.push(r + s);
    let score = 0;
    for (let n = 0; n < sims; n++) {
      // partial shuffle
      const need = 5 - board.length + opponents * 2;
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (rest.length - i));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      let k = 0;
      const fullBoard = board.concat(rest.slice(k, k + 5 - board.length)); k += 5 - board.length;
      const mine = bestHand(hole.concat(fullBoard)).score;
      let win = true, tie = 0;
      for (let o = 0; o < opponents; o++) {
        const opp = bestHand([rest[k], rest[k + 1]].concat(fullBoard)).score; k += 2;
        const c = cmp(mine, opp);
        if (c < 0) { win = false; break; }
        if (c === 0) tie++;
      }
      if (win) score += tie ? 1 / (tie + 1) : 1;
    }
    return score / sims;
  }

  function botDecide(g, id) {
    const L = legal(g, id);
    if (!L) return null;
    const p = g.players.find((q) => q.id === id);
    const opponents = g.players.filter((q) => q.inHand && !q.folded && q !== p).length;
    const eq = equity(p.hole, g.board, Math.max(1, opponents), 200);
    const potOdds = L.toCall > 0 ? L.toCall / (L.pot + L.toCall) : 0;
    const r = Math.random();
    const raiseTo = (frac) => Math.max(L.minTo, Math.min(L.maxTo, g.currentBet + Math.floor((L.pot * frac) / g.bb) * g.bb));
    const strong = 1 / (opponents + 1) + 0.25;

    if (L.canRaise && (eq > strong + 0.15 || (eq > strong && r < 0.5))) {
      if (eq > 0.85 && r < 0.3) return { type: 'allin' };
      return { type: 'raise', amount: raiseTo(0.5 + r) };
    }
    if (L.canRaise && L.canCheck && r < 0.08) return { type: 'raise', amount: raiseTo(0.6) }; // bluff
    if (L.canCheck) return { type: 'check' };
    if (eq > potOdds + 0.03 || (L.toCall <= g.bb && eq > 0.2)) return { type: 'call' };
    return { type: 'fold' };
  }

  const api = { createGame, addPlayer, removePlayer, startHand, applyAction, legal, viewFor, botDecide, bestHand, isLive, RANKS, SUITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Poker = api;
})(typeof window !== 'undefined' ? window : globalThis);
