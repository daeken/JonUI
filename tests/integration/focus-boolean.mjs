import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(false), reversed = State(false), presented = State(false), blocked = State(false), parent = State('parent');
let controllers, model, setups = 0, disposals = 0, completions = 0; const gates = [], submits = [];
const Panel = Component(scope => {
  setups++;
  const c = controllers = Object.fromEntries(['text', 'secure', 'editor', 'date', 'web'].map(key => [key, scope.focusBoolean(key === 'text')]));
  const local = model = { text: scope.state('A'), secure: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  scope.task(async () => { await new Promise(resolve => gates.push(resolve)); c.text.request(true); c.text.desired.value = true; c.secure.request(true); completions++; });
  return () => VStack([
    ForEach(reversed.value ? ['secure', 'text'] : ['text', 'secure'], { id: key => key }, key => key === 'text'
      ? TextField('Text', { text: local.text.binding, onSubmit: () => { submits.push(local.text.value); c.secure.request(true); } }).padding(2).focused(c.text.binding)
      : SecureField('Secret', { text: local.secure.binding }).focused(c.secure.binding)),
    TextEditor({ text: local.editor.binding }).focused(c.editor.binding).frame({ height: 65 }),
    DatePicker('Date', { selection: local.date.binding, components: 'date', style: 'compact' }).focused(c.date.binding),
    WebView({ html: '<input id="first"><input id="second">' }).frame({ height: 80 }).disabled(blocked.value).focused(c.web.binding),
    Text(`Actual: ${c.text.actual.value}/${c.secure.actual.value}; desired: ${c.text.desired.value}`),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI boolean focus', width: 620, height: 620, content: VStack([
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
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), stats: test.stats() })}`);
}
async function select(key) {
  controllers[key].request(true);
  await until(() => controllers[key].actual.value, `boolean ${key}`);
  assert.equal(controllers[key].binding.value, true); assert.equal(controllers[key].desired.value, true);
  for (const [other, controller] of Object.entries(controllers)) if (other !== key) assert.equal(controller.actual.value, false);
}
await until(() => snapshot().hostedControlCount === 1, 'parent mounted');
assert.equal(Focus.requestNamed('parent'), true); shown.value = true;
await until(() => snapshot().hostedControlCount === 5 && snapshot().webViewCount === 1 && controllers?.text.actual.value, 'initial true attempt');
assert.deepEqual(test.focusStats(), { listeners: 5, watching: true }); assert.equal(watch().observations, 1); assert.equal(watch().notifications, 4);
const names = snapshot().nodes.map(node => node.props.focusName).filter(name => name && name !== 'parent' && name !== 'sheet');
assert.equal(names.length, 5); assert.equal(new Set(names).size, 5);
assert.ok(snapshot().nodes.every(node => !('focusBinding' in node.props)));
assert.equal(controllers.secure.desired.value, false);
const original = controllers, originalModel = model;
controllers.editor.desired.value = true; await until(() => controllers.editor.actual.value, 'boolean desired write');
assert.equal(controllers.text.desired.value, true);
controllers.text.desired.value = false; test.flush(); await sleep(30); assert.equal(controllers.editor.actual.value, true);
controllers.text.request(false); test.flush(); await sleep(30); assert.equal(controllers.editor.actual.value, true);
reversed.value = true; test.flush(); await sleep(30); assert.equal(controllers, original); assert.equal(model, originalModel);
assert.deepEqual(snapshot().nodes.map(node => node.props.focusName).filter(name => name && name !== 'parent' && name !== 'sheet').sort(), [...names].sort());
for (const key of ['text', 'secure', 'editor', 'date', 'web']) await select(key);
await select('text'); const field = test.request('debug.focusStatus').fields[0]; assert.ok(Number.isInteger(field));
test.request('debug.field', { index: field, value: '日本 🦊 café', submit: true });
await until(() => submits.length === 1 && controllers.secure.actual.value, 'Return snapshot and boolean request'); assert.deepEqual(submits, ['日本 🦊 café']);
await select('web'); blocked.value = true; test.flush(); await until(() => !controllers.web.actual.value, 'disabled browser');
assert.equal(controllers.web.desired.value, true); assert.equal(Focus.requestNamed('parent'), true);
controllers.web.desired.value = false; test.flush(); await sleep(30); assert.equal(Focus.currentName(), 'parent');
blocked.value = false; test.flush(); await until(() => test.request('debug.webFocus', { id: snapshot().nodes.find(node => node.kind === 'webview').id }).containerEligible, 'browser restored');
await select('text'); controllers.text.desired.value = false; await until(() => !controllers.text.actual.value, 'matching boolean clear');
await select('editor');
controllers.text.resume(); await until(() => !controllers.text.retired.value && controllers.editor.actual.value, 'passive resume');
gates.shift()(); await until(() => completions === 1 && controllers.secure.actual.value, 'per-controller stale task lease');
assert.equal(controllers.text.desired.value, false);
presented.value = true; await until(() => test.request('debug.focusContext').sheet && Object.values(controllers).every(c => c.retired.value), 'all boolean contexts retired');
assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(Focus.requestNamed('sheet'), true);
controllers.editor.request(true); test.flush(); await sleep(30); assert.equal(Focus.currentName(), 'sheet');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed');
assert.equal(Focus.requestNamed('parent'), true);
for (const c of Object.values(controllers)) c.resume();
await until(() => Object.values(controllers).every(c => !c.retired.value), 'boolean parent resume');
assert.equal(Focus.currentName(), 'parent'); assert.equal(controllers, original); assert.equal(model.text.value, '日本 🦊 café');
await select('editor'); const retired = controllers;
shown.value = false; test.flush();
await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'boolean owner removed');
const baseline = test.stats();
for (const c of Object.values(retired)) { c.desired.value = true; c.request(true); c.resume(); }
assert.deepEqual(test.stats(), baseline);
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 5 && test.focusStats().listeners === 5 && controllers.text.actual.value, `boolean mount ${i}`);
  const current = controllers; current.editor.request(true); current.text.resume(); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `pending boolean removal ${i}`);
  gates.shift()(); await sleep(10);
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS boolean focus: independent opaque text/date/WebKit targets, desired/actual separation, conditional clears, Return ordering, keyed identity, per-controller task leases, modal retirement/resume and 20 pending owner lifetimes');
