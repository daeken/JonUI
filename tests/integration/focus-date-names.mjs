import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, LazyVStack, ScrollView, State, Text, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(true), reversed = State(false), names = State(['café', 'cafe\u0301']), blocked = State(false), presented = State(false);
const settings = State({ style: 'compact', components: 'date', timeZone: 'UTC' });
let model, setups = 0, disposals = 0; const matrix = [];
const Panel = Component(scope => {
  setups++; model = { a: scope.state(Date.UTC(2026, 0, 1)), b: scope.state(Date.UTC(2027, 0, 1)), lazy: scope.state(Date.UTC(2028, 0, 1)), sheet: scope.state(Date.UTC(2029, 0, 1)), text: scope.state('native') };
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    TextField('Name', { text: model.text.binding, focusName: 'text' }),
    ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, owner => {
      const focusName = names.value[owner === 'a' ? 0 : 1];
      return DatePicker('Same title', { selection: model[owner].binding, ...settings.value, ...(focusName === null ? {} : { focusName }) }).disabled(owner === 'a' && blocked.value);
    }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 24 }, (_, i) => i), { id: i => i }, i => Text(`Row ${i}`).frame({ height: 40 })),
      DatePicker('Lazy', { selection: model.lazy.binding, components: 'date', style: 'compact', focusName: 'lazy' }),
    ])).frame({ height: 100 }),
    WebView({ html: '<p>Chart</p>', focusName: 'chart' }).frame({ height: 40 }),
  ], { spacing: 8 }).sheet({ isPresented: presented.binding, content: DatePicker('Sheet', { selection: model.sheet.binding, components: 'date', style: 'compact', focusName: 'sheet' }).frame({ width: 360, height: 160 }) });
});
const app = runApp({ title: 'JonUI named native dates', width: 620, height: 500, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), dates = () => test.request('debug.dates').dates;
const controls = () => test.request('debug.focusControls').controls.filter(c => c.kind === 'date'), handles = () => test.request('debug.focusHandles'), registry = () => test.request('debug.focusNames');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const end = Date.now() + 10000;
  do {
    const s = snapshot(), c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < end);
  assert.fail(`Timed out: ${name}; ${JSON.stringify({ dates: dates(), controls: controls(), registry: registry(), counts: test.stats() })}`);
}
const dateIndex = owner => dates().findIndex(d => d.value === model[owner].value);
function request(name, owner) {
  assert.equal(Focus.requestNamed(name), true); const index = dateIndex(owner); assert.ok(index >= 0); assert.equal(controls()[index].focused, true);
}
await until(s => s.states.length === 11 && s.hostedControlCount === 3 && dates().length === 2 && controls().every(c => c.eligible), 'two real native date controls with identical labels');
assert.deepEqual(registry(), { count: 6 }); assert.deepEqual(handles(), { targets: 0, live: 0 });
assert.equal(Focus.requestNamed('lazy'), false); assert.equal(Focus.requestNamed('sheet'), false); assert.equal(Focus.requestNamed('unknown'), false);
request('café', 'a'); request('cafe\u0301', 'b'); assert.equal(Focus.requestNamed('CAFÉ'), false);
for (let i = 0; i < 50; i++) request('café', 'a'); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.equal(test.stats().actions, 0);
const a = Focus.capture(); assert.ok(a); request('cafe\u0301', 'b'); const b = Focus.capture(); assert.ok(b); assert.equal(Focus.requestNamed('text'), true); const text = Focus.capture(); assert.ok(text);
assert.equal(Focus.setTraversal([a, b, text], { tabNavigation: true }), true); request('café', 'a'); assert.equal(test.request('debug.tab').intercepted, true); assert.equal(controls()[dateIndex('b')].focused, true);
const next = Date.UTC(2026, 1, 28); test.request('debug.date', { index: dateIndex('a'), value: next }); await until(() => model.a.value === next, 'real date target/action publishes to the correct owner');
names.value = ['Renamed', 'cafe\u0301']; reversed.value = true; test.flush(); await sleep(30);
assert.equal(setups, 1); assert.equal(Focus.requestNamed('café'), false); request('Renamed', 'a'); assert.equal(Focus.request(a), true); assert.equal(controls()[dateIndex('a')].focused, true);
names.value = ['cafe\u0301', 'Renamed']; test.flush(); request('Renamed', 'b'); request('cafe\u0301', 'a'); assert.equal(Focus.request(b), true); assert.equal(controls()[dateIndex('b')].focused, true);
names.value = [null, 'Renamed']; test.flush(); assert.equal(Focus.requestNamed('cafe\u0301'), false); assert.equal(Focus.request(a), true); assert.deepEqual(registry(), { count: 5 });
names.value = ['Restored', 'Renamed']; test.flush(); request('Restored', 'a');
const stable = snapshot().nodes, node = stable.find(n => n.kind === 'datepicker' && n.props.focusName === 'Restored');
for (const focusName of [null, '', 1, true, {}, []]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...node, props: { ...node.props, focusName } }] }), /Focus name/); assert.deepEqual(snapshot().nodes, stable);
}
for (const focusName of ['Renamed', 'text', 'chart']) {
  assert.throws(() => test.request('commit', { nodes: [{ ...node, props: { ...node.props, focusName } }] }), /Duplicate focus name/); assert.deepEqual(snapshot().nodes, stable);
}
request('Renamed', 'b'); blocked.value = true; test.flush(); await until(() => !controls()[dateIndex('a')].eligible, 'inherited disabled date environment');
assert.equal(Focus.requestNamed('Restored'), false); assert.equal(controls()[dateIndex('b')].focused, true); assert.equal(Focus.request(a), false);
blocked.value = false; test.flush(); await until(() => controls()[dateIndex('a')].eligible, 'date eligibility restored'); request('Restored', 'a'); assert.equal(Focus.request(a), true);
const focused = controls()[dateIndex('a')]; test.request('debug.focusControlAvailability', { index: focused.index, hidden: true });
assert.equal(Focus.requestNamed('Restored'), false); test.request('debug.focusControlAvailability', { index: focused.index, hidden: false }); request('Restored', 'a');
Focus.setTraversal([]);
for (const [style, components] of [['graphical', 'date'], ['automatic', 'time'], ['compact', 'dateAndTime']]) {
  settings.value = { style, components, timeZone: 'America/Chicago' }; test.flush();
  await until(() => dates().length === 2 && dates().every(d => d.timeZone === 'America/Chicago'), `${style}/${components} native controls`);
  const index = dateIndex('a'); assert.ok(index >= 0); const eligible = controls()[index].eligible;
  assert.equal(Focus.requestNamed('Restored'), eligible); if (eligible) assert.equal(controls()[index].focused, true);
  matrix.push(`${style}/${components}:${eligible}`);
}
settings.value = { style: 'compact', components: 'date', timeZone: 'UTC' }; test.flush(); await until(() => dates().length === 2 && controls().every(c => c.eligible) && dates().every(d => ['UTC', 'GMT'].includes(d.timeZone)), 'compact date restored');
presented.value = true; await until(s => s.sheetPresented && test.request('debug.focusContext').sheet && controls().length === 1, 'owned native sheet date');
assert.equal(Focus.requestNamed('Restored'), false); assert.equal(Focus.requestNamed('sheet'), true); assert.equal(controls()[0].focused, true); assert.deepEqual(handles(), { targets: 0, live: 0 });
presented.value = false; await until(s => !s.sheetPresented && !test.request('debug.focusContext').sheet && controls().length === 2, 'native sheet date dismissed');
assert.equal(Focus.requestNamed('sheet'), false); request('Restored', 'a'); assert.equal(Focus.request(a), false);
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 100 && s.document.height > 900); assert.ok(scroll);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 2000 }); await until(() => dates().length === 3, 'lazy date realized by actual scroll'); request('lazy', 'lazy');
shown.value = false; await until(s => s.states.length === 6 && s.liveCells === 6 && s.hostedControlCount === 0 && s.webViewCount === 0 && s.liveViews === s.nodes.length && !dates().length, 'owned native date retirement');
assert.deepEqual(registry(), { count: 0 }); assert.equal(Focus.requestNamed('lazy'), false); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 11 && dates().length === 2 && controls().every(c => c.eligible), `date owner mount ${i}`);
  request('Restored', 'a'); request('Renamed', 'b'); shown.value = false;
  await until(s => s.states.length === 6 && s.liveCells === 6 && s.hostedControlCount === 0 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `date owner retirement ${i}`);
  assert.equal(Focus.requestNamed('Restored'), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().hostedControlCount, 0);
console.log(`PASS named DatePicker: first native focus with identical labels, exact Unicode, date actions/bindings, physical cycles, keyed rename/reassignment/removal, atomic native/date/web duplicates, disabled/hidden and style eligibility (${matrix.join(', ')}), sheet isolation, lazy realization and 20 focused owner retirements`);
