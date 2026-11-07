import assert from 'node:assert/strict';
import { Component, State, Text, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE ?? '', leafMode = mode !== 'root-overflow', epoch = State(1), secondCount = State(1);
const Owner = Component(scope => {
  scope.state(0); scope.onDispose(() => { console.log('LEASE_DISPOSE'); if (mode.endsWith('overflow')) {
    const s = snapshot(); for (const key of ['pairDispatchLeafLeaseCount', 'pairDispatchUnclaimedLeafCount', 'pairDispatchDependencyCount', 'pairDispatchPendingCount', 'pairProbeCohortOwners']) assert.equal(s[key], 0, key); console.log('LEASE_RETIRED');
  } });
  return () => Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle').modifier('testGesturePair', { first: { kind: 'spatial', count: 1 }, second: { kind: 'tap', count: secondCount.value }, priority: 'normal', epoch: epoch.value, dispatch: true, traceLeaves: leafMode, dispatchLeaves: leafMode });
});
const app = runApp({ title: 'Native leaf lease claims', width: 420, height: 250, content: Owner(), onStop: () => console.log('LEASE_STOP') });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot'), node = () => snapshot().nodes.find(n => n.props.dispatch), read = () => test.request('debug.pairTrace', { id: node().id });
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(5);
  } while (Date.now() < end); assert.fail(`Timed out ${label}: ${JSON.stringify(snapshot())}`);
}
async function ready() { await until(() => node() && read().armed === epoch.value && test.request('debug.layout').frames.some(f => f.id === node().id), 'armed layout'); }
async function click(count = 1, wait = 20) {
  await ready(); read(); const q = test.request('debug.tap', { id: node().id, count, command: true });
  await until(() => test.request('debug.tapResult', { id: q.id }).done, 'release'); await sleep(wait); return read();
}
function claimLeaf(event, extras = {}) { return test.request('gesturePair.leafClaim', { id: node().id, token: epoch.value, arm: event.dispatchArm, cohort: event.cohort, receipt: event.receipt, path: event.path, ...extras }); }
function claimGroup(event) { return test.request('gesturePair.claim', { id: node().id, token: epoch.value, arm: event.dispatchArm, completion: event.completion }); }
function clean() { for (const key of ['pairDispatchLeafLeaseCount', 'pairDispatchUnclaimedLeafCount', 'pairDispatchDependencyCount', 'pairDispatchPendingCount', 'pairProbeCohortOwners', 'pointerTimerCount']) assert.equal(snapshot()[key], 0, key); }
await ready();
if (mode.endsWith('overflow')) {
  for (let i = 0; i < 64; i++) { await click(2); await until(() => snapshot().pairDispatchPendingCount === (i + 1) * 2, 'bounded queue'); }
  assert.equal(snapshot().pairDispatchLeafLeaseCount, leafMode ? 256 : 0); assert.equal(snapshot().pairDispatchUnclaimedLeafCount, leafMode ? 256 : 0); assert.equal(snapshot().pairDispatchDependencyCount, leafMode ? 128 : 0); assert.equal(snapshot().pairProbeTraceCount, 0);
  test.request('debug.tap', { id: node().id, command: true });
  await app; assert.fail('overflow must stop');
} else {
  const result = await click(), leaves = result.records.filter(r => r.phase === 'leafEnded'), group = result.records.find(r => r.phase === 'ended'); assert.equal(leaves.length, 2); assert.ok(group); assert.equal(result.correlationErrors, 0);
  assert.equal(snapshot().pairDispatchLeafLeaseCount, 2); assert.equal(snapshot().pairDispatchUnclaimedLeafCount, 2); assert.equal(snapshot().pairDispatchDependencyCount, 1);
  assert.deepEqual(claimGroup(group), { accepted: false }, 'group cannot pass unclaimed leaf dependencies');
  for (const extras of [{ path: [1] }, { cohort: leaves[0].cohort + 1 }, { arm: leaves[0].dispatchArm + 1 }, { token: epoch.value + 1 }, { receipt: leaves[0].receipt + 1000 }]) assert.deepEqual(claimLeaf(leaves[0], extras), { accepted: false });
  for (const extras of [{ path: [true] }, { path: [] }, { path: [0, 1] }, { path: [2] }, { receipt: true }, { cohort: 0 }, { extra: true }]) assert.throws(() => claimLeaf(leaves[0], extras), /Invalid gesture pair leaf claim/);
  assert.deepEqual(claimLeaf(leaves[0]), { accepted: true }); assert.deepEqual(claimLeaf(leaves[0]), { accepted: false }); assert.equal(snapshot().pairDispatchLeafLeaseCount, 2); assert.equal(snapshot().pairDispatchUnclaimedLeafCount, 1); assert.deepEqual(claimGroup(group), { accepted: false });
  assert.deepEqual(claimLeaf(leaves[1]), { accepted: true }); assert.equal(snapshot().pairDispatchUnclaimedLeafCount, 0); assert.equal(snapshot().pairDispatchLeafLeaseCount, 2);
  assert.deepEqual(claimGroup(group), { accepted: true }); clean(); assert.deepEqual(claimGroup(group), { accepted: false }); assert.deepEqual(claimLeaf(leaves[1]), { accepted: false });
  secondCount.value = 2; epoch.value++; test.flush(); const pending = await click(1, 20), receipt = pending.records.find(r => r.phase === 'leafEnded'); assert.ok(receipt); assert.equal(snapshot().pairDispatchLeafLeaseCount, 1); assert.deepEqual(claimLeaf(receipt), { accepted: true });
  epoch.value += 2; test.flush(); await ready(); clean(); assert.deepEqual(claimLeaf(receipt, { token: epoch.value - 2 }), { accepted: false });
  const fresh = await click(1, 650), freshLeaf = fresh.records.find(r => r.phase === 'leafEnded'), freshGroup = fresh.records.find(r => r.phase === 'ended'); assert.ok(freshLeaf.cohort > receipt.cohort); assert.deepEqual(claimGroup(freshGroup), { accepted: false }); assert.deepEqual(claimLeaf(freshLeaf), { accepted: true }); assert.deepEqual(claimGroup(freshGroup), { accepted: true }); clean();
  const target = node(), stable = snapshot().nodes;
  for (const dispatchLeaves of [1, 'true', null]) { assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, dispatchLeaves } }] }), /Invalid layout boolean/); assert.deepEqual(snapshot().nodes, stable); }
  for (const props of [{ ...target.props, traceLeaves: false }, { ...target.props, dispatch: false }]) { assert.throws(() => test.request('commit', { nodes: [{ ...target, props }] }), /Leaf dispatch requires/); assert.deepEqual(snapshot().nodes, stable); }
  test.request('debug.close'); await app; clean(); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0);
  console.log('LEASE_CLEAN');
  console.log('PASS native leaf leases: queued leaves survive group completion, exact single-use path/cohort/arm claims, root dependency gate, claimed-receipt retirement and bounded owner cleanup without activation');
}
