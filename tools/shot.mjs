/* tools/shot.mjs — take a screenshot of a page Chrome already has open, after a real wait.
   Usage: node tools/shot.mjs <cdpPort> <outPng> <waitMs> [js-to-run-first]
   Chrome must be running with --remote-debugging-port=<cdpPort> and the page already loaded.
Virtual time (--virtual-time-budget) gives the CPU's thinking slices no real time to run in,
so a demo game needs a wall-clock wait instead. */
const [portArg, outArg, waitArg, jsArg] = process.argv.slice(2);
const port = Number(portArg || 9223);
const out = outArg || 'shot.png';
const wait = Number(waitArg || 8000);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url)) || list.find(t => t.type === 'page');
if (!page) { console.error('no page target on port ' + port); process.exit(2); }
console.log('target: ' + page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });

let id = 0;
const pending = new Map();
const send = (method, params) => new Promise((res, rej) => {
  const my = ++id;
  pending.set(my, { res, rej });
  ws.send(JSON.stringify({ id: my, method, params: params || {} }));
  setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout: ' + method)); } }, 30000);
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};

await new Promise(r => setTimeout(r, wait));
await send('Runtime.enable');
if (jsArg) await send('Runtime.evaluate', { expression: jsArg, returnByValue: true });
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));

/* read back what the page thinks it is showing, so the caption in README stays honest */
const probe = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({status:(document.getElementById("status")||{}).textContent,sub:(document.getElementById("substatus")||{}).textContent,log:(document.getElementById("log")||{}).textContent})',
  returnByValue: true
});
if (probe.result && probe.result.value) console.log(probe.result.value);
ws.close();
console.log('wrote ' + out);
