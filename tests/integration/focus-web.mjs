import assert from 'node:assert/strict';
import { Component, Focus, ForEach, State, Text, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';

const shown = State(true), reversed = State(false), revision = State(0), blocked = State(false), ancestorBlocked = State(false);
const messages = [], errors = []; let model, setups = 0, disposals = 0, query = 0;
const html = owner => `<!doctype html><meta charset="utf-8"><input id="first"><input id="second"><script>
const owner = ${JSON.stringify(owner)}, boot = crypto.getRandomValues(new Uint32Array(4)).join('-');
jonui.onMessage(model => { const input = document.getElementById('first'); if (input.value !== model.value) input.value = model.value; });
document.addEventListener('input', event => { if (event.target.id === 'first') jonui.postMessage({ type: 'input', owner, value: event.target.value }); });
jonui.postMessage({ type: 'ready', owner, boot });
</script>`;
const Panel = Component(scope => {
  setups++; model = { name: scope.state('name'), a: scope.state('browser A'), b: scope.state('browser B') };
  scope.onDispose(() => { disposals++; });
  return () => VStack([ForEach(reversed.value ? ['b', 'a', 'name'] : ['name', 'a', 'b'], { id: id => id }, owner => owner === 'name'
    ? TextField(`Name (${model.name.value.length})`, { text: model.name.binding })
    : WebView({ html: html(owner) + (owner === 'a' ? `<!-- ${revision.value} -->` : ''), data: { owner, value: model[owner].value },
      onMessage: message => { messages.push(message); if (message.type === 'input' && typeof message.value === 'string') model[owner].value = message.value; },
      onError: error => errors.push(error),
    }).disabled(owner === 'a' && blocked.value).frame({ height: 120 }),
  )], { spacing: 12 }).disabled(ancestorBlocked.value);
});
const app = runApp({ title: 'JonUI mixed native/WebKit focus', width: 650, height: 420, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus');
const browser = owner => snapshot().nodes.find(n => n.kind === 'webview' && n.props.data.owner === owner)?.id;
const web = owner => test.request('debug.web', { id: browser(owner) }), focus = owner => test.request('debug.webFocus', { id: browser(owner) });
const evaluate = (owner, script) => test.request('debug.web.evaluate', { id: browser(owner), script });
const cycle = () => test.request('debug.focusTraversal'), handles = () => test.request('debug.focusHandles');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 10000;
  do { const s = snapshot(); assert.equal(status().key, false); assert.deepEqual(errors, []); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), cycle: cycle(), counts: test.stats(), messages: messages.slice(-8) })}`);
}
async function probe(owner, expected) {
  const deadline = Date.now() + 6000;
  do {
    const id = ++query;
    evaluate(owner, `jonui.postMessage({ type: 'probe', query: ${id}, owner, boot, active: document.activeElement.id, value: document.getElementById('first').value, selection: document.getElementById('first').selectionStart })`);
    await until(() => messages.some(m => m.query === id), 'browser probe');
    const result = messages.find(m => m.query === id);
    if (!expected || expected(result)) return result;
    await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Browser ${owner} probe did not settle`);
}
function captureWeb(owner) {
  test.request('debug.focus', { web: browser(owner) }); assert.equal(focus(owner).focused, true);
  const target = Focus.capture(); assert.ok(target); return target;
}
const tab = (reverse = false) => test.request('debug.tab', { modifiers: reverse ? ['shift'] : [] }).intercepted;
await until(s => s.states.length === 8 && s.webViewCount === 2 && ['a', 'b'].every(owner => browser(owner) && web(owner).ready && focus(owner).hit), 'two real WebKit documents');
const a = captureWeb('a'); const firstCount = handles().targets;
evaluate('a', "document.getElementById('second').focus()"); await probe('a', p => p.active === 'second');
const sameBrowser = Focus.capture(); assert.ok(sameBrowser); assert.equal(handles().targets, firstCount);
assert.throws(() => Focus.setTraversal([a, sameBrowser]), /distinct/, 'DOM controls share one native WebKit responder target');
const b = captureWeb('b');
test.request('debug.focus', { field: 0 }); const name = Focus.capture(); assert.ok(name);
assert.deepEqual(handles(), { targets: 3, live: 3 });
assert.equal(Focus.request(a), true); assert.equal(focus('a').focused, true);
assert.equal((await probe('a')).active, 'second', 'native restore preserves existing DOM focus');
assert.equal(Focus.setTraversal([name, a, b], { tabNavigation: true }), true);
Focus.clear(); Focus.next(); assert.deepEqual(status().fields, [0]);
Focus.next(); assert.equal(focus('a').focused, true); Focus.previous(); assert.deepEqual(status().fields, [0]);
assert.equal(tab(), true); assert.equal(focus('a').focused, true);
assert.equal(tab(), true); assert.equal(focus('b').focused, true);
assert.equal(tab(), true); assert.deepEqual(status().fields, [0]);
assert.equal(tab(true), true); assert.equal(focus('b').focused, true);
assert.equal(tab(true), true); assert.equal(focus('a').focused, true);
Focus.request(name); test.request('debug.field', { index: 0, value: 'Native 🦊 café' });
evaluate('a', "const input = document.getElementById('first'); input.focus(); input.value = 'Browser 🦊 café'; input.dispatchEvent(new Event('input', { bubbles: true })); input.setSelectionRange(2, 2)");
await until(() => model.name.value === 'Native 🦊 café' && model.a.value === 'Browser 🦊 café', 'native/browser Unicode values');
const before = await probe('a', p => p.value === model.a.value && p.active === 'first' && p.selection === 2);
const loads = { a: web('a').loads, b: web('b').loads }, original = model;
reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, original); assert.equal(setups, 1); assert.equal(Focus.request(a), true);
const reordered = await probe('a'); assert.equal(reordered.boot, before.boot); assert.equal(reordered.active, 'first'); assert.equal(reordered.selection, 2);
assert.deepEqual({ a: web('a').loads, b: web('b').loads }, loads); assert.equal(Focus.request(b), true);
// Reset must restore WebKit's own DOM Tab/Shift-Tab, rather than keeping the
// global cycle trapped inside the native dispatcher.
Focus.setTraversal([]); Focus.request(a); evaluate('a', "document.getElementById('first').focus()"); await probe('a', p => p.active === 'first');
assert.equal(tab(), false); await probe('a', p => p.active === 'second'); assert.equal(focus('a').focused, true);
assert.equal(tab(true), false); await probe('a', p => p.active === 'first');
assert.equal(Focus.setTraversal([name, a, b], { tabNavigation: true }), true);
Focus.request(a); blocked.value = true; test.flush();
await until(() => !focus('a').interactionEnabled && !focus('a').focused && !focus('a').hit && !focus('a').containerEligible, 'disabled browser resigns native focus and rejects pointer/key-view entry');
assert.equal(Focus.request(a), false); assert.equal(Focus.capture(), null);
// NSWindow may report successful resignation even if the requested view refused
// entry; check the real responder, not just makeFirstResponder's return value.
test.request('debug.focus', { web: browser('a') }); assert.equal(focus('a').focused, false);
model.a.value = 'Disabled 🦊 data'; const disabledData = await probe('a', p => p.value === model.a.value);
assert.equal(disabledData.boot, before.boot); assert.equal(web('a').loads, loads.a, 'disabling preserves the document and its data bridge');
evaluate('a', "document.getElementById('second').focus()"); await probe('a', p => p.active === 'second');
assert.equal(focus('a').focused, false, 'DOM programmatic focus does not regain disabled native entry');
Focus.request(name); Focus.next(); assert.equal(cycle().count, 0); assert.equal(focus('a').focused, false);
assert.equal(Focus.setTraversal([name]), true);
assert.equal(Focus.setTraversal([a, name], { tabNavigation: true }), false); assert.deepEqual(cycle(), { count: 1, tabNavigation: false });
blocked.value = false; test.flush(); await until(() => focus('a').interactionEnabled && focus('a').hit && focus('a').containerEligible, 'browser re-enabled');
assert.equal(Focus.request(a), true); assert.equal(focus('a').focused, true); assert.deepEqual(handles(), { targets: 3, live: 3 });
ancestorBlocked.value = true; test.flush();
await until(() => ['a', 'b'].every(owner => !focus(owner).interactionEnabled && !focus(owner).hit && !focus(owner).focused) && !test.request('debug.fields').fields[0].enabled, 'ancestor disabling propagates through representables');
assert.equal(Focus.request(a), false); assert.equal(Focus.request(b), false); assert.equal(Focus.request(name), false);
ancestorBlocked.value = false; test.flush(); await until(() => focus('a').interactionEnabled && focus('b').interactionEnabled, 'ancestor availability restored');
assert.equal(Focus.request(a), true); assert.equal(Focus.request(b), true);
const oldToken = web('a').token; revision.value++; test.flush();
await until(() => web('a').loads === loads.a + 1 && web('a').ready && web('a').token !== oldToken, 'source replacement while preserving physical browser');
assert.notEqual((await probe('a', p => p.value === model.a.value)).boot, before.boot);
assert.equal(Focus.request(a), true); assert.equal(focus('a').focused, true, 'physical target addresses the browser, not an old DOM element');
assert.equal(web('b').loads, loads.b);
evaluate('a', "setTimeout(() => jonui.postMessage({ type: 'late', owner }), 60)"); shown.value = false; test.flush();
await until(s => s.states.length === 5 && s.liveCells === 5 && s.webViewCount === 0 && s.liveViews === s.nodes.length, 'focused browser owner teardown');
assert.equal(Focus.request(a), false); assert.equal(Focus.request(b), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.equal(cycle().count, 0);
await sleep(90); assert.ok(!messages.some(m => m.type === 'late'));
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 8 && s.webViewCount === 2 && ['a', 'b'].every(owner => browser(owner) && web(owner).ready), `mixed mount ${i}`);
  const target = captureWeb('a'); assert.equal(Focus.setTraversal([target], { tabNavigation: true }), true);
  blocked.value = true; test.flush(); await until(() => !focus('a').interactionEnabled && !focus('a').focused, `disabled browser ${i}`);
  assert.equal(Focus.request(target), false);
  blocked.value = false; test.flush(); await until(() => focus('a').interactionEnabled, `re-enabled browser ${i}`);
  assert.equal(Focus.request(target), true); assert.equal(tab(), true); assert.equal(focus('a').focused, true);
  shown.value = false;
  await until(s => s.states.length === 5 && s.liveCells === 5 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `mixed unmount ${i}`);
  assert.equal(Focus.request(target), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(cycle(), { count: 0, tabNavigation: false }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS mixed native/WebKit focus: physical browser targets versus DOM controls, command/Tab cycles and native DOM reset, Unicode/selection/keyed identity, disabled pointer/key-view entry and ancestor propagation, data/document lifetimes, stale-target/late-message rejection and 20 focused mount/unmount cycles');
