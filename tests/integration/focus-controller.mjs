import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(false), reversed = State(false), presented = State(false), blocked = State(false), passive = State(false), parent = State('parent'), initial = State(null);
let model, controller, setups = 0, disposals = 0, completions = 0; const gates = [];
const Panel = Component(scope => {
  setups++; const local = model = { a: scope.state('A'), b: scope.state('B'), secure: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), sheet: scope.state('sheet') };
  const focus = controller = scope.focus(initial.value);
  scope.onDispose(() => { disposals++; });
  scope.task(async () => { await new Promise(resolve => gates.push(resolve)); focus.request('parent'); focus.desired.value = 'parent'; completions++; });
  return () => VStack([
    Text(`Actual: ${focus.actual.value ?? 'none'}; desired: ${focus.desired.value ?? 'none'}; retired: ${focus.retired.value}`),
    ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => TextField('Same title', { text: local[id].binding, focusName: id })),
    SecureField('Secret', { text: local.secure.binding, focusName: 'secure' }),
    TextEditor({ text: local.editor.binding, focusName: 'editor' }).frame({ height: 70 }),
    DatePicker('Date', { selection: local.date.binding, style: 'compact', components: 'date', focusName: 'date' }),
    WebView({ html: '<input id="first"><input id="second">', focusName: 'web', tabFocusable: !passive.value }).disabled(blocked.value).frame({ height: 80 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI owned focus controller', width: 620, height: 640, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), watch = () => test.request('debug.focusWatch');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), actual: controller?.actual.value, desired: controller?.desired.value, retired: controller?.retired.value, stats: test.stats() })}`);
}
await until(() => snapshot().hostedControlCount === 1, 'parent mounted');
assert.equal(Focus.requestNamed('parent'), true); shown.value = true;
await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && controller?.actual.value === 'parent', 'passive controller activation');
assert.equal(controller.desired.value, null); assert.equal(controller.retired.value, false); assert.equal(Focus.currentName(), 'parent');
assert.deepEqual(test.focusStats(), { listeners: 1, watching: true });
const original = controller;
async function request(name) {
  controller.request(name);
  await until(() => controller.actual.value === name && Focus.currentName() === name, `controller focuses ${name}`);
  assert.equal(controller.desired.value, name);
}
controller.desired.value = 'a'; await until(() => controller.actual.value === 'a', 'tracked desired write');
assert.equal(Focus.requestNamed('b'), true); await until(() => controller.actual.value === 'b', 'native movement updates actual');
assert.equal(controller.desired.value, 'a'); const noFeedback = watch().generation; await sleep(50); assert.equal(watch().generation, noFeedback); assert.equal(Focus.currentName(), 'b');
reversed.value = true; test.flush(); await sleep(30); assert.equal(controller, original); assert.equal(setups, 1); assert.equal(Focus.currentName(), 'b');
for (const name of ['a', 'secure', 'editor', 'date', 'web']) await request(name);
const beforeRetry = watch().generation; controller.request('web'); await until(() => watch().generation > beforeRetry, 'explicit same-name retry');
blocked.value = true; test.flush(); await until(() => controller.actual.value === null, 'disabled browser observation'); assert.equal(controller.desired.value, 'web');
blocked.value = false; test.flush(); await request('web');
passive.value = true; test.flush(); await until(() => controller.actual.value === null, 'passive browser observation');
passive.value = false; test.flush(); await request('editor');
test.request('debug.editor', { index: 0, value: '日本 🦊', newline: true }); await until(() => model.editor.value === '日本 🦊\n', 'native editor binding');
await request(null);
controller.request('a'); controller.request(null); await sleep(50); assert.equal(controller.actual.value, null); assert.equal(controller.desired.value, null);
controller.request('unavailable'); await sleep(40); assert.equal(controller.actual.value, null); assert.equal(controller.desired.value, 'unavailable'); assert.equal(controller.retired.value, false);
await request('a');

// Explicit resume is passive, keeps the owner/model and invalidates older writers.
assert.equal(Focus.requestNamed('b'), true); await until(() => controller.actual.value === 'b', 'user focus before resume');
const originalModel = model, values = [model.a.value, model.b.value, model.editor.value];
controller.resume(); await until(() => !controller.retired.value && controller.actual.value === 'b', 'passive same-window resume');
assert.equal(controller, original); assert.equal(model, originalModel); assert.equal(controller.desired.value, 'a'); assert.equal(Focus.currentName(), 'b');
gates.shift()(); await until(() => completions === 1, 'earlier task completed');
assert.equal(controller.desired.value, 'a'); assert.equal(Focus.currentName(), 'b');
controller.resume(); controller.request('a'); await until(() => !controller.retired.value && controller.actual.value === 'a', 'fresh same-turn request');
assert.deepEqual([model.a.value, model.b.value, model.editor.value], values);

// A new modal context retires the old controller even when an intent was queued.
presented.value = true; controller.request('sheet'); test.flush();
await until(() => test.request('debug.focusContext').sheet && controller.retired.value, 'modal context retirement');
assert.equal(controller.actual.value, null); assert.equal(controller.desired.value, 'sheet');
assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0);
assert.equal(Focus.requestNamed('sheet'), true); controller.request('parent'); controller.desired.value = 'a'; test.flush(); await sleep(40);
assert.equal(Focus.currentName(), 'sheet'); assert.equal(controller.actual.value, null); assert.equal(controller.retired.value, true);
controller.resume(); await until(() => !controller.retired.value && controller.actual.value === 'sheet', 'explicit sheet resumption');
assert.equal(controller.desired.value, 'a'); assert.equal(Focus.currentName(), 'sheet');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed');
await until(() => controller.retired.value, 'resumed sheet context retired on dismiss');
assert.equal(Focus.requestNamed('parent'), true); controller.resume();
await until(() => !controller.retired.value && controller.actual.value === 'parent', 'explicit parent resumption');
assert.equal(controller.desired.value, 'a'); assert.equal(Focus.currentName(), 'parent'); assert.equal(controller, original); assert.equal(model, originalModel);
for (let i = 0; i < 20; i++) {
  controller.resume(); await until(() => !controller.retired.value && controller.actual.value === 'parent', `passive resume ${i}`);
  assert.equal(controller.desired.value, 'a'); assert.equal(Focus.currentName(), 'parent'); assert.equal(watch().observations, 1); assert.equal(watch().notifications, 4);
}
shown.value = false;
await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'retired owner disposed');
const baseline = test.stats(); await sleep(20); assert.deepEqual(test.stats(), baseline);
initial.value = 'editor';
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 6 && test.focusStats().listeners === 1 && !controller.retired.value && controller.actual.value === 'editor', `initial named request on fresh controller ${i}`);
  assert.notEqual(controller, original); await request('editor');
  const retired = controller; retired.resume(); retired.request('secure'); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `pending controller disposal ${i}`);
  gates.shift()(); retired.resume(); retired.request('parent'); retired.desired.value = 'parent'; await sleep(10);
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS owned focus controller: mixed native/WebKit requests, passive same-window/sheet/parent resumption with retained model identity, stale task leases, 20 observer resume cycles and 20 pending/canceled owner lifetimes');
