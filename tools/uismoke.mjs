/* Boots the interface (app.js) against a tiny stub DOM and plays a few moves through the
   on-screen key pad, so the whole UI wiring is exercised head-less. The page's own timers are
   virtual here: the CPU thinks in setTimeout slices, and driving them in step is what lets the
   test see the search climb one slice at a time.
   Run: node tools/uismoke.mjs [moves]                                              */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(here, '..', f), 'utf8');
const engSrc = read('engine.js');
(0, eval)(engSrc);
const appSrc = read('app.js');

const MOVES = parseInt(process.argv[2] || '14', 10);
let failures = 0, checks = 0;
function ok(cond, label, extra) {
  checks++;
  if (cond) console.log('  ok    ' + label);
  else { failures++; console.log('  FAIL  ' + label + (extra ? '   -> ' + extra : '')); }
}

/* ---------- tiny DOM ---------- */
function ctx2d() {
  return new Proxy({ calls: 0 }, {
    get(t, k) { if (k in t || k === 'calls') return t[k]; return function () { t.calls++; }; },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeEl(tag, id) {
  const el = {
    tagName: tag, id: id || '', style: {}, dataset: {}, children: [], text: '', innerHTML: '',
    value: '', checked: true, width: 0, height: 0, scrollTop: 0, scrollHeight: 0,
    clientWidth: 980, clientHeight: 760, hidden: false, firstChild: null, handlers: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); return c; },
    replaceChildren() { el.children.length = 0; },
    addEventListener(type, fn) { (el.handlers[type] = el.handlers[type] || []).push(fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }; },
    getContext() { return ctx2d(); }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el.text; },
    set(v) { el.text = String(v); }
  });
  el.firstChild = { textContent: '' };
  return el;
}
const registry = new Map();
function getEl(id) {
  if (!registry.has(id)) registry.set(id, makeEl(id === 'field' ? 'canvas' : 'div', id));
  return registry.get(id);
}
const documentStub = {
  getElementById(id) { return getEl(id); },
  createElement(tag) { return makeEl(tag); },
  documentElement: { style: { setProperty() {} }, setAttribute() {}, getAttribute() { return null; } }
};

let clock = performance.now();
const frameQueue = [];
function raf(cb) { frameQueue.push(cb); return frameQueue.length; }
/* the page's setTimeout is virtual here so the CPU's thinking slices can be stepped through */
const timers = [];
let timerSeq = 1;
function vSetTimeout(fn, ms) { const id = timerSeq++; timers.push({ id: id, at: clock + (Number(ms) || 0), fn: fn }); return id; }
function vClearTimeout(id) { for (let i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; } }
function runTimers() {
  let guard = 0;
  while (timers.length && guard++ < 6000) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    clock = Math.max(clock, t.at);
    t.fn();
  }
}
function runFrames(n) {
  for (let i = 0; i < n; i++) {
    const q = frameQueue.splice(0, frameQueue.length);
    clock += 90;
    runTimers();
    for (const cb of q) cb(clock);
  }
}
const winHandlers = {};
const windowStub = {
  addEventListener(type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); },
  devicePixelRatio: 1, FBEngine: globalThis.FBEngine
};

let thrown = null;
try {
  const run = new Function('window', 'document', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'Worker', 'fetch', 'localStorage', 'navigator', appSrc);
  run(windowStub, documentStub, raf, vSetTimeout, vClearTimeout, undefined, undefined, undefined, { maxTouchPoints: 0 });
} catch (e) { thrown = e; }
ok(!thrown, 'the interface boots against a stub DOM', thrown && (thrown.message + '\n' + thrown.stack));
if (thrown) process.exit(1);

ok(frameQueue.length > 0, 'the render loop registered');
runFrames(3);
ok(true, 'three frames drew without throwing');
function txt(id) { const e = getEl(id); return (e.text || '') + ' ' + (e.innerHTML || ''); }
ok(/Player 1 to kick/.test(txt('status')), 'the status line asks Player 1 to kick', JSON.stringify(txt('status')));
ok(/strokes drawn: 0 \/ 312/.test(txt('substatus')),
  'the match starts with 0 of 312 playable strokes drawn', txt('substatus'));

/* H is the hint hotkey a player actually reaches for — drive it through the real key handler */
function pressKey(code, key) {
  const ev = { code: code, key: key || '', repeat: false, preventDefault() {} };
  (winHandlers.keydown || []).forEach((fn) => fn(ev));
}
ok((winHandlers.keydown || []).length > 0, 'the page registered a key handler',
   'window listeners: ' + Object.keys(winHandlers).join(','));
pressKey('KeyH', 'h');
runFrames(2);
const logAfterH = getEl('log').innerHTML || '';
ok(/hint: (up-left|up|up-right|left|right|down-left|down|down-right)/.test(logAfterH),
   'H asks for a hint and the paper log records it', JSON.stringify(logAfterH.slice(-200)));

const pad = getEl('pad');
ok(pad.children.length === 9, 'the on-screen key pad has a 3x3 cluster with a ball cell in the middle', 'got ' + pad.children.length);

