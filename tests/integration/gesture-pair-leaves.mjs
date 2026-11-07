import assert from 'node:assert/strict';
import { Button, Component, Focus, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE ?? '', shown = State(false), presented = State(false), first = State({ kind: 'spatial', count: 1 }), second = State({ kind: 'tap', count: 1 });
const priority = State('normal'), epoch = State(1), traceLeaves = State(true), disabled = State(false);
let setups = 0, disposals = 0, buttons = 0, model;
const pair = view => view.modifier('testGesturePair', { first: first.value, second: second.value, priority: priority.value, epoch: epoch.value, traceLeaves: traceLeaves.value });
const Owner = Component(scope => {
  setups++; model = scope.state('日本 🦊'); scope.onDispose(() => disposals++);
  return () => VStack([
    pair(Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle')),
    pair(Button('Button', () => buttons++).frame({ width: 260, height: 40 }).contentShape('rectangle')),
    ...(mode === 'sheet' ? [] : [TextField('Field', { text: model.binding, focusName: 'field' })]),
  ], { spacing: 16 }).disabled(disabled.value);
});
const owner = View(() => shown.value ? Owner() : Text('removed'));
const app = runApp({ title: 'Native pair leaf receipts', width: 420, height: 330, content: mode === 'sheet' ? Text('Base').sheet({ isPresented: presented.binding, content: owner }) : owner });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot');
function node(label = 'Pair') {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (n.props.name !== 'testGesturePair') return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value === label || child?.props.title === label; });
}
const read = (label = 'Pair') => test.request('debug.pairTrace', { id: node(label).id });
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(5);
  } while (Date.now() < end); assert.fail(`Timed out ${label}: ${JSON.stringify(snapshot())}`);
}
const ready = () => node() && test.request('debug.layoutSurfaces').surfaces.some(s => s.current && s.frames.some(f => f.id === node().id));
async function arm() { await until(() => ready() && read().armed === epoch.value, 'armed layout'); }
async function click(label = 'Pair', count = 1, wait = 650, at = 0.5) {
  await until(ready, 'layout'); read(label); const queued = test.request('debug.tap', { id: node(label).id, count, command: true, at: { x: at, y: 0.5 } });
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native release'); await sleep(wait); return read(label);
}
const leaves = r => r.records.filter(e => e.phase === 'leafEnded'), ends = r => r.records.filter(e => e.phase === 'ended');
const receipts = new Set(), cohorts = new Set(); let lastReceipt = 0;
function check(result, count, expected = true) {
  assert.equal(result.correlationErrors, 0, JSON.stringify(result)); assert.ok(result.records.every(r => !r.correlationError && r.phase !== 'uncaptured'), JSON.stringify(result));
  const a = first.value.count, b = second.value.count;
  const total = !expected || count < Math.min(a, b) ? 0 : a === 1 && b === 1 ? count : 1;
  assert.equal(ends(result).length, total, JSON.stringify(result));
  const completed = leaves(result);
  for (const [i, definition] of [first.value, second.value].entries()) assert.equal(completed.filter(e => e.path[0] === i).length, expected && count >= definition.count ? a === 1 && b === 1 ? count : 1 : 0, JSON.stringify(result));
  for (const e of completed) {
    assert.ok(e.path.length === 1 && [0, 1].includes(e.path[0])); assert.ok(e.receipt > lastReceipt); lastReceipt = e.receipt;
    assert.ok(!receipts.has(e.receipt)); receipts.add(e.receipt); assert.equal(e.epoch, epoch.value); assert.ok(e.cohort > 0);
  }
  for (const e of ends(result)) {
    assert.ok(!cohorts.has(e.cohort)); cohorts.add(e.cohort);
    for (const [i, key] of ['first', 'second'].entries()) {
      if (e[key] === null) { assert.equal(e.receipts[key], null); continue; }
      const receipt = completed.find(r => r.receipt === e.receipts[key]); assert.ok(receipt, JSON.stringify(result));
      assert.deepEqual(receipt.path, [i]); assert.equal(receipt.cohort, e.cohort); assert.deepEqual(receipt[key], e[key]);
      assert.ok(result.records.indexOf(receipt) < result.records.indexOf(e));
    }
  }
  assert.equal(snapshot().pairProbeCohortOwners, 0); assert.equal(snapshot().pairProbeLeafReceipts, 0);
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true; presented.value = true; test.flush(); await arm();
if (mode.endsWith('close')) {
  if (mode === 'pending-close') {
    second.value = { kind: 'tap', count: 2 }; epoch.value++; test.flush(); await arm();
    const pending = await click('Pair', 1, 20); assert.equal(leaves(pending).length, 1); assert.equal(ends(pending).length, 0);
    assert.equal(snapshot().pairProbeCohortOwners, 1); assert.equal(snapshot().pairProbeLeafReceipts, 1);
  } else {
    read(); test.request('debug.tap', { id: node().id, hold: 1, command: true });
    await until(() => read().records.some(e => e.phase === 'began'), 'held begin'); assert.ok(snapshot().pointerTimerCount > 0);
  }
  test.request('debug.close'); await app; assert.equal(disposals, setups);
  for (const key of ['pairProbeCohortOwners', 'pairProbeLeafReceipts', 'pairProbeTraceCount', 'pairProbeArmOwners', 'liveViews', 'liveCells', 'pointerTimerCount']) assert.equal(snapshot()[key], 0);
  console.log(`PASS leaf receipt ${mode} shutdown clears cohorts, traces, native owners and timers`);
} else if (mode === 'sheet') {
  const original = node(); second.value = { kind: 'tap', count: 2 }; epoch.value++; test.flush(); await arm();
  const early = await click('Pair', 1, 20); assert.equal(leaves(early).length, 1); assert.equal(ends(early).length, 0); assert.equal(snapshot().pairProbeCohortOwners, 1);
  presented.value = false; test.flush(); await until(() => !test.request('debug.focusContext').sheet && snapshot().pairProbeCohortOwners === 0, 'sheet disappearance'); await sleep(650);
  assert.equal(ends(read()).length, 0); assert.equal(snapshot().pairProbeLeafReceipts, 0); assert.equal(disposals, 0);
  presented.value = true; test.flush(); await arm(); assert.equal(node().id, original.id); assert.equal(setups, 1); assert.equal(model.value, '日本 🦊');
  const fresh = await click(); check(fresh, 1); assert.ok(ends(fresh)[0].cohort > leaves(early)[0].cohort);
  presented.value = false; test.flush(); await until(() => !test.request('debug.focusContext').sheet && snapshot().pairProbeArmOwners === 0, 'dismiss sheet');
  test.request('debug.close'); await app; assert.equal(disposals, 1); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().pairProbeCohortOwners, 0);
  console.log('PASS leaf receipt sheet: pending completed branch retires on native disappearance; retained owner re-entry starts a distinct cohort without activation');
} else {
  assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured); const original = node().id;
  for (const p of ['normal', 'high', 'simultaneous']) for (const [a, b] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
    first.value = { kind: 'spatial', count: a }; second.value = { kind: 'tap', count: b }; priority.value = p; epoch.value++; test.flush(); await arm();
    for (const count of [1, 2]) {
      const plain = await click('Pair', count); check(plain, count);
      if (a === 1 && b === 1 && count === 2) { assert.equal(ends(plain)[0].interval, ends(plain)[1].interval); assert.notEqual(ends(plain)[0].cohort, ends(plain)[1].cohort); }
      if (a === 2 && b === 1 && count === 2) assert.deepEqual(leaves(plain).map(e => e.path), [[1], [0]], 'native callback order follows recognition, not sorted paths');
      const before = buttons, button = await click('Button', count);
      const normalDoubleWins = p === 'normal' && a === 2 && b === 2 && count === 2;
      check(button, count, p !== 'normal' || normalDoubleWins);
      assert.equal(buttons, before + (normalDoubleWins || p === 'high' && count >= Math.min(a, b) ? 0 : count));
    }
    assert.equal(node().id, original); assert.equal(Focus.request(captured), true); assert.equal(model.value, '日本 🦊');
  }
  first.value = { kind: 'tap', count: 1 }; second.value = { kind: 'spatial', count: 1 }; epoch.value++; test.flush(); await arm(); check(await click(), 1);
  const target = node(), stable = snapshot().nodes;
  for (const traceLeaves of [1, 'true', null]) { assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, traceLeaves } }] }), /Invalid layout boolean/); assert.deepEqual(snapshot().nodes, stable); }
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, traceLeaves: false } }] }), /require a newer epoch/); assert.deepEqual(snapshot().nodes, stable);
  traceLeaves.value = false; epoch.value++; test.flush(); await arm(); const noTrace = await click(); assert.equal(leaves(noTrace).length, 0); assert.equal(ends(noTrace).length, 1); assert.equal(ends(noTrace)[0].cohort, undefined);
  traceLeaves.value = true; first.value = { kind: 'spatial', count: 1 }; second.value = { kind: 'tap', count: 2 }; epoch.value++; test.flush(); await arm();
  const early = await click('Pair', 1, 20); assert.equal(leaves(early).length, 1); assert.equal(ends(early).length, 0); assert.equal(snapshot().pairProbeCohortOwners, 1); assert.equal(snapshot().pairProbeLeafReceipts, 1);
  assert.equal(read().records.length, 0, 'trace drain does not retire pending receipt ownership'); await sleep(650); const late = read(); check({ ...late, records: [...early.records, ...late.records] }, 1);
  for (const p of ['normal', 'high', 'simultaneous']) {
    priority.value = p; epoch.value++; test.flush(); await arm(); const pending = await click('Pair', 1, 20, 0.2); assert.equal(snapshot().pairProbeCohortOwners, 1);
    epoch.value += 2; test.flush(); await arm(); assert.equal(snapshot().pairProbeCohortOwners, 0); const fresh = await click('Pair', 1, 650, 0.8); check(fresh, 1);
    assert.ok(ends(fresh)[0].cohort > leaves(pending)[0].cohort); assert.ok(Math.abs(ends(fresh)[0].first.x - 208) < 0.1); assert.equal(Focus.request(captured), true);
  }
  const pending = await click('Pair', 1, 20); assert.equal(snapshot().pairProbeCohortOwners, 1); disabled.value = true; test.flush(); await until(() => snapshot().pairProbeCohortOwners === 0, 'disabled retirement'); await sleep(650); assert.equal(ends(read()).length, 0);
  disabled.value = false; test.flush(); await arm(); const fresh = await click(); check(fresh, 1); assert.ok(ends(fresh)[0].cohort > leaves(pending)[0].cohort);
  await click('Pair', 1, 20); shown.value = false; test.flush(); await until(() => !node() && snapshot().liveViews === snapshot().nodes.length, 'pending removal'); assert.equal(snapshot().pairProbeCohortOwners, 0); assert.equal(snapshot().pairProbeLeafReceipts, 0); assert.deepEqual(test.stats(), baseline);
  first.value = { kind: 'spatial', count: 1 }; second.value = { kind: 'tap', count: 1 };
  for (let i = 0; i < 20; i++) {
    shown.value = true; epoch.value++; test.flush(); await arm(); check(await click('Pair', 1, 20), 1);
    shown.value = false; test.flush(); await until(() => !node() && snapshot().liveViews === snapshot().nodes.length, 'owner removal');
    assert.deepEqual(test.stats(), baseline); for (const key of ['pairProbeCohortOwners', 'pairProbeLeafReceipts', 'pairProbeTraceCount', 'pairProbeArmOwners', 'pointerTimerCount']) assert.equal(snapshot()[key], 0);
  }
  assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0);
  console.log('PASS native leaf receipts: actual recognition order and stable paths, exact terminal cohort correlation, count/priority/control matrix, pure mapped values, independent double ends, drain/pending/config/disabled/removal retirement and twenty lifetimes without activation');
}
