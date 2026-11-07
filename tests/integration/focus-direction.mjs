import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, HStack, LazyVStack, ScrollView, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.move('right'), /mounted window/);
const shown = State(true), reversed = State(false), blocked = State(false), webTab = State(true), presented = State(false);
let model, active = null, setups = 0, disposals = 0; const messages = [], errors = [];
const html = '<meta charset="utf-8"><input id="first"><input id="second">';
const Panel = Component(scope => {
  setups++; model = Object.fromEntries(['A0', 'B0', 'A1', 'C1', 's0', 's1', 'lazy'].map(id => [id, scope.state(id === 'C1' ? 'notes' : `${id} 🦊 café`)]));
  model.B1 = scope.state(Date.UTC(2026, 0, 1)); scope.onDispose(() => { disposals++; });
  const field = id => (id === 'B0' ? SecureField : TextField)(id, { text: model[id].binding, focusName: id, onEditingChanged: editing => { if (editing) active = id; else if (active === id) active = null; } });
  return () => VStack([
    VStack(['0', '1'].map(row => HStack([
      ForEach(reversed.value ? ['C', 'B', 'A'] : ['A', 'B', 'C'], { id: id => id }, column => {
        const id = column + row;
        const view = id === 'C0' ? WebView({ html, focusName: id, tabFocusable: webTab.value, onMessage: m => messages.push(m), onError: error => errors.push(error) }) :
          id === 'B1' ? DatePicker('Date', { selection: model.B1.binding, components: 'date', style: 'compact', focusName: id }) :
          id === 'C1' ? TextEditor({ text: model.C1.binding, focusName: id }) : field(id).disabled(id === 'B0' && blocked.value);
        return view.frame({ width: 150, height: 80 });
      }),
    ], { spacing: 30 })), { spacing: 30 }),
    ScrollView(LazyVStack([
      ForEach(Array.from({ length: 24 }, (_, i) => i), { id: i => i }, i => Text(`Row ${i}`).frame({ height: 40 })),
      field('lazy'),
    ])).frame({ width: 510, height: 60 }),
  ], { spacing: 12 }).sheet({ isPresented: presented.binding, content: HStack([field('s0'), field('s1')], { spacing: 30 }).frame({ width: 360, height: 140 }) });
});
const app = runApp({ title: 'JonUI geometric focus commands', width: 650, height: 400, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus');
const node = id => snapshot().nodes.find(n => n.props.focusName === id);
const web = () => test.request('debug.web', { id: node('C0').id }), webFocus = () => test.request('debug.webFocus', { id: node('C0').id });
const handles = () => test.request('debug.focusHandles'), cycle = () => test.request('debug.focusTraversal');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const end = Date.now() + 10000;
  do {
    const s = snapshot(), c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0); assert.deepEqual(errors, []);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < end);
  assert.fail(`Timed out: ${name}; ${JSON.stringify({ active, status: status(), counts: test.stats(), cycle: cycle() })}`);
}
const focused = id => id === 'C0' ? webFocus().focused : id === 'C1' ? status().editors[0] === 0 : id === 'B1'
  ? test.request('debug.focusControls').controls.some(c => c.kind === 'date' && c.focused) : active === id && status().fields.length === 1;
