import assert from 'node:assert/strict';
import { Component, DatePicker, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, WebRequest, runApp, __testing as test } from 'jonui';
const shown = State(true), presented = State(false), reversed = State(false), blocked = State(false), tabFocusable = State(true), revision = State(0);
const parent = State('parent safe'), parentDate = State(Date.UTC(2025, 0, 1));
const messages = [], errors = [], submits = [], lateFocus = [], gates = new Map(); let model, setups = 0, disposals = 0, query = 0, canceled = 0;
const html = '<meta charset="utf-8"><input id="first"><input id="second"><output id="model"></output><script>jonui.onMessage(value => { document.getElementById("model").textContent = value.payload; });</script>';
const Anchor = Component(scope => {
  setups++; const local = model = { before: scope.state('before'), after: scope.state('dummy'), note: scope.state('notes'), date: scope.state(Date.UTC(2028, 1, 29)), payload: scope.state('initial') };
  scope.onDispose(() => { disposals++; });
  const api = {
    select(value) { local.payload.value = value; return { value, date: local.date.value }; },
    async hold(key) {
      const context = WebRequest.current; let resolve; const wait = new Promise(done => { resolve = done; });
      const gate = { signal: context.signal, resolve }; gates.set(key, gate);
      context.onCancel(() => { gates.delete(key); canceled++; });
      await wait; parent.value = 'obsolete request'; local.payload.value = 'obsolete request';
      lateFocus.push([Focus.requestNamed('parent'), Focus.requestNamed('sheet-before')]); return key;
    },
  };
  return () => Text('Sheet anchor').sheet({ isPresented: presented.binding, content: VStack([
    ForEach(reversed.value ? ['after', 'web', 'before'] : ['before', 'web', 'after'], { id: id => id }, kind => kind === 'web'
      ? WebView({ html: html + `<!-- ${revision.value} -->`, focusName: 'sheet-web', tabFocusable: tabFocusable.value, api, data: { payload: local.payload.value }, onMessage: m => messages.push(m), onError: error => errors.push(error) }).disabled(blocked.value).frame({ height: 100 })
      : kind === 'before' ? TextField('Before', { text: local.before.binding, focusName: 'sheet-before', onSubmit: () => { submits.push(local.before.value); Focus.requestNamed('sheet-date'); } })
      : SecureField('After', { text: local.after.binding, focusName: 'sheet-after' })),
    DatePicker('Sheet date', { selection: local.date.binding, components: 'date', style: 'compact', timeZone: 'UTC', focusName: 'sheet-date' }),
    TextEditor({ text: local.note.binding, focusName: 'sheet-editor' }).frame({ height: 80 }),
  ], { spacing: 12 }).frame({ width: 420, height: 400 }).padding(16) });
});
const app = runApp({ title: 'JonUI mixed sheet focus and RPC', width: 600, height: 450, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }),
  DatePicker('Parent date', { selection: parentDate.binding, components: 'date', style: 'compact', focusName: 'parent-date' }),
  View(() => shown.value ? Anchor() : Text('Owner removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), context = () => test.request('debug.focusContext'), status = () => test.request('debug.focusStatus');
const node = () => snapshot().nodes.find(n => n.kind === 'webview'), web = () => test.request('debug.web', { id: node().id }), focus = () => test.request('debug.webFocus', { id: node().id });
const fields = () => test.request('debug.fields').fields, fieldIndex = secure => fields().find(f => f.secure === secure).index;
const dates = () => test.request('debug.dates').dates, dateFocused = () => test.request('debug.focusControls').controls.some(c => c.kind === 'date' && c.focused);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const end = Date.now() + 10000;
  do {
    const s = snapshot(), c = context(); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0); assert.equal(c.animationsSuppressed, true); assert.deepEqual(errors, []);
    if (predicate(s)) return s; await sleep(10);
  } while (Date.now() < end);
  assert.fail(`Timed out: ${name}; ${JSON.stringify({ context: context(), status: status(), counts: test.stats(), requests: test.webRequestStats(), gates: [...gates.keys()] })}`);
}
const evaluate = script => test.request('debug.web.evaluate', { id: node().id, script });
async function probe(expected) {
  const end = Date.now() + 6000; let last;
  do {
    const id = ++query; evaluate(`jonui.postMessage({query:${id},active:document.activeElement.id,selection:document.getElementById('first').selectionStart,value:document.getElementById('first').value,model:document.getElementById('model').textContent})`);
    await until(() => messages.some(m => m.query === id), 'sheet DOM response'); last = messages.find(m => m.query === id); if (!expected || expected(last)) return last; await sleep(10);
  } while (Date.now() < end);
  assert.fail(`Sheet DOM state did not settle: ${JSON.stringify(last)}`);
}
function begin(key) { evaluate(`jonui.remote().hold(${JSON.stringify(key)}).catch(() => {})`); }
const tab = reverse => assert.equal(test.request('debug.tab', { modifiers: reverse ? ['shift'] : [] }).intercepted, false, 'sheet Tab dispatch remains native');
async function traversal(start, end, startIndex, endIndex) {
  assert.equal(Focus.request(start), true); tab(); await until(() => focus().focused, 'native field enters sheet browser'); await probe(p => p.active === 'first');
  tab(); await probe(p => p.active === 'second'); tab(); await until(() => status().fields[0] === endIndex, 'last DOM input leaves for sheet field');
  tab(true); await until(() => focus().focused, 'reverse entry to sheet browser'); await probe(p => p.active === 'second');
  tab(true); await probe(p => p.active === 'first'); tab(true); await until(() => status().fields[0] === startIndex, 'first DOM input leaves for preceding sheet field');
  assert.equal(Focus.request(end), true);
}
async function open() {
  presented.value = true;
  await until(s => s.sheetPresented && context().sheet && fields().length === 2 && dates().length === 1 && s.webViewCount === 1 && web().ready && focus().containerEligible, 'mixed native/WebKit sheet');
}
await until(s => s.states.length === 13 && fields().length === 1 && dates().length === 1 && !context().sheet, 'parent controls and logical sheet owner');
assert.equal(dates()[0].value, parentDate.value); assert.equal(Focus.requestNamed('parent'), true); const parentTarget = Focus.capture(); assert.ok(parentTarget);
await open(); assert.equal(Focus.request(parentTarget), false); assert.equal(Focus.requestNamed('parent'), false); assert.equal(dates()[0].value, model.date.value, 'date adapter follows the actual active sheet, not its parent');
const targets = {};
for (const name of ['before', 'date', 'web', 'editor', 'after']) { assert.equal(Focus.requestNamed(`sheet-${name}`), true); targets[name] = Focus.capture(); assert.ok(targets[name]); }
const order = ['before', 'date', 'web', 'editor', 'after'].map(name => targets[name]); assert.equal(Focus.setTraversal(order), true);
Focus.clear(); Focus.next(); assert.deepEqual(status().fields, [fieldIndex(false)]); Focus.next(); assert.equal(dateFocused(), true); Focus.next(); assert.equal(focus().focused, true); Focus.next(); assert.deepEqual(status().editors, [0]); Focus.previous(); assert.equal(focus().focused, true);
assert.equal(Focus.setTraversal(order, { tabNavigation: true }), false); assert.deepEqual(test.request('debug.focusTraversal'), { count: 5, tabNavigation: false });
assert.equal(Focus.setTraversal([], { tabNavigation: true }), true);
Focus.request(targets.before); test.request('debug.field', { index: fieldIndex(false), value: 'Sheet 日本 🦊 café', submit: true });
await until(() => submits.length === 1 && dateFocused(), 'Return snapshot before named date focus'); assert.deepEqual(submits, ['Sheet 日本 🦊 café']);
Focus.requestNamed('sheet-after'); test.request('debug.field', { index: fieldIndex(true), value: 'sheet-demo-🦊' }); await until(() => model.after.value === 'sheet-demo-🦊', 'actual sheet secure binding');
Focus.requestNamed('sheet-editor'); test.request('debug.editor', { index: 0, value: 'Sheet notes 日本 🦊', newline: true }); await until(() => model.note.value === 'Sheet notes 日本 🦊\n', 'actual mixed sheet editor/newline binding'); assert.equal(submits.length, 1);
const instant = Date.UTC(2028, 2, 1); test.request('debug.date', { index: 0, value: instant }); await until(() => model.date.value === instant, 'actual sheet NSDatePicker action reaches its scoped state'); assert.equal(parentDate.value, Date.UTC(2025, 0, 1));
await traversal(targets.before, targets.after, fieldIndex(false), fieldIndex(true));
Focus.requestNamed('sheet-web'); evaluate("const input = document.getElementById('first'); input.focus(); input.value = '日本 🦊'; input.setSelectionRange(2,2)"); await probe(p => p.active === 'first' && p.selection === 2 && p.value === '日本 🦊');
const loads = web().loads, token = web().token; model.payload.value = 'snapshot 🦊'; test.flush(); await sleep(30); await probe(p => p.model === 'snapshot 🦊' && p.selection === 2 && p.value === '日本 🦊'); assert.equal(web().loads, loads); assert.equal(web().token, token);
blocked.value = true; test.flush(); await until(() => !focus().containerEligible && !focus().hit, 'disabled browser in sheet'); assert.equal(Focus.requestNamed('sheet-web'), false);
Focus.request(targets.before); tab(); await until(() => status().fields[0] === fieldIndex(true), 'sheet Tab skips disabled browser'); tab(true); await until(() => status().fields[0] === fieldIndex(false), 'sheet reverse Tab skips disabled browser');
blocked.value = false; tabFocusable.value = false; test.flush(); await until(() => !focus().containerEligible && focus().hit, 'passive but interactive sheet browser');
const rpc = ++query; evaluate(`jonui.remote().select('selected 🦊').then(value => jonui.postMessage({query:${rpc},value}))`); await until(() => messages.some(m => m.query === rpc), 'sheet RPC updates Node model'); assert.deepEqual(messages.find(m => m.query === rpc).value, { value: 'selected 🦊', date: instant }); assert.equal(model.payload.value, 'selected 🦊');
Focus.request(targets.before); tab(); await until(() => status().fields[0] === fieldIndex(true), 'sheet Tab skips passive browser');
tabFocusable.value = true; reversed.value = true; test.flush(); await until(() => focus().containerEligible, 'keyed sheet browser restored'); await sleep(30);
assert.equal(Focus.request(targets.before), true); assert.equal(Focus.request(targets.date), true); await traversal(targets.after, targets.before, fieldIndex(true), fieldIndex(false));
begin('reload'); await until(() => gates.has('reload') && web().pending === 1, 'pending sheet document call'); const old = gates.get('reload'); revision.value++; test.flush();
await until(() => web().ready && web().loads > loads && web().pending === 0 && old.signal.aborted, 'sheet document reload cancels pending RPC'); assert.equal(Focus.requestNamed('sheet-date'), true); old.resolve(); await sleep(30); assert.equal(dateFocused(), true); assert.equal(parent.value, 'parent safe'); assert.equal(model.payload.value, 'selected 🦊'); assert.deepEqual(lateFocus, [[false, false]]);
const original = model, ids = snapshot().nodes.map(n => n.id).sort((a,b) => a-b); presented.value = false;
await until(s => !s.sheetPresented && !context().sheet && fields().length === 1 && dates().length === 1, 'mixed sheet dismissed'); assert.equal(dates()[0].value, parentDate.value); assert.equal(Focus.requestNamed('sheet-web'), false); assert.equal(Focus.requestNamed('sheet-date'), false);
await open(); assert.equal(model, original); assert.equal(setups, 1); assert.deepEqual(snapshot().nodes.map(n => n.id).sort((a,b) => a-b), ids); assert.equal(dates()[0].value, instant); assert.equal(model.before.value, 'Sheet 日本 🦊 café'); assert.equal(model.after.value, 'sheet-demo-🦊'); assert.equal(model.note.value, 'Sheet notes 日本 🦊\n');
begin('remove'); await until(() => gates.has('remove') && web().pending === 1, 'pending focused sheet owner call'); const removed = gates.get('remove'); assert.equal(Focus.requestNamed('sheet-web'), true); shown.value = false;
await until(s => !context().sheet && s.states.length === 8 && s.liveCells === 8 && s.hostedControlCount === 2 && s.webViewCount === 0 && s.liveViews === s.nodes.length, 'mixed focused sheet owner removed'); assert.equal(removed.signal.aborted, true); removed.resolve(); await sleep(30); assert.equal(parent.value, 'parent safe'); assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 }); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  presented.value = false; shown.value = true; await until(s => s.states.length === 13 && !context().sheet, `mixed owner mount ${i}`); await open();
  assert.equal(Focus.requestNamed('sheet-before'), true); Focus.next(); assert.equal(Focus.requestNamed('sheet-date'), true); assert.equal(Focus.requestNamed('sheet-web'), true);
  const key = `owner-${i}`; begin(key); await until(() => gates.has(key) && web().pending === 1, `pending sheet owner ${i}`); const held = gates.get(key); shown.value = false;
  await until(s => !context().sheet && s.states.length === 8 && s.liveCells === 8 && s.hostedControlCount === 2 && s.webViewCount === 0 && s.liveViews === s.nodes.length, `mixed focused owner retirement ${i}`);
  assert.equal(held.signal.aborted, true); held.resolve(); await sleep(10); assert.equal(parent.value, 'parent safe'); assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 }); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(gates.size, 0); assert.equal(canceled, 22); assert.equal(lateFocus.length, 22); assert.ok(lateFocus.every(values => values.every(value => value === false))); assert.deepEqual(submits, ['Sheet 日本 🦊 café']); assert.deepEqual(test.request('debug.focusNames'), { count: 2 });
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.deepEqual(test.webRequestStats(), { apis: 0, pending: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS mixed sheet focus/RPC: plain/secure/editor/date/WebKit captures and cycles, native DOM Tab boundaries, Return/Unicode/date actions, disabled/passive browser, snapshot/selection and keyed identity, document cancellation, dismiss/reopen state, active-window date adapters and 20 pending focused owner retirements without activation');
