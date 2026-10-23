// Fairness checks for the rules engine. Run with: npm test
// Every adjudication the game makes is compared against an independent reference here.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/poker.js');

const R = '23456789TJQKA', S = 'shdc';
const val = (c) => R.indexOf(c[0]) + 2;
const DECK = []; for (const r of R) for (const s of S) DECK.push(r + s);

// ---------- reference 7-card evaluator (no 5-card combinations; written independently) ----------
function refScore(cards) {
  const bySuit = {}; for (const c of cards) (bySuit[c[1]] ||= []).push(val(c));
  const straightHigh = (vals) => { const u = new Set(vals); if (u.has(14)) u.add(1); for (let h = 14; h >= 5; h--) { let ok = true; for (let k = 0; k < 5; k++) if (!u.has(h - k)) { ok = false; break; } if (ok) return h; } return 0; };
  for (const s in bySuit) if (bySuit[s].length >= 5) { const h = straightHigh(bySuit[s]); if (h) return [8, h]; }
  const cnt = {}; for (const c of cards) cnt[val(c)] = (cnt[val(c)] || 0) + 1;
  const atLeast = (n) => Object.keys(cnt).map(Number).filter((x) => cnt[x] >= n).sort((a, b) => b - a);
  const desc = cards.map(val).sort((a, b) => b - a);
  const quads = atLeast(4); if (quads.length) return [7, quads[0], desc.filter((x) => x !== quads[0])[0]];
  const trips = atLeast(3);
  if (trips.length) { const pr = atLeast(2).filter((x) => x !== trips[0]); if (pr.length) return [6, trips[0], pr[0]]; }
  for (const s in bySuit) if (bySuit[s].length >= 5) return [5, ...bySuit[s].sort((a, b) => b - a).slice(0, 5)];
  const sh = straightHigh(desc); if (sh) return [4, sh];
  if (trips.length) return [3, trips[0], ...desc.filter((x) => x !== trips[0]).slice(0, 2)];
  const pairs = atLeast(2);
  if (pairs.length >= 2) return [2, pairs[0], pairs[1], desc.filter((x) => x !== pairs[0] && x !== pairs[1])[0]];
  if (pairs.length) return [1, pairs[0], ...desc.filter((x) => x !== pairs[0]).slice(0, 3)];
  return [0, ...desc.slice(0, 5)];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return Math.sign(d); } return 0; };
function deal(n) { const d = DECK.slice(); for (let i = 0; i < n; i++) { const j = i + P.randInt(52 - i); [d[i], d[j]] = [d[j], d[i]]; } return d.slice(0, n); }

test('hand evaluation matches the reference on 200,000 random 7-card hands', () => {
  for (let t = 0; t < 200000; t++) {
    const seven = deal(7);
    assert.deepStrictEqual(P.bestHand(seven).score, refScore(seven), seven.join(' '));
  }
});

test('hand comparisons agree with the reference on 100,000 random head-to-heads', () => {
  for (let t = 0; t < 100000; t++) {
    const d = deal(9), board = d.slice(4), a = d.slice(0, 2).concat(board), b = d.slice(2, 4).concat(board);
    assert.strictEqual(Math.sign(P.cmp(P.bestHand(a).score, P.bestHand(b).score)), cmp(refScore(a), refScore(b)), `${a.join(' ')} vs ${b.join(' ')}`);
  }
});

test('edge cases are ranked correctly', () => {
  const s = (h) => P.bestHand(h.split(' ')).score;
  const name = (h) => P.bestHand(h.split(' ')).name;
  assert.strictEqual(name('As Ks Qs Js Ts 2d 3c'), '로열 스트레이트 플러시');
  assert.deepStrictEqual(s('Ah 2d 3c 4s 5h 9d Kc'), [4, 5]);                 // wheel is a 5-high straight
  assert.ok(P.cmp(s('6h 2d 3c 4s 5h 9d Kc'), s('Ah 2d 3c 4s 5h 9d Kc')) > 0); // 6-high beats the wheel
  assert.deepStrictEqual(s('As 2s 3s 4s 5s 9d Kc'), [8, 5]);                 // steel wheel
  assert.deepStrictEqual(s('Ah Ad Kc Ks 7h 7d 2c'), [2, 14, 13, 7]);         // three pairs: best two + best kicker
  assert.deepStrictEqual(s('9h 9d 9c 5s 5h 5d 2c'), [6, 9, 5]);             // two trips make a full house
  assert.deepStrictEqual(s('4c 4d 4h 4s Ah Kd 2c'), [7, 4, 14]);            // quads take the best kicker
  assert.ok(P.cmp(s('2h 3h 9h Jh Kh Ac Ad'), s('Ts Js Qs Kd Ac 9c 2d')) > 0); // flush beats straight
  assert.ok(P.cmp(s('Kh Kd Kc 2s 2h 5d 7c'), s('Ah Kh 9h 5h 2h Qd 3c')) > 0); // full house beats flush
  // board plays: both players split
  const board = 'Ts Js Qs Ks As'.split(' ');
  assert.strictEqual(P.cmp(P.bestHand(['2c', '3d'].concat(board)).score, P.bestHand(['4c', '5d'].concat(board)).score), 0);
  // the five cards shown are exactly the five that make the score, laid out in reading order
  assert.deepStrictEqual(P.bestHand('6h 9c 5d 7s 8h 2c Kd'.split(' ')).cards, ['9c', '8h', '7s', '6h', '5d']);
  assert.deepStrictEqual(P.bestHand('Ah 2d 3c 4s 5h 9d Kc'.split(' ')).cards, ['5h', '4s', '3c', '2d', 'Ah']);
});

