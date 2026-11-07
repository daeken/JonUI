import assert from 'node:assert/strict';
import { Button, Component, Focus, State, TapGesture, SpatialTapGesture, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), firstCount = State(1), secondCount = State(1), priority = State('normal'), revision = State(0), disabled = State(false), withFirst = State(true), withSecond = State(true);
const events = []; let mutation = 'none', setups = 0, disposals = 0, buttons = 0, model;
const Owner = Component(scope => {
  setups++; model = scope.state('日本 🦊'); scope.onDispose(() => disposals++);
  return () => {
    const current = revision.value;
    const pair = (view, label) => {
      let first = SpatialTapGesture({ count: firstCount.value }), second = TapGesture({ count: secondCount.value });
      if (withFirst.value) first = first.onEnded(function (point) {
        assert.equal(this, undefined); assert.ok(Object.isFrozen(point)); assert.deepEqual(Object.keys(point).sort(), ['x', 'y']); events.push({ label, path: 0, current, point });
        if (label !== 'Pair') return;
        if (mutation === 'revision') revision.value++;
        if (mutation === 'dropSecond') withSecond.value = false;
        if (mutation === 'last-handler') withFirst.value = false;
        if (mutation === 'count') firstCount.value = 2;
        if (mutation === 'priority') priority.value = 'high';
        if (mutation === 'disable') disabled.value = true;
        if (mutation === 'remove') shown.value = false;
      });
      if (withSecond.value) second = second.onEnded(function () { assert.equal(this, undefined); assert.equal(arguments.length, 0); events.push({ label, path: 1, current }); });
      return test.gesturePair(view, first, second, function (value) { assert.equal(this, undefined); assert.ok(Object.isFrozen(value)); events.push({ label, path: 'group', current, value }); }, { priority: priority.value });
    };
    return VStack([
      pair(Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle'), 'Pair'),
      pair(Button('Button', () => buttons++).frame({ width: 260, height: 40 }).contentShape('rectangle'), 'Button'),
      TextField('Field', { text: model.binding, focusName: 'field' }),
    ], { spacing: 16 }).disabled(disabled.value);
  };
});
const app = runApp({ title: 'Owned leaf callbacks', width: 420, height: 330, content: View(() => shown.value ? Owner() : Text('removed')) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot');
function node(label = 'Pair') {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.dispatch) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value === label || child?.props.title === label; });
}
const read = (label = 'Pair') => test.request('debug.pairTrace', { id: node(label).id });
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(5);
  } while (Date.now() < end); assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-10), snapshot: snapshot() })}`);
}
async function ready() { await until(() => node() && test.pairStats().armed === 2 && test.request('debug.layout').frames.some(f => f.id === node().id), 'armed layout'); }
async function click(label = 'Pair', count = 1, wait = 650) {
  await ready(); read(label); const before = events.length, q = test.request('debug.tap', { id: node(label).id, count, command: true, at: { x: label === 'Button' ? 0.5 : 0.8, y: 0.5 } });
  await until(() => test.request('debug.tapResult', { id: q.id }).done, 'release'); await sleep(wait); return events.slice(before);
}
const clean = () => { for (const key of ['pairDispatchLeafLeaseCount', 'pairDispatchUnclaimedLeafCount', 'pairDispatchDependencyCount', 'pairDispatchPendingCount', 'pairProbeCohortOwners', 'pointerTimerCount']) assert.equal(snapshot()[key], 0, key); };
await until(() => snapshot().nodes.length, 'base'); const baseline = test.stats(); shown.value = true; test.flush(); await ready();
assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured); const original = node();
for (const p of ['normal', 'high', 'simultaneous']) for (const [a, b] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
  firstCount.value = a; secondCount.value = b; priority.value = p; test.flush(); await ready();
  for (const count of [1, 2]) for (const label of ['Pair', 'Button']) {
    const before = buttons, result = await click(label, count);
    const normalDoubleWins = label === 'Button' && p === 'normal' && a === 2 && b === 2 && count === 2;
    const recognizes = count >= Math.min(a, b) && (label === 'Pair' || p !== 'normal' || normalDoubleWins);
    const paths = !recognizes ? [] : a === 1 && b === 1 ? Array.from({ length: count }, () => [0, 1, 'group']).flat() : [...(a <= count && (a === 1 || b !== 1) ? [0] : []), ...(b <= count ? [1] : []), ...(a <= count && a === 2 && b === 1 ? [0] : []), 'group'];
    assert.deepEqual(result.map(e => e.path), paths, JSON.stringify({ a, b, p, count, label, result })); assert.ok(result.every(e => e.current === revision.value));
    if (label === 'Button') assert.equal(buttons, before + (normalDoubleWins || p === 'high' && recognizes ? 0 : count));
    assert.equal(read(label).correlationErrors, 0); clean();
  }
  assert.equal(node().id, original.id); assert.equal(Focus.request(captured), true); assert.equal(model.value, '日本 🦊');
}
firstCount.value = secondCount.value = 1; priority.value = 'normal'; test.flush(); await ready();
for (const action of ['revision', 'dropSecond', 'count', 'priority', 'disable', 'last-handler']) {
  mutation = 'none'; firstCount.value = secondCount.value = 1; priority.value = 'normal'; disabled.value = false; withFirst.value = true; withSecond.value = action !== 'last-handler'; test.flush(); await ready();
  const old = node(), current = revision.value; mutation = action; const result = await click(); mutation = 'none';
  assert.deepEqual(result.map(e => e.path), action === 'revision' ? [0, 1, 'group'] : action === 'dropSecond' ? [0, 'group'] : [0], action);
  if (action === 'revision') { assert.deepEqual(result.map(e => e.current), [current, current + 1, current + 1]); assert.equal(node().props.epoch, old.props.epoch); }
  if (action === 'dropSecond') assert.equal(node().props.epoch, old.props.epoch);
  if (['count', 'priority', 'disable', 'last-handler'].includes(action)) assert.notEqual(node().props.epoch, old.props.epoch);
  clean(); assert.equal(Focus.request(captured), action !== 'disable', action);
}
firstCount.value = secondCount.value = 1; priority.value = 'normal'; disabled.value = false; withFirst.value = withSecond.value = true; test.flush(); await ready();
let result = await click('Pair', 1, 40); const trace = read(), receipt = trace.records.find(r => r.phase === 'leafEnded');
assert.ok(receipt); assert.deepEqual(test.request('gesturePair.leafClaim', { id: node().id, token: node().props.epoch, arm: receipt.dispatchArm, cohort: receipt.cohort, receipt: receipt.receipt, path: receipt.path }), { accepted: false }); clean();
secondCount.value = 2; test.flush(); await ready(); result = await click('Pair', 1, 20); assert.deepEqual(result.map(e => e.path), [0]); assert.equal(snapshot().pairDispatchLeafLeaseCount, 1); assert.equal(snapshot().pairDispatchUnclaimedLeafCount, 0);
await sleep(650); assert.equal(events.at(-1).path, 'group'); clean();
firstCount.value = secondCount.value = 1; test.flush(); await ready(); mutation = 'remove'; result = await click('Pair', 1, 40); mutation = 'none'; assert.deepEqual(result.map(e => e.path), [0]);
await until(() => !node() && snapshot().liveViews === snapshot().nodes.length, 'callback removal'); assert.deepEqual(test.stats(), baseline); clean();
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await ready(); assert.equal(model.value, '日本 🦊'); assert.deepEqual((await click('Pair', 1, 40)).map(e => e.path), [0, 1, 'group']);
  shown.value = false; test.flush(); await until(() => !node() && snapshot().liveViews === snapshot().nodes.length, 'owner retirement'); assert.deepEqual(test.stats(), baseline); clean();
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; clean(); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS pair leaf callbacks: native order/count/control matrix, void/frozen-point arguments, current handlers, synchronous revision/config/disable/removal/handler mutations, retained pending leases and twenty lifetimes without activation');
