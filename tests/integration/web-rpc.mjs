import assert from 'node:assert/strict';
import { Component, State, Text, View, WebView, WebRequest, runApp, __testing as test } from 'jonui';
const shown = State(true), revision = State(0), version = State(1), shared = State('safe');
const messages = [], errors = [], gates = new Map(); let model, calls = 0, cleanups = 0, setups = 0, disposals = 0, query = 0;
const html = '<!doctype html><meta charset="utf-8"><div id="plot"></div><script>window.node = jonui.remote(); jonui.onMessage(value => { document.getElementById("plot").textContent = JSON.stringify(value); }); jonui.postMessage({type:"ready"});</script>';
const Chart = Component(scope => {
  setups++; model = scope.state('initial'); scope.onDispose(() => { disposals++; });
  return () => {
    const current = version.value;
    return WebView({ html: html + `<!-- ${revision.value} -->`, data: { selected: model.value }, onMessage: message => messages.push(message), onError: error => errors.push(error), api: {
      echo(value) { calls++; return { value, version: current }; },
      select(value) { calls++; model.value = value; return { selected: model.value }; },
      empty() {}, nullValue: () => null,
      fail() { throw new RangeError('invalid point'); }, invalid: () => NaN,
      ...(current === 1 ? { old: () => 'old method' } : {}),
      async hold(key) {
        calls++; const context = WebRequest.current, gate = { resolve: null, signal: context.signal }; gates.set(key, gate);
        context.onCancel(() => { cleanups++; gates.delete(key); shared.value = 'cancelled cleanup write'; });
        await new Promise(resolve => { gate.resolve = resolve; });
        model.value = `result ${key}`; shared.value = `result ${key}`;
        return { key, version: current };
      },
    } }).frame({ height: 250 });
  };
});
const app = runApp({ title: 'JonUI WebView typed RPC', width: 600, height: 350, content: View(() => shown.value ? Chart() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), webID = () => snapshot().nodes.find(n => n.kind === 'webview')?.id;
const web = () => test.request('debug.web', { id: webID() }), evaluate = script => test.request('debug.web.evaluate', { id: webID(), script });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 10000;
  do { const s = snapshot(); assert.equal(test.request('debug.focusStatus').key, false); assert.deepEqual(errors, []); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ counts: test.stats(), rpc: test.webRequestStats(), messages: messages.slice(-6) })}`);
}
function begin(method, args = []) {
  const id = ++query;
  evaluate(`node[${JSON.stringify(method)}](...${JSON.stringify(args)}).then(value => jonui.postMessage({ query: ${id}, ok: true, value: value === undefined ? null : value, undefined: value === undefined }), error => jonui.postMessage({ query: ${id}, ok: false, error: {name:error.name,message:error.message} }))`);
  return id;
}
async function response(id) { await until(() => messages.some(m => m.query === id), `RPC reply ${id}`); return messages.find(m => m.query === id); }
const call = (method, args) => response(begin(method, args));
await until(s => s.states.length === 5 && s.webViewCount === 1 && web().ready && messages.some(m => m.type === 'ready'), 'real browser and Node API');
const token = web().token, epoch = web().epoch, id = webID();
assert.deepEqual((await call('echo', [{ label: '🦊 café', points: [1, 2, null] }])).value, { value: { label: '🦊 café', points: [1, 2, null] }, version: 1 });
assert.equal((await call('empty')).undefined, true); assert.equal((await call('nullValue')).undefined, false);
assert.deepEqual((await call('fail')).error, { name: 'RangeError', message: 'invalid point' }); assert.equal((await call('invalid')).error.name, 'TypeError');
assert.equal((await call('missing')).error.name, 'TypeError'); assert.equal((await call('old')).value, 'old method');
const invalid = ++query; evaluate(`node.echo(() => {}).catch(error => jonui.postMessage({query:${invalid},error:{name:error.name,message:error.message}}))`);
assert.equal((await response(invalid)).error.name, 'TypeError');
assert.deepEqual((await call('select', ['Selected 🦊 café'])).value, { selected: 'Selected 🦊 café' });
await until(() => model.value === 'Selected 🦊 café', 'RPC action updates Node state');
const dataProbe = ++query; evaluate(`jonui.postMessage({query:${dataProbe},text:document.getElementById('plot').textContent})`);
assert.ok((await response(dataProbe)).text.includes('Selected 🦊 café'));
const pending = begin('hold', ['concurrent']); await until(() => gates.has('concurrent'), 'async handler entered');
const gate = gates.get('concurrent'); version.value = 2; test.flush();
assert.equal((await call('echo', ['fast'])).value.version, 2); assert.equal((await call('old')).error.name, 'TypeError');
assert.ok(!messages.some(m => m.query === pending)); assert.equal(web().loads, 1); assert.equal(web().token, token); assert.equal(web().epoch, epoch);
gate.resolve(); assert.deepEqual((await response(pending)).value, { key: 'concurrent', version: 1 }); assert.equal(gate.signal.aborted, true);
assert.equal(shared.value, 'result concurrent', 'request cleanup cannot overwrite a completed result');
await until(() => web().pending === 0 && test.webRequestStats().pending === 0, 'completed request cleanup');
begin('hold', ['reload']); await until(() => gates.has('reload') && web().pending === 1, 'pending document request');
const old = gates.get('reload'); shared.value = 'current'; revision.value++; test.flush();
assert.equal(old.signal.aborted, true, 'Node cancellation precedes deferred native source replacement');
await until(() => web().ready && web().loads === 2 && web().token !== token, 'document replaced');
old.resolve(); await sleep(30); assert.equal(shared.value, 'current'); assert.equal(web().pending, 0); assert.equal(test.webRequestStats().pending, 0);
const stale = ++query;
evaluate(`window.webkit.messageHandlers.jonuiRPC.postMessage({ token:${JSON.stringify(token)}, method:'echo', args:['stale'] }).then(result => jonui.postMessage({query:${stale},result}))`);
assert.equal((await response(stale)).result.error.name, 'AbortError');
assert.deepEqual(test.request('web.reply', { id, epoch, document: token, call: 99999, result: { ok: true, value: 'late' } }), { accepted: false });
const nativeNode = snapshot().nodes.find(n => n.id === id), stable = snapshot().nodes;
for (const props of [{ ...nativeNode.props, rpcEpoch: 0 }, { ...nativeNode.props, methods: ['then'] }, { ...nativeNode.props, methods: ['echo', 'echo'] }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...nativeNode, props }] }), /API descriptor/); assert.deepEqual(snapshot().nodes, stable);
}
// Bound retained reply blocks while the Node event loop remains responsive.
for (let i = 0; i < 128; i++) begin('hold', [`burst-${i}`]);
await until(() => gates.size === 128 && web().pending === 128, 'bounded concurrent calls');
assert.equal((await call('echo', ['overflow'])).error.name, 'RangeError');
const burst = [...gates.values()]; revision.value++; test.flush();
await until(() => web().ready && web().loads === 3 && web().pending === 0, 'burst cancellation');
burst.forEach(gate => { assert.equal(gate.signal.aborted, true); gate.resolve(); }); await sleep(30); assert.equal(shared.value, 'current');
// SwiftUI can coalesce A -> B -> A into an update whose final HTML bytes match
// the already-loaded source. Its new request epoch must still replace the page.
const beforeRapid = web().loads;
for (let i = 0; i < 5; i++) { revision.value = 100 + i; test.flush(); revision.value = 2; test.flush(); }
const finalEpoch = snapshot().nodes.find(n => n.id === id).props.rpcEpoch;
await until(() => web().ready && web().epoch === finalEpoch && web().loads > beforeRapid, 'coalesced document epochs');
assert.equal((await call('echo', ['after coalescing'])).ok, true);
begin('hold', ['unmount']); await until(() => gates.has('unmount'), 'pending owner request');
const removed = gates.get('unmount'); shown.value = false;
await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && s.webViewCount === 0, 'RPC owner removed');
assert.equal(removed.signal.aborted, true); removed.resolve(); await sleep(30); assert.equal(shared.value, 'current');
assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 5 && s.webViewCount === 1 && web().ready, `RPC mount ${i}`);
  begin('hold', [`owner-${i}`]); await until(() => gates.has(`owner-${i}`), `owner call ${i}`); const held = gates.get(`owner-${i}`);
  shown.value = false; await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && s.webViewCount === 0, `RPC unmount ${i}`);
  assert.equal(held.signal.aborted, true); held.resolve(); await sleep(5); assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(shared.value, 'current'); assert.equal(gates.size, 0); assert.ok(cleanups >= 151);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS WebView RPC: real promise replies, JSON/void/errors, concurrent/current handlers, Node state snapshots, source epochs/stale replies, 128-call backpressure, cancellation/late-write guards and 20 pending owner lifetimes');
