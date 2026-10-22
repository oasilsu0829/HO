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
    if (cards.length < 5) {
      // too few cards for straights/flushes: only pairs and sets count
      const vals = cards.map(rv).sort((x, y) => y - x);
      const cnt = {}; for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;
      const groups = Object.entries(cnt).map(([v, k]) => [k, +v]).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
      const by = groups.map((x) => x[1]);
      const cat = groups[0][0] === 4 ? 7 : groups[0][0] === 3 ? 3 : groups[0][0] === 2 ? (groups[1] && groups[1][0] === 2 ? 2 : 1) : 0;
      const score = [cat, ...by];
      return { score, cards: sortFive(cards, score), name: handName(score) };
    }
    let best = null;
    const n = cards.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
      for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
        const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
        const score = eval5(five);
        if (!best || cmp(score, best.score) > 0) best = { score, cards: five };
      }
    best.name = handName(best.score);
    best.cards = sortFive(best.cards, best.score);
    return best;
  }

  // Lay the five out the way a player reads them: sets first (biggest group, then rank),
  // straights high to low with the wheel as 5-4-3-2-A.
  function sortFive(cards, score) {
    const cnt = {};
    for (const c of cards) cnt[rv(c)] = (cnt[rv(c)] || 0) + 1;
    const key = (c) => (score && (score[0] === 4 || score[0] === 8) && score[1] === 5 && rv(c) === 14 ? 1 : rv(c));
    return cards.slice().sort((a, b) => cnt[rv(b)] - cnt[rv(a)] || key(b) - key(a) || 'shdc'.indexOf(a[1]) - 'shdc'.indexOf(b[1]));
  }

  function handName(score) {
    if (score[0] === 8 && score[1] === 14) return '로열 스트레이트 플러시';
    return HAND_NAMES[score[0]];
  }

  // ---------- game state ----------
  function createGame(opts = {}) {
    return {
      mode: opts.mode === 'death' ? 'death' : 'normal',
      roundLen: 8,      // death mode: hands per round
      round: 1,
      roundHand: 0,
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

  // Bot personalities: how tight, how aggressive, how often they bluff, how well they read and hide.
  const PERSONAS = [
    { key: 'rock', name: '바위', tight: 0.8, aggr: 0.25, bluff: 0.05, skill: 0.5 },
    { key: 'shark', name: '상어', tight: 0.6, aggr: 0.75, bluff: 0.3, skill: 0.9 },
    { key: 'maniac', name: '미치광이', tight: 0.1, aggr: 0.95, bluff: 0.55, skill: 0.35 },
    { key: 'station', name: '콜중독', tight: 0.2, aggr: 0.15, bluff: 0.08, skill: 0.2 },
    { key: 'fox', name: '여우', tight: 0.45, aggr: 0.55, bluff: 0.4, skill: 0.8 },
  ];
  function personaOf(p) {
    if (p.style) return p.style;
    let h = 0; for (const ch of String(p.id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return PERSONAS[h % PERSONAS.length];
  }

  function addPlayer(g, { id, name, bot = false }) {
    const p = {
      id, name, bot,
      chips: g.startChips,
      hole: [], folded: true, allIn: false,
      bet: 0, total: 0, acted: false, inHand: false,
      lastAction: '',
    };
    if (bot) p.style = PERSONAS[g.players.filter((q) => q.bot).length % PERSONAS.length];
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

  function statOf(g, id) {
    g.stats = g.stats || {};
    return (g.stats[id] = g.stats[id] || { hands: 0, vpip: 0, agg: 0, pas: 0, faced: 0, foldBet: 0, bluffs: 0 });
  }

  // House rule: a 2-card flop, then one card per street (0 → 2 → 3 → 4 → 5), so there's an extra betting round.
  const isLive = (g) => ['preflop', 'flop', 'turn', 'fourth', 'river'].includes(g.street);

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
    // death mode: a new round puts every survivor back on the same stack
    if (g.mode === 'death' && g.resetPending) {
      for (const p of g.players) if (!p.dead) p.chips = g.startChips;
      g.resetPending = false;
    }
    const seated = g.players.filter((p) => p.chips > 0 && !p.sitOut && !p.dead);
    if (seated.length < 2) return false;

    g.handNo++;
    g.deck = newDeck();
    g.board = [];
    g.pot = 0;
    g.result = null;
    for (const p of g.players) {
      p.hole = []; p.bet = 0; p.total = 0; p.acted = false; p.allIn = false; p.lastAction = ''; p.say = null; p.tell = '';
      p.inHand = p.chips > 0 && !p.sitOut && !p.dead;
      p.folded = !p.inHand;
    }
    g.aggressor = null; g.lastAggressor = null;
    for (const p of g.players) if (p.inHand) statOf(g, p.id).hands++;
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

    const st = statOf(g, p.id);
    if (L.toCall > 0) { st.faced++; if (type === 'fold') st.foldBet++; }
    if (type === 'raise') st.agg++; else if (type === 'call') st.pas++;
    if (g.street === 'preflop' && (type === 'call' || type === 'raise') && p.vpipHand !== g.handNo) { p.vpipHand = g.handNo; st.vpip++; }

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
      g.aggressor = p.id; g.lastAggressor = p.id;
      p.lastAction = p.allIn ? '올인' : wasBet ? '벳' : '레이즈';
      log(g, `${p.name} ${p.lastAction} ${to}`);
    } else {
      return { ok: false, error: '알 수 없는 액션' };
    }
    p.acted = true;
    p.say = action.say ? { text: String(action.say).slice(0, 40), seq: g.logSeq } : null;
    p.tell = action.tell || '';
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
      g.aggressor = null;
      if (g.street === 'river') return showdown(g);
      if (g.street === 'preflop') { g.board.push(g.deck.pop(), g.deck.pop()); g.street = 'flop'; }
      else if (g.street === 'flop') { g.board.push(g.deck.pop()); g.street = 'turn'; }
      else if (g.street === 'turn') { g.board.push(g.deck.pop()); g.street = 'fourth'; }
      else if (g.street === 'fourth') { g.board.push(g.deck.pop()); g.street = 'river'; }
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
    deathCheck(g);
  }

  // Death mode: whoever busts dies at once and ends the round; otherwise the
  // shortest stack dies after the round's last hand. Last one alive wins.
  function deathCheck(g) {
    if (g.mode !== 'death') return;
    g.roundHand++;
    const alive = g.players.filter((p) => !p.dead && !p.leaving);
    let doomed = alive.filter((p) => p.inHand && p.chips === 0);
    let reason = 'bust';
    if (!doomed.length && g.roundHand >= g.roundLen) {
      const low = Math.min(...alive.map((p) => p.chips));
      const tied = alive.filter((p) => p.chips === low);
      // a tie goes against whoever put the least into this hand (the most passive)
      tied.sort((a, b) => a.total - b.total || (Math.random() - 0.5));
      doomed = [tied[0]];
      reason = 'lowest';
    }
    if (!doomed.length) return;
    g.result.deaths = doomed.map((p) => p.id);
    g.result.deathInfo = doomed.map((p) => ({ id: p.id, name: p.name, chips: p.chips, reason }));
    g.result.round = g.round;
    for (const p of doomed) { log(g, `☠ ${p.name} 처형 (${reason === 'bust' ? '파산' : `최하위 $${p.chips}`})`); p.dead = true; p.deathRound = g.round; p.chips = 0; }
    const left = alive.filter((p) => !p.dead);
    if (left.length <= 1) { g.champion = left[0]?.id || null; if (left[0]) log(g, `🏆 ${left[0].name} 최후의 1인`); return; }
    g.round++; g.roundHand = 0; g.resetPending = true;
    log(g, `── 라운드 ${g.round} 시작: 칩 리셋 ──`);
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
    for (const p of alive) shown[p.id] = { name: hands[p.id].name, cards: hands[p.id].cards, score: hands[p.id].score };
    // the last bettor turning over a pair or worse without winning got caught bluffing
    let bluffer = null;
    const la = alive.find((p) => p.id === g.lastAggressor);
    if (la && hands[la.id].score[0] <= 1 && !won[la.id]) { bluffer = la.id; statOf(g, la.id).bluffs++; }
    g.result = { uncontested: false, winners, hands: shown, pots: pots.length, bluffer };
    g.pot = 0;
    g.street = 'showdown';
    g.toAct = -1;
    deathCheck(g);
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

  const LINES = {
    value: ['들어와 봐.', '이번엔 진짜야.', '…', '콜하면 후회할걸.', '받아.'],
    nervous: ['어… 벳.', '음… 이 정도면…', '…(침을 삼킨다)', '그, 그냥 벳.'],
    call: ['보자.', '따라간다.', '흠…', '안 믿어.', '네 패 보고 싶네.'],
    fold: ['가져가.', '다음 판에 보자.', '쳇.', '…운 좋네.'],
    allin: ['전부 건다.', '죽거나 살거나.', '올인이다.', '여기서 끝내자.'],
    check: ['체크.', '네 차례.', '…'],
    trap: ['체크.', '…글쎄.', '조용히 가자.'],
    hero: ['너 블러핑이지.', '그 표정 다 보여.', '안 속아.'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Returns { type, amount?, think (ms), say?, tell? }.
  function botDecide(g, id) {
    const L = legal(g, id);
    if (!L) return null;
    const p = g.players.find((q) => q.id === id);
    const P = personaOf(p);
    const opps = g.players.filter((q) => q.inHand && !q.folded && q !== p);
    const n = Math.max(1, opps.length);
    const eq = equity(p.hole, g.board, n, 220);
    const fair = 1 / (n + 1);
    const strength = clamp((eq - fair) / (1 - fair), -1, 1); // 0 = average hand here, 1 = the nuts
    const r = Math.random();

    // read whoever is betting into us (or the table)
    const target = (g.aggressor && g.aggressor !== id ? [g.aggressor] : opps.map((o) => o.id)).map((x) => statOf(g, x));
    const avg = (f) => target.reduce((s, t) => s + f(t), 0) / Math.max(1, target.length);
    const oppAgg = avg((t) => (t.agg + 1) / (t.agg + t.pas + 3));
    const oppFold = avg((t) => (t.foldBet + 1) / (t.faced + 3));
    const oppBluffy = avg((t) => Math.min(1, t.bluffs / (t.hands * 0.1 + 1)));
    const read = L.toCall > 0 ? P.skill * ((oppAgg - 0.4) * 0.12 + oppBluffy * 0.15) : 0;
    const effEq = eq + read;

    // fear: how much of what's left this call would cost, softened if already pot-committed
    const stack = p.chips + p.bet;
    const risk = L.toCall / Math.max(1, p.chips);
    const committed = p.total / Math.max(1, p.total + p.chips);
    const potOdds = L.toCall > 0 ? L.toCall / (L.pot + L.toCall) : 0;
    let fear = Math.pow(Math.min(1, risk), 1.3) * (0.22 - 0.14 * P.aggr) * (1 - committed);
    let need = potOdds + P.tight * 0.05 + fear;
    // death mode: busting is death, but so is sitting on the shortest stack when the round ends
    let desperate = false;
    if (g.mode === 'death') {
      const alive = g.players.filter((q) => !q.dead);
      const low = Math.min(...alive.map((q) => q.chips + q.bet));
      const lowest = p.chips + p.bet <= low;
      const left = g.roundLen - g.roundHand;
      desperate = lowest && left <= 2;
      if (desperate) need -= 0.1 + (left === 1 ? 0.08 : 0);
      else need += fear * 0.5; // comfortable players protect their lives
    }

    const size = (frac) => clamp(g.currentBet + Math.max(g.bb, Math.round((L.pot * frac) / g.bb) * g.bb), L.minTo, L.maxTo);
    const leaky = Math.random() > P.skill; // weak players give away their hand
    const talk = (kind, prob = 0.4) => (Math.random() < prob ? pick(LINES[kind]) : null);
    const closeness = 1 - Math.min(1, Math.abs(effEq - need) * 5);
    const big = Math.min(1, (L.toCall + L.pot * 0.3) / Math.max(1, stack));
    const tank = () => 700 + Math.random() * 600 + 4200 * closeness * big;
    const quick = () => 500 + Math.random() * 600;
    let d;

    if ((p.chips / g.bb < 10 || (desperate && Math.random() < 0.4)) && L.canRaise) {
      // short stack: shove or get out
      if (effEq > fair + 0.12 - P.aggr * 0.08) d = { type: 'allin', say: talk('allin', 0.7), think: tank() + 800 };
      else d = L.canCheck ? { type: 'check', think: quick() } : effEq >= need ? { type: 'call', think: tank() } : { type: 'fold', say: talk('fold', 0.3), think: tank() };
    } else if (L.canCheck) {
      const postflop = g.street === 'flop' || g.street === 'turn' || g.street === 'fourth';
      if (strength > 0.75 && postflop && r < (1 - P.aggr) * 0.45) {
        d = { type: 'check', say: talk('trap', 0.3), think: quick() + 400 }; // slow-play the monster
      } else if (strength > 0.4 - P.aggr * 0.15) {
        d = { type: 'raise', amount: size(0.45 + 0.35 * Math.random() + P.aggr * 0.25), think: quick() + 300,
          say: talk(leaky ? 'value' : pick(['value', 'nervous'])), tell: !leaky && Math.random() < 0.2 ? 'shaky' : '' };
      } else if (postflop && eq > fair * 0.8 && r < P.aggr * 0.35) {
        d = { type: 'raise', amount: size(0.5 + Math.random() * 0.2), think: quick() + 500, say: talk('value', 0.25) }; // semi-bluff a draw
      } else if (r < P.bluff * (0.4 + oppFold) * (n === 1 ? 1 : 0.35) * (g.street === 'river' ? 1.3 : 0.8)) {
        d = { type: 'raise', amount: size(P.aggr > 0.8 ? 1.1 : 0.6 + 0.3 * Math.random()), bluff: true,
          think: leaky ? 300 + Math.random() * 300 : quick() + 400, // nervous bluffers fire too fast
          say: talk(leaky ? 'nervous' : 'value', 0.5), tell: leaky ? (Math.random() < 0.7 ? 'shaky' : '') : '' };
      } else d = { type: 'check', say: talk('check', 0.15), think: quick() };
    } else {
      if (L.canRaise && strength > 0.6 + P.tight * 0.12 - P.aggr * 0.1 && r < 0.4 + P.aggr * 0.5) {
        d = strength > 0.85 && (risk > 0.4 || r < 0.25)
          ? { type: 'allin', say: talk('allin', 0.7), think: tank() + 600 }
          : { type: 'raise', amount: size(0.7 + P.aggr * 0.4), say: talk('value'), think: tank(), tell: !leaky && Math.random() < 0.2 ? 'shaky' : '' };
      } else if (L.canRaise && risk < 0.25 && r < P.bluff * P.aggr * 0.6 * oppFold) {
        d = { type: 'raise', amount: size(0.8), bluff: true, think: tank(), say: talk(leaky ? 'nervous' : 'value', 0.5), tell: leaky ? 'shaky' : '' };
      } else if (effEq >= need) {
        d = { type: 'call', think: tank(), say: read > 0.04 && effEq - read < need ? pick(LINES.hero) : talk('call', 0.3) };
      } else d = { type: 'fold', say: talk('fold', 0.35), think: tank() };
    }
    d.think = Math.round(clamp(d.think, 300, 6000));
    return d;
  }

  // How long the client's result celebration runs for each tier (high card .. royal flush)
  const CELEB_MS = [1000, 2300, 2700, 3100, 3500, 3900, 4400, 5200, 6000, 8600];
  function celebTier(score) { return score[0] === 8 && score[1] === 14 ? 9 : score[0]; }
  function bestWin(g) {
    if (!g.result || g.result.uncontested) return null;
    let best = null;
    for (const w of g.result.winners) { const h = g.result.hands[w.id]; if (h && (!best || cmp(h.score, best.h.score) > 0)) best = { w, h }; }
    return best;
  }
  const celebMs = (g) => { const b = bestWin(g); return b ? CELEB_MS[celebTier(b.h.score)] : 0; };
  // A close call: the top two hands share a rank, so it comes down to the kickers.
  function duelInfo(g) {
    const b = bestWin(g);
    if (!b) return null;
    const hands = g.result.hands, winIds = new Set(g.result.winners.map((w) => w.id));
    const tiedWinner = g.result.winners.find((w) => w.id !== b.w.id && hands[w.id] && cmp(hands[w.id].score, b.h.score) === 0);
    let rid = tiedWinner?.id;
    if (!rid) for (const id of Object.keys(hands)) if (!winIds.has(id) && (!rid || cmp(hands[id].score, hands[rid].score) > 0)) rid = id;
    if (!rid || hands[rid].score[0] !== b.h.score[0]) return null;
    const ws = b.h.score, ls = hands[rid].score;
    let depth = 1; while (depth < ws.length && ws[depth] === ls[depth]) depth++;
    const tie = depth >= ws.length;
    return { wid: b.w.id, lid: rid, depth: Math.min(depth, ws.length - 1), steps: ws.length - 1, tie };
  }
  const DUEL_STEP = 750;
  const duelMs = (g) => { const d = duelInfo(g); return d ? 1300 + (d.depth) * DUEL_STEP + 1300 : 0; };

  const api = { duelInfo, duelMs, DUEL_STEP, CELEB_MS, celebTier, bestWin, celebMs, PERSONAS, personaOf, createGame, addPlayer, removePlayer, startHand, applyAction, legal, viewFor, botDecide, bestHand, isLive, RANKS, SUITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Poker = api;
})(typeof window !== 'undefined' ? window : globalThis);