// ---------- reference pot distribution: peel the smallest live stake each pass ----------
function refPayouts(g, before) {
  const n = g.players.length;
  const left = g.players.map((p) => p.total);
  const live = g.players.map((p) => p.inHand && !p.folded);
  const score = g.players.map((p) => (live[p.idx] && g.board.length === 5 ? refScore(p.hole.concat(g.board)) : null));
  const pay = new Array(n).fill(0);
  const seatFromButton = (i) => (i - g.dealer + n - 1) % n;
  let lastWinners = null;
  for (;;) {
    const alive = [...Array(n).keys()].filter((i) => live[i] && left[i] > 0);
    if (!alive.length) break;
    const m = Math.min(...alive.map((i) => left[i]));
    let pot = 0;
    for (let i = 0; i < n; i++) { const take = Math.min(left[i], m); pot += take; left[i] -= take; }
    let winners;
    if (alive.length === 1) winners = alive; // uncalled chips go back, or the last player standing takes it
    else {
      let best = null; winners = [];
      for (const i of alive) { const c = best ? cmp(score[i], best) : 1; if (c > 0) { best = score[i]; winners = [i]; } else if (c === 0) winners.push(i); }
    }
    const share = Math.floor(pot / winners.length); let odd = pot - share * winners.length;
    for (const i of winners.slice().sort((a, b) => seatFromButton(a) - seatFromButton(b))) { pay[i] += share + (odd > 0 ? 1 : 0); if (odd > 0) odd--; }
    lastWinners = winners;
  }
  // chips folded players put in above every live stake belong to the last pot
  const rest = left.reduce((a, b) => a + b, 0);
  if (rest && lastWinners) pay[lastWinners[0]] += rest;
  return g.players.map((p, i) => before[i] - p.total + pay[i]);
}

function randomAction(g, id) {
  const L = P.legal(g, id), r = Math.random();
  if (r < 0.15) return { type: 'fold' };
  if (r < 0.5) return { type: L.canCheck ? 'check' : 'call' };
  if (r < 0.62) return { type: 'allin' };
  if (r < 0.85 && L.canRaise) return { type: 'raise', amount: L.minTo + Math.floor(Math.random() * 6) * g.bb };
  return { type: L.canCheck ? 'check' : 'fold' };
}

test('pot distribution (side pots, refunds, splits, odd chips) matches the reference on 20,000 hands', () => {
  let sidePots = 0, refunds = 0, splits = 0;
  for (let t = 0; t < 20000; t++) {
    const n = 2 + (t % 6);
    const g = P.createGame({ sb: 5, bb: 10, startChips: 1000 });
    for (let i = 0; i < n; i++) P.addPlayer(g, { id: 'p' + i, name: 'P' + i });
    for (const p of g.players) p.chips = 10 + Math.floor(Math.random() * 120) * 5 + (Math.random() < 0.3 ? 3 : 0); // odd stacks too
    g.dealer = Math.floor(Math.random() * n) - 1;
    if (!P.startHand(g)) continue;
    g.players.forEach((p, i) => (p.idx = i));
    const before = g.players.map((p) => p.chips + p.total);
    let guard = 0;
    while (P.isLive(g)) { if (g.runout) { P.runoutStep(g); continue; } const p = g.players[g.toAct]; assert.ok(P.applyAction(g, p.id, randomAction(g, p.id)).ok); assert.ok(guard++ < 500, 'betting never ends'); }
    const expect = refPayouts(g, before);
    assert.deepStrictEqual(g.players.map((p) => p.chips), expect, g.log.join(' | '));
    assert.strictEqual(g.players.reduce((a, p) => a + p.chips, 0), before.reduce((a, b) => a + b, 0), 'chips created or destroyed');
    if (g.result.pots > 1) sidePots++;
    if (g.result.refunds?.length) refunds++;
    if (g.result.winners.length > 1) splits++;
  }
  assert.ok(sidePots > 500 && refunds > 500 && splits > 100, `coverage: ${sidePots} side pots, ${refunds} refunds, ${splits} splits`);
});

