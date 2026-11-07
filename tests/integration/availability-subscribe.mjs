import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, SecureField, State, Text, TextField, View, VStack, WebRequest, WebView, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.subscribeAvailability('parent', () => {}), /mounted window/);
const shown = State(false), blocked = State(false), passive = State(false), presented = State(false), source = State(0), parent = State('parent');
const names = ['parent', 'café', 'cafe\u0301', 'web', 'lazy', 'sheet'], values = new Map(names.map(name => [name, []]));
const effects = [], tasks = [], rpcValues = [], rpcGates = new Map(), errors = []; let controller, stopTask, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; controller = scope.focus(); const text = scope.state('日本 🦊'), status = scope.state('waiting');
  scope.onDispose(() => { disposals++; });
  scope.effect(() => Focus.subscribeAvailability('café', value => { effects.push(value); status.value = value; }));
  stopTask = scope.task(async task => {
    Focus.subscribeAvailability('café', value => tasks.push(value));
    await new Promise(resolve => task.onCancel(() => resolve()));
    Focus.subscribeAvailability({}, null)();
  });
  const api = { async listen(label) {
    Focus.subscribeAvailability('café', value => rpcValues.push({ label, value }));
    await new Promise(resolve => { rpcGates.set(label, resolve); WebRequest.current.onCancel(() => { rpcGates.delete(label); resolve(); }); });
    rpcGates.delete(label); return label;
  } };
  return () => VStack([
    TextField('Same label', { text: text.binding, focusName: 'café' }).disabled(blocked.value),
    SecureField('Same label', { text: text.binding, focusName: 'cafe\u0301' }),
    Text(`Observed: ${status.value}`),
    WebView({ html: `<input><!-- ${source.value} -->`, focusName: 'web', tabFocusable: !passive.value, api, onError: error => errors.push(error) }).frame({ height: 60 }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 60 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
      TextField('Lazy', { text: text.binding, focusName: 'lazy' }).frame({ height: 40 }),
    ])).frame({ width: 350, height: 120 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: text.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI availability subscriptions', width: 520, height: 460, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), nativeStats = () => test.request('debug.availabilityWatch');
const last = name => values.get(name).at(-1), browser = () => snapshot().nodes.find(n => n.kind === 'webview');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext');
    assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0); assert.deepEqual(errors, []);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ values: [...values], native: nativeStats(), stats: test.stats() })}`);
}
function beginRPC(label) { test.request('debug.web.evaluate', { id: browser().id, script: `jonui.remote().listen(${JSON.stringify(label)}).catch(() => {})` }); }
await until(() => snapshot().hostedControlCount === 1, 'parent mounted');
assert.deepEqual(nativeStats(), { watches: 0, notifications: 0, scheduled: false });
const stops = names.map(name => Focus.subscribeAvailability(name, value => values.get(name).push(value)));
assert.equal(values.get('parent').length, 0); await until(() => last('parent') === 'ready' && last('café') === 'missing', 'async initial snapshots');
assert.equal(nativeStats().watches, 6); assert.equal(nativeStats().notifications, 4);
const baseline = test.stats(); shown.value = true;
await until(() => last('café') === 'ready' && last('cafe\u0301') === 'ready' && last('web') === 'ready' && last('lazy') === 'unrealized' && last('sheet') === 'unrealized' && effects.at(-1) === 'ready' && tasks.at(-1) === 'ready', 'native adapters notify readiness');
assert.equal(nativeStats().watches, 6); assert.deepEqual(test.availabilityStats(), { names: 6, listeners: 8 });
assert.equal(Focus.requestNamed('parent'), true); await until(() => controller.actual.value === 'parent', 'unrelated focus');
controller.request('lazy'); test.flush(); await sleep(30);
const generation = test.request('debug.focusWatch').generation, handles = test.request('debug.focusHandles');
blocked.value = true; test.flush(); await until(() => last('café') === 'unavailable' && effects.at(-1) === 'unavailable' && tasks.at(-1) === 'unavailable', 'native disabled change');
assert.equal(last('cafe\u0301'), 'ready'); assert.equal(Focus.currentName(), 'parent');
blocked.value = false; test.flush(); await until(() => last('café') === 'ready', 'native enabled change');
passive.value = true; test.flush(); await until(() => last('web') === 'unavailable', 'passive browser');
passive.value = false; test.flush(); await until(() => last('web') === 'ready', 'browser restored');
assert.equal(test.request('debug.focusWatch').generation, generation); assert.deepEqual(test.request('debug.focusHandles'), handles); assert.equal(controller.desired.value, 'lazy');
stopTask(); assert.deepEqual(test.availabilityStats(), { names: 6, listeners: 7 });
await until(() => test.request('debug.web', { id: browser().id }).ready, 'RPC document ready'); beginRPC('old'); await until(() => rpcGates.has('old') && rpcValues.some(v => v.label === 'old'), 'RPC owns subscription');
assert.equal(test.availabilityStats().listeners, 8); source.value++; test.flush(); await until(() => !rpcGates.has('old') && test.availabilityStats().listeners === 7, 'document replacement cancels listener');
const oldCount = rpcValues.filter(v => v.label === 'old').length;
blocked.value = true; test.flush(); await until(() => last('café') === 'unavailable', 'change after old document canceled');
assert.equal(rpcValues.filter(v => v.label === 'old').length, oldCount); blocked.value = false; test.flush(); await until(() => last('café') === 'ready', 'target re-enabled');
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 120 && s.document.height > 2000); assert.ok(scroll);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 10000 }); await until(() => last('lazy') === 'ready', 'actual lazy attachment notifies');
assert.equal(Focus.currentName(), 'parent'); assert.equal(controller.desired.value, 'lazy');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && last('sheet') === 'ready' && last('parent') === 'inactiveWindow' && last('café') === 'inactiveWindow' && last('web') === 'inactiveWindow', 'active sheet notifications');
assert.equal(controller.retired.value, true);
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && last('parent') === 'ready' && last('café') === 'ready', 'parent context restored');
assert.equal(controller.retired.value, true, 'availability notifications do not resume controllers');
for (const token of [0, -1, true, 1.5]) assert.throws(() => test.request('focus.availability.watch', { token, name: 'parent' }), /token|integer|positive handle/);
assert.throws(() => test.request('focus.availability.watch', { token: 1000000, name: false }), /Focus name/); assert.equal(nativeStats().watches, 6);
await until(() => test.request('debug.web', { id: browser().id }).ready, 'replacement document ready'); beginRPC('pending'); await until(() => rpcGates.has('pending'), 'pending RPC before removal');
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && last('café') === 'missing' && last('lazy') === 'missing' && !rpcGates.has('pending'), 'target removal and owned cleanup');
assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.availabilityStats(), { names: 6, listeners: 6 }); assert.equal(nativeStats().watches, 6);
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => last('café') === 'ready' && effects.at(-1) === 'ready' && test.availabilityStats().listeners === 8, `availability mount ${i}`);
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && last('café') === 'missing', `availability removal ${i}`);
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.availabilityStats(), { names: 6, listeners: 6 }); assert.equal(nativeStats().watches, 6);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
for (const stop of stops) { stop(); stop(); }
await until(() => nativeStats().scheduled === false, 'last observer removed'); assert.deepEqual(nativeStats(), { watches: 0, notifications: 0, scheduled: false }); assert.deepEqual(test.availabilityStats(), { names: 0, listeners: 0 });
const removed = []; const stopImmediate = Focus.subscribeAvailability('parent', v => removed.push(v)); stopImmediate(); await sleep(30); assert.deepEqual(removed, []);
const shutdownValues = []; Focus.subscribeAvailability('parent', value => shutdownValues.push(value));
await until(() => shutdownValues.length === 1 && nativeStats().watches === 1, 'app-owned watch before shutdown');
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.deepEqual(test.availabilityStats(), { names: 0, listeners: 0 });
assert.equal(snapshot().availabilityWatchCount, 0); assert.equal(snapshot().availabilityNotificationCount, 0); assert.equal(snapshot().liveCells, 0);
console.log('PASS availability subscriptions: async shared snapshots, native enabled/passive/lazy/sheet changes, exact Unicode, no focus/retry/generation changes, task/effect/RPC ownership, source cancellation and 20 owner lifetimes with final observer removal');
