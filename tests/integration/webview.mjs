import assert from 'node:assert/strict';
import { Button, State, Text, View, VStack, WebView, runApp, __testing as test } from 'jonui';
import { controlHTML } from '../../examples/web-controls/control.ts';
const hue = State(180), shown = State(true), revision = State(0);
const messages = [], errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const app = runApp({ title: 'WebView contract test', width: 700, height: 600,
  content: VStack([
    Button('Increment', () => { hue.value += 30; }),
    View(() => Text(`Native hue: ${hue.value}`)),
    View(() => shown.value ? WebView({
      html: controlHTML + `<!-- ${revision.value} -->`, data: { hue: hue.value },
      onMessage: message => { messages.push(message); if (message.type === 'hue') hue.value = message.value; },
      onError: message => errors.push(message),
    }) : Text('unmounted')),
  ]),
});
function snapshot() { return test.request('debug.snapshot'); }
function webID() { return snapshot().nodes.find(n => n.kind === 'webview')?.id; }
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { if (predicate()) return; await sleep(20); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; errors: ${JSON.stringify(errors)}`);
}
await until(() => webID() && test.request('debug.web', { id: webID() }).ready && messages.some(m => m.type === 'ready'), 'WebKit document ready');
const id = webID(), boot = messages.find(m => m.type === 'ready').boot;
const firstToken = test.request('debug.web', { id }).token;
const evaluate = script => test.request('debug.web.evaluate', { id, script });
evaluate("document.getElementById('hue').focus(); document.getElementById('hue').value = '210'; document.getElementById('hue').dispatchEvent(new Event('input', { bubbles: true }));");
await until(() => hue.value === 210, 'browser input to Node State');
const button = snapshot().nodes.find(n => n.kind === 'button');
test.request('debug.action', { id: button.id });
await until(() => hue.value === 240, 'native callback to shared State');
async function probe(expected) {
  const deadline = Date.now() + 5000;
  do {
    const start = messages.length;
    evaluate("window.jonui.postMessage({ type: 'probe', value: Number(document.getElementById('hue').value), focused: document.activeElement.id, boot: window.documentBoot });");
    await until(() => messages.length > start, 'browser probe');
    const result = messages.slice(start).find(m => m.type === 'probe');
    if (result?.value === expected) return result;
    await sleep(20);
  } while (Date.now() < deadline);
  throw new Error('Node model did not reach the browser');
}
let result = await probe(240);
assert.equal(result.boot, boot); assert.equal(result.focused, 'hue');
const baseline = test.stats();
for (let i = 0; i < 25; i++) { hue.value = i; await sleep(10); }
result = await probe(24);
assert.equal(result.boot, boot); assert.equal(result.focused, 'hue');
assert.equal(test.request('debug.web', { id }).loads, 1);
assert.deepEqual(test.stats(), baseline);
revision.value += 1;
await until(() => test.request('debug.web', { id }).loads === 2 && test.request('debug.web', { id }).ready && messages.filter(m => m.type === 'ready').length === 2, 'explicit HTML reload');
assert.notEqual(messages.filter(m => m.type === 'ready').at(-1).boot, boot);
await probe(24);
evaluate(`window.webkit.messageHandlers.jonui.postMessage({ token: ${JSON.stringify(firstToken)}, value: { type: 'stale' } });`);
await sleep(100); assert.ok(!messages.some(m => m.type === 'stale'));
evaluate("location.href = 'https://jonui.invalid/blocked-navigation';");
await sleep(100); await probe(24);
assert.deepEqual(errors, []);
// WebKit can redact details from evaluated async code as "Script error.";
// either form must still reach the application's error callback.
evaluate("setTimeout(() => { throw new Error('web page failure'); }, 0);");
await until(() => errors.some(e => e.includes('web page failure') || e === 'Script error.'), 'web error callback');
shown.value = false;
await until(() => !webID() && snapshot().webViewCount === 0, 'webview unmounted and handler released');
assert.equal(test.stats().actions, baseline.actions - 2);
shown.value = true;
await until(() => webID() && messages.filter(m => m.type === 'ready').length === 3, 'webview remounted');
assert.notEqual(webID(), id);
assert.deepEqual(test.stats(), baseline);
console.log('PASS WebView: real WebKit input/Node messages, model updates without document reload or focus loss, source reload, stale-document rejection, navigation policy, errors and unmount cleanup');
test.request('debug.close');
await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
