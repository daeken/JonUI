import assert from 'node:assert/strict';
import { Component, State, Text, VStack, runApp, __testing as test } from 'jonui';
const a = State(false), b = State(false), revision = State(0), blocked = State(false), double = State(false);
const events = [], owners = {}, setups = { A: 0, B: 0 }, disposals = { A: 0, B: 0 };
const Owner = Component((scope, label) => {
  const total = scope.state(0), sheet = scope.state(false); owners[label] = { total, sheet }; setups[label]++;
  scope.onDispose(() => disposals[label]++);
  return () => { const current = revision.value; return VStack([
    Text(`${label} tap`).frame({ width: 210, height: 65 }).onTapGesture(() => { total.value++; events.push([label, current]); }, { count: double.value ? 2 : 1 }),
    Text(`${label} total: ${total.value}`),
  ]).disabled(blocked.value).sheet({ isPresented: sheet.binding, content: Text(`${label} sheet`).frame({ width: 280, height: 140 }).onTapGesture(() => { total.value++; events.push(['sheet', current]); }, { count: double.value ? 2 : 1 }) }); };
});
const app = runApp({ title: 'JonUI tap window isolation', width: 440, height: 280, content: Text('Main tap').onTapGesture(() => events.push(['main', revision.value]))
  .window({ isPresented: a.binding, title: 'A', width: 370, height: 250, content: Owner('A') })
  .window({ isPresented: b.binding, title: 'B', width: 410, height: 290, content: Owner('B') }) });
const sleep = ms => new Promise(r => setTimeout(r, ms)), snapshot = () => test.request('debug.snapshot'), windows = () => test.request('debug.windows').windows;
const surfaces = () => test.request('debug.layoutSurfaces'), win = label => windows().find(w => w.title === label);
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.tap) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value === (label === 'main' ? 'Main tap' : label === 'sheet' ? 'B sheet' : `${label} tap`); });
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    assert.ok(windows().every(w => w.alpha === 0 && !w.key));
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ surfaces: surfaces(), events, windows: windows() })}`);
}
function laidOut(label) { const target = node(label); return target && surfaces().surfaces.some(s => s.current && s.attached && s.frames.some(f => f.id === target.id)); }
async function click(label, count = 1, expected = true) {
  await until(() => laidOut(label), `layout ${label}`); const before = events.length;
  const { id, modifiers } = test.request('debug.tap', { id: node(label).id, count, command: label === 'sheet' });
  assert.equal(modifiers, label === 'sheet' ? 1 << 20 : 0);
  await until(() => test.request('debug.tapResult', { id }).done, 'dispatch');
  if (expected) { await until(() => events.length === before + 1, `tap ${label}`); assert.deepEqual(events.at(-1), [label, revision.value]); }
  else { await sleep(100); assert.equal(events.length, before); }
}
function rejected(target) { assert.throws(() => test.request('debug.tap', { id: target.id }), /not laid out in current window/); }
await until(() => laidOut('main'), 'main root'); const baseline = test.stats(), baseRecords = surfaces().records; assert.equal(baseRecords, 1); await click('main');
a.value = true; test.flush(); await until(() => win('A') && laidOut('A'), 'A root'); const firstA = node('A'), aWindow = win('A').id;
await click('A'); rejected(node('main')); assert.equal(owners.A.total.value, 1);
b.value = true; test.flush(); await until(() => win('B') && laidOut('B'), 'B root'); await click('B'); rejected(firstA); rejected(node('main'));
assert.equal(owners.A.total.value, 1); assert.equal(owners.B.total.value, 1); assert.equal(surfaces().records, 3);
test.request('debug.selectWindow', { id: aWindow }); await click('A'); rejected(node('B')); assert.equal(owners.B.total.value, 1);
const tokens = snapshot().nodes.filter(n => n.props.tap).map(n => [n.id, n.props.tap]); revision.value = 1; test.flush(); await sleep(40); await click('A');
assert.deepEqual(snapshot().nodes.filter(n => n.props.tap).map(n => [n.id, n.props.tap]), tokens);
blocked.value = true; test.flush(); await sleep(30); await click('A', 1, false); blocked.value = false; double.value = true; test.flush(); await sleep(30); await click('A', 2);
test.request('debug.selectWindow', { id: win('B').id }); await click('B', 2);
// Sheet geometry must belong to the sheet, so the blocked parent cannot be clicked.
// Real Command-clicks exercise the inactive sheet without changing eligibility.
// Ordinary unmodified first-mouse delivery remains a separate platform gap.
owners.B.sheet.value = true; test.flush(); await until(() => test.request('debug.focusContext').sheet && surfaces().surfaces.some(s => s.current && s.frames.some(f => snapshot().nodes.find(n => n.id === f.id)?.props.value === 'B sheet')), 'sheet surface');
rejected(node('B')); rejected(node('A')); rejected(node('main'));
const sheetTotal = owners.B.total.value, sheetToken = node('sheet').props.tap; await click('sheet', 2);
double.value = false; revision.value = 2; test.flush(); await sleep(40); assert.notEqual(node('sheet').props.tap, sheetToken); await click('sheet');
assert.equal(owners.B.total.value, sheetTotal + 2); double.value = true; test.flush(); await sleep(40);
owners.B.sheet.value = false; test.flush(); await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed'); await click('B', 2);
const oldB = node('B'); test.request('debug.closeWindow', { id: win('B').id }); await until(() => !b.value && !win('B') && disposals.B === 1 && surfaces().records === 2, 'B native close'); rejected(oldB);
test.request('debug.selectWindow', { id: aWindow }); await click('A', 2); test.request('debug.closeWindow', { id: aWindow });
await until(() => !a.value && windows().length === 0 && surfaces().records === baseRecords && snapshot().liveViews === snapshot().nodes.length, 'all root resources removed'); assert.deepEqual(test.stats(), baseline); rejected(firstA); await click('main');
double.value = false;
for (let i = 0; i < 20; i++) {
  a.value = true; test.flush(); await until(() => win('A') && laidOut('A'), `open ${i}`); assert.equal(owners.A.total.value, 0); const current = node('A'); assert.notEqual(current.props.tap, firstA.props.tap); await click('A');
  test.request('debug.closeWindow', { id: win('A').id }); await until(() => !a.value && windows().length === 0 && surfaces().records === baseRecords && snapshot().liveViews === snapshot().nodes.length, `close ${i}`); rejected(current); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups.A, 21); assert.deepEqual(disposals, setups); await click('main');
a.value = true; test.flush(); await until(() => win('A') && laidOut('A'), 'open root at app shutdown'); await click('A');
test.request('debug.close'); await app; assert.deepEqual(disposals, setups); assert.equal(snapshot().layoutSurfaceCount, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS tap windows: real native single/double taps in independent roots, current handlers/state, disabled content, root/sheet target rejection, sheet single/double Command-clicks/current State, native-close retirement, fresh reopen and 20 owner lifetimes without activation');
