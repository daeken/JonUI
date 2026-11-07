import assert from 'node:assert/strict';
import { Component, Focus, SecureField, State, Text, TextField, View, VStack, WebRequest, WebView, runApp, __testing as test } from 'jonui';
const a = State(false), b = State(false), decorated = State(true), title = State('A'), width = State(420), main = State('main');
const owners = {}, setups = { A: 0, B: 0, C: 0 }, disposals = { A: 0, B: 0, C: 0 }, tasks = new Map(), rpc = new Map(), late = [], errors = []; let stops = 0;
const Nested = Component(scope => { setups.C++; const text = scope.state('nested'); scope.onDispose(() => { disposals.C++; }); return () => TextField('Nested', { text: text.binding, focusName: 'shared' }); });
const Owner = Component((scope, initial) => {
  const name = initial.name, instance = ++setups[name], text = scope.state(name), nested = scope.state(false), sheet = scope.state(false), focus = scope.focus('shared');
  owners[name] = { text, nested, sheet, focus }; scope.onDispose(() => { disposals[name]++; });
  scope.task(async task => {
    await new Promise(resolve => { tasks.set(`${name}:${instance}`, resolve); task.onCancel(() => { tasks.delete(`${name}:${instance}`); resolve(); }); });
    text.value = 'late task'; focus.resume(); focus.request('shared'); late.push(task.isCurrent);
  });
  const api = { async hold(label) {
    const current = WebRequest.current;
    await new Promise(resolve => { rpc.set(label, resolve); current.onCancel(() => { rpc.delete(label); resolve(); }); });
    text.value = 'late RPC'; focus.resume(); focus.request('shared'); late.push(current.isCurrent); return true;
  } };
  return () => VStack([
    TextField(name, { text: text.binding, focusName: 'shared' }), SecureField(`${name} secret`, { text: text.binding, focusName: 'next' }),
    WebView({ html: '<input>', api, onError: error => errors.push(error) }).frame({ height: 45 }),
  ]).sheet({ isPresented: sheet.binding, content: TextField('Sheet', { text: text.binding, focusName: 'sheet' }).frame({ width: 300, height: 130 }) })
    .window({ isPresented: nested.binding, title: 'C', width: 310, height: 170, content: Nested() });
});
const app = runApp({ title: 'JonUI owned roots', width: 540, height: 280, onStop: () => { stops++; }, content: View(() => {
  const base = TextField('Main', { text: main.binding, focusName: 'shared' });
  const content = decorated.value ? base.window({ isPresented: a.binding, title: title.value, width: width.value, height: 240, content: Owner({ name: 'A' }) }) : base.padding(0);
  return content.window({ isPresented: b.binding, title: 'B', width: 440, height: 250, content: Owner({ name: 'B' }) });
}) });
const snapshot = () => test.request('debug.snapshot'), windows = () => test.request('debug.windows').windows, sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const win = label => windows().find(w => w.title === label);
function webID(label) {
  const nodes = snapshot().nodes, state = owners[label].text.binding.id, field = nodes.find(n => n.kind === 'textfield' && n.props.state === state);
  const container = nodes.find(n => n.kind === 'vstack' && n.children.includes(field.id));
  function find(id) { const node = nodes.find(n => n.id === id); return node.kind === 'webview' ? id : node.children.map(find).find(Boolean); }
  return find(container.id);
}
async function until(predicate, label) {
  const deadline = Date.now() + 12000;
  do {
    const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0); assert.deepEqual(errors, []); assert.ok(windows().every(w => w.alpha === 0 && !w.key));
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ windows: windows(), stats: test.stats(), focus: test.request('debug.focusContext') })}`);
}
await until(() => snapshot().hostedControlCount === 1, 'main'); const baseline = test.stats(); assert.equal(setups.A, 0); assert.equal(setups.B, 0);
a.value = true; await until(() => win('A') && owners.A?.focus.actual.value === 'shared' && test.request('debug.web', { id: webID('A') }).ready, 'first independent root'); const idA = win('A').id, firstA = owners.A;
assert.equal(test.request('debug.focusContext').root, idA); assert.equal(test.request('debug.focusNames').count, 3); assert.equal(Focus.requestNamed('shared'), true);
b.value = true; await until(() => win('B') && owners.B?.focus.actual.value === 'shared' && owners.A.focus.retired.value && test.request('debug.web', { id: webID('B') }).ready, 'second root and isolated duplicate names'); const idB = win('B').id;
assert.equal(owners.A.focus.availability('shared'), 'inactiveWindow'); assert.equal(owners.B.focus.availability('shared'), 'ready');
const plain = test.request('debug.fields').fields.find(f => !f.secure); test.request('debug.field', { index: plain.index, value: 'B edited 🦊' }); await until(() => owners.B.text.value === 'B edited 🦊', 'native current-root binding'); assert.equal(owners.A.text.value, 'A'); assert.equal(main.value, 'main');
test.request('debug.selectWindow', { id: 0 }); assert.equal(Focus.requestNamed('shared'), true); owners.B.focus.resume(); owners.B.focus.request('shared'); test.flush(); await sleep(25); assert.equal(owners.B.focus.retired.value, true); assert.equal(main.value, 'main');
test.request('debug.selectWindow', { id: idA }); owners.A.focus.resume(); owners.A.focus.request('shared'); await until(() => owners.A.focus.actual.value === 'shared', 'root-local resume');
const first = Focus.capture(); assert.equal(Focus.requestNamed('next'), true); const second = Focus.capture(); assert.ok(first && second); assert.equal(Focus.setTraversal([first, second], { tabNavigation: true }), true);
Focus.request(first); assert.equal(test.request('debug.tab', { applicationDispatch: true }).intercepted, true); assert.equal(Focus.currentName(), 'next'); Focus.setTraversal([]);
title.value = 'A renamed'; width.value = 600; test.flush(); await until(() => win('A renamed'), 'title update'); assert.equal(owners.A, firstA); assert.equal(win('A renamed').width, 420, 'creation size does not overwrite user geometry');
const stable = snapshot().nodes, windowNode = stable.find(n => n.props.name === 'window' && n.props.title === 'B');
for (const props of [{ ...windowNode.props, width: 0 }, { ...windowNode.props, unexpected: true }]) { assert.throws(() => test.request('commit', { nodes: [{ ...windowNode, props }] }), /Window requires|Unknown layout option/); assert.deepEqual(snapshot().nodes, stable); }
const otherNode = stable.find(n => n.props.name === 'window' && n.props.title === 'A renamed');
assert.throws(() => test.request('commit', { nodes: [{ ...windowNode, children: [windowNode.children[0], otherNode.children[1]] }] }), /multiple window roots/); assert.deepEqual(snapshot().nodes, stable);
owners.A.sheet.value = true; await until(() => test.request('debug.focusContext').sheet && owners.A.focus.retired.value, 'sheet on auxiliary root'); assert.equal(Focus.requestNamed('sheet'), true); assert.equal(Focus.availabilityNamed('shared'), 'inactiveWindow');
owners.A.sheet.value = false; await until(() => !test.request('debug.focusContext').sheet, 'auxiliary sheet dismissed');
test.request('debug.web.evaluate', { id: webID('A'), script: "jonui.remote().hold('pending-A').catch(() => {})" }); await until(() => rpc.has('pending-A'), 'pending RPC');
owners.A.nested.value = true; await until(() => win('C') && snapshot().hostedControlCount >= 6, 'owned nested root');
test.request('debug.closeWindow', { id: idA }); await until(() => !a.value && !win('A renamed') && !win('C') && disposals.A === 1 && disposals.C === 1 && !rpc.has('pending-A'), 'native close retires nested scopes and RPC');
assert.equal(stops, 0); assert.equal(owners.B.text.value, 'B edited 🦊'); assert.ok(win('B')); assert.ok(late.every(value => value === false));
b.value = false; test.flush(); await until(() => windows().length === 0 && snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'all auxiliary roots removed'); assert.deepEqual(test.stats(), baseline);
const stopNames = Focus.subscribe(() => {}), channel = test.request('debug.focusWatch');
const rejected = test.request('focus.named', { name: 'shared', focusRequest: { token: channel.token, generation: channel.generation + 1, context: channel.context, root: idA } });
assert.equal(rejected.focusAccepted, false); assert.equal(rejected.observation.root, 0); const generation = test.request('debug.focusWatch').generation;
for (const root of [-1, 0.5, null, true, '0']) assert.throws(() => test.request('focus.named', { name: 'shared', focusRequest: { token: channel.token, generation: generation + 1, root } }), /root counter/);
assert.equal(test.request('debug.focusWatch').generation, generation); stopNames();
for (let i = 0; i < 20; i++) {
  a.value = true; await until(() => win('A renamed') && owners.A.focus.actual.value === 'shared' && test.request('debug.web', { id: webID('A') }).ready, `mount ${i}`); assert.equal(owners.A.text.value, 'A');
  test.request('debug.closeWindow', { id: win('A renamed').id }); await until(() => !a.value && windows().length === 0 && snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, `close ${i}`); assert.deepEqual(test.stats(), baseline); assert.equal(stops, 0);
}
a.value = true; await until(() => win('A renamed') && owners.A.focus.actual.value === 'shared', 'opening before immediate bounce');
const previous = owners.A; previous.text.value = 'must end'; const beforeBounce = setups.A;
const stopBounce = a.subscribe(value => { if (!value) a.value = true; });
test.request('debug.closeWindow', { id: win('A renamed').id });
await until(() => win('A renamed') && setups.A === beforeBounce + 1 && owners.A !== previous && owners.A.focus.actual.value === 'shared', 'native close barrier before immediate subscriber reopen'); assert.equal(owners.A.text.value, 'A');
stopBounce(); a.value = false; test.flush(); await until(() => windows().length === 0 && snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'bounce owner removed'); assert.deepEqual(test.stats(), baseline);
a.value = true; await until(() => win('A renamed') && owners.A.focus.actual.value === 'shared', 'before window boundary replacement');
const oldBoundary = win('A renamed').id, oldOwner = owners.A; decorated.value = false; test.flush(); await until(() => windows().length === 0 && snapshot().hostedControlCount === 1, 'modifier kind replacement closes root'); assert.equal(a.value, true);
decorated.value = true; test.flush(); await until(() => win('A renamed') && owners.A !== oldOwner && owners.A.focus.actual.value === 'shared', 'reintroduced root has fresh ownership'); assert.notEqual(win('A renamed').id, oldBoundary);
a.value = false; test.flush(); await until(() => windows().length === 0 && snapshot().hostedControlCount === 1 && snapshot().webViewCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'replaced boundary removed'); assert.deepEqual(test.stats(), baseline);
b.value = true; await until(() => win('B') && owners.B.focus.actual.value === 'shared', 'root open during app shutdown'); test.request('debug.close'); await app;
assert.equal(stops, 1); assert.equal(setups.A, disposals.A); assert.equal(setups.B, disposals.B); assert.equal(tasks.size, 0); assert.equal(rpc.size, 0); assert.ok(late.every(v => !v));
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().ownedWindowCount, 0); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0);
console.log('PASS owned windows: independent native roots/state/name domains, current-root focus/bindings and application Tab routing, title/initial sizing, atomic graph validation, auxiliary sheets/nested ownership, native-close task/RPC cancellation, reopen fresh state, 20 owner lifetimes and app shutdown with an open root');
