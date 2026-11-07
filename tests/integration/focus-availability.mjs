import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, LazyVStack, Picker, ScrollView, SecureField, State, Stepper, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.availabilityNamed('parent'), /mounted window/);
const shown = State(false), blocked = State(false), browserBlocked = State(false), passive = State(false), presented = State(false), fieldName = State('café'), parent = State('parent');
let controller, model, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; controller = scope.focus();
  const local = model = { text: scope.state('text'), secure: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), count: scope.state(2), choice: scope.state('a'), lazy: scope.state('lazy'), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
  return () => VStack([
    TextField('Same label', { text: local.text.binding, focusName: fieldName.value }).disabled(blocked.value),
    SecureField('Same label', { text: local.secure.binding, focusName: 'cafe\u0301' }),
    TextEditor({ text: local.editor.binding, focusName: 'editor' }).frame({ height: 45 }),
    DatePicker('Date', { selection: local.date.binding, components: 'date', style: 'compact', focusName: 'date' }),
    Stepper('Count', { value: local.count.binding, focusName: 'count' }),
    Picker('Choice', { selection: local.choice.binding, options, style: 'segmented', focusName: 'choice' }),
    Picker('Menu', { selection: local.choice.binding, options, style: 'menu', focusName: 'menu' }),
    WebView({ html: '<input>', focusName: 'web', tabFocusable: !passive.value }).frame({ height: 45 }).disabled(browserBlocked.value),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 60 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
      TextField('Lazy input', { text: local.lazy.binding, focusName: 'lazy-text' }).frame({ height: 40 }),
      WebView({ html: '<input>', focusName: 'lazy-web' }).frame({ height: 60 }),
    ])).frame({ width: 350, height: 120 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding, focusName: 'sheet-field' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI named focus availability', width: 620, height: 700, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), watch = () => test.request('debug.focusWatch'), availability = Focus.availabilityNamed;
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
await until(() => snapshot().hostedControlCount === 1, 'parent mounted');
assert.equal(availability('parent'), 'ready'); assert.equal(availability('café'), 'missing');
shown.value = true;
await until(() => snapshot().hostedControlCount === 8 && snapshot().webViewCount === 1 && test.focusStats().listeners === 1 && availability('web') === 'ready', 'mixed owners mounted');
assert.equal(Focus.requestNamed('parent'), true); await until(() => controller.actual.value === 'parent', 'parent observation');
controller.request('lazy-text'); test.flush(); await sleep(30);
assert.equal(controller.desired.value, 'lazy-text'); assert.equal(controller.actual.value, 'parent');
const target = Focus.capture(); assert.ok(target); assert.equal(Focus.setTraversal([target], { tabNavigation: true }), true);
const baselineStats = test.stats(), baselineHandles = test.request('debug.focusHandles'), baselineCycle = test.request('debug.focusTraversal'), generation = watch().generation;
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 120 && s.document.height > 2000); assert.ok(scroll);
const originalViewport = scroll.viewport;
for (let i = 0; i < 20; i++) {
  for (const name of ['parent', 'café', 'cafe\u0301', 'editor', 'date', 'web']) assert.equal(availability(name), 'ready');
  assert.equal(availability('absent'), 'missing'); assert.equal(availability('sheet-field'), 'unrealized');
  assert.equal(availability('lazy-text'), 'unrealized'); assert.equal(availability('lazy-web'), 'unrealized');
}
assert.equal(Focus.currentName(), 'parent'); assert.equal(controller.desired.value, 'lazy-text'); assert.equal(watch().generation, generation);
assert.deepEqual(test.stats(), baselineStats); assert.deepEqual(test.request('debug.focusHandles'), baselineHandles); assert.deepEqual(test.request('debug.focusTraversal'), baselineCycle);
assert.deepEqual(test.request('debug.layout').scrolls.find(s => s.index === scroll.index).viewport, originalViewport);
const node = name => snapshot().nodes.find(n => n.props.focusName === name);
for (const name of ['count', 'choice', 'menu']) {
  const controls = test.request('debug.focusControls').controls.filter(c => c.owner === node(name).id);
  assert.equal(availability(name), controls.some(c => c.eligible) ? 'ready' : 'unavailable');
}
for (const name of [false, '', 1]) assert.throws(() => test.request('focus.availability', { name }), /Focus name/);
assert.equal(watch().generation, generation);
blocked.value = true; test.flush(); await until(() => availability('café') === 'unavailable', 'disabled text availability');
assert.equal(availability('cafe\u0301'), 'ready'); assert.equal(Focus.currentName(), 'parent');
blocked.value = false; test.flush(); await until(() => availability('café') === 'ready', 'text re-enabled');
const date = test.request('debug.focusControls').controls.find(c => c.owner === node('date').id && c.kind === 'date'); assert.ok(date);
test.request('debug.focusControlAvailability', { index: date.index, hidden: true }); assert.equal(availability('date'), 'unavailable');
test.request('debug.focusControlAvailability', { index: date.index, hidden: false }); assert.equal(availability('date'), 'ready');
browserBlocked.value = true; test.flush(); await until(() => availability('web') === 'unavailable', 'disabled browser availability');
browserBlocked.value = false; passive.value = true; test.flush(); await until(() => availability('web') === 'unavailable', 'passive browser availability');
passive.value = false; test.flush(); await until(() => availability('web') === 'ready', 'browser restored');
fieldName.value = 'renamed'; test.flush(); assert.equal(availability('café'), 'missing'); assert.equal(availability('renamed'), 'ready'); assert.equal(availability('cafe\u0301'), 'ready');
test.request('debug.scroll', { index: scroll.index, x: 0, y: 10000 });
await until(() => availability('lazy-text') === 'ready' && availability('lazy-web') === 'ready', 'actual scrolling realizes named targets');
assert.equal(Focus.currentName(), 'parent'); assert.equal(controller.desired.value, 'lazy-text');
controller.request('lazy-text'); await until(() => controller.actual.value === 'lazy-text', 'explicit retry after availability changed');
assert.equal(Focus.requestNamed('lazy-web'), true);
presented.value = true; await until(() => test.request('debug.focusContext').sheet && controller.retired.value && availability('sheet-field') === 'ready', 'sheet availability');
for (const name of ['parent', 'renamed', 'web', 'lazy-text', 'lazy-web']) assert.equal(availability(name), 'inactiveWindow');
assert.equal(availability('absent'), 'missing'); Focus.clear(); const sheetGeneration = watch().generation;
assert.equal(availability('sheet-field'), 'ready'); assert.equal(Focus.currentName(), null); assert.equal(watch().generation, sheetGeneration);
assert.equal(Focus.requestNamed('sheet-field'), true);
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && availability('parent') === 'ready', 'parent availability restored');
assert.ok(['unrealized', 'inactiveWindow'].includes(availability('sheet-field')), 'dismissed sheet may retain an unattached/cached native surface');
assert.equal(controller.retired.value, true, 'availability does not resume a retired controller');
const retired = controller; shown.value = false; test.flush();
await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'mixed owner removed');
assert.equal(availability('renamed'), 'missing'); assert.equal(availability('lazy-text'), 'missing');
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 8 && snapshot().webViewCount === 1 && availability('renamed') === 'ready', `availability mount ${i}`);
  assert.notEqual(controller, retired); assert.equal(availability('absent'), 'missing'); assert.equal(availability('lazy-web'), 'unrealized');
  shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `availability removal ${i}`);
  assert.equal(availability('renamed'), 'missing'); assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false });
  assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.equal(availability('parent'), null); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS focus availability: exact logical/native states across text/date/choice/WebKit, no focus/generation/capture/scroll/intent changes, actual lazy realization plus explicit retry, sheet isolation without resume and 20 owner lifetimes');
