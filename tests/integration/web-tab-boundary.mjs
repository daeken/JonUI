import assert from 'node:assert/strict';
import { Component, Focus, ForEach, State, Text, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
const shown = State(true), reversed = State(false), blocked = State(false), empty = State(false), revision = State(0), tick = State(0), tabFocusable = State(true);
const messages = [], errors = [], submits = []; let activeField = null, model, setups = 0, disposals = 0, query = 0;
const document = passive => `<!doctype html><meta charset="utf-8">${passive ? '<p>No controls</p>' : '<input id="first"><input id="second">'}<output id="tick"></output><script>
window.boot = crypto.getRandomValues(new Uint32Array(4)).join('-');
jonui.onMessage(model => { document.getElementById('tick').textContent = String(model.tick); });
document.addEventListener('input', event => jonui.postMessage({ type: 'input', value: event.target.value }));
jonui.postMessage({ type: 'ready', boot });
</script>`;
const Panel = Component(scope => {
  setups++; model = { before: scope.state('before'), after: scope.state('after') }; scope.onDispose(() => { disposals++; });
  return () => VStack([ForEach(reversed.value ? ['after', 'web', 'before'] : ['before', 'web', 'after'], { id: id => id }, kind => kind === 'web'
    ? WebView({ html: document(empty.value) + `<!-- ${revision.value} -->`, focusName: 'browser', tabFocusable: tabFocusable.value, api: { echo: value => value }, data: { tick: tick.value }, onMessage: message => messages.push(message), onError: error => errors.push(error) }).disabled(blocked.value).frame({ height: 120 })
    : TextField(kind, { text: model[kind].binding, onSubmit: () => submits.push(kind), onEditingChanged: editing => { if (editing) activeField = kind; else if (activeField === kind) activeField = null; } }),
  )], { spacing: 16 });
});
const app = runApp({ title: 'JonUI native document-boundary Tab', width: 550, height: 320, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus');
const browser = () => snapshot().nodes.find(n => n.kind === 'webview')?.id;
const web = () => test.request('debug.web', { id: browser() }), focus = () => test.request('debug.webFocus', { id: browser() });
const evaluate = script => test.request('debug.web.evaluate', { id: browser(), script });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 8000;
  do { const s = snapshot(), c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.deepEqual(errors, []); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  assert.fail(`Timed out: ${name}; ${JSON.stringify({ status: status(), activeField, counts: test.stats() })}`);
}
async function probe(expected) {
  const deadline = Date.now() + 6000;
  do {
    const id = ++query;
    evaluate(`jonui.postMessage({ query: ${id}, boot, active: document.activeElement.id, value: document.getElementById('first')?.value ?? null, selection: document.getElementById('first')?.selectionStart ?? null, tick: document.getElementById('tick').textContent })`);
    await until(() => messages.some(m => m.query === id), 'DOM probe'); const result = messages.find(m => m.query === id);
    if (!expected || expected(result)) return result; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail('DOM state did not settle');
}
function tab(reverse = false) { assert.equal(test.request('debug.tab', { modifiers: reverse ? ['shift'] : [] }).intercepted, false, 'all events use native handling'); }
async function captureFields() {
  const targets = {};
  for (let i = 0; i < 2; i++) {
    Focus.clear(); await until(() => !status().fields.length, 'clear native responder'); activeField = null;
    test.request('debug.focus', { field: i }); await until(() => activeField !== null, 'identify native field'); targets[activeField] = Focus.capture();
  }
  assert.ok(targets.before && targets.after); return targets;
}
async function traversal(start, end) {
  Focus.request(end); const endIndex = status().fields[0]; Focus.request(start); const startIndex = status().fields[0];
  tab(); await until(() => focus().focused, 'native field enters WebKit'); await probe(p => p.active === 'first');
  tab(); await probe(p => p.active === 'second');
  tab(); await until(() => status().fields[0] === endIndex, 'last DOM field exits to following native field');
  tab(true); await until(() => focus().focused, 'native field re-enters WebKit in reverse'); await probe(p => p.active === 'second');
  tab(true); await probe(p => p.active === 'first');
  tab(true); await until(() => status().fields[0] === startIndex, 'first DOM field exits to preceding native field');
}
await until(s => s.states.length === 9 && s.webViewCount === 1 && web().ready && test.request('debug.fields').fields.length === 2, 'native fields around real WebKit');
const targets = await captureFields(); Focus.setTraversal([]);
assert.deepEqual(test.request('debug.focusTraversal'), { count: 0, tabNavigation: false });
await traversal(targets.before, targets.after);
Focus.requestNamed('browser'); evaluate("const input = document.getElementById('first'); input.focus(); input.value = '日本 🦊 café'; input.dispatchEvent(new Event('input', {bubbles:true})); input.setSelectionRange(2,2)");
const original = await probe(p => p.active === 'first' && p.value === '日本 🦊 café' && p.selection === 2);
tick.value++; test.flush(); const updated = await probe(p => p.tick === '1');
assert.equal(updated.boot, original.boot); assert.equal(updated.value, original.value); assert.equal(updated.selection, 2); assert.equal(updated.active, 'first');
blocked.value = true; test.flush(); await until(() => !focus().containerEligible, 'browser unavailable');
Focus.request(targets.after); const afterIndex = status().fields[0]; Focus.request(targets.before); const beforeIndex = status().fields[0];
tab(); await until(() => status().fields[0] === afterIndex, 'native Tab skips disabled browser');
tab(true); await until(() => status().fields[0] === beforeIndex, 'native Shift-Tab skips disabled browser');
blocked.value = false; reversed.value = true; test.flush(); await until(() => focus().containerEligible, 'keyed browser re-enabled'); await sleep(30);
assert.equal(Focus.request(targets.before), true); assert.equal(Focus.request(targets.after), true);
await traversal(targets.after, targets.before);
const loads = web().loads; empty.value = true; test.flush(); await until(() => web().loads > loads && web().ready, 'empty document loaded');
Focus.request(targets.before); const lastIndex = status().fields[0]; Focus.request(targets.after); const firstIndex = status().fields[0];
tab(); await until(() => focus().focused, 'empty browser retains its default native stop');
tab(); await until(() => status().fields[0] === lastIndex, 'Tab leaves an empty document');
tab(true); await until(() => focus().focused, 'reverse entry into empty browser');
tab(true); await until(() => status().fields[0] === firstIndex, 'Shift-Tab leaves an empty document');
Focus.requestNamed('browser'); const browserTarget = Focus.capture(); assert.ok(browserTarget);
assert.equal(Focus.setTraversal([targets.after, browserTarget, targets.before], { tabNavigation: true }), true);
const passiveLoads = web().loads, passiveToken = web().token, passiveEpoch = web().epoch;
tabFocusable.value = false; test.flush(); await until(() => !focus().containerEligible, 'passive browser excluded from key views');
assert.equal(focus().interactionEnabled, true); assert.equal(focus().hit, true); assert.equal(focus().focused, true, 'changing Tab eligibility preserves an existing responder');
assert.equal(Focus.capture(), null); assert.equal(Focus.request(browserTarget), false); assert.equal(Focus.requestNamed('browser'), false);
tab(); await until(() => status().fields[0] === lastIndex, 'manual browser focus can still leave through native Tab');
assert.deepEqual(test.request('debug.focusTraversal'), { count: 0, tabNavigation: false }, 'excluded cycle member falls back to native handling');
tab(true); await until(() => status().fields[0] === firstIndex, 'reverse Tab skips passive browser');
tab(); await until(() => status().fields[0] === lastIndex, 'forward Tab skips passive browser');
tick.value++; test.flush(); await probe(p => p.tick === '2');
evaluate("jonui.remote().echo('still interactive').then(value => jonui.postMessage({type:'rpc',value}))");
await until(() => messages.some(m => m.type === 'rpc' && m.value === 'still interactive'), 'Tab exclusion retains the data/RPC bridge');
assert.equal(web().loads, passiveLoads); assert.equal(web().token, passiveToken); assert.equal(web().epoch, passiveEpoch);
const stable = snapshot().nodes, node = stable.find(n => n.id === browser());
for (const value of [null, 0, 1, 'false', {}, []]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...node, props: { ...node.props, tabFocusable: value } }] }), /tabFocusable/);
  assert.deepEqual(snapshot().nodes, stable);
}
tabFocusable.value = true; test.flush(); await until(() => focus().containerEligible, 'Tab eligibility restored');
assert.equal(Focus.request(browserTarget), true, 'property-only changes preserve physical captures');
const emptyLoads = web().loads; empty.value = false; revision.value++; test.flush();
await until(() => web().loads > emptyLoads && web().ready, 'editable document restored');
tabFocusable.value = false; test.flush(); await until(() => !focus().containerEligible, 'editable browser excluded from key views');
Focus.request(targets.after); tab(); await until(() => status().fields[0] === lastIndex, 'native Tab skips browser with focusable DOM descendants');
tab(true); await until(() => status().fields[0] === firstIndex, 'native Shift-Tab skips browser with focusable DOM descendants');
tabFocusable.value = true; test.flush(); await until(() => focus().containerEligible, 'editable browser Tab eligibility restored');
await traversal(targets.after, targets.before);
Focus.requestNamed('browser'); evaluate("document.getElementById('second').focus()"); await probe(p => p.active === 'second');
tab(); shown.value = false;
await until(s => s.states.length === 7 && s.liveCells === 7 && s.webViewCount === 0 && s.liveViews === s.nodes.length && test.request('debug.fields').fields.length === 0, 'owner removed during native boundary handoff');
await sleep(30); assert.equal(Focus.capture(), null); assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 }); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 9 && s.webViewCount === 1 && web().ready && test.request('debug.fields').fields.length === 2, `boundary mount ${i}`);
  const current = await captureFields(); await traversal(current.after, current.before);
  Focus.requestNamed('browser'); evaluate("document.getElementById('second').focus()"); await probe(p => p.active === 'second'); tab(); shown.value = false;
  await until(s => s.states.length === 7 && s.liveCells === 7 && s.webViewCount === 0 && s.liveViews === s.nodes.length && test.request('debug.fields').fields.length === 0, `boundary unmount ${i}`);
  assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.deepEqual(submits, []);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS native WebKit Tab boundaries: forward/reverse entry and exit, DOM order, Unicode/caret data updates, disabled/empty/passive documents, explicit Tab eligibility with live data/RPC, keyed reorder/reload and 20 owner removals during boundary handoff without custom routing');
