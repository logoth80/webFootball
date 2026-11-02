/* ===== ENGINE (pure logic: no DOM). Loaded by the page, and by tools/selftest.mjs, tools/bench.mjs ===== */
(function (g) {
  'use strict';

  var DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  var MATE = 1000000, MATEC = MATE - 5000;
  /* Strength ladder: a proved depth plus a clock. The label is the only thing a player sees, so
     the name is short and the numbers belong in the rules panel and the README, where they are
     measured rather than advertised.

     The depths below are chosen from what this search can actually prove, measured with
     tools/ladder.mjs on the classic pitch: one thread, empty table, the opening plus four positions
     taken along one 163-stroke game. Costs there, one thread:  depth 12 in ~22 ms,  depth 16 in
     ~160 ms,  depth 20 in ~1.0 s.
     With no ceiling in the way, 200/400/800/1600/3200 ms prove a median depth of 13/14/15/16/17
     on that sample: one extra ply per doubling of the clock, which is how the rungs are placed.
     (Two of those positions had a forced line to a goal proved at depth 9 and 13 and stopped
     there whatever the clock allowed, which drags the medians down; the slope is what repeats
     from sample to sample, not the absolute depth.) The old Hard(12) -> Expert(18) step claimed
     six plies more than this and both halves of it were proved in well under a second, which is
     why those two levels played the same game.
     Master has no ceiling it can reach: asked at a cap of 22 or 24 it proved the ceiling at none
     of the five positions inside 3.5 s (median 17 plies), so the clock is what stops it. Normal
     is what the original CPU was aiming for; Master is the old top rung renamed, Expert a rung
     between Hard and Master. */
  var LEVELS = {
    easy:   { depth: 1,  budget: 120,  label: 'Easy' },
    normal: { depth: 6,  budget: 500,  label: 'Normal' },
    hard:   { depth: 12, budget: 1000, label: 'Hard' },
    expert: { depth: 16, budget: 1500, label: 'Expert' },
    master: { depth: 26, budget: 3500, label: 'Master' }
  };

  /* ---------------- board ---------------- */
  function buildBoard(cfg) {
    cfg = cfg || {};
    var cw = Math.max(4, Math.round((cfg.cellCols || 8) / 2) * 2);
    var ch = Math.max(6, Math.round((cfg.cellRows || 12) / 2) * 2);
    var W = cw + 1, H = ch + 1, N = W * H;
    var gc = cw / 2, gr = ch / 2;
    var goalHalf = Math.max(1, Math.min(cfg.goalHalf == null ? 1 : cfg.goalHalf, gc - 1));
    function idx(c, r) { return r * W + c; }

    var edgeNodes = [], edgeId = new Map();
    function addEdge(a, b) {
      var k = a < b ? a * N + b : b * N + a;
      var got = edgeId.get(k); if (got !== undefined) return got;
      var e = edgeNodes.length; edgeNodes.push([a, b]); edgeId.set(k, e); return e;
    }
    var fwd = [[1, 0], [0, 1], [1, 1], [-1, 1]], c, r, e;
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) {
      for (var f = 0; f < 4; f++) {
        var nc = c + fwd[f][0], nr = r + fwd[f][1];
        if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
        addEdge(idx(c, r), idx(nc, nr));
      }
    }
    var E = edgeNodes.length;
    var adjEdge = new Int32Array(N * 8), adjTo = new Int32Array(N * 8);
    for (e = 0; e < N * 8; e++) { adjEdge[e] = -1; adjTo[e] = -1; }
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) {
      for (var k = 0; k < 8; k++) {
        var tc = c + DIRS[k][0], tr = r + DIRS[k][1];
        if (tc < 0 || tc >= W || tr < 0 || tr >= H) continue;
        adjEdge[idx(c, r) * 8 + k] = addEdge(idx(c, r), idx(tc, tr));
        adjTo[idx(c, r) * 8 + k] = idx(tc, tr);
      }
    }

    /* printed pitch — the border, the half-way line, the goal-area lines and the two post lines.
       Nothing else is printed: the thick border is what defines the pitch. */
    var pre = [], printed = [], seen = new Set();
    function add(c1, r1, c2, r2) {
      var ee = addEdge(idx(c1, r1), idx(c2, r2));
      if (!seen.has(ee)) { seen.add(ee); pre.push(ee); printed.push(ee); }
    }
    var cols = [0, W - 1], i;
    for (i = 0; i < 2; i++) for (r = 1; r <= H - 3; r++) add(cols[i], r, cols[i], r + 1);          /* sidelines, corner edges left open */
    for (c = 0; c <= W - 2; c++) add(c, gr, c + 1, gr);                                            /* half-way line */
    var rows = [1, H - 2];
    for (i = 0; i < 2; i++) for (c = 0; c <= W - 2; c++) {                                        /* goal-area line, open in front of the mouth */
      if (c >= gc - goalHalf && c < gc + goalHalf) continue;
      add(c, rows[i], c + 1, rows[i]);
    }
    var posts = [gc - goalHalf, gc + goalHalf];
    for (i = 0; i < 2; i++) { add(posts[i], 0, posts[i], 1); add(posts[i], H - 2, posts[i], H - 1); }

    /* The printed border is the pitch, so everything outside it is out of play: the dots beyond the
       touchlines and the strips beside the goal boxes. Those strokes are blocked in the state and are
       not drawn either, so the paper shows exactly what may be played. A stroke may not leave the
       pitch — checked at its endpoints and at its middle — which is what the original enforced with
       its faint goal-area hatch. */
    function onPitch(x, y) {
      if (y >= 1 && y <= H - 2) return true;                                       /* inside the touchlines */
      return x >= gc - goalHalf && x <= gc + goalHalf && (y <= 1 || y >= H - 2);  /* between the posts */
    }
    var inPlay = new Uint8Array(N), hidden = [];
    for (r = 0; r < H; r++) for (c = 0; c < W; c++) inPlay[idx(c, r)] = onPitch(c, r) ? 1 : 0;
    for (e = 0; e < E; e++) {
      if (seen.has(e)) continue;
      var en = edgeNodes[e], na = en[0], nb = en[1];
      var ax = na % W, ay = (na / W) | 0, bx = nb % W, by = (nb / W) | 0;
      if (onPitch(ax, ay) && onPitch(bx, by) && onPitch((ax + bx) / 2, (ay + by) / 2)) continue;
      seen.add(e); hidden.push(e);
    }
    pre = pre.concat(hidden);

    var goalNodes = [[], []], goalOwner = new Int8Array(N); for (e = 0; e < N; e++) goalOwner[e] = -1;
    for (c = gc - goalHalf; c <= gc + goalHalf; c++) {
      goalNodes[0].push(idx(c, 0)); goalOwner[idx(c, 0)] = 0;
      goalNodes[1].push(idx(c, H - 1)); goalOwner[idx(c, H - 1)] = 1;
    }
    var hdist = [new Int32Array(N), new Int32Array(N)];
    for (var s = 0; s < 2; s++) for (var n = 0; n < N; n++) {
      var best = 1e9, cc = n % W, rrw = (n / W) | 0;
      for (i = 0; i < goalNodes[s].length; i++) {
        var t = goalNodes[s][i], d = Math.abs(cc - (t % W)) + Math.abs(rrw - ((t / W) | 0));
        if (d < best) best = d;
      }
      hdist[s][n] = best;
    }
    var preUsed = new Uint8Array(E); for (i = 0; i < pre.length; i++) preUsed[pre[i]] = 1;
    var printVisible = new Uint8Array(E); for (i = 0; i < printed.length; i++) printVisible[printed[i]] = 1;

    return {
      cellCols: cw, cellRows: ch, W: W, H: H, N: N, E: E, gc: gc, gr: gr, goalHalf: goalHalf,
      idx: idx, center: idx(gc, gr), adjEdge: adjEdge, adjTo: adjTo,
      edgeNodes: edgeNodes, goalNodes: goalNodes, goalOwner: goalOwner, hdist: hdist,
      preUsed: preUsed, preCount: pre.length, playable: E - pre.length,
      printVisible: printVisible, printCount: printed.length, inPlay: inPlay
    };
  }

  /* ---------------- state, moves ---------------- */
  function bumpDeg(board, used, deg, sign) {
    var en = board.edgeNodes;
    for (var e = 0; e < board.E; e++) { if (!used[e]) continue; deg[en[e][0]] += sign; deg[en[e][1]] += sign; }
  }
  function newState(board, side) {
    var used = board.preUsed.slice(), deg = new Int32Array(board.N);
    bumpDeg(board, used, deg, 1);
    return { used: used, deg: deg, ball: board.center, side: side || 0 };
  }
  function stateFrom(board, usedArr, ball, side) {
    var used = new Uint8Array(board.E);
    for (var e = 0; e < board.E; e++) used[e] = usedArr[e] ? 1 : 0;
    var deg = new Int32Array(board.N); bumpDeg(board, used, deg, 1);
    return { used: used, deg: deg, ball: ball, side: side };
  }
  function cloneState(board, ps) {
    return { used: ps.used.slice(), deg: ps.deg.slice(), ball: ps.ball, side: ps.side };
  }
  /* isBounce / isGoal are evaluated against the position BEFORE the stroke is drawn */
  function legalMoves(board, ps) {
    var out = [], a = ps.ball, side = ps.side, base = a * 8;
    for (var k = 0; k < 8; k++) {
      var e = board.adjEdge[base + k];
      if (e < 0 || ps.used[e]) continue;
      var to = board.adjTo[base + k], own = board.goalOwner[to];
      out.push({
        edge: e, from: a, to: to, dir: k, isBounce: ps.deg[to] > 0,
        isGoal: own === side, isOwnGoal: own !== -1 && own !== side
      });
    }
    return out;
  }
  function makeMove(ps, mv) {
    ps.used[mv.edge] = 1; ps.deg[mv.from]++; ps.deg[mv.to]++; ps.ball = mv.to;
    if (!mv.isBounce) ps.side ^= 1;
  }
  function unmakeMove(ps, mv) {
    if (!mv.isBounce) ps.side ^= 1;
    ps.ball = mv.from; ps.deg[mv.from]--; ps.deg[mv.to]--; ps.used[mv.edge] = 0;
  }

  /* ---------------- CPU ---------------- */
  function createCpu(board) {
    var seed = 2246822251 >>> 0;
    function rnd32() {
      seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed >>> 0;
    }
    var zE1 = new Uint32Array(board.E), zE2 = new Uint32Array(board.E);
    var zB1 = new Uint32Array(board.N), zB2 = new Uint32Array(board.N);
    var i;
    for (i = 0; i < board.E; i++) { zE1[i] = rnd32(); zE2[i] = rnd32(); }
    for (i = 0; i < board.N; i++) { zB1[i] = rnd32(); zB2[i] = rnd32(); }
    var zS1 = rnd32(), zS2 = rnd32();
    /* The transposition table is one entry per slot, addressed by the first hash word and
       verified by the second. Two things it deliberately does not do: it never refuses to
       store (a table that stops accepting entries mid-search is the same as no table at all,
       and that is what a size cap used to mean here), and it never lets a shallow entry
       overwrite a deep one. Five Int32Arrays hold a quarter of a million positions in about
       5 MB, which is what makes it possible to keep one across moves instead of rebuilding
       it for every kick. */
    var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
    var ttA = new Int32Array(TT_SIZE), ttB = new Int32Array(TT_SIZE), ttV = new Int32Array(TT_SIZE),
        ttM = new Int32Array(TT_SIZE), ttD = new Int32Array(TT_SIZE);
    var ttFill = 0;
    function ttClear() {
      ttA.fill(0); ttB.fill(0); ttV.fill(0); ttM.fill(0); ttD.fill(0); ttFill = 0;
    }
    var dist = new Int32Array(board.N), que = new Int32Array(board.N);
    var h1 = 0, h2 = 0, ctx = null, nodes = 0;
    var ABORT = { abort: true };

    function hashAll(ps) {
      h1 = ps.side ? zS1 : 0; h2 = ps.side ? zS2 : 0;
      for (var e = 0; e < board.E; e++) if (ps.used[e]) { h1 ^= zE1[e]; h2 ^= zE2[e]; }
      h1 ^= zB1[ps.ball]; h2 ^= zB2[ps.ball];
    }
    function rehashOn(mv, flip) {
      h1 ^= zE1[mv.edge]; h1 ^= zB1[mv.from]; h1 ^= zB1[mv.to]; if (flip) h1 ^= zS1;
      h2 ^= zE2[mv.edge]; h2 ^= zB2[mv.from]; h2 ^= zB2[mv.to]; if (flip) h2 ^= zS2;
    }

    /* how many kicks along still-blank strokes to each goal, from where the ball is */
    function evaluate(ps) {
      var side = ps.side, used = ps.used, n, k, e, t;
      for (n = 0; n < board.N; n++) dist[n] = -1;
      var head = 0, tail = 0;
      dist[ps.ball] = 0; que[tail++] = ps.ball;
      while (head < tail) {
        n = que[head++]; var d0 = dist[n], base = n * 8;
        for (k = 0; k < 8; k++) {
          e = board.adjEdge[base + k]; if (e < 0 || used[e]) continue;
          t = board.adjTo[base + k]; if (dist[t] >= 0) continue;
          dist[t] = d0 + 1; que[tail++] = t;
        }
      }
      var mine = 40, his = 40, gn = board.goalNodes[side], gn2 = board.goalNodes[side ^ 1];
      for (var a = 0; a < gn.length; a++) { var v = dist[gn[a]]; if (v >= 0 && v < mine) mine = v; }
      for (a = 0; a < gn2.length; a++) { var v2 = dist[gn2[a]]; if (v2 >= 0 && v2 < his) his = v2; }
      var mob = 0, base2 = ps.ball * 8;
      for (k = 0; k < 8; k++) { var ee = board.adjEdge[base2 + k]; if (ee >= 0 && !used[ee]) mob++; }
      var sc = 42 * (his - mine) + 7 * mob;
      return sc > 900000 ? 900000 : (sc < -900000 ? -900000 : sc);
    }

    function orderScore(mv, side) {
      return (mv.isGoal ? 1000000 : 0) + (mv.isOwnGoal ? -200000 : 0) + (mv.isBounce ? 4000 : 0)
        + (board.hdist[side][mv.from] - board.hdist[side][mv.to]) * 25;
    }

    function search(ps, depth, alpha, beta, ply) {
      if (((++nodes) & 1023) === 0 && Date.now() > ctx.deadline) throw ABORT;
      var moves = legalMoves(board, ps);
      if (!moves.length) return -MATE + ply;                 /* the player to kick has no stroke left */
      if (depth <= 0) return evaluate(ps);

      var key1 = h1, slot = (key1 >>> 0) & TT_MASK, ttMove = -1, alphaOrig = alpha, v, pack, pflag;
      if (ttA[slot] === key1 && ttB[slot] === h2) {
        pack = ttD[slot]; pflag = pack & 3; ttMove = ttM[slot];
        if ((pack >> 2) >= depth) {
          v = ttV[slot];
          if (v >= MATEC) v -= ply; else if (v <= -MATEC) v += ply;
          if (pflag === 0) return v;
          if (pflag === 1) { if (v > alpha) alpha = v; } else { if (v < beta) beta = v; }
          if (alpha >= beta) return v;
        }
      }
      var side = ps.side, m, mv, flip, val, owner, best = -Infinity, bestMove = -1;
      if (ttMove >= 0) {
        for (m = 0; m < moves.length; m++) if (moves[m].edge === ttMove) { var tmp = moves[m]; moves.splice(m, 1); moves.unshift(tmp); break; }
      } else {
        moves.sort(function (a, b) { return orderScore(b, side) - orderScore(a, side); });
      }
      for (m = 0; m < moves.length; m++) {
        mv = moves[m]; flip = mv.isBounce ? 0 : 1;
        /* The first move gets the whole window; the rest are tested against a one-ply window
           around what is already known to be good enough (principal variation search). A move
           that cannot beat it is dropped without being looked at, which is where most of the
           time for a deeper ply comes from; only a move that lands inside the narrow window
           has to be searched again properly. */
        var narrow = m > 0 && alpha > -Infinity && beta > alpha + 1;
        var lo = alpha, hi = narrow ? alpha + 1 : beta;
        makeMove(ps, mv); rehashOn(mv, flip);
        try {
          owner = board.goalOwner[mv.to];
          /* a bounce means the same player kicks again, so that child is not negated
             and its window is not mirrored — the tree does not strictly alternate */
          if (owner !== -1) val = (owner === side) ? (MATE - ply - 1) : (-MATE + ply + 1);
          else if (mv.isBounce) val = search(ps, depth - 1, lo, hi, ply + 1);
          else val = -search(ps, depth - 1, -hi, -lo, ply + 1);
          if (narrow && val > alpha && val < beta) {
            if (mv.isBounce) val = search(ps, depth - 1, alpha, beta, ply + 1);
            else val = -search(ps, depth - 1, -beta, -alpha, ply + 1);
          }
        } finally {
          /* a time-out aborts the tree: the position must still be rewound */
          unmakeMove(ps, mv); rehashOn(mv, flip);
        }
        if (val > best) { best = val; bestMove = mv.edge; }
        if (val > alpha) alpha = val;
        if (alpha >= beta) break;
      }
      /* store unless the slot already holds this same position searched deeper */
      var sv = best;
      if (sv >= MATEC) sv += ply; else if (sv <= -MATEC) sv -= ply;
      if (!(ttA[slot] === key1 && ttB[slot] === h2 && (ttD[slot] >> 2) > depth)) {
        if (ttD[slot] === 0) ttFill++;
        ttA[slot] = key1; ttB[slot] = h2; ttV[slot] = sv; ttM[slot] = bestMove;
        ttD[slot] = (depth << 2) | (best <= alphaOrig ? 2 : (best >= beta ? 1 : 0));
      }
      return best;
    }

    function easyPick(moves, ps) {
      var pool = [], i, mv, dead;
      for (i = 0; i < moves.length; i++) {
        mv = moves[i];
        if (mv.isOwnGoal) continue;
        if (mv.isBounce) {
          makeMove(ps, mv); dead = legalMoves(board, ps).length === 0; unmakeMove(ps, mv);
          if (dead) continue;
        }
        pool.push(mv);
      }
      if (!pool.length) pool = moves;
      var wins = pool.filter(function (m) { return m.isGoal; });
      var p = wins.length ? wins : pool;
      return p[(Math.random() * p.length) | 0];
    }

    function choose(level, ps, budgetOverride, depthOverride) {
      var lv = LEVELS[level] || LEVELS.normal;
      var moves = legalMoves(board, ps);
      if (!moves.length) return null;
      if (level === 'easy') { var ep = easyPick(moves, ps); return ep; }

      /* depthOverride is for measuring the cost of one ply. A level is a ceiling, never a
         floor, and an omitted override must mean the level's ceiling — not depth 1. */
      var cap = depthOverride ? Math.min(lv.depth, Math.max(1, depthOverride | 0)) : lv.depth;
      var budget = Math.max(60, budgetOverride || lv.budget);
      var rootSide = ps.side, t0 = Date.now();
      ctx = { deadline: t0 + budget }; nodes = 0;
      hashAll(ps);

      var ordered = moves, scores = new Map(), best = moves[0], bestScore = -Infinity, done = 0, d;
      var doneWlo = -Infinity, doneWhi = Infinity;   /* the window of the deepest completed pass */
      /* Iterative deepening normally starts again at ply 1 for every kick and walks the whole
         tree again to get nowhere new. If this very position is in the table — it was, a move
         ago, a node inside the tree that was just searched — start from the depth that
         proof already reached, and spend the time on what is actually new. */
      var startAt = 1, slotP = (h1 >>> 0) & TT_MASK;
      var hitP = ttA[slotP] === h1 && ttB[slotP] === h2;
      /* start one ply past the proof the table already holds: re-walking the depth that is already
         proved proves nothing new. If that is past what this level asks for, nothing is searched
         at all and the recorded move is the answer (see fromTable below). */
      if (hitP) { startAt = (ttD[slotP] >> 2) + 1; if (startAt < 1) startAt = 1; }

      for (d = startAt; d <= cap; d++) {
        ordered = moves.slice();
        if (scores.size) ordered.sort(function (a, b) { return (scores.get(b.edge) || -Infinity) - (scores.get(a.edge) || -Infinity); });
        var slotR = (h1 >>> 0) & TT_MASK;
        if (ttA[slotR] === h1 && ttB[slotR] === h2 && ttM[slotR] >= 0) {
          for (var q = 0; q < ordered.length; q++) if (ordered[q].edge === ttM[slotR]) { var tp = ordered[q]; ordered.splice(q, 1); ordered.unshift(tp); break; }
        }
        /* What a position is worth hardly ever moves far when one more ply is looked at, so the
           new depth is searched inside a narrow window around what the previous depth concluded
           rather than from -Infinity to +Infinity: that is what lets a re-walked tree cut
           immediately instead of being looked at again. Only when the answer turns out to sit
           outside the window is that depth searched a second time, once without a window. */
        var wlo = -Infinity, whi = Infinity, retried = false, aborted = false;
        if (done && Math.abs(bestScore) < MATEC) { wlo = bestScore - 60; whi = bestScore + 60; }
        for (;;) {
          var alpha = -Infinity, localBest = null, local = new Map();
          try {
            for (var m2 = 0; m2 < ordered.length; m2++) {
              var mv2 = ordered[m2], loR = Math.max(alpha, wlo);
              var hiR = Math.min(whi, (m2 > 0 && loR > -Infinity) ? loR + 1 : whi);
              makeMove(ps, mv2); rehashOn(mv2, mv2.isBounce ? 0 : 1);
              try {
                var own = board.goalOwner[mv2.to], val2;
                if (own !== -1) val2 = (own === rootSide) ? (MATE - 1) : (-MATE + 1);
                else if (mv2.isBounce) {
                  val2 = search(ps, d - 1, loR, hiR, 1);
                  if (hiR < whi && val2 > loR && val2 < whi) val2 = search(ps, d - 1, loR, whi, 1);
                } else {
                  val2 = -search(ps, d - 1, -hiR, -loR, 1);
                  if (hiR < whi && val2 > loR && val2 < whi) val2 = -search(ps, d - 1, -whi, -loR, 1);
                }
              } finally {
                unmakeMove(ps, mv2); rehashOn(mv2, mv2.isBounce ? 0 : 1);
              }
              local.set(mv2.edge, val2);
              if (val2 > alpha) { alpha = val2; localBest = mv2; }
            }
          } catch (err) { if (err !== ABORT) throw err; aborted = true; }
          if (aborted) break;
          if (!retried && wlo > -Infinity && (alpha <= wlo || alpha >= whi)) {
            retried = true; wlo = -Infinity; whi = Infinity; continue;
          }
          break;
        }
        if (aborted) break;
        scores = local;
        if (localBest) { best = localBest; bestScore = alpha; done = d; doneWlo = wlo; doneWhi = whi; }
        if (Math.abs(bestScore) >= MATEC) break;
        if (Date.now() > ctx.deadline) break;
      }

      /* Store what the root itself is worth. The search below only ever writes entries for the
         positions *under* the root, so a position the CPU is actually asked to play was never
         recorded by its own search — reaching it again (after an undo, or with a different level
         asked for) started from scratch even though the answer had been proved minutes ago. */
      if (done > 0) {
        /* the root is ply 0, so no mate re-base is needed there */
        if (!(ttA[slotP] === h1 && ttB[slotP] === h2 && (ttD[slotP] >> 2) > done)) {
          if (ttD[slotP] === 0) ttFill++;
          ttA[slotP] = h1; ttB[slotP] = h2; ttV[slotP] = bestScore; ttM[slotP] = best.edge;
          ttD[slotP] = (done << 2) | (doneWlo > -Infinity && bestScore <= doneWlo ? 2 :
                                      (doneWhi < Infinity && bestScore >= doneWhi ? 1 : 0));
        }
      }
      /* The position is already proven deeper than this level asks for: the move the table
         recorded for it is the answer, and there is nothing new to score. Say so, instead of
         reporting a depth of 1 for a move that was answered without any new searching at all. */
      var fromTable = false, tableDepth = 0;
      if (done === 0 && hitP && ttM[slotP] >= 0) {
        for (var q3 = 0; q3 < moves.length; q3++) if (moves[q3].edge === ttM[slotP]) best = moves[q3];
        if ((ttD[slotP] & 3) === 0) bestScore = ttV[slotP];   /* an exact proof from earlier work */
        tableDepth = ttD[slotP] >> 2;
        fromTable = true;
      }
      /* Several moves can score exactly the same. Do not choose one of them at random:
         keep the order the search already put them in — goal first, then avoiding own
         goals, then keeping the bounce tempo — so a given position is always answered the
         same way. Randomising is left to 'easy' on purpose (see easyPick). */
      var pick = best;
      for (var i2 = 0; i2 < ordered.length; i2++) {
        if (scores.get(ordered[i2].edge) === bestScore) { pick = ordered[i2]; break; }
      }
      return {
        edge: pick.edge, from: pick.from, to: pick.to, dir: pick.dir, isBounce: pick.isBounce,
        isGoal: pick.isGoal, isOwnGoal: pick.isOwnGoal,
        /* depth: how deep this answer is actually proved. Either what the search just proved
           (done), or — when nothing new was searched because the table already held the answer —
           the proof the table holds, capped at what was asked; tableDepth says the real number,
           which is what the page prints in that case. partial says the clock cut the walk off
           before it proved even one ply, and the move is the best that partial walk saw. */
        score: bestScore,
        depth: done || Math.min(cap, fromTable ? Math.max(1, tableDepth) : startAt),
        fromTable: fromTable, tableDepth: tableDepth,
        partial: (!done && !fromTable && startAt <= cap),
        nodes: nodes, ms: Date.now() - t0
      };
    }

    return {
      choose: choose,
      clearCache: ttClear,
      stats: function () { return { ttFill: ttFill, ttSize: TT_SIZE }; }
    };
  }

  var sessions = new Map();
  function session(cfg) {
    var key = [cfg.cellCols, cfg.cellRows, cfg.goalHalf | 0].join('|');
    var s = sessions.get(key);
    if (!s) { var board = buildBoard(cfg); s = { board: board, cpu: createCpu(board) }; sessions.set(key, s); }
    return s;
  }

  /* ---------------- match: the next goal decides it, own goals included; undo ---------------- */
  function createMatch(cfg) {
    var s = session(cfg);
    var M = {
      cfg: cfg, board: s.board, cpu: s.cpu, ps: null, scores: [0, 0],
      over: false, winner: null, reason: '', hist: [],

      reset: function () {
        this.ps = newState(this.board, 0); this.scores = [0, 0];
        this.over = false; this.winner = null; this.reason = ''; this.hist = [];
      },
      moves: function () { return legalMoves(this.board, this.ps); },
      pick: function (dir) {
        var ms = this.moves();
        for (var i = 0; i < ms.length; i++) if (ms[i].dir === dir) return ms[i];
        return null;
      },

      play: function (mv) {
        if (this.over || !mv) return null;
        var board = this.board, ps = this.ps, legal = legalMoves(board, ps), found = null;
        for (var i = 0; i < legal.length; i++) if (legal[i].edge === mv.edge) { found = legal[i]; break; }
        if (!found) return null;

        var rec = {
          kind: 'move', mv: found, side: ps.side, scores: this.scores.slice(),
          over: this.over, winner: this.winner, reason: this.reason
        };
        var evt = { kind: 'kick', side: rec.side, from: found.from, to: found.to, bounce: found.isBounce, goal: false, ownGoal: false, stuck: false };
        makeMove(ps, found);

        var owner = board.goalOwner[found.to];
        if (owner !== -1) {
          /* the next goal settles the match, and it counts whichever way the ball goes in:
             landing in the goal you do not attack scores for the other side */
          evt.goal = true; evt.scorer = owner; evt.ownGoal = (owner !== rec.side);
          this.scores[owner]++;
          this.over = true; this.winner = owner; this.reason = evt.ownGoal ? 'own goal' : 'goals';
        }
        if (!this.over && legalMoves(board, ps).length === 0) {
          this.over = true; this.winner = ps.side ^ 1; this.reason = 'no strokes left'; evt.stuck = true;
        }
        this.hist.push(rec);
        return evt;
      },

      undo: function () {
        if (!this.hist.length) return false;
        var rec = this.hist.pop(), ps = this.ps;
        unmakeMove(ps, rec.mv);
        ps.side = rec.side;
        this.scores = rec.scores; this.over = rec.over; this.winner = rec.winner; this.reason = rec.reason;
        return true;
      },

      strokes: function () {
        var out = [];
        for (var i = 0; i < this.hist.length; i++) {
          var r = this.hist[i]; if (r.kind !== 'move') continue;
          out.push({ from: r.mv.from, to: r.mv.to, side: r.side, edge: r.mv.edge });
        }
        return out;
      }
    };
    M.reset();
    return M;
  }

  g.FBEngine = {
    DIRS: DIRS, MATE: MATE, LEVELS: LEVELS, buildBoard: buildBoard, session: session,
    createMatch: createMatch, newState: newState, stateFrom: stateFrom, cloneState: cloneState,
    legalMoves: legalMoves, makeMove: makeMove, unmakeMove: unmakeMove
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
/* ===== ENGINE END ===== */