function clickKey(dir) {
  const el = pad.children.filter(c => String(c.dataset.dir) === String(dir))[0];
  if (!el || !el.handlers.click) return false;
  el.handlers.click[0]();
  return true;
}
function strokeCount() { const m = /strokes drawn: (\d+)/.exec(txt('substatus')); return m ? Number(m[1]) : -1; }
let played = 0, finished = false;
for (let turn = 0; turn < MOVES; turn++) {
  let advanced = false;
  for (const d of [6, 1, 4, 7, 3, 5, 2, 0]) {
    const before = strokeCount();
    if (!clickKey(d)) continue;
    if (strokeCount() > before) { advanced = true; break; }
  }
  runFrames(14);                                  /* let the stroke finish and the CPU answer */
  if (advanced) played++;
  if (/won/.test(txt('status'))) { finished = true; break; }
  if (!advanced) break;
}
runFrames(30);   /* the CPU spreads its thinking over slices: let the turn finish before reading the paper */
ok(played >= 2, 'clicking the key pad drew strokes and the CPU replied', 'replies seen: ' + played);
const sub = txt('substatus');
const m = /strokes drawn: (\d+) \/ (\d+)/.exec(sub);
ok(!!m && Number(m[1]) > 0 && Number(m[2]) === 312, 'the stroke counter moved and still reports the 312 playable strokes', sub);
ok(!/undefined|NaN|\[object Object\]/.test(txt('status') + sub + txt('log')),
  'no undefined / NaN leaked into the interface');
/* the paper says what the search actually did: the depth it proved, or one of the two honest
   alternatives — the answer came out of a proof made during an earlier kick, or the clock cut the
   walk off before it proved a ply. Printing "depth 1 of 12" for either of those is the bug. */
const dl = /proved depth (\d+) of (\d+)|already searched to (\d+) plies during an earlier kick|the clock ended the search before it proved even one ply/.exec(sub);
ok(!!dl && (!dl[1] || (Number(dl[1]) >= 2 && Number(dl[2]) >= Number(dl[1]))),
   'the paper says how deep the CPU actually proved' + (dl ? ' (' + (dl[1] ? dl[1] + ' of ' + dl[2] : dl[0]) + ')' : ''), sub);
const appCode = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
ok(!/\bnew Worker\(/.test(appCode),
   'the search does not live in a worker: measured in Chrome, a page opened straight from disk cannot load a worker script');
ok(/setTimeout\(step/.test(appSrc), 'the CPU thinks in slices between frames, so the paper keeps drawing');
console.log('        status: ' + txt('status').trim().replace(/\n/g, ' / '));
console.log('        ' + (m ? m[0] : 'no counter') + (finished ? ' — match finished early' : ''));

/* F5 restarts the match; R used to, and no longer does. Ctrl+F5 is left to the browser. */
const beforeReset = strokeCount();
pressKey('F5', 'F5');
runFrames(2);
ok(beforeReset > 0 && strokeCount() === 0, 'F5 starts a new match instead of reloading the page',
   'strokes ' + beforeReset + ' -> ' + strokeCount());
const afterReset = strokeCount();
pressKey('KeyR', 'r');
runFrames(2);
ok(strokeCount() === afterReset, 'R is no longer a hotkey', 'strokes ' + afterReset + ' -> ' + strokeCount());

/* ---------- Watch mode: two CPUs, and they may be two different strengths ---------- */
ok(getEl('lblLevel2').style.display === 'none',
   'the second strength row stays hidden while there is only one CPU',
   'display=' + JSON.stringify(getEl('lblLevel2').style.display));
getEl('selMode').value = 'demo';
getEl('selLevel').value = 'normal';
getEl('selLevel2').value = 'hard';
(getEl('settings').handlers.change || [() => {}])[0]();
pressKey('F5', 'F5');                       /* start the paired match on a clean sheet */
runFrames(2);
ok(getEl('lblLevel2').style.display === '', 'picking Watch mode opens the second strength row',
   'display=' + JSON.stringify(getEl('lblLevel2').style.display));
const b1 = getEl('box1').firstChild.textContent, b2 = getEl('box2').firstChild.textContent;
ok(/Normal/.test(b1) && /Hard/.test(b2), 'each score box says what strength plays that side',
   JSON.stringify([b1, b2]));
ok(/new game: CPU · Normal vs CPU · Hard/.test(getEl('log').innerHTML || ''),
   'the paper log records the pairing it started with', JSON.stringify((getEl('log').innerHTML || '').slice(0, 160)));
const strengths = new Set();
for (let f = 0; f < 400 && strengths.size < 2; f++) {
  runFrames(1);
  const mm = /CPU (Easy|Normal|Hard|Expert|Master):/.exec(txt('substatus'));
  if (mm) strengths.add(mm[1]);
}
ok(strengths.has('Normal') && strengths.has('Hard'),
   'the two CPUs really search to their own ceilings, not to one shared setting',
   'seen on the paper: ' + [...strengths].join(', '));
runFrames(40);                              /* let the move in progress finish before reading it */
ok(/proved depth \d+ of (6|12)\b/.test(txt('substatus')),
   'the depth printed next to a move is the ceiling of the CPU that played it', txt('substatus'));

runFrames(20);
ok(true, 'another 20 frames after the last input still drew');

console.log('\n' + (failures ? 'FAILED ' + failures + ' of ' + checks + ' checks' : 'all ' + checks + ' interface checks passed'));
process.exit(failures ? 1 : 0);
