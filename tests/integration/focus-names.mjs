import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, State, Text, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.requestNamed('browser'), /mounted window/);
const shown = State(true), reversed = State(false), names = State(['café', 'cafe\u0301']), disabled = State(false), presented = State(false), nativeName = State('native');
const messages = [], errors = []; let model, setups = 0, disposals = 0, query = 0;
const html = owner => `<!doctype html><meta charset="utf-8"><input id="first"><input id="second"><script>
const owner = ${JSON.stringify(owner)}; window.boot = crypto.getRandomValues(new Uint32Array(4)).join('-');
jonui.onMessage(model => { const input = document.getElementById('first'); if (input.value !== model.value) input.value = model.value; });
jonui.postMessage({ type: 'ready', owner, boot });
</script>`;
const Panel = Component(scope => {
  setups++; model = { a: scope.state('A'), b: scope.state('B') }; scope.onDispose(() => { disposals++; });
  const browser = (owner, focusName, value = '') => WebView({ html: html(owner), data: { owner, value }, ...(focusName === null ? {} : { focusName }),
    onMessage: message => messages.push(message), onError: error => errors.push(error),
  });
  return () => VStack([
    ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, owner =>
      browser(owner, names.value[owner === 'a' ? 0 : 1], model[owner].value).disabled(owner === 'a' && disabled.value).frame({ height: 90 })),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 24 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
      browser('lazy', 'lazy-browser').frame({ height: 80 }),
    ])).frame({ height: 100 }),
  ]).sheet({ isPresented: presented.binding, content: browser('sheet', 'sheet-browser').frame({ width: 380, height: 180 }) });
});
const app = runApp({ title: 'JonUI declarative WebView names', width: 600, height: 420, content: VStack([
  TextField('Native', { text: nativeName.binding }), View(() => shown.value ? Panel() : Text('hidden')),
]) });
const snapshot = () => test.request('debug.snapshot'), context = () => test.request('debug.focusContext');
const id = owner => snapshot().nodes.find(n => n.kind === 'webview' && n.props.data.owner === owner)?.id;
const web = owner => test.request('debug.web', { id: id(owner) }), focus = owner => test.request('debug.webFocus', { id: id(owner) });
const handles = () => test.request('debug.focusHandles'), registry = () => test.request('debug.focusNames');
const evaluate = (owner, script) => test.request('debug.web.evaluate', { id: id(owner), script });
function ready(owner) {
  try { return web(owner).ready; } catch (error) { if (/Unknown WebView/.test(error.message)) return false; throw error; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 10000;
  do {
    const s = snapshot(), c = context(); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0); assert.deepEqual(errors, []);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ context: context(), registry: registry(), counts: test.stats(), messages: messages.slice(-5) })}`);
}
async function probe(owner, expected) {
  const deadline = Date.now() + 6000;
  do {
    const token = ++query;
    evaluate(owner, `jonui.postMessage({ type: 'probe', query: ${token}, owner, boot, active: document.activeElement.id, value: document.getElementById('first').value, selection: document.getElementById('first').selectionStart })`);
    await until(() => messages.some(m => m.query === token), 'browser probe');
    const result = messages.find(m => m.query === token); if (!expected || expected(result)) return result; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Probe did not settle: ${owner}`);
}
await until(s => s.states.length === 8 && ['a', 'b'].every(owner => id(owner) && ready(owner)), 'real named browser views');
assert.deepEqual(registry(), { count: 4 }); assert.deepEqual(handles(), { targets: 0, live: 0 });
assert.equal(Focus.requestNamed('missing'), false); assert.equal(Focus.requestNamed('sheet-browser'), false);
assert.equal(Focus.requestNamed('lazy-browser'), false, 'a logical name does not realize offscreen lazy content');
assert.equal(Focus.requestNamed('café'), true, 'first focus needs no captured target'); assert.equal(focus('a').focused, true);
assert.deepEqual(handles(), { targets: 0, live: 0 }, 'named requests allocate no weak capture IDs');
assert.equal(Focus.requestNamed('cafe\u0301'), true); assert.equal(focus('b').focused, true, 'canonically equivalent Unicode spellings remain distinct identifiers');
assert.equal(Focus.requestNamed('CAFÉ'), false); assert.equal(focus('b').focused, true);
Focus.requestNamed(names.value[0]); evaluate('a', "const input = document.getElementById('first'); input.focus(); input.setSelectionRange(1, 1)");
const before = await probe('a', p => p.active === 'first' && p.selection === 1);
for (let i = 0; i < 50; i++) assert.equal(Focus.requestNamed(names.value[0]), true);
const after = await probe('a'); assert.equal(after.boot, before.boot); assert.equal(after.active, before.active); assert.equal(after.selection, before.selection);
assert.deepEqual(handles(), { targets: 0, live: 0 }); const a = Focus.capture(); assert.ok(a);
Focus.requestNamed(names.value[1]); const b = Focus.capture(); assert.ok(b);
test.request('debug.focus', { field: 0 }); const native = Focus.capture(); assert.ok(native);
assert.equal(Focus.setTraversal([a, b, native], { tabNavigation: true }), true);
assert.equal(Focus.requestNamed(names.value[1]), true); assert.equal(test.request('debug.tab').intercepted, true); assert.deepEqual(test.request('debug.focusStatus').fields, [0]);
assert.equal(Focus.requestNamed('unknown'), false); assert.deepEqual(test.request('debug.focusTraversal'), { count: 3, tabNavigation: true });
model.a.value = 'Named 🦊 café'; await probe('a', p => p.value === model.a.value);
const loads = { a: web('a').loads, b: web('b').loads }, original = model;
names.value = ['Renamed 🦊', 'cafe\u0301']; reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, original); assert.equal(setups, 1); assert.equal(Focus.requestNamed('café'), false);
assert.equal(Focus.requestNamed('Renamed 🦊'), true); assert.equal(focus('a').focused, true); assert.equal(Focus.request(a), true);
names.value = ['cafe\u0301', 'Renamed 🦊']; test.flush();
assert.equal(Focus.requestNamed('Renamed 🦊'), true); assert.equal(focus('b').focused, true);
assert.equal(Focus.requestNamed('cafe\u0301'), true); assert.equal(focus('a').focused, true);
assert.equal(Focus.request(b), true); assert.equal(focus('b').focused, true, 'physical captures keep their identity across name reassignment');
names.value = [null, 'Renamed 🦊']; test.flush(); assert.equal(Focus.requestNamed('cafe\u0301'), false); assert.deepEqual(registry(), { count: 3 });
names.value = ['A restored', 'Renamed 🦊']; test.flush(); assert.equal(Focus.requestNamed('A restored'), true);
const stable = snapshot().nodes, aNode = stable.find(n => n.id === id('a')), bNode = stable.find(n => n.id === id('b'));
for (const focusName of [null, '', 1, true, {}, []]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...aNode, props: { ...aNode.props, focusName } }] }), /Focus name/);
  assert.deepEqual(snapshot().nodes, stable); assert.equal(Focus.requestNamed('A restored'), true);
}
assert.throws(() => test.request('commit', { nodes: [{ ...bNode, props: { ...bNode.props, focusName: aNode.props.focusName, html: '<p>must not load</p>' } }] }), /Duplicate focus name/);
assert.deepEqual(snapshot().nodes, stable); assert.equal(Focus.requestNamed('Renamed 🦊'), true); assert.equal(focus('b').focused, true);
assert.deepEqual({ a: web('a').loads, b: web('b').loads }, loads); assert.deepEqual(registry(), { count: 4 });
for (const name of [null, '', 1, true, {}, []]) assert.throws(() => test.request('focus.named', { name }), /Focus name/);
disabled.value = true; test.flush(); await until(() => !focus('a').interactionEnabled, 'named target disabled');
Focus.requestNamed(names.value[1]); assert.equal(Focus.requestNamed(names.value[0]), false); assert.equal(focus('b').focused, true);
disabled.value = false; test.flush(); await until(() => focus('a').interactionEnabled, 'named target re-enabled');
assert.equal(Focus.requestNamed(names.value[0]), true); assert.deepEqual(handles(), { targets: 3, live: 3 });
// Name resolution is limited to the active window, including targets that have
// never received focus inside a just-presented sheet.
presented.value = true;
await until(s => s.sheetPresented && context().sheet && id('sheet') && ready('sheet'), 'named sheet browser realized');
assert.equal(Focus.requestNamed(names.value[0]), false); assert.deepEqual(handles(), { targets: 0, live: 0 });
assert.equal(Focus.requestNamed('sheet-browser'), true); assert.equal(focus('sheet').focused, true);
const sheet = Focus.capture(); assert.ok(sheet); assert.equal(Focus.setTraversal([sheet]), true);
assert.equal(Focus.requestNamed(names.value[1]), false); assert.equal(focus('sheet').focused, true);
presented.value = false; await until(s => !s.sheetPresented && !context().sheet, 'named sheet dismissed');
assert.equal(Focus.requestNamed('sheet-browser'), false); assert.equal(Focus.requestNamed(names.value[0]), true);
assert.equal(Focus.request(sheet), false); assert.equal(Focus.request(a), false); assert.deepEqual(handles(), { targets: 0, live: 0 });
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 100 && s.document.height > 900); assert.ok(scroll);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 2000 });
await until(() => ready('lazy'), 'named lazy target realized by actual scrolling');
assert.equal(Focus.requestNamed('lazy-browser'), true); assert.equal(focus('lazy').focused, true);
assert.deepEqual(handles(), { targets: 0, live: 0 });
Focus.requestNamed(names.value[0]); shown.value = false;
await until(s => s.states.length === 6 && s.liveCells === 6 && s.webViewCount === 0 && s.liveViews === s.nodes.length, 'named owner teardown');
assert.deepEqual(registry(), { count: 0 }); assert.equal(Focus.requestNamed('A restored'), false); assert.equal(Focus.requestNamed('lazy-browser'), false);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 8 && id('a') && ready('a'), `named mount ${i}`);
  assert.equal(Focus.requestNamed(names.value[0]), true); assert.equal(focus('a').focused, true); assert.deepEqual(handles(), { targets: 0, live: 0 });
  shown.value = false;
  await until(s => s.states.length === 6 && s.liveCells === 6 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `focused named unmount ${i}`);
  assert.equal(Focus.requestNamed(names.value[0]), false); assert.deepEqual(registry(), { count: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.equal(Focus.requestNamed('A restored'), false);
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS named WebView focus: before-first-focus registration, exact Unicode names, rename/reassignment/removal, captured-cycle interoperability, atomic duplicate/invalid rejection, disabled/modal/lazy availability and 20 focused owner mount/unmount cycles');
