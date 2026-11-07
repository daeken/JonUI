import assert from 'node:assert/strict';
import { Button, Component, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(true), presented = State(false), reversed = State(false), disabled = State(false), mainName = State('parent');
const submits = []; let model, setups = 0, disposals = 0;
const Sheet = Component(scope => {
  setups++; model = { plain: scope.state('sheet name'), secure: scope.state('dummy'), note: scope.state('notes') };
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: id => id }, kind => {
      if (kind === 'editor') return TextEditor({ text: model.note.binding }).frame({ height: 80 });
      if (kind === 'secure') return SecureField('Demo secret', { text: model.secure.binding }).disabled(disabled.value);
      return TextField(`Sheet name (${model.plain.value.length})`, { text: model.plain.binding, onSubmit: () => { submits.push(model.plain.value); Focus.next(); } });
    }),
    Button('Next', Focus.next), Button('Done', () => { presented.value = false; }),
  ], { spacing: 12 }).frame({ width: 380, height: 300 }).padding(16);
});
const app = runApp({ title: 'JonUI active sheet focus', width: 560, height: 400, content: VStack([
  TextField('Main window', { text: mainName.binding }),
  View(() => shown.value ? Text('Sheet anchor').sheet({ isPresented: presented.binding, content: Sheet() }) : Text('Owner removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus'), context = () => test.request('debug.focusContext');
const fields = () => test.request('debug.fields').fields, index = secure => fields().find(f => f.secure === secure).index;
const handles = () => test.request('debug.focusHandles'), cycle = () => test.request('debug.focusTraversal');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 10000;
  do {
    const s = snapshot(), c = context();
    assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.active, false); assert.equal(c.alpha, 0);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), context: context(), cycle: cycle(), counts: test.stats() })}`);
}
const tab = reverse => test.request('debug.tab', { modifiers: reverse ? ['shift'] : [] }).intercepted;
const nodeIDs = () => snapshot().nodes.map(n => n.id).sort((a, b) => a - b);
await until(s => s.states.length === 8 && fields().length === 1 && !context().sheet, 'mounted main window');
test.request('debug.focus', { field: 0 }); const parent = Focus.capture(); assert.ok(parent);
assert.equal(Focus.setTraversal([parent], { tabNavigation: true }), true); const originalIDs = nodeIDs();
presented.value = true;
await until(s => s.sheetPresented && context().sheet && fields().length === 2 && test.request('debug.editors').count === 1, 'real native sheet controls');
assert.deepEqual(nodeIDs(), originalIDs, 'presentation alone does not change logical handles');
const parentFocus = context().mainFields;
assert.equal(tab(), false, 'main-window custom routing does not intercept sheet events');
assert.equal(Focus.request(parent), false, 'observing a sheet context retires parent captures');
assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(cycle(), { count: 0, tabNavigation: false });
Focus.clear(); Focus.next(); assert.deepEqual(status().fields, [index(false)]);
test.request('debug.field', { index: index(false), value: 'Sheet 🦊 café', submit: true });
await until(() => submits.length === 1 && status().fields[0] === index(true), 'Return snapshot and traversal stay inside sheet');
assert.deepEqual(submits, ['Sheet 🦊 café']);
const secure = Focus.capture(); assert.ok(secure);
Focus.next(); assert.deepEqual(status().editors, [0]); const note = Focus.capture(); assert.ok(note);
Focus.previous(); assert.deepEqual(status().fields, [index(true)]);
Focus.previous(); assert.deepEqual(status().fields, [index(false)]); const plain = Focus.capture(); assert.ok(plain);
for (let i = 0; i < 50; i++) assert.ok(Focus.capture());
assert.deepEqual(handles(), { targets: 3, live: 3 }); assert.deepEqual(context().mainFields, parentFocus);
const order = [note, plain, secure]; assert.equal(Focus.setTraversal(order), true);
Focus.clear(); Focus.next(); assert.deepEqual(status().editors, [0]);
Focus.next(); assert.deepEqual(status().fields, [index(false)]); Focus.previous(); assert.deepEqual(status().editors, [0]);
assert.equal(Focus.setTraversal(order, { tabNavigation: true }), false, 'unsupported sheet Tab mode preserves command cycle');
assert.deepEqual(cycle(), { count: 3, tabNavigation: false });
assert.equal(Focus.setTraversal([parent]), false); assert.deepEqual(cycle(), { count: 3, tabNavigation: false });
assert.equal(Focus.setTraversal([], { tabNavigation: true }), true); assert.deepEqual(cycle(), { count: 0, tabNavigation: false });
Focus.request(plain); assert.equal(tab(), false); await until(() => status().fields[0] === index(true), 'native sheet Tab');
assert.equal(tab(true), false); await until(() => status().fields[0] === index(false), 'native sheet Shift-Tab');
Focus.request(note); test.request('debug.editor', { index: 0, value: 'sheet tabs' });
assert.equal(tab(), false); await until(() => model.note.value.includes('\t'), 'native multiline Tab remains available');
Focus.request(plain); disabled.value = true; test.flush();
await until(() => !fields().find(f => f.secure).enabled, 'disabled sheet control');
assert.equal(Focus.request(secure), false); assert.equal(Focus.setTraversal([note]), true); assert.equal(Focus.setTraversal([secure]), false);
disabled.value = false; test.flush(); await until(() => fields().find(f => f.secure).enabled, 'sheet control re-enabled');
assert.equal(Focus.request(secure), true);
const original = model; reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, original); assert.equal(setups, 1); assert.equal(Focus.request(plain), true); assert.equal(model.plain.value, 'Sheet 🦊 café');
assert.deepEqual(nodeIDs(), originalIDs); assert.deepEqual(context().mainFields, parentFocus);
presented.value = false;
await until(s => !s.sheetPresented && !context().sheet && fields().length === 1, 'native sheet dismissed');
assert.equal(Focus.request(plain), false); assert.equal(Focus.request(secure), false); assert.equal(Focus.request(note), false);
assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(cycle(), { count: 0, tabNavigation: false });
Focus.clear(); Focus.next(); assert.deepEqual(status().fields, [0]); const renewedParent = Focus.capture(); assert.ok(renewedParent);
assert.equal(Focus.request(parent), false); assert.equal(Focus.setTraversal([renewedParent], { tabNavigation: true }), true); assert.equal(tab(), true);
// Removing the logical owner while its sheet is focused must dismiss the
// platform sheet and release scoped resources despite framework view caches.
presented.value = true; await until(s => s.sheetPresented && context().sheet && fields().length === 2, 'sheet re-presentation');
Focus.clear(); Focus.next(); const removed = Focus.capture(); assert.ok(removed);
assert.equal(Focus.setTraversal([removed]), true); shown.value = false;
await until(s => !s.sheetPresented && !context().sheet && s.states.length === 5 && s.liveCells === 5 && s.liveViews === s.nodes.length && fields().length === 1, 'focused sheet owner removal');
assert.equal(Focus.request(removed), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.equal(cycle().count, 0);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  presented.value = false; shown.value = true;
  await until(s => s.states.length === 8 && !context().sheet, `sheet owner mount ${i}`);
  presented.value = true;
  await until(s => s.sheetPresented && context().sheet && fields().length === 2 && test.request('debug.editors').count === 1, `sheet presentation ${i}`);
  Focus.clear(); Focus.next(); const target = Focus.capture(); assert.ok(target); assert.equal(Focus.setTraversal([target]), true);
  Focus.previous(); assert.equal(Focus.request(target), true); shown.value = false;
  await until(s => !s.sheetPresented && !context().sheet && s.states.length === 5 && s.liveCells === 5 && s.liveViews === s.nodes.length && fields().length === 1, `focused sheet owner unmount ${i}`);
  assert.equal(Focus.request(target), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(cycle(), { count: 0, tabNavigation: false }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(mainName.value, 'parent'); assert.deepEqual(submits, ['Sheet 🦊 café']);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS active sheet focus: native plain/secure/editor commands and captures, parent isolation/context retirement, Return/Unicode ordering, command cycles/native Tab and multiline reset, atomic unsupported routing, disabled/keyed identity and 20 focused owner mount/unmount cycles without activation');