async function start(id) { assert.equal(Focus.requestNamed(id), true); await until(() => focused(id), `focus ${id}`); }
async function move(direction, id) { assert.equal(Focus.move(direction), true, `${direction} → ${id}`); await until(() => focused(id), `${direction} selects ${id}`); }
await until(s => s.states.length === 13 && s.webViewCount === 1 && web().ready && test.request('debug.fields').fields.length === 3, 'real 2×3 matrix');
Focus.clear(); assert.equal(Focus.move('right'), false, 'directional commands need a current eligible responder');
assert.equal(Focus.requestNamed('lazy'), false);
await start('A0'); assert.equal(Focus.move('up'), false); assert.equal(Focus.move('left'), false);
await move('right', 'B0'); await move('down', 'B1'); await move('right', 'C1'); await move('up', 'C0');
assert.equal(Focus.move('right'), false, 'edge navigation does not wrap or choose an almost-vertical neighbor'); await move('left', 'B0'); await move('left', 'A0'); await move('down', 'A1'); assert.equal(Focus.move('down'), false);
assert.deepEqual(handles(), { targets: 0, live: 0 });
const captures = {};
for (const id of ['A0', 'B0', 'A1', 'B1', 'C1', 'C0']) { await start(id); captures[id] = Focus.capture(); assert.ok(captures[id]); }
const registered = handles(); assert.equal(registered.targets, 6);
assert.equal(Focus.setTraversal([captures.A0, captures.C1], { tabNavigation: true }), true);
await start('A0'); assert.equal(Focus.move('down'), false, 'diagonal outside the direction cone is excluded'); await move('right', 'C1'); await move('left', 'A0');
assert.deepEqual(cycle(), { count: 2, tabNavigation: true }, 'spatial commands preserve cycle configuration');
assert.equal(Focus.setTraversal([captures.A0, captures.B0], { tabNavigation: true }), true);
blocked.value = true; test.flush(); await until(() => test.request('debug.fields').fields.some(f => f.secure && !f.enabled), 'middle field disabled');
await start('A0'); await move('right', 'C0'); assert.deepEqual(cycle(), { count: 0, tabNavigation: false }, 'unavailable explicit membership falls back to native key views');
webTab.value = false; test.flush(); await until(() => !webFocus().containerEligible, 'browser excluded from key views');
await start('A0'); await move('right', 'B1'); assert.equal(web().loads, 1);
blocked.value = false; webTab.value = true; test.flush(); await until(() => webFocus().containerEligible && test.request('debug.fields').fields.every(f => f.enabled), 'matrix restored');
await start('C0');
test.request('debug.web.evaluate', { id: node('C0').id, script: "const input = document.getElementById('second'); input.focus(); input.value = '日本 🦊'; input.setSelectionRange(2,2); jonui.postMessage({type:'ready-selection'})" });
await until(() => messages.some(m => m.type === 'ready-selection'), 'DOM responder selected'); assert.equal(Focus.move('right'), false);
test.request('debug.web.evaluate', { id: node('C0').id, script: "jonui.postMessage({type:'selection',active:document.activeElement.id,caret:document.getElementById('second').selectionStart})" });
await until(() => messages.some(m => m.type === 'selection'), 'DOM selection preserved at boundary'); assert.deepEqual(messages.find(m => m.type === 'selection'), { type: 'selection', active: 'second', caret: 2 });
await move('left', 'B0');
const ids = snapshot().nodes.map(n => n.id).sort((a,b) => a-b), original = model;
reversed.value = true; test.flush(); await sleep(30); assert.equal(model, original); assert.equal(setups, 1); assert.deepEqual(snapshot().nodes.map(n => n.id).sort((a,b) => a-b), ids);
assert.equal(Focus.request(captures.A0), true); await until(() => focused('A0'), 'captured identity after keyed column reorder'); await move('left', 'B0'); await move('left', 'C0'); assert.equal(Focus.move('left'), false);
await start('C1'); await move('up', 'C0'); assert.deepEqual(handles(), registered);
for (const direction of [null, '', 'next', 1, true, {}, []]) assert.throws(() => test.request('focus.direction', { direction }), /Invalid focus direction/);
assert.deepEqual(handles(), registered); assert.equal(webFocus().focused, true);
presented.value = true; await until(s => s.sheetPresented && test.request('debug.focusContext').sheet && test.request('debug.fields').fields.length === 2, 'native sheet matrix');
await start('s0'); await move('right', 's1'); await move('left', 's0'); assert.equal(Focus.move('up'), false); assert.equal(Focus.requestNamed('A0'), false); assert.deepEqual(handles(), { targets: 0, live: 0 });
presented.value = false; await until(s => !s.sheetPresented && !test.request('debug.focusContext').sheet && test.request('debug.fields').fields.length === 3, 'sheet matrix dismissed');
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 60 && s.document.height > 900); assert.ok(scroll);
await start('B1'); test.request('debug.scroll', { index: scroll.index, x: 0, y: 2000 }); await until(() => test.request('debug.fields').fields.length === 4, 'lazy neighbor realized by scrolling'); await move('down', 'lazy');
shown.value = false; await until(s => s.states.length === 5 && s.liveCells === 5 && s.hostedControlCount === 0 && s.webViewCount === 0 && s.liveViews === s.nodes.length, 'focused matrix retirement');
assert.equal(Focus.move('right'), false); const baseline = test.stats(); reversed.value = false;
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 13 && s.webViewCount === 1 && web().ready && test.request('debug.fields').fields.length === 3, `matrix mount ${i}`);
  await start('A0'); await move('right', 'B0'); await move('down', 'B1'); await move('right', 'C1'); await move('up', 'C0'); await move('left', 'B0');
  shown.value = false; await until(s => s.states.length === 5 && s.liveCells === 5 && s.hostedControlCount === 0 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `matrix retirement ${i}`);
  assert.equal(Focus.move('down'), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.equal(Focus.move('right'), false); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS directional focus: actual native key-loop geometry in 2×3 plain/secure/editor/date/WebKit matrix, four axes/no wrap/cone fallback, explicit membership and unavailable reset, browser container/DOM selection, keyed/captured identity, sheet isolation, lazy realization, atomic directions and 20 focused owner retirements without activation');
