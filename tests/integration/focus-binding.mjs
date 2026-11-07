import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(true), presented = State(false), blocked = State(false), parent = State('parent');
let controller, projections, model, setups = 0, disposals = 0; const submits = [];
const first = 'café', second = 'cafe\u0301';
const Editor = Component((scope, initial) => () => TextEditor({ text: initial.text }).frame({ height: 65 }).focused(scope.props.focus));
const Panel = Component(scope => {
  setups++; controller = scope.focus();
  const local = model = { a: scope.state('A'), b: scope.state('B'), secure: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), sheet: scope.state('sheet') };
  const p = projections = Object.fromEntries([first, second, 'secure', 'editor', 'date', 'web', 'sheet'].map(name => [name, controller.binding(name)]));
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    TextField('Same title', { text: local.a.binding, onSubmit: () => { submits.push(local.a.value); p[second].value = true; } }).padding(2).focused(p[first]),
    TextField('Same title', { text: local.b.binding }).focused(p[second]),
    SecureField('Secret', { text: local.secure.binding }).focused(p.secure),
    Editor({ text: local.editor.binding, focus: p.editor }),
    DatePicker('Date', { selection: local.date.binding, components: 'date', style: 'compact' }).focused(p.date),
    WebView({ html: '<input id="first"><input id="second">' }).frame({ height: 80 }).disabled(blocked.value).focused(p.web),
    Text(`Focused: ${p[first].value}/${p[second].value}/${p.editor.value}`),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding }).focused(p.sheet).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI projected focus bindings', width: 620, height: 640, content: VStack([
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
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), actual: controller?.actual.value, desired: controller?.desired.value, stats: test.stats() })}`);
}
async function select(name) {
  projections[name].value = true;
  await until(() => projections[name].value && Focus.currentName() === name, `projected ${name}`);
  assert.equal(controller.desired.value, name);
}
await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && test.focusStats().listeners === 1, 'projected controls mounted');
assert.ok(snapshot().nodes.every(n => !('focusBinding' in n.props)));
controller.request(null); await until(() => controller.actual.value === null, 'initial clear');
for (const name of [first, second, 'secure', 'editor', 'date', 'web']) await select(name);
await select(first);
// Queue native focus into a canonically equivalent but distinct name before
// Node receives it. False on the older projection must not clear that responder.
assert.equal(test.request('focus.named', { name: second }).focused, true);
projections[first].value = false;
await until(() => projections[second].value, 'conditional clear observes the newer responder');
assert.equal(Focus.currentName(), second); assert.equal(controller.desired.value, null);
projections[first].value = true; projections[second].value = true; projections[first].value = false;
await until(() => projections[second].value && controller.desired.value === second, 'newer pending target survives false on old projection');
projections[second].value = false; await until(() => controller.actual.value === null, 'matching projection clears');
assert.equal(Focus.requestNamed('parent'), true); await until(() => controller.actual.value === 'parent', 'unrelated parent focus');
projections[first].value = true; projections[first].value = false; await sleep(40);
assert.equal(Focus.currentName(), 'parent'); assert.equal(controller.desired.value, null);
await select(first);
const index = test.request('debug.focusStatus').fields[0]; assert.ok(Number.isInteger(index));
test.request('debug.field', { index, value: '日本 🦊 café', submit: true });
await until(() => submits.length === 1 && projections[second].value, 'Return snapshot before projection request'); assert.deepEqual(submits, ['日本 🦊 café']);
await select('web'); blocked.value = true; test.flush(); await until(() => !projections.web.value, 'disabled projection false');
assert.equal(controller.desired.value, 'web');
assert.equal(Focus.requestNamed('parent'), true); await until(() => controller.actual.value === 'parent', 'unrelated focus after browser disabled');
projections.web.value = false; await until(() => controller.desired.value === null, 'false cancels retained disabled intent');
assert.equal(Focus.currentName(), 'parent');
blocked.value = false; test.flush(); await until(() => test.request('debug.webFocus', { id: snapshot().nodes.find(n => n.kind === 'webview').id }).containerEligible, 'browser eligibility restored'); await select('web');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && controller.retired.value, 'projection context retires');
projections.sheet.value = true; assert.equal(controller.actual.value, null);
controller.resume(); projections.sheet.value = true;
await until(() => !controller.retired.value && projections.sheet.value, 'same-turn resumed sheet projection');
projections.sheet.value = false; await until(() => controller.actual.value === null, 'sheet projection clears');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && controller.retired.value, 'sheet projection context ends');
controller.resume(); projections.editor.value = true; await until(() => !controller.retired.value && projections.editor.value, 'parent projection resumes');
const retiredProjection = projections.editor;
shown.value = false; test.flush();
await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'projected owner retired');
const baseline = test.stats(); retiredProjection.value = true; assert.deepEqual(test.stats(), baseline);
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 6 && test.focusStats().listeners === 1, `binding mount ${i}`);
  await select('editor'); projections[first].value = true; shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `pending binding removal ${i}`);
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS focus projections: declarative text/date/WebKit names through modifiers/children, observed boolean reads, deferred writes, exact Unicode conditional blur, newer intent, Return ordering, disabled/sheet/resume and 20 pending owner lifetimes');
