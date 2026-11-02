/* How much thinking work does one move cost, and how much of it is a repeat?
   Run:  node tools/bench.mjs [level ...]

   A real game is played first, and the positions where one side is to kick are
   snapshotted. Then each of those positions is searched twice:

     cold  the table cleared first — what the game cost per move before the search
           was made to resume from the last kick's proof instead of restarting;
     warm  one table kept for the whole sequence — the position on the paper is a
           node the previous search already walked, and the search starts at the
           depth it has already proved.

   Reported per move: the depth actually reached inside the level's own time bound,
   the number of positions looked at, and the wall time. tools/ladder.mjs is the
   companion that asks the other question — what a given number of milliseconds
   proves, with no depth ceiling in the way — and tools/threads.mjs plays one
   shared table against the same time split across cores. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
(0, eval)(readFileSync(path.join(here, '..', 'engine.js'), 'utf8'));
const E = globalThis.FBEngine;
if (!E) { console.error('FBEngine not exported'); process.exit(1); }

const LEVELS = process.argv.slice(2).filter(l => E.LEVELS[l]);
if (!LEVELS.length) LEVELS.push('normal', 'hard', 'expert', 'master');
const POSITIONS = Number(process.env.POSITIONS || 6);
const cfg = { cellCols: 8, cellRows: 12, goalHalf: 1 };

/* one self-play game, keeping the positions a chosen side has to answer */
function collect(side, fromPly) {
  const m = E.createMatch(cfg);
  const out = [];
  let ply = 0;
  while (!m.over && m.moves().length && out.length < POSITIONS) {
    const mv = m.cpu.choose('normal', m.ps, 400);
    if (!mv) break;
    if (m.ps.side === side && ply >= fromPly) {
      out.push({ ply: ply, used: Uint8Array.from(m.ps.used), ball: m.ps.ball, side: m.ps.side });
    }
    if (!m.play(mv)) break;
    ply++;
  }
  return out;
}

function measure(positions, level, warm) {
  const budget = E.LEVELS[level].budget;
  const one = E.session(cfg);
  const rows = [];
  for (const p of positions) {
    const s = warm ? one : E.session(cfg);
    const ps = E.stateFrom(s.board, p.used, p.ball, p.side);
    const mv = s.cpu.choose(level, ps, budget);
    rows.push({ ply: p.ply, depth: mv ? mv.depth : 0, nodes: mv ? mv.nodes : 0, ms: mv ? mv.ms : 0 });
  }
  return rows;
}

const avg = (rows, k) => Math.round(rows.reduce((a, r) => a + r[k], 0) / rows.length);

console.log('classic pitch 8x12 — ' + POSITIONS + ' positions per level, each level on its own time budget\n');
for (const level of LEVELS) {
  const side = 1, positions = collect(side, 24);
  const cold = measure(positions, level, false);
  const warm = measure(positions, level, true);
  console.log(level + ' — budget ' + E.LEVELS[level].budget + ' ms, max depth ' + E.LEVELS[level].depth);
  console.log('        cold (fresh table per move)   avg depth ' + avg(cold, 'depth') +
              ', avg ' + avg(cold, 'nodes').toLocaleString() + ' positions, avg ' + avg(cold, 'ms') + ' ms');
  console.log('        warm (table kept across moves) avg depth ' + avg(warm, 'depth') +
              ', avg ' + avg(warm, 'nodes').toLocaleString() + ' positions, avg ' + avg(warm, 'ms') + ' ms');
  const cut = avg(cold, 'nodes') ? (1 - avg(warm, 'nodes') / avg(cold, 'nodes')) * 100 : 0;
  console.log('        work avoided by reusing the previous search: ' + cut.toFixed(0) + '% of positions looked at');
  for (let k = 0; k < positions.length; k++) {
    console.log('          ply ' + String(cold[k].ply).padStart(3) +
                '   cold d' + cold[k].depth + ' / ' + String(cold[k].nodes).padStart(9) + ' / ' + cold[k].ms + ' ms' +
                '   warm d' + warm[k].depth + ' / ' + String(warm[k].nodes).padStart(9) + ' / ' + warm[k].ms + ' ms');
  }
  console.log('');
}
