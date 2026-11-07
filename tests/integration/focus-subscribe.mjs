import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.subscribe(() => {}), /mounted window/);
const shown = State(true), presented = State(false), reversed = State(false), names = State(['café', 'cafe\u0301']), blocked = State(false), tabFocusable = State(true), parent = State('parent');
let model, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; const local = model = { a: scope.state('A'), b: scope.state('B'), secure: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), actual: scope.state(null), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  scope.effect(() => Focus.subscribe(name => { local.actual.value = name; }));
  return () => VStack([
    Text(`Observed: ${local.actual.value ?? 'unnamed'}`),
    ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => TextField('Same title', { text: local[id].binding, focusName: names.value[id === 'a' ? 0 : 1] })),
    SecureField('Secret', { text: local.secure.binding, focusName: 'secure' }),
    TextEditor({ text: local.editor.binding, focusName: 'editor' }).frame({ height: 70 }),
    DatePicker('Date', { selection: local.date.binding, style: 'compact', components: 'date', focusName: 'date' }),
    WebView({ html: '<input id="first"><input id="second">', focusName: 'web', tabFocusable: tabFocusable.value }).disabled(blocked.value).frame({ height: 80 }),
  ]).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: local.sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI actual focus subscriptions', width: 580, height: 620, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), watch = () => test.request('debug.focusWatch');
