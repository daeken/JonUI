import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(true), reversed = State(false), names = State(['café', 'cafe\u0301', 'Notes 🦊']), disabled = State(false), presented = State(false);
let model, setups = 0, disposals = 0; const events = [], submits = [];
const Panel = Component(scope => {
  setups++; model = { plain: scope.state('plain'), secure: scope.state('dummy'), editor: scope.state('notes'), lazy: scope.state('lazy'), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: kind => kind }, kind => {
      const focusName = names.value[['plain', 'secure', 'editor'].indexOf(kind)], options = { text: model[kind].binding, ...(focusName === null ? {} : { focusName }), onEditingChanged: editing => events.push({ kind, editing, value: model[kind].value }) };
      return kind === 'editor' ? TextEditor({ ...options, monospaced: true }).frame({ height: 80 }) :
        (kind === 'secure' ? SecureField('Secret', { ...options, onSubmit: () => submits.push(model.secure.value) }) : TextField('Plain', { ...options, onSubmit: () => { submits.push(model.plain.value); Focus.requestNamed(names.value[2]); } })).disabled(kind === 'secure' && disabled.value);
    }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 24 }, (_, i) => i), { id: i => i }, i => Text(`Row ${i}`).frame({ height: 40 })),
      TextField('Lazy', { text: model.lazy.binding, focusName: 'lazy' }),
    ])).frame({ height: 100 }),
    WebView({ html: '<p>Chart</p>', focusName: 'chart' }).frame({ height: 50 }),
  ], { spacing: 8 }).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: model.sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 120 }) });
});
const app = runApp({ title: 'JonUI owned native named inputs', width: 600, height: 480, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus'), context = () => test.request('debug.focusContext');
const registry = () => test.request('debug.focusNames'), handles = () => test.request('debug.focusHandles'), fields = () => test.request('debug.fields').fields;
const index = kind => fields().find(f => f.secure === (kind === 'secure'))?.index;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 10000;
  do {
    const s = snapshot(), c = context(); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.active, false); assert.equal(c.alpha, 0);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${name}; ${JSON.stringify({ status: status(), context: context(), registry: registry(), counts: test.stats() })}`);
}
function request(name, kind) {
  assert.equal(Focus.requestNamed(name), true);
  assert.deepEqual(kind === 'editor' ? status().editors : status().fields, [kind === 'editor' ? 0 : index(kind)]);
}
await until(s => s.states.length === 10 && s.textInputCount === 3 && fields().length === 2 && test.request('debug.editors').count === 1, 'owned native subtrees');
assert.deepEqual(registry(), { count: 6 }); assert.deepEqual(handles(), { targets: 0, live: 0 });
assert.equal(Focus.requestNamed('missing'), false); assert.equal(Focus.requestNamed('lazy'), false); assert.equal(Focus.requestNamed('sheet'), false);
request('cafe\u0301', 'secure'); request('café', 'plain'); request('Notes 🦊', 'editor');
assert.equal(Focus.requestNamed('CAFÉ'), false); assert.deepEqual(status().editors, [0]);
const actions = test.stats().actions;
for (let i = 0; i < 50; i++) request('Notes 🦊', 'editor');
assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.equal(test.stats().actions, actions);
const editor = Focus.capture(); request('café', 'plain'); const plain = Focus.capture(); request('cafe\u0301', 'secure'); const secure = Focus.capture();
assert.ok(editor && plain && secure); assert.equal(Focus.setTraversal([plain, secure, editor], { tabNavigation: true }), true);
request('café', 'plain'); test.request('debug.field', { index: index('plain'), value: 'Named 🦊 café', submit: true });
await until(() => model.plain.value === 'Named 🦊 café' && status().editors[0] === 0 && submits.length === 1, 'Return snapshot before named focus');
test.request('debug.editor', { index: 0, value: '日本 🦊', newline: true }); await until(() => model.editor.value === '日本 🦊\n', 'native editor binding/newline');
request('cafe\u0301', 'secure'); test.request('debug.field', { index: index('secure'), value: 'dummy-🦊' }); await until(() => model.secure.value === 'dummy-🦊', 'secure binding');
const original = model, ids = snapshot().nodes.map(n => n.id).sort((a,b) => a-b);
names.value = ['Renamed', 'cafe\u0301', 'Notes 🦊']; reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, original); assert.equal(setups, 1); assert.deepEqual(snapshot().nodes.map(n => n.id).sort((a,b) => a-b), ids);
assert.equal(Focus.requestNamed('café'), false); request('Renamed', 'plain'); assert.equal(Focus.request(plain), true);
names.value = ['cafe\u0301', 'Renamed', 'Notes 🦊']; test.flush(); request('Renamed', 'secure'); request('cafe\u0301', 'plain');
assert.equal(Focus.request(secure), true); assert.deepEqual(status().fields, [index('secure')]);
assert.equal(test.request('debug.tab').intercepted, true); assert.deepEqual(status().editors, [0]);
await sleep(50); const eventCount = events.length;
for (let i = 0; i < 30; i++) request('Notes 🦊', 'editor'); await sleep(30); assert.equal(events.length, eventCount, 'repeated named requests preserve editing sessions');
names.value = ['cafe\u0301', null, 'Notes 🦊']; test.flush(); assert.equal(Focus.requestNamed('Renamed'), false); assert.equal(Focus.request(secure), true); assert.deepEqual(registry(), { count: 5 });
names.value = ['cafe\u0301', 'Restored', 'Notes 🦊']; test.flush(); request('Restored', 'secure');
const stable = snapshot().nodes, native = stable.filter(n => ['textfield', 'securefield', 'texteditor'].includes(n.kind) && n.props.focusName && !['lazy', 'sheet'].includes(n.props.focusName));
for (const node of native) for (const focusName of [null, '', 1, true, {}, []]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...node, props: { ...node.props, focusName } }] }), /Focus name/); assert.deepEqual(snapshot().nodes, stable);
}
for (const focusName of ['chart', names.value[0]]) {
  const node = native.find(n => n.kind === 'securefield');
  assert.throws(() => test.request('commit', { nodes: [{ ...node, props: { ...node.props, focusName } }] }), /Duplicate focus name/); assert.deepEqual(snapshot().nodes, stable);
}
request('Notes 🦊', 'editor'); disabled.value = true; test.flush(); await until(() => !fields().find(f => f.secure).enabled, 'inherited environment disables hosted control');
assert.equal(Focus.requestNamed('Restored'), false); assert.deepEqual(status().editors, [0]);
disabled.value = false; test.flush(); await until(() => fields().find(f => f.secure).enabled, 'hosted input re-enabled'); request('Restored', 'secure');
Focus.setTraversal([]); presented.value = true;
await until(s => s.sheetPresented && context().sheet && fields().length === 1, 'native named sheet');
assert.equal(Focus.requestNamed('Restored'), false); assert.equal(Focus.requestNamed('sheet'), true); assert.deepEqual(status().fields, [0]); assert.deepEqual(handles(), { targets: 0, live: 0 });
presented.value = false; await until(s => !s.sheetPresented && !context().sheet && fields().length === 2, 'native named sheet dismissal');
assert.equal(Focus.requestNamed('sheet'), false); request('Restored', 'secure'); assert.equal(Focus.request(secure), false);
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 100 && s.document.height > 900); assert.ok(scroll);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 2000 });
await until(() => fields().length === 3, 'actual lazy text realization'); assert.equal(Focus.requestNamed('lazy'), true); assert.equal(status().fields.length, 1);
test.request('debug.field', { index: status().fields[0], value: 'realized 🦊' }); await until(() => model.lazy.value === 'realized 🦊', 'named lazy target edits the owned cell');
shown.value = false;
await until(s => s.states.length === 5 && s.liveCells === 5 && s.textInputCount === 0 && s.webViewCount === 0 && s.liveViews === s.nodes.length && fields().length === 0, 'named owner retirement');
assert.deepEqual(registry(), { count: 0 }); assert.equal(Focus.requestNamed('lazy'), false); assert.equal(Focus.requestNamed('Restored'), false); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 10 && fields().length === 2 && test.request('debug.editors').count === 1, `native named mount ${i}`);
  request('Restored', 'secure'); request('Notes 🦊', 'editor'); assert.deepEqual(handles(), { targets: 0, live: 0 }); shown.value = false;
  await until(s => s.states.length === 5 && s.liveCells === 5 && s.textInputCount === 0 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `native named unmount ${i}`);
  assert.equal(Focus.requestNamed('Notes 🦊'), false); assert.deepEqual(registry(), { count: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.deepEqual(submits, ['Named 🦊 café']);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().textInputCount, 0);
console.log('PASS named native inputs: owned SwiftUI subtrees, plain/secure/editor first focus, exact Unicode names, binding/Return/newline order, keyed/captured identity, rename/reassignment/removal, atomic cross-kind duplicates, disabled environment, sheet isolation, real lazy realization and 20 focused owner retirements');
