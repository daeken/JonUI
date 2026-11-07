import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(false), reversed = State(false), presented = State(false), blocked = State(false), parent = State('parent');
let controller, other, model, setups = 0, disposals = 0, completions = 0; const gates = [], submits = [];
const Panel = Component(scope => {
  setups++; const focus = controller = scope.focusSelection([1, '1', 'editor', 'date', 'web'], 1), independent = other = scope.focusSelection([1]);
  const bindings = new Map([1, '1', 'editor', 'date', 'web'].map(id => [id, focus.binding(id)]));
  const local = model = { first: scope.state('A'), second: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), other: scope.state('other'), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  scope.task(async () => { await new Promise(resolve => gates.push(resolve)); focus.request('obsolete invalid ID'); focus.desired.value = 'obsolete invalid ID'; independent.request(1); completions++; });
  return () => VStack([
    ForEach(reversed.value ? ['1', 1] : [1, '1'], { id: id => id }, id => typeof id === 'number'
      ? TextField('Same label', { text: local.first.binding, onSubmit: () => { submits.push(local.first.value); focus.request('1'); } }).padding(2).focused(bindings.get(id))
      : SecureField('Same label', { text: local.second.binding }).focused(bindings.get(id))),
    TextEditor({ text: local.editor.binding }).focused(bindings.get('editor')).frame({ height: 65 }),
    DatePicker('Date', { selection: local.date.binding, components: 'date', style: 'compact' }).focused(bindings.get('date')),
    WebView({ html: '<input id="first"><input id="second">' }).frame({ height: 80 }).disabled(blocked.value).focused(bindings.get('web')),
    TextField('Independent domain', { text: local.other.binding }).focused(independent.binding(1)),
    Text(`Actual: ${focus.actual.value}; desired: ${focus.desired.value}; other: ${independent.actual.value}`),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI typed focus selections', width: 620, height: 660, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), watch = () => test.request('debug.focusWatch');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext');
    assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), actual: controller?.actual.value, desired: controller?.desired.value, stats: test.stats() })}`);
}
async function select(id) {
  controller.request(id); await until(() => controller.actual.value === id, `selected ${typeof id}:${id}`);
  assert.equal(controller.desired.value, id); assert.equal(controller.binding(id).value, true); assert.equal(other.actual.value, null);
}
await until(() => snapshot().hostedControlCount === 1, 'parent mounted');
assert.equal(Focus.requestNamed('parent'), true); shown.value = true;
await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && controller?.actual.value === 1, 'initial typed attempt');
assert.deepEqual(test.focusStats(), { listeners: 2, watching: true }); assert.equal(watch().observations, 1); assert.equal(watch().notifications, 4);
const names = snapshot().nodes.map(node => node.props.focusName).filter(name => name && name !== 'parent' && name !== 'sheet');
assert.equal(names.length, 6); assert.equal(new Set(names).size, 6); assert.equal(other.desired.value, null);
assert.ok(snapshot().nodes.every(node => !('focusBinding' in node.props)));
const original = controller, originalModel = model;
controller.desired.value = '1'; await until(() => controller.actual.value === '1', 'numeric and string IDs distinct');
controller.binding(1).value = false; test.flush(); await sleep(30); assert.equal(controller.actual.value, '1');
reversed.value = true; test.flush(); await sleep(30); assert.equal(controller, original); assert.equal(model, originalModel);
assert.deepEqual(snapshot().nodes.map(node => node.props.focusName).filter(name => name && name !== 'parent' && name !== 'sheet').sort(), [...names].sort());
for (const id of [1, '1', 'editor', 'date', 'web']) await select(id);
other.request(1); await until(() => other.actual.value === 1 && controller.actual.value === null, 'same ID in independent domain');
assert.equal(controller.desired.value, 'web'); controller.binding('web').value = false; test.flush(); await sleep(30); assert.equal(other.actual.value, 1);
controller.request(null); await until(() => other.actual.value === null && Focus.currentName() === null, 'explicit null clears context');
await select(1); const field = test.request('debug.focusStatus').fields[0]; assert.ok(Number.isInteger(field));
test.request('debug.field', { index: field, value: '日本 🦊 café', submit: true });
await until(() => submits.length === 1 && controller.actual.value === '1', 'Return snapshot and typed selection'); assert.deepEqual(submits, ['日本 🦊 café']);
await select('web'); blocked.value = true; test.flush(); await until(() => controller.actual.value === null, 'disabled browser');
assert.equal(controller.desired.value, 'web'); assert.equal(Focus.requestNamed('parent'), true);
controller.binding('web').value = false; test.flush(); await sleep(30); assert.equal(Focus.currentName(), 'parent'); assert.equal(controller.desired.value, null);
blocked.value = false; test.flush(); await until(() => test.request('debug.webFocus', { id: snapshot().nodes.find(node => node.kind === 'webview').id }).containerEligible, 'browser restored');
await select('editor'); controller.resume(); await until(() => !controller.retired.value && controller.actual.value === 'editor', 'passive resume');
gates.shift()(); await until(() => completions === 1 && other.actual.value === 1, 'per-controller stale task lease'); assert.equal(controller.desired.value, 'editor');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && controller.retired.value && other.retired.value, 'selection contexts retired');
assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(Focus.requestNamed('sheet'), true);
controller.request('invalid retired ID'); controller.desired.value = 'date'; test.flush(); await sleep(30); assert.equal(Focus.currentName(), 'sheet');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed');
assert.equal(Focus.requestNamed('parent'), true); controller.resume(); other.resume();
await until(() => !controller.retired.value && !other.retired.value, 'selection parent resume');
assert.equal(Focus.currentName(), 'parent'); assert.equal(controller.actual.value, null); assert.equal(controller.desired.value, 'date'); assert.equal(controller, original); assert.equal(model.first.value, '日本 🦊 café');
await select('editor'); const retired = controller;
shown.value = false; test.flush();
await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'selection owner removed');
const baseline = test.stats(); retired.desired.value = 'invalid disposed ID'; retired.request('invalid disposed ID'); retired.resume(); assert.deepEqual(test.stats(), baseline);
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 6 && test.focusStats().listeners === 2 && controller.actual.value === 1, `selection mount ${i}`);
  controller.request('editor'); controller.resume(); controller.request('date'); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `pending selection removal ${i}`);
  gates.shift()(); await sleep(10);
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS selection focus: typed numeric/string IDs and independent domains, native text/date/WebKit selection, conditional/global clear, Return ordering, keyed identity, task leases, modal retirement/resume and 20 pending owner lifetimes');