test('a refund is never reported as a win', () => {
  const g = P.createGame({ sb: 10, bb: 20, startChips: 1000 });
  P.addPlayer(g, { id: 'A', name: 'A' }); P.addPlayer(g, { id: 'B', name: 'B' });
  g.players[0].chips = 300;
  P.startHand(g);
  g.players[0].hole = ['Kh', 'Kd']; g.players[1].hole = ['Qh', 'Jd'];
  g.deck = g.deck.filter((c) => !['Kh', 'Kd', 'Qh', 'Jd', 'Kc', '7s', '7h', 'Qs', 'Jc'].includes(c)).concat(['Jc', 'Qs', '7h', '7s', 'Kc']);
  while (P.isLive(g)) { if (g.runout) { P.runoutStep(g); continue; } const p = g.players[g.toAct]; P.applyAction(g, p.id, p.id === 'B' ? { type: 'allin' } : { type: 'call' }); }
  assert.deepStrictEqual(g.result.winners.map((w) => w.id), ['A']);
  assert.deepStrictEqual(g.result.refunds.map((r) => [r.id, r.amount]), [['B', 700]]);
});

// ---------- betting rules ----------
function table(n, stacks) {
  const g = P.createGame({ sb: 10, bb: 20, startChips: 1000 });
  for (let i = 0; i < n; i++) P.addPlayer(g, { id: 'p' + i, name: 'P' + i });
  if (stacks) stacks.forEach((c, i) => (g.players[i].chips = c));
  P.startHand(g);
  return g;
}
const act = (g, a) => { const p = g.players[g.toAct]; const r = P.applyAction(g, p.id, a); assert.ok(r.ok, r.error); return p.id; };

test('only the player to act can act, and you cannot check facing a bet', () => {
  const g = table(3);
  const other = g.players.find((p, i) => i !== g.toAct);
  assert.strictEqual(P.applyAction(g, other.id, { type: 'call' }).ok, false);
  assert.strictEqual(P.applyAction(g, g.players[g.toAct].id, { type: 'check' }).ok, false);
});

test('a raise below the minimum is lifted to the minimum', () => {
  const g = table(3);
  const L = P.legal(g, g.players[g.toAct].id);
  const id = act(g, { type: 'raise', amount: 25 });
  assert.strictEqual(g.players.find((p) => p.id === id).bet, L.minTo);
  assert.strictEqual(L.minTo, 40);
});

test('heads-up: the button posts the small blind, acts first preflop and last after', () => {
  const g = table(2);
  const btn = g.players[g.dealer];
  assert.strictEqual(btn.bet, 10);
  assert.strictEqual(g.players[g.toAct], btn);
  act(g, { type: 'call' }); act(g, { type: 'check' });
  assert.strictEqual(g.street, 'flop');
  assert.notStrictEqual(g.players[g.toAct], btn);
});

test('the big blind gets the option to raise when everyone limps', () => {
  const g = table(3);
  act(g, { type: 'call' }); act(g, { type: 'call' });
  const bb = g.players[g.toAct];
  assert.strictEqual(bb.bet, 20);
  assert.ok(P.legal(g, bb.id).canRaise);
});

test('an all-in short of a full raise does not reopen the betting', () => {
  // flop: p? bets 100, a short stack shoves 130 (a 30 raise), the bettor may only call or fold
  const g = table(3, [1000, 1000, 1000]);
  while (g.street === 'preflop') act(g, { type: g.currentBet > g.players[g.toAct].bet ? 'call' : 'check' });
  const order = [];
  for (let k = 0; k < 3; k++) order.push(g.players[(g.toAct + k) % 3]);
  order[1].chips = 130; // make the second player short
  act(g, { type: 'raise', amount: 100 });
  act(g, { type: 'allin' });
  assert.strictEqual(order[1].bet, 130);
  act(g, { type: 'call' }); // third player just calls
  assert.strictEqual(g.players[g.toAct], order[0]);
  const L = P.legal(g, order[0].id);
  assert.strictEqual(L.canRaise, false, 'the original bettor may not re-raise');
  assert.strictEqual(L.toCall, 30);
});

