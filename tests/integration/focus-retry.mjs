import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, SecureField, State, Text, TextField, View, VStack, WebRequest, WebView, runApp, __testing as test } from 'jonui';
const shown = State(false), blocked = State(true), presented = State(false), source = State(0), first = State('unnamed A'), second = State('unnamed B');
let controllers, stopTask, setups = 0, disposals = 0; const taskGates = new Map(), rpcGates = new Map(), errors = [];
const Panel = Component(scope => {
  const instance = ++setups, named = scope.focus(), boolean = scope.focusBoolean(), selection = scope.focusSelection([1, '1', 'lazy']);
  controllers = { named, boolean, selection }; const text = scope.state('日本 🦊'), sheet = scope.state('sheet');
  scope.onDispose(() => { disposals++; });
  stopTask = scope.task(async task => {
    await new Promise(resolve => { taskGates.set(instance, resolve); task.onCancel(() => { taskGates.delete(instance); resolve(); }); });
    taskGates.delete(instance); if (!task.isCurrent) return;
    named.resume(); named.request('target'); named.retryWhenReady();
    await new Promise(resolve => task.onCancel(() => resolve()));
  });
  const api = { async arm(label) {
    named.resume(); named.request('target'); named.retryWhenReady();
    await new Promise(resolve => { rpcGates.set(label, resolve); WebRequest.current.onCancel(() => { rpcGates.delete(label); resolve(); }); });
    rpcGates.delete(label); named.retryWhenReady()(); return label;
  } };
  return () => VStack([
    TextField('Named', { text: text.binding, focusName: 'target' }).disabled(blocked.value),
    TextField('Boolean', { text: text.binding }).focused(boolean.binding).disabled(blocked.value),
    TextField('Number', { text: text.binding }).focused(selection.binding(1)).disabled(blocked.value),
    SecureField('String', { text: text.binding }).focused(selection.binding('1')).disabled(blocked.value),
    WebView({ html: `<input><!-- ${source.value} -->`, api, onError: error => errors.push(error) }).frame({ height: 50 }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 60 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
      TextField('Lazy', { text: text.binding }).focused(selection.binding('lazy')).frame({ height: 40 }),
    ])).frame({ width: 350, height: 120 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI explicit one-shot focus retry', width: 560, height: 610, content: VStack([
  TextField('Unnamed A', { text: first.binding }), TextField('Unnamed B', { text: second.binding }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), watches = () => test.availabilityStats().names, sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = () => snapshot().nodes.find(n => n.kind === 'webview');
const unnamedIndex = (which = 0) => {
  const owner = snapshot().nodes.find(n => n.kind === 'textfield' && n.props.title === `Unnamed ${which ? 'B' : 'A'}`)?.id;
  const index = test.request('debug.fields').fields.find(f => f.owner === owner)?.index; assert.ok(Number.isInteger(index)); return index;
};
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0); assert.deepEqual(errors, []);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watches: test.availabilityStats(), stats: test.stats(), fields: test.request('debug.fields'), status: test.request('debug.focusStatus'), controls: test.request('debug.focusControls') })}`);
}
async function focusUnnamed(index = 0) {
  index = unnamedIndex(index);
  assert.equal(test.request('debug.focus', { field: index }).accepted, true);
  await until(() => test.request('debug.focusStatus').fields.includes(index), 'actual unnamed responder'); assert.equal(Focus.currentName(), null);
  await sleep(20);
}
await until(() => snapshot().hostedControlCount === 2, 'root fields'); const baseline = test.stats(); shown.value = true;
await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && controllers.named.availability('target') === 'unavailable', 'blocked targets mounted');
const { named, boolean, selection } = controllers;
await focusUnnamed(); named.request('target'); test.flush(); await sleep(20); assert.equal(named.actual.value, null);
named.retryWhenReady(); await until(() => watches() === 1, 'named retry armed'); const waitingGeneration = test.request('debug.focusWatch').generation;
await sleep(50); assert.equal(test.request('debug.focusWatch').generation, waitingGeneration); assert.equal(test.request('debug.focusStatus').fields[0], unnamedIndex());
blocked.value = false; test.flush(); await until(() => named.actual.value === 'target' && watches() === 0, 'enabled target retries once');
const completed = test.request('debug.focusWatch').generation; await sleep(40); assert.equal(test.request('debug.focusWatch').generation, completed);
await focusUnnamed(); const stopImmediate = named.retryWhenReady(); stopImmediate(); await sleep(40); assert.equal(test.request('debug.focusStatus').fields[0], unnamedIndex());
blocked.value = true; test.flush(); await until(() => boolean.availability() === 'unavailable', 'boolean target blocked');
boolean.request(true); boolean.retryWhenReady(); await until(() => watches() === 1, 'boolean retry armed'); boolean.desired.value = false;
blocked.value = false; test.flush(); await sleep(40); assert.equal(watches(), 0); assert.equal(boolean.actual.value, false); assert.equal(test.request('debug.focusStatus').fields[0], unnamedIndex());
blocked.value = true; test.flush(); await until(() => selection.availability(1) === 'unavailable', 'typed targets blocked');
selection.request(1); selection.retryWhenReady(); selection.request('1'); selection.retryWhenReady();
blocked.value = false; test.flush(); await until(() => selection.actual.value === '1' && watches() === 0, 'latest typed intent wins');
blocked.value = true; test.flush(); await focusUnnamed(); named.request('target'); named.retryWhenReady(); await until(() => watches() === 1, 'retry before unnamed focus change');
const publicNames = [], stopNames = Focus.subscribe(value => publicNames.push(value));
assert.equal(test.request('debug.focus', { field: unnamedIndex(1) }).accepted, true); blocked.value = false; test.flush();
await until(() => watches() === 0, 'unnamed responder revision cancels retry'); await sleep(30);
assert.equal(test.request('debug.focusStatus').fields[0], unnamedIndex(1)); assert.equal(named.desired.value, 'target'); assert.deepEqual(publicNames, []); stopNames();
blocked.value = true; test.flush(); await focusUnnamed(); named.request('target'); const oldStop = named.retryWhenReady(); named.resume(); const freshStop = named.retryWhenReady(); oldStop();
await until(() => !named.retired.value && watches() === 1, 'fresh resume arms retained intent'); blocked.value = false; test.flush();
await until(() => named.actual.value === 'target' && watches() === 0, 'new session retry accepted'); freshStop();
blocked.value = true; test.flush(); await focusUnnamed(); taskGates.get(1)();
await until(() => watches() === 1 && !named.retired.value, 'task retry armed'); stopTask();
await until(() => watches() === 0, 'task cancellation releases retry'); blocked.value = false; test.flush(); await sleep(30); assert.equal(test.request('debug.focusStatus').fields[0], unnamedIndex());
blocked.value = true; test.flush(); await until(() => test.request('debug.web', { id: browser().id }).ready, 'RPC ready');
test.request('debug.web.evaluate', { id: browser().id, script: `jonui.remote().arm('old').catch(() => {})` });
await until(() => rpcGates.has('old') && watches() === 1 && !named.retired.value, 'RPC retry armed'); source.value++; test.flush();
await until(() => watches() === 0 && !rpcGates.has('old'), 'document cancellation releases retry'); blocked.value = false; test.flush(); await sleep(30); assert.equal(test.request('debug.focusStatus').fields[0], unnamedIndex());
selection.request('lazy'); const cancelLazy = selection.retryWhenReady(); await until(() => watches() === 1, 'lazy retry armed');
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 120 && s.document.height > 2000); assert.ok(scroll); const viewport = scroll.viewport;
await sleep(30); assert.deepEqual(test.request('debug.layout').scrolls.find(s => s.index === scroll.index).viewport, viewport); assert.equal(selection.actual.value, null);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 10000 }); await until(() => selection.actual.value === 'lazy' && watches() === 0, 'user scrolling realizes and retries lazy target'); cancelLazy();
blocked.value = true; test.flush(); await focusUnnamed(); named.request('target'); named.retryWhenReady(); await until(() => watches() === 1, 'retry before sheet');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && named.retired.value && watches() === 0, 'sheet retires retry'); assert.equal(Focus.requestNamed('sheet'), true);
blocked.value = false; test.flush(); await sleep(30); assert.equal(Focus.currentName(), 'sheet');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed'); assert.equal(named.retired.value, true);
named.resume(); named.retryWhenReady(); await until(() => named.actual.value === 'target' && watches() === 0, 'explicit rearm after context change');
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 2 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'retry owner removed'); assert.deepEqual(test.stats(), baseline);
blocked.value = true;
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 6 && !controllers.named.retired.value, `retry mount ${i}`);
  const current = i % 3 === 0 ? controllers.named : i % 3 === 1 ? controllers.boolean : controllers.selection;
  current.request(i % 3 === 0 ? 'target' : i % 3 === 1 ? true : 1); current.retryWhenReady();
  await until(() => watches() === 1, `pending retry ${i}`); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 2 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length && watches() === 0, `retry disposal ${i}`); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(taskGates.size, 0); assert.equal(rpcGates.size, 0);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().availabilityWatchCount, 0);
console.log('PASS explicit focus retry: one-shot enable/lazy focus, boolean/typed supersession, real shared-editor unnamed focus protection, cancellation and resume/context/task/RPC guards, no waiting scroll and 20 pending owner lifetimes');
