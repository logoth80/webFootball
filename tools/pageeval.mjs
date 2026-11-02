/* tools/pageeval.mjs — ask a page Chrome already has open a question, print the answer.
   Usage: node tools/pageeval.mjs <cdpPort> <expression>
   The expression may be async: the result promise is awaited. Used for measuring what the
   browser will actually allow (workers, fetch) rather than what the spec says it should. */
const [portArg, exprArg] = process.argv.slice(2);
const port = Number(portArg || 9223);
/* '-' means: read the expression from stdin, which dodges shell quoting entirely */
const expr = exprArg === '-' ? (await import('node:fs')).readFileSync(0, 'utf8') : exprArg;
if (!expr) { console.error('no expression'); process.exit(2); }

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(t => t.type === 'page') ;
if (!page) { console.error('no page target on port ' + port); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
let id = 0;
const pending = new Map();
const send = (method, params) => new Promise((res, rej) => {
  const my = ++id;
  pending.set(my, { res, rej });
  ws.send(JSON.stringify({ id: my, method, params: params || {} }));
  setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout: ' + method)); } }, 60000);
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
console.log('target: ' + page.url);
await send('Runtime.enable');
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (r.exceptionDetails) console.log('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
console.log(JSON.stringify(r.result && r.result.value));
ws.close();