test('a full raise does reopen the betting', () => {
  const g = table(3, [1000, 1000, 1000]);
  while (g.street === 'preflop') act(g, { type: g.currentBet > g.players[g.toAct].bet ? 'call' : 'check' });
  const first = g.players[g.toAct];
  act(g, { type: 'raise', amount: 100 });
  act(g, { type: 'raise', amount: 200 });
  act(g, { type: 'call' });
  assert.strictEqual(g.players[g.toAct], first);
  assert.ok(P.legal(g, first.id).canRaise);
});

// ---------- randomness ----------
test('the shuffle is uniform: every card lands in every position equally (chi-square)', () => {
  const N = 104000, counts = new Map();
  const idx = new Map(DECK.map((c, i) => [c, i]));
  const grid = new Uint32Array(52 * 52);
  for (let t = 0; t < N; t++) { const d = P.newDeck(); for (let pos = 0; pos < 52; pos++) grid[idx.get(d[pos]) * 52 + pos]++; }
  const e = N / 52; let chi = 0; for (const o of grid) chi += ((o - e) * (o - e)) / e;
  const df = 51 * 51, sd = Math.sqrt(2 * df);
  assert.ok(chi < df + 5 * sd && chi > df - 5 * sd, `chi-square ${chi.toFixed(0)} vs df ${df}`);
});

test('the shuffle uses the cryptographic RNG', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used for shuffling'); };
  try { P.newDeck(); } finally { Math.random = orig; }
  const seen = new Set(); for (let i = 0; i < 70000; i++) seen.add(P.randInt(7));
  assert.deepStrictEqual([...seen].sort(), [0, 1, 2, 3, 4, 5, 6]);
});

// ---------- information ----------
test('nobody sees hidden cards or the deck before showdown, and folded hands stay hidden after', () => {
  for (let t = 0; t < 2000; t++) {
    const g = table(2 + (t % 6));
    let guard = 0;
    while (P.isLive(g)) {
      for (const viewer of g.players) {
        const v = P.viewFor(g, viewer.id);
        assert.strictEqual(v.deck, undefined);
        if (!g.runout) for (const p of v.players) if (p.id !== viewer.id) assert.ok(p.hole.every((c) => c === '??'));
      }
      if (g.runout) {
        // during an all-in runout the live hands are tabled, but folded ones never are
        for (const viewer of g.players) for (const p of P.viewFor(g, viewer.id).players) if (p.id !== viewer.id && p.folded) assert.ok(p.hole.every((c) => c === '??'));
        P.runoutStep(g); continue;
      }
      const p = g.players[g.toAct]; P.applyAction(g, p.id, randomAction(g, p.id)); guard++;
    }
    for (const viewer of g.players) {
      const v = P.viewFor(g, viewer.id);
      for (const p of v.players) if (p.id !== viewer.id && (p.folded || g.result.uncontested)) assert.ok(p.hole.every((c) => c === '??'), 'a folded or unshown hand leaked');
    }
  }
});

test('bots decide without ever reading hidden cards', () => {
  for (let t = 0; t < 200; t++) {
    const g = table(4);
    const actor = g.players[g.toAct];
    const blind = P.viewFor(g, actor.id); // what the bot is allowed to know
    blind.deck = undefined;
    for (const p of blind.players) if (p.id !== actor.id) p.hole = ['??', '??'];
    const d = P.botDecide(blind, actor.id); // would throw or misbehave if it touched hidden cards
    assert.ok(d && ['fold', 'check', 'call', 'raise', 'allin'].includes(d.type));
  }
});

test('an all-in runout deals one street at a time and nobody can act during it', () => {
  const g = table(2, [300, 1000]);
  act(g, { type: 'allin' }); act(g, { type: 'call' });
  assert.strictEqual(g.runout, true);
  assert.strictEqual(g.board.length, 2);
  for (const p of g.players) assert.strictEqual(P.applyAction(g, p.id, { type: 'check' }).ok, false);
  const seen = [g.board.length];
  while (g.runout) { P.runoutStep(g); seen.push(g.board.length); }
  assert.deepStrictEqual(seen, [2, 3, 4, 5, 5]);
  assert.strictEqual(g.street, 'showdown');
});

