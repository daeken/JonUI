import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, SecureField, State, Text, TextEditor, TextField, View, VStack, WebRequest, WebView, runApp, __testing as test } from 'jonui';
const shown = State(false), blocked = State(false), presented = State(false), source = State(0), parent = State('parent');
let controllers, traces, setups = 0, disposals = 0; const globals = [], taskGates = new Map(), late = [], rpcGates = new Map(), rpcValues = [], messages = [], errors = [];
const Panel = Component(scope => {
  const instance = ++setups, named = scope.focus(), boolean = scope.focusBoolean(), selection = scope.focusSelection([1, '1', 'lazy']);
  controllers = { named, boolean, selection }; const text = scope.state('日本 🦊'), sheet = scope.state('sheet');
  const seen = traces = { named: [], boolean: [], number: [], string: [], lazy: [], task: [] };
  scope.onDispose(() => { disposals++; });
  scope.task(async task => {
    named.subscribeAvailability('notes', value => seen.task.push(value));
    await new Promise(resolve => { taskGates.set(instance, resolve); task.onCancel(() => { taskGates.delete(instance); resolve(); }); });
    taskGates.delete(instance); named.subscribeAvailability({}, null)(); late.push(instance);
  });
  const api = { async listen(label, id) {
    selection.subscribeAvailability(id, value => rpcValues.push({ label, value }));
    await new Promise(resolve => { rpcGates.set(label, resolve); WebRequest.current.onCancel(() => { rpcGates.delete(label); resolve(); }); });
    rpcGates.delete(label); selection.subscribeAvailability({}, null)(); return 'obsolete registration suppressed';
  } };
  return () => VStack([
    TextField('Boolean', { text: text.binding }).focused(boolean.binding).disabled(blocked.value),
    TextField('Selection number', { text: text.binding }).focused(selection.binding(1)).disabled(blocked.value),
    SecureField('Selection string', { text: text.binding }).focused(selection.binding('1')),
    TextEditor({ text: text.binding }).focused(named.binding('notes')).frame({ height: 50 }),
    WebView({ html: `<input><!-- ${source.value} -->`, api, onMessage: value => messages.push(value), onError: error => errors.push(error) }).frame({ height: 50 }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 60 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
      TextField('Lazy', { text: text.binding }).focused(selection.binding('lazy')).frame({ height: 40 }),
    ])).frame({ width: 350, height: 120 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: sheet.binding }).focused(named.binding('sheet')).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI session-owned availability', width: 520, height: 530, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), native = () => test.request('debug.availabilityWatch'), browser = () => snapshot().nodes.find(n => n.kind === 'webview');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0); assert.deepEqual(errors, []);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ traces, native: native(), stats: test.stats() })}`);
}
function beginRPC(label, id = 1) { test.request('debug.web.evaluate', { id: browser().id, script: `jonui.remote().listen(${JSON.stringify(label)},${JSON.stringify(id)}).then(value => jonui.postMessage({label:${JSON.stringify(label)},value}), error => jonui.postMessage({label:${JSON.stringify(label)},error:String(error)}))` }); }
await until(() => snapshot().hostedControlCount === 1, 'parent mounted');
const stopGlobal = Focus.subscribeAvailability('notes', value => globals.push(value)); await until(() => globals.at(-1) === 'missing', 'global observer'); const baseline = test.stats();
shown.value = true; await until(() => snapshot().hostedControlCount === 5 && snapshot().webViewCount === 1 && traces.task.at(-1) === 'ready', 'session owners mounted');
const { named, boolean, selection } = controllers, original = controllers;
named.subscribeAvailability('notes', value => traces.named.push(value)); boolean.subscribeAvailability(value => traces.boolean.push(value));
selection.subscribeAvailability(1, value => traces.number.push(value)); selection.subscribeAvailability('1', value => traces.string.push(value)); selection.subscribeAvailability('lazy', value => traces.lazy.push(value));
await until(() => traces.named.at(-1) === 'ready' && traces.boolean.at(-1) === 'ready' && traces.number.at(-1) === 'ready' && traces.string.at(-1) === 'ready' && traces.lazy.at(-1) === 'unrealized', 'opaque initial callbacks');
assert.equal(native().watches, 5); assert.deepEqual(test.availabilityStats(), { names: 5, listeners: 7 });
assert.equal(Focus.requestNamed('parent'), true); await until(() => named.actual.value === 'parent', 'unrelated focus'); selection.request('lazy'); test.flush(); await sleep(30);
const generation = test.request('debug.focusWatch').generation, queued = [];
boolean.subscribeAvailability(value => queued.push(value)); boolean.resume(); boolean.subscribeAvailability(value => traces.boolean.push(`new:${value}`));
await until(() => traces.boolean.at(-1) === 'new:ready', 'same-turn resume/re-subscribe'); assert.deepEqual(queued, []);
const oldNamedCount = traces.named.length, oldTaskCount = traces.task.length; named.resume(); taskGates.get(1)();
await until(() => late.includes(1) && !named.retired.value, 'old task registration suppressed');
assert.equal(traces.named.length, oldNamedCount); assert.equal(traces.task.length, oldTaskCount);
named.subscribeAvailability('notes', value => traces.named.push(`new:${value}`)); await until(() => traces.named.at(-1) === 'new:ready', 'fresh named session');
await until(() => test.request('debug.web', { id: browser().id }).ready, 'RPC ready'); beginRPC('lease'); await until(() => rpcValues.some(v => v.label === 'lease'), 'RPC subscription');
selection.resume(); rpcGates.get('lease')(); await until(() => messages.some(m => m.label === 'lease'), 'stale RPC registration suppressed'); assert.equal(messages.find(m => m.label === 'lease').value, 'obsolete registration suppressed');
const oldRPCCount = rpcValues.length; blocked.value = true; test.flush(); await until(() => traces.boolean.at(-1) === 'new:unavailable', 'fresh boolean status change'); assert.equal(rpcValues.length, oldRPCCount);
blocked.value = false; test.flush(); await until(() => traces.boolean.at(-1) === 'new:ready', 'boolean re-enabled');
beginRPC('document'); await until(() => rpcValues.some(v => v.label === 'document'), 'fresh RPC listener'); source.value++; test.flush(); await until(() => !rpcGates.has('document'), 'document cancellation stops owned listener');
const documentCount = rpcValues.length; selection.resume(); await until(() => !selection.retired.value, 'selection resumes after canceled RPC'); assert.equal(rpcValues.length, documentCount);
const lazy = []; selection.subscribeAvailability('lazy', value => lazy.push(value)); await until(() => lazy.at(-1) === 'unrealized', 'fresh lazy session');
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 120 && s.document.height > 2000); assert.ok(scroll); test.request('debug.scroll', { index: scroll.index, x: 0, y: 10000 });
await until(() => lazy.at(-1) === 'ready', 'opaque lazy attachment'); assert.equal(Focus.currentName(), 'parent'); assert.equal(selection.desired.value, 'lazy'); assert.equal(test.request('debug.focusWatch').generation, generation);
presented.value = true; await until(() => test.request('debug.focusContext').sheet && Object.values(controllers).every(c => c.retired.value) && globals.at(-1) === 'inactiveWindow', 'context retirement');
assert.deepEqual(test.availabilityStats(), { names: 1, listeners: 1 }); assert.equal(native().watches, 1);
assert.ok(!traces.named.includes('inactiveWindow') && !traces.boolean.includes('new:inactiveWindow') && !lazy.includes('inactiveWindow'), 'old context callbacks suppressed');
named.subscribeAvailability({}, null)(); boolean.subscribeAvailability(null)(); selection.subscribeAvailability({}, null)();
const sheetValues = []; named.resume(); named.subscribeAvailability('sheet', value => sheetValues.push(value)); await until(() => sheetValues.at(-1) === 'ready', 'fresh sheet session');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && named.retired.value && globals.at(-1) === 'ready', 'sheet subscription retires on dismissal');
assert.deepEqual(sheetValues, ['ready']); assert.deepEqual(test.availabilityStats(), { names: 1, listeners: 1 });
named.resume(); boolean.resume(); selection.resume(); const fresh = [];
named.subscribeAvailability('notes', value => fresh.push(`n:${value}`)); boolean.subscribeAvailability(value => fresh.push(`b:${value}`)); selection.subscribeAvailability(1, value => fresh.push(`s:${value}`));
await until(() => fresh.length === 3 && Object.values(controllers).every(c => !c.retired.value), 'fresh parent subscriptions'); assert.equal(controllers, original);
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && globals.at(-1) === 'missing', 'owner disposal without manual unsubscribe');
assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.availabilityStats(), { names: 1, listeners: 1 });
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => traces.task.at(-1) === 'ready' && snapshot().hostedControlCount === 5, `owned watch mount ${i}`);
  const ignored = []; controllers.boolean.subscribeAvailability(value => ignored.push(value)); controllers.selection.subscribeAvailability(1, value => ignored.push(value));
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && globals.at(-1) === 'missing' && late.length === i + 2, `owned watch disposal ${i}`);
  assert.deepEqual(ignored, []); assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.availabilityStats(), { names: 1, listeners: 1 });
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(taskGates.size, 0); assert.equal(rpcGates.size, 0);
stopGlobal(); assert.deepEqual(native(), { watches: 0, notifications: 0, scheduled: false });
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().availabilityWatchCount, 0); assert.equal(snapshot().liveCells, 0);
console.log('PASS owned availability subscriptions: opaque typed targets, initial replay, resume/context cancellation before callbacks, shared focus acknowledgements, task/RPC leases and source cancellation, explicit sheet/parent re-subscription and 20 pending owner lifetimes');
