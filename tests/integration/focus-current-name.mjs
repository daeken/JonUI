import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp, __testing as test } from 'jonui';

assert.throws(() => Focus.currentName(), /mounted window/);
const shown = State(true), presented = State(false), reversed = State(false), names = State(['café', 'cafe\u0301']), blocked = State(false), tabFocusable = State(true);
const parent = State('parent'); let model, setups = 0, disposals = 0;
const messages = [], errors = [], editing = [];
const Panel = Component(scope => {
  setups++; model = { a: scope.state('A'), b: scope.state('B'), secure: scope.state('dummy'), editor: scope.state('notes'), date: scope.state(Date.UTC(2028, 0, 1)), sheet: scope.state('sheet') };
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => TextField('Same title', {
      text: model[id].binding, ...(names.value[id === 'a' ? 0 : 1] === null ? {} : { focusName: names.value[id === 'a' ? 0 : 1] }), onEditingChanged: value => editing.push([id, value]),
    })),
    SecureField('Secret', { text: model.secure.binding, focusName: 'secure' }),
    TextEditor({ text: model.editor.binding, focusName: 'editor' }).frame({ height: 70 }),
    DatePicker('Date', { selection: model.date.binding, style: 'compact', components: 'date', focusName: 'date' }),
    WebView({ html: '<meta charset="utf-8"><input id="first"><input id="second">', focusName: 'web', tabFocusable: tabFocusable.value,
      onMessage: value => messages.push(value), onError: value => errors.push(value),
    }).disabled(blocked.value).frame({ height: 90 }),
  ], { spacing: 10 }).sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: model.sheet.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI native focus name snapshots', width: 580, height: 620, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), TextField('Unnamed', { text: parent.binding }),
  View(() => shown.value ? Panel() : Text('Removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), handles = () => test.request('debug.focusHandles');
const webID = () => snapshot().nodes.find(n => n.kind === 'webview')?.id;
const web = () => test.request('debug.web', { id: webID() });
const webFocus = () => test.request('debug.webFocus', { id: webID() });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const s = snapshot(), c = test.request('debug.focusContext');
    assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0); assert.deepEqual(errors, []);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}`);
}
function request(name) { assert.equal(Focus.requestNamed(name), true); assert.equal(Focus.currentName(), name); }
await until(s => s.hostedControlCount === 7 && s.webViewCount === 1 && web().ready, 'mixed controls mounted');
Focus.clear(); assert.equal(Focus.currentName(), null);
assert.equal(test.request('debug.focus', { field: 1 }).accepted, true); assert.equal(Focus.currentName(), null, 'unnamed responder');
for (const name of ['parent', 'café', 'cafe\u0301', 'secure', 'editor', 'date', 'web']) request(name);
assert.equal(webFocus().focused, true); assert.deepEqual(handles(), { targets: 0, live: 0 });
request('café'); assert.equal(test.request('debug.tab').intercepted, false);
assert.equal(Focus.currentName(), 'cafe\u0301', 'snapshot follows native Tab, not the last named request');
Focus.next(); assert.equal(Focus.currentName(), 'secure');
Focus.clear(); assert.equal(Focus.currentName(), null); request('web');

// A DOM input is an internal WebKit responder; querying must preserve its caret.
test.request('debug.web.evaluate', { id: webID(), script: "const input=document.getElementById('second'); input.value='日本 🦊'; input.focus(); input.setSelectionRange(2,2); jonui.postMessage({ready:true});" });
await until(() => messages.some(m => m.ready) && webFocus().focused, 'actual DOM focus');
const counts = test.stats(); for (let i = 0; i < 50; i++) assert.equal(Focus.currentName(), 'web');
test.request('debug.web.evaluate', { id: webID(), script: "jonui.postMessage({active:document.activeElement.id,caret:document.activeElement.selectionStart,value:document.activeElement.value})" });
await until(() => messages.some(m => m.active), 'DOM selection after snapshots');
assert.deepEqual(messages.find(m => m.active), { active: 'second', caret: 2, value: '日本 🦊' });
assert.deepEqual(test.stats(), counts); assert.deepEqual(handles(), { targets: 0, live: 0 });
tabFocusable.value = false; test.flush(); await until(() => !webFocus().containerEligible, 'browser excluded from focus');
assert.equal(Focus.currentName(), null); assert.equal(Focus.requestNamed('web'), false);
tabFocusable.value = true; test.flush(); await until(() => webFocus().containerEligible, 'browser eligibility restored'); request('web');
blocked.value = true; test.flush(); await until(() => !webFocus().interactionEnabled, 'browser disabled'); assert.equal(Focus.currentName(), null);
blocked.value = false; test.flush(); await until(() => webFocus().interactionEnabled, 'browser re-enabled');

request('café'); await sleep(40); const eventCount = editing.length;
for (let i = 0; i < 50; i++) assert.equal(Focus.currentName(), 'café'); await sleep(40);
assert.equal(editing.length, eventCount, 'snapshots preserve the native editing session');
const physical = Focus.capture(); assert.ok(physical);
names.value = ['Renamed 🦊', 'cafe\u0301']; reversed.value = true; test.flush();
assert.equal(Focus.currentName(), 'Renamed 🦊'); assert.equal(Focus.request(physical), true);
names.value = [null, 'Renamed 🦊']; test.flush(); assert.equal(Focus.currentName(), null, 'removing name does not change physical focus');
assert.equal(Focus.request(physical), true); assert.equal(Focus.currentName(), null);
request('Renamed 🦊'); names.value = ['Restored', 'Reassigned']; test.flush(); assert.equal(Focus.currentName(), 'Reassigned');
request('Restored');

presented.value = true; await until(s => s.sheetPresented && test.request('debug.focusContext').sheet, 'sheet mounted');
assert.notEqual(Focus.currentName(), 'Restored', 'parent focus is not reported behind the sheet');
request('sheet'); assert.deepEqual(handles(), { targets: 0, live: 0 });
assert.equal(Focus.requestNamed('parent'), false); assert.equal(Focus.currentName(), 'sheet');
presented.value = false; await until(s => !s.sheetPresented && !test.request('debug.focusContext').sheet, 'sheet dismissed');
assert.notEqual(Focus.currentName(), 'sheet'); request('parent');

shown.value = false; await until(s => s.hostedControlCount === 2 && s.webViewCount === 0 && s.liveViews === s.nodes.length, 'owner retired');
request('parent'); assert.deepEqual(test.request('debug.focusNames'), { count: 1 }); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.hostedControlCount === 7 && s.webViewCount === 1 && web().ready, `owner mount ${i}`);
  request('editor'); shown.value = false;
  await until(s => s.hostedControlCount === 2 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `focused retirement ${i}`);
  const actual = test.request('debug.focusStatus');
  assert.equal(Focus.currentName(), actual.fields.includes(0) ? 'parent' : null);
  assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.equal(Focus.currentName(), null); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().hostedControlCount, 0);
console.log('PASS native focus name snapshots: plain/secure/editor/date/WebKit and DOM responders, exact Unicode, unnamed/clear/unavailable targets, preserved editing/caret, keyed rename/reassignment, active sheet isolation, no query allocations and 20 focused owner retirements');