// ---------- three-card poker ----------
function ref3(cards) { // brute-force reference: category from first principles, ranked like hold'em
  const v = cards.map(val).sort((a, b) => b - a);
  const suited = new Set(cards.map((c) => c[1])).size === 1;
  const distinct = new Set(v).size;
  const run = distinct === 3 && (v[0] - v[2] === 2 || (v[0] === 14 && v[1] === 3 && v[2] === 2));
  const high = v[0] === 14 && v[1] === 3 ? 3 : v[0];
  if (run && suited) return [8, high, 3];
  if (suited) return [5, ...v];
  if (run) return [4, high];
  if (distinct === 1) return [3, v[0]];
  if (distinct === 2) { const pair = v[0] === v[1] ? v[0] : v[1]; return [1, pair, v.find((x) => x !== pair)]; }
  return [0, ...v];
}

test('three-card hands match the reference for every one of the 22,100 possible hands', () => {
  let n = 0;
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
    const h = [DECK[a], DECK[b], DECK[c]];
    assert.deepStrictEqual(P.eval3(h), ref3(h), h.join(' ')); n++;
  }
  assert.strictEqual(n, 22100);
  const s = (h) => P.eval3(h.split(' '));
  assert.ok(P.cmp(s('Qh Jh Th'), s('Ad 9d 4d')) > 0);  // straight flush > flush
  assert.ok(P.cmp(s('Ad 9d 4d'), s('9c 8d 7h')) > 0);  // flush > straight (hold'em order)
  assert.ok(P.cmp(s('9c 8d 7h'), s('8s 8h 8d')) > 0);  // straight > trips (hold'em order)
  assert.ok(P.cmp(s('4c 3d 2h'), s('Ac 2d 3h')) > 0);  // A-2-3 is the lowest straight
  assert.deepStrictEqual(P.hand3('Ac 2d 3h'.split(' ')).cards, ['3h', '2d', 'Ac']);
});

test('three-card duels: payouts match the reference and chips are conserved over 10,000 hands', () => {
  for (let t = 0; t < 10000; t++) {
    const g = P.createGame({ variant: 'three', sb: 5, bb: 10, startChips: 1000 });
    P.addPlayer(g, { id: 'a', name: 'A' }); P.addPlayer(g, { id: 'b', name: 'B' });
    for (const p of g.players) p.chips = 10 + Math.floor(Math.random() * 120) * 5 + (Math.random() < 0.3 ? 3 : 0);
    g.dealer = Math.floor(Math.random() * 2) - 1;
    P.startHand(g);
    g.players.forEach((p, i) => (p.idx = i));
    assert.ok(g.players.every((p) => p.hole.length === 3));
    const before = g.players.map((p) => p.chips + p.total);
    while (P.isLive(g)) { if (g.runout) { P.runoutStep(g); continue; } const p = g.players[g.toAct]; assert.ok(P.applyAction(g, p.id, randomAction(g, p.id)).ok); }
    assert.strictEqual(g.board.length, 0, 'three-card poker never deals a board');
    // reference payout using the three-card reference evaluator
    const live = g.players.filter((p) => p.inHand && !p.folded);
    const n = 2, left = g.players.map((p) => p.total), pay = [0, 0];
    const sc = g.players.map((p) => (p.inHand && !p.folded ? ref3(p.hole) : null));
    for (;;) {
      const alive = [0, 1].filter((i) => sc[i] && left[i] > 0);
      if (!alive.length) break;
      const m = Math.min(...alive.map((i) => left[i])); let pot = 0;
      for (let i = 0; i < n; i++) { const take = Math.min(left[i], m); pot += take; left[i] -= take; }
      let winners = alive;
      if (alive.length === 2) { const c = cmp(sc[0], sc[1]); winners = c > 0 ? [0] : c < 0 ? [1] : [0, 1]; }
      const order = winners.slice().sort((x, y) => ((x - g.dealer + 1) % 2) - ((y - g.dealer + 1) % 2));
      const share = Math.floor(pot / winners.length); let odd = pot - share * winners.length;
      for (const i of order) { pay[i] += share + (odd > 0 ? 1 : 0); if (odd > 0) odd--; }
    }
    const rest = left.reduce((a, b) => a + b, 0); if (rest) pay[live.length === 1 ? g.players.indexOf(live[0]) : 0] += rest;
    assert.deepStrictEqual(g.players.map((p) => p.chips), g.players.map((p, i) => before[i] - p.total + pay[i]), g.log.join(' | '));
    assert.strictEqual(g.players[0].chips + g.players[1].chips, before[0] + before[1]);
  }
});
