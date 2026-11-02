/* What does a given amount of thinking actually prove on this board?
   Positions come from one real self-played game: the opening, mid-game, and the endgame.
   Usage: node tools/ladder.mjs [positionsPerStage]                                   */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
(0, eval)(readFileSync(path.join(here, '..', 'engine.js'), 'utf8'));
const E = globalThis.FBEngine;
const cfg = { cellCols: 8, cellRows: 12, goalHalf: 1 };
const s = E.session(cfg);

/* one game, played at 'normal'; take the opening, and where each side has to answer */
const m = E.createMatch(cfg);
const shots = [];
let ply = 0;
while (!m.over && m.moves().length) {
  if (m.ps.side === 1) shots.push({ ply: ply, used: Uint8Array.from(m.ps.used), ball: m.ps.ball, side: 1 });
  const mv = m.cpu.choose('normal', m.ps, 300);
  if (!mv) break;
  if (!m.play(mv)) break;
  ply++;
}
const PER = Number(process.argv[2] || 2);
const pick = [];
const fresh = E.createMatch(cfg);
pick.push({ ply: 0, used: Uint8Array.from(fresh.ps.used), ball: fresh.ps.ball, side: 1, tag: 'opening' });
const mid = shots.filter(p => p.ply > 20 && p.ply < ply - 30);
const late = shots.filter(p => p.ply >= ply - 30);
for (const list of [mid, late]) for (let i = 0; i < PER && i < list.length; i++) pick.push(list[Math.floor(i * list.length / PER)]);
console.log(pick.length + ' positions from a ' + ply + '-ply game: ' + pick.map(p => (p.tag || 'ply ' + p.ply)).join(', '));

const psOf = (p) => E.stateFrom(m.board, p.used, p.ball, p.side);
const run = (level, budget, cap) => pick.map(p => {
  const one = E.session(cfg); one.cpu.clearCache();     // fresh table: the worst case
  const mv = one.cpu.choose(level, psOf(p), budget, cap);
  return mv ? { d: mv.depth, n: mv.nodes, ms: mv.ms } : { d: 0, n: 0, ms: 0 };
});
const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const fmt = (rs) => 'median depth ' + med(rs.map(r => r.d)).toString().padStart(2) +
  ', median ' + med(rs.map(r => r.n)).toLocaleString().padStart(9) + ' positions, median ' +
  med(rs.map(r => r.ms)).toString().padStart(5) + ' ms   (depths: ' + rs.map(r => r.d).join(' ') + ')';

console.log('\nA. what a clock buys, with no depth ceiling in the way (cap 30)');
for (const budget of [200, 400, 800, 1600, 3200]) {
  console.log('  ' + String(budget).padStart(5) + ' ms: ' + fmt(run('master', budget, 30)));
}
console.log('\nB. is the ceiling proved inside the time bound? (fresh table per position)');
for (const [lvl, depth, budget] of [['normal', 6, 500], ['hard', 12, 1200], ['expert', 16, 2000], ['master', 20, 3000], ['master', 22, 3000], ['master', 24, 3000]]) {
  const rs = run(lvl, budget, depth);
  const proved = rs.filter(r => r.d >= depth).length;
  console.log('  ' + lvl.padEnd(7) + ' cap ' + String(depth).padStart(2) + ' in ' + String(budget).padStart(4) + ' ms: proved at ' +
    proved + '/' + rs.length + ' positions — ' + fmt(rs));
}
