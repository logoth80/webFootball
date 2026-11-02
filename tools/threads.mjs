/* Would more cores make the CPU stronger? Not directly testable in the published game — from a
   file:// page the browser will not load a worker script at all (measured: new Worker('engine.js'),
   importScripts, fetch and XHR all fail, and SharedArrayBuffer is undefined). So this measures the
   best case that threads could buy on a served page: the same total thinking time split N ways
   across the root's answers, each core keeping its own transposition table because there is no way
   to share one without shared memory. Then it plays the two designs against each other.

   Run: node tools/threads.mjs [games]        (default 2, each side colours alternating)      */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const engSrc = readFileSync(path.join(here, '..', 'engine.js'), 'utf8');
/* A real worker gets its own copy of the engine, so its own tables: load the file once per core.
   The engine hands its exports to whatever global it is given, which makes that possible here. */
const loadEngine = () => { const box = {}; new Function('globalThis', engSrc)(box); return box.FBEngine; };
const E = loadEngine();
const cfg = { cellCols: 8, cellRows: 12, goalHalf: 1 };
const LEVEL = 'master';
const TOTAL = E.LEVELS[LEVEL].budget, N = 4;
const PER = Math.max(60, Math.floor(TOTAL / N));

/* one core, one shared table, the way the page searches today */
const solo = E.session(cfg);
/* N cores, N private tables, each asked only about a slice of the root's answers */
const cores = [];
for (let i = 0; i < N; i++) cores.push(loadEngine().session(cfg));

function childState(board, ps, mv) {
  const q = E.cloneState(board, ps);
  E.makeMove(q, mv);
  return q;
}

/* the split search: every root answer gets one core, none of which has seen the others' work */
function splitChoose(board, ps) {
  const moves = E.legalMoves(board, ps);
  if (!moves.length) return null;
  const side = ps.side;
  let best = null, bestVal = -Infinity;
  const depths = [];
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    let val;
    if (board.goalOwner[mv.to] !== -1) {
      val = (board.goalOwner[mv.to] === side) ? E.MATE - 1 : -E.MATE + 1;   /* terminal: nothing to search */
    } else {
      const r = cores[i % N].cpu.choose(LEVEL, childState(board, ps, mv), PER);
      if (!r) continue;
      depths.push(r.depth);
      val = mv.isBounce ? r.score : -r.score;
    }
    if (val > bestVal) { bestVal = val; best = mv; }
  }
  return { move: best, val: bestVal, depths: depths };
}

const GAMES = Number(process.argv[2] || 2);
let winsSolo = 0, winsSplit = 0, plyTotal = 0, bad = 0;
const depthSolo = [], depthSplit = [];
for (let g = 0; g < GAMES; g++) {
  const soloSide = g % 2;
  const m = E.createMatch(cfg);
  let ply = 0;
  while (!m.over && m.moves().length && ply < 200) {
    const side = m.ps.side;
    let mv, tag;
    if (side === soloSide) {
      const r = solo.cpu.choose(LEVEL, m.ps, TOTAL);
      mv = r; tag = 'solo';
      if (r) depthSolo.push(r.depth);
    } else {
      const r = splitChoose(m.board, m.ps);
      mv = r && r.move; tag = 'split';
      if (r && r.depths) depthSplit.push.apply(depthSplit, r.depths);
    }
    if (!mv) { bad++; break; }
    if (!m.play(mv)) { bad++; break; }
    ply++;
  }
  const winner = m.winner;
  if (winner === soloSide) winsSolo++; else winsSplit++;
  plyTotal += ply;
  console.log('  game ' + (g + 1) + ': ' + (winner === soloSide ? 'one core' : 'four cores') +
    ' won after ' + ply + ' strokes (one-core side was player ' + (soloSide + 1) + ')');
}
const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0;
console.log('\none core, one table, ' + TOTAL + ' ms a move:  won ' + winsSolo + ' of ' + GAMES +
  '  (median depth proved ' + med(depthSolo) + ')');
console.log(N + ' cores, ' + N + ' private tables, ' + PER + ' ms each: won ' + winsSplit + ' of ' + GAMES +
  '  (median depth proved per root answer: ' + med(depthSplit) + ')');
console.log('avg ' + Math.round(plyTotal / GAMES) + ' strokes a game, ' + bad + ' anomalies');