const browser = () => snapshot().nodes.find(n => n.kind === 'webview')?.id;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), actual: model?.actual.value, stats: test.stats() })}`);
}
await until(() => snapshot().hostedControlCount === 6 && snapshot().webViewCount === 1 && test.request('debug.web', { id: browser() }).ready && test.focusStats().listeners === 1, 'scope observer and mixed controls');
Focus.clear(); await sleep(40);
const events = [], other = [];
const stop = Focus.subscribe(name => events.push(name)), stopOther = Focus.subscribe(name => other.push(name));
assert.deepEqual(events, []); assert.deepEqual(test.focusStats(), { listeners: 3, watching: true });
assert.equal(watch().observations, 1); assert.equal(watch().notifications, 4);
assert.throws(() => test.request('focus.watch', { token: 1 }), /token must increase/);
test.request('focus.unwatch', { token: 1 }); assert.equal(watch().watching, true, 'stale stop cannot retire a newer session');
// Emit a real native gain while Node is still in this synchronous turn, then
// acknowledge a newer blur before the queued event can reach its listeners.
const beforeGain = watch().sequence;
test.request('focus.named', { name: 'café' }); assert.ok(watch().sequence > beforeGain);
Focus.clear(); await sleep(60); assert.deepEqual(events, []); assert.equal(model.actual.value, null);
async function request(name) {
  assert.equal(Focus.requestNamed(name), true);
  await until(() => events.at(-1) === name && model.actual.value === name, `observed ${name}`);
}
await request('café');
// No debug/query/layout call before this assertion: observe shared field-editor
// reassignment independently of polling the native view hierarchy.
test.request('focus.move', { direction: 'next' }); await sleep(60); assert.equal(events.at(-1), 'cafe\u0301');
for (const name of ['secure', 'editor', 'date', 'web']) await request(name);
const before = events.length;
test.request('debug.web.evaluate', { id: browser(), script: "document.getElementById('second').focus()" }); await sleep(60);
assert.equal(events.length, before, 'DOM changes within one named browser do not duplicate name events');
Focus.clear(); await until(() => events.at(-1) === null && model.actual.value === null, 'clear observation');
await request('café'); names.value = ['cafe\u0301', 'Distinct']; reversed.value = true; test.flush();
await until(() => events.at(-1) === 'cafe\u0301' && model.actual.value === 'cafe\u0301', 'canonical rename emits exact bytes');
await request('web'); blocked.value = true; test.flush(); await until(() => events.at(-1) === null, 'disabled browser observation');
blocked.value = false; test.flush(); await until(() => test.request('debug.webFocus', { id: browser() }).interactionEnabled, 'browser enabled'); await request('web');
tabFocusable.value = false; test.flush(); await until(() => events.at(-1) === null, 'passive browser observation');
tabFocusable.value = true; test.flush(); await until(() => test.request('debug.webFocus', { id: browser() }).containerEligible, 'browser eligible');
await request('parent'); const parentContext = watch().context;
presented.value = true; await until(() => test.request('debug.focusContext').sheet && watch().context > parentContext, 'sheet observer context'); await request('sheet');
assert.equal(Focus.requestNamed('parent'), false); assert.equal(model.actual.value, 'sheet');
const sheetContext = watch().context; presented.value = false;
await until(() => !test.request('debug.focusContext').sheet && watch().context > sheetContext, 'parent observer context restored'); await request('parent');
assert.deepEqual(other, events);
stop(); const stoppedCount = events.length; assert.equal(Focus.requestNamed('editor'), true);
await until(() => other.at(-1) === 'editor' && model.actual.value === 'editor', 'remaining listeners'); assert.equal(events.length, stoppedCount);
stopOther(); stopOther(); assert.deepEqual(test.focusStats(), { listeners: 1, watching: true });
const saved = Focus.capture(); assert.ok(saved);
const beforeMove = watch().generation;
assert.equal(typeof Focus.move('up'), 'boolean'); assert.equal(Focus.request(saved), true);
assert.equal(Focus.currentName(), 'editor'); assert.ok(watch().generation >= beforeMove + 2);
assert.equal(Focus.requestNamed('unavailable'), false); assert.equal(Focus.currentName(), 'editor');
const channel = watch(), stamp = { token: channel.token, generation: channel.generation + 1, context: channel.context };
const applied = test.request('focus.named', { name: 'secure', focusRequest: stamp });
assert.equal(applied.focusAccepted, true); assert.equal(applied.focused, true); assert.equal(applied.observation.name, 'secure');
assert.equal(applied.observation.generation, stamp.generation); assert.ok(applied.observation.sequence > channel.sequence);
const replayed = test.request('focus.named', { name: 'editor', focusRequest: stamp });
assert.equal(replayed.focusAccepted, false); assert.equal(replayed.observation.name, 'secure');
const wrongWindow = test.request('focus.named', { name: 'editor', focusRequest: { ...stamp, generation: stamp.generation + 1, context: sheetContext } });
assert.equal(wrongWindow.focusAccepted, false); assert.equal(wrongWindow.observation.name, 'secure');
assert.equal(wrongWindow.observation.context, channel.context);
const staleSession = test.request('focus.move', { direction: 'clear', focusRequest: { ...stamp, token: 1, generation: stamp.generation + 2 } });
assert.equal(staleSession.focusAccepted, false); assert.equal(Focus.currentName(), 'secure');
const beforeInvalid = watch().generation;
for (const focusRequest of [null, [], 1, {}, { ...stamp, generation: true }, { ...stamp, generation: 0 }, { ...stamp, context: -1 }, { ...stamp, unknown: true }]) {
  assert.throws(() => test.request('focus.named', { name: 'editor', focusRequest }), /focus request/);
  assert.equal(watch().generation, beforeInvalid); assert.equal(Focus.currentName(), 'secure');
}
assert.throws(() => test.request('focus.move', { direction: 'invalid', focusRequest: { ...stamp, generation: beforeInvalid + 1 } }), /focus direction/);
assert.equal(watch().generation, beforeInvalid);
shown.value = false; await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && test.focusStats().listeners === 0, 'scope observer retirement');
assert.equal(watch().watching, false); assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 6 && test.focusStats().listeners === 1, `observer mount ${i}`);
  assert.equal(Focus.requestNamed('editor'), true); await until(() => model.actual.value === 'editor', 'scoped observation publishes');
  Focus.requestNamed('secure'); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `queued observer retirement ${i}`);
  assert.deepEqual(test.focusStats(), { listeners: 0, watching: false });
  assert.equal(watch().observations, 0); assert.equal(watch().notifications, 0); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
console.log('PASS focus subscriptions: native/DOM focus and unacknowledged shared field-editor traversal, queued gain/newer blur acknowledgements, request generations/context/replay guards, exact Unicode, listener isolation and 20 queued focused owner retirements');
