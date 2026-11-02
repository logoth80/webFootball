/* ad-hoc trace of the bounce-ladder position */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
(0, eval)(readFileSync(path.join(here, '..', 'engine.js'), 'utf8'));
const E = globalThis.FBEngine;

const cfg = { cellCols: 8, cellRows: 12, goalHalf: 1, ownGoals: true, firstTo: 1 };
const m = E.createMatch(cfg);
const b = m.board;
function adjEdge(b, n1, n2) { for (let k = 0; k < 8; k++) if (b.adjTo[n1 * 8 + k] === n2) return b.adjEdge[n1 * 8 + k]; return -1; }
const used = b.preUsed.slice();
for (let r = 1; r <= 7; r++) {
  const a = b.idx(b.gc, r), c = r === 1 ? b.idx(b.gc + 1, 2) : b.idx(b.gc + 1, r + 1);
  used[adjEdge(b, a, c)] = 1;
}
m.ps = E.stateFrom(b, used, b.idx(b.gc, 8), 0);
const xy = (n) => '(' + (n % b.W) + ',' + ((n / b.W) | 0) + ')';
for (let hop = 0; hop < 10; hop++) {
  const legal = E.legalMoves(b, m.ps);
  const mv = m.cpu.choose(process.argv[2] || 'hard', m.ps, parseInt(process.argv[3] || '400', 10));
  if (!mv) { console.log('no move'); break; }
  const alts = legal.map(v => xy(v.from) + '->' + xy(v.to) + (v.isBounce ? ' bounce' : '') + (v.isGoal ? ' GOAL' : '')).join('  ');
  console.log('hop ' + hop + ': pick ' + xy(mv.from) + '->' + xy(mv.to) + ' dir=' + mv.dir +
    ' bounce=' + mv.isBounce + ' goal=' + mv.isGoal + '  score=' + mv.score + ' depth=' + mv.depth +
    ' nodes=' + mv.nodes + ' ms=' + mv.ms);
  console.log('      legal: ' + alts);
  const ev = m.play(mv);
  if (!ev) { console.log('play rejected'); break; }
  if (ev.goal) { console.log('GOAL by side ' + ev.scorer); break; }
  if (!ev.bounce) { console.log('turn passed -> test position over'); break; }
}
