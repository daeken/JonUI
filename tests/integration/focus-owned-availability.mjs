import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, LazyVStack, ScrollView, SecureField, State, Text, TextEditor, TextField, View, VStack, WebRequest, WebView, runApp, __testing as test } from 'jonui';
const shown = State(false), targetShown = State(true), blocked = State(false), passive = State(false), reversed = State(false), presented = State(false), parent = State('parent');
let controllers, model, setups = 0, disposals = 0; const tasks = [], taskResults = [], rpcGates = new Map(), rpcResults = new Map(), messages = [], errors = [];
const Panel = Component(scope => {
  setups++; const named = scope.focus(), boolean = scope.focusBoolean(), selection = scope.focusSelection([1, '1', 'lazy', 'browser', 'unmounted']);
  controllers = { named, boolean, selection };
  const local = model = { boolean: scope.state('boolean'), first: scope.state('first'), second: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), lazy: scope.state('lazy'), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  scope.task(async () => { await new Promise(resolve => tasks.push(resolve)); taskResults.push([named.availability('notes'), boolean.availability(), selection.availability(1)]); });
  const api = { async inspect(label, id, name) {
    const wait = new Promise(resolve => { rpcGates.set(label, resolve); WebRequest.current.onCancel(() => { rpcGates.delete(label); resolve(); }); });
    await wait; rpcGates.delete(label);
    const result = [named.availability(name), boolean.availability(), selection.availability(id)]; rpcResults.set(label, result); return result;
  } };
  return () => VStack([
    View(() => targetShown.value ? TextField('Boolean', { text: local.boolean.binding }).focused(boolean.binding).disabled(blocked.value) : Text('Boolean target hidden')),
    ForEach(reversed.value ? ['1', 1] : [1, '1'], { id: id => id }, id => typeof id === 'number'
      ? TextField('Selection', { text: local.first.binding }).focused(selection.binding(id))
      : SecureField('Selection', { text: local.second.binding }).focused(selection.binding(id))),
    TextEditor({ text: local.editor.binding }).focused(named.binding('notes')).frame({ height: 50 }),
    DatePicker('Date', { selection: local.date.binding, components: 'date', style: 'compact' }).focused(named.binding('date')),
    WebView({ html: '<input>', api, onMessage: m => messages.push(m), onError: e => errors.push(e), tabFocusable: !passive.value }).focused(selection.binding('browser')).frame({ height: 50 }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 60 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
      TextField('Lazy selection', { text: local.lazy.binding }).focused(selection.binding('lazy')).frame({ height: 40 }),
    ])).frame({ width: 350, height: 120 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding }).focused(named.binding('sheet')).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI owned focus availability', width: 620, height: 650, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), watch = () => test.request('debug.focusWatch');
const browser = () => snapshot().nodes.find(n => n.kind === 'webview');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext');
    assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0); assert.deepEqual(errors, []);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), stats: test.stats() })}`);
}
function beginRPC(label, id = 1, name = 'notes') {
  test.request('debug.web.evaluate', { id: browser().id, script: `jonui.remote().inspect(${JSON.stringify(label)},${JSON.stringify(id)},${JSON.stringify(name)}).then(value => jonui.postMessage({label:${JSON.stringify(label)},value}), error => jonui.postMessage({label:${JSON.stringify(label)},error:String(error)}))` });
}
await until(() => snapshot().hostedControlCount === 1, 'parent mounted'); shown.value = true;
await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && test.focusStats().listeners === 3 && test.request('debug.web', { id: browser().id }).ready, 'owned targets mounted');
const { named, boolean, selection } = controllers, originalModel = model;
named.request('notes'); await until(() => named.actual.value === 'notes', 'named intent');
boolean.request(true); await until(() => boolean.actual.value, 'boolean intent');
selection.request('lazy'); test.flush(); await sleep(30); assert.equal(selection.desired.value, 'lazy'); assert.equal(selection.actual.value, null);
assert.equal(Focus.requestNamed('parent'), true); await until(() => named.actual.value === 'parent' && !boolean.actual.value, 'unrelated parent focus');
const target = Focus.capture(); assert.ok(target); assert.equal(Focus.setTraversal([target], { tabNavigation: true }), true);
const baselineStats = test.stats(), handles = test.request('debug.focusHandles'), cycle = test.request('debug.focusTraversal'), generation = watch().generation;
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 120 && s.document.height > 2000); assert.ok(scroll);
for (let i = 0; i < 20; i++) {
  assert.equal(named.availability('notes'), 'ready'); assert.equal(named.availability('date'), 'ready'); assert.equal(named.availability('missing'), 'missing'); assert.equal(named.availability('sheet'), 'unrealized');
  assert.equal(boolean.availability(), 'ready'); assert.equal(selection.availability(1), 'ready'); assert.equal(selection.availability('1'), 'ready');
  assert.equal(selection.availability('browser'), 'ready'); assert.equal(selection.availability('lazy'), 'unrealized'); assert.equal(selection.availability('unmounted'), 'missing');
}
assert.deepEqual([named.desired.value, boolean.desired.value, selection.desired.value], ['notes', true, 'lazy']); assert.equal(Focus.currentName(), 'parent'); assert.equal(watch().generation, generation);
assert.deepEqual(test.stats(), baselineStats); assert.deepEqual(test.request('debug.focusHandles'), handles); assert.deepEqual(test.request('debug.focusTraversal'), cycle);
assert.deepEqual(test.request('debug.layout').scrolls.find(s => s.index === scroll.index).viewport, scroll.viewport);
const names = snapshot().nodes.map(n => n.props.focusName).filter(Boolean).sort(); reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, originalModel); assert.equal(controllers.selection, selection); assert.deepEqual(snapshot().nodes.map(n => n.props.focusName).filter(Boolean).sort(), names);
blocked.value = true; test.flush(); await until(() => boolean.availability() === 'unavailable', 'disabled boolean target'); assert.equal(selection.availability(1), 'ready');
blocked.value = false; passive.value = true; test.flush(); await until(() => boolean.availability() === 'ready' && selection.availability('browser') === 'unavailable', 'passive browser target');
passive.value = false; test.flush(); await until(() => selection.availability('browser') === 'ready', 'browser restored');
targetShown.value = false; test.flush(); await until(() => boolean.availability() === 'missing' && snapshot().hostedControlCount === 5, 'opaque target removed while controller remains alive');
assert.equal(boolean.desired.value, true); targetShown.value = true; test.flush();
await until(() => boolean.availability() === 'ready' && snapshot().hostedControlCount === 6, 'same opaque binding reinserted'); assert.equal(Focus.currentName(), 'parent');
boolean.resume(); await until(() => !boolean.retired.value, 'boolean lease resumed'); tasks.shift()(); await until(() => taskResults.length === 1, 'stale task queried');
assert.deepEqual(taskResults[0], ['ready', null, 'ready']);
beginRPC('stale', 'invalid stale ID', {}); await until(() => rpcGates.has('stale'), 'RPC started'); named.resume(); selection.resume();
await until(() => !named.retired.value && !selection.retired.value, 'RPC leases resumed'); rpcGates.get('stale')();
await until(() => messages.some(m => m.label === 'stale'), 'stale RPC replied'); assert.deepEqual(messages.find(m => m.label === 'stale').value, [null, 'ready', null]);
beginRPC('fresh'); await until(() => rpcGates.has('fresh'), 'fresh RPC started'); rpcGates.get('fresh')();
await until(() => messages.some(m => m.label === 'fresh'), 'fresh RPC replied'); assert.deepEqual(messages.find(m => m.label === 'fresh').value, ['ready', 'ready', 'ready']);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 10000 }); await until(() => selection.availability('lazy') === 'ready', 'opaque lazy target realized');
assert.equal(Focus.currentName(), 'parent'); assert.equal(selection.desired.value, 'lazy'); selection.request('lazy'); await until(() => selection.actual.value === 'lazy', 'explicit opaque retry');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && Object.values(controllers).every(c => c.retired.value) && named.availability('sheet') === 'ready', 'retired sheet availability');
assert.equal(named.availability('notes'), 'inactiveWindow'); assert.equal(boolean.availability(), 'inactiveWindow'); assert.equal(selection.availability('lazy'), 'inactiveWindow');
assert.ok(Object.values(controllers).every(c => c.retired.value)); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false });
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && boolean.availability() === 'ready', 'parent availability restored');
assert.ok(Object.values(controllers).every(c => c.retired.value), 'queries leave all retired owners unchanged');
beginRPC('canceled', 'invalid disposed ID', {}); await until(() => rpcGates.has('canceled'), 'pending RPC before disposal');
const retired = controllers; shown.value = false; test.flush();
await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length && rpcResults.has('canceled'), 'pending availability owner removed');
assert.deepEqual(rpcResults.get('canceled'), [null, null, null]); assert.equal(retired.named.availability({}), null); assert.equal(retired.boolean.availability(), null); assert.equal(retired.selection.availability({}), null);
assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && test.focusStats().listeners === 3 && controllers.boolean.availability() === 'ready', `owned query mount ${i}`);
  assert.equal(controllers.selection.availability('lazy'), 'unrealized'); shown.value = false; test.flush(); tasks.shift()();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length && taskResults.length === i + 2, `late owned query removal ${i}`);
  assert.deepEqual(taskResults.at(-1), [null, null, null]); assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 });
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(rpcGates.size, 0);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS owned availability: named/boolean/typed opaque targets, pure snapshots, keyed identity, disabled/passive and lazy explicit retry, per-controller task/RPC leases, retired sheet contexts, canceled requests and 20 owner lifetimes');
