import assert from 'node:assert/strict';
import { Component, TapGesture, Text, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE ?? '';
const Owner = Component(scope => {
  scope.state(0); scope.onDispose(() => console.log('LEAF_DISPOSE'));
  return () => test.gesturePair(Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle'), TapGesture().onEnded(() => {
    if (mode === 'close') { test.request('debug.close'); return; }
    if (mode === 'promise') return Promise.reject(new Error('consumed leaf failure'));
    throw new Error('intentional pair leaf failure');
  }), TapGesture({ count: mode === 'close' ? 2 : 1 }).onEnded(() => assert.fail('retired leaf ran')), () => assert.fail('retired group ran'));
});
const app = runApp({ title: 'Pair leaf failure', width: 400, height: 240, content: Owner(), onStop: () => console.log('LEAF_STOP') });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let i = 0; i < 1000 && test.pairStats().armed !== 1; i++) await sleep(10);
assert.equal(test.pairStats().armed, 1); const node = test.request('debug.snapshot').nodes.find(n => n.props.dispatchLeaves);
test.request('debug.tap', { id: node.id, command: true, hold: mode === 'held-close' ? 0.2 : 0 });
if (mode === 'held-close') {
  let began = false; for (let i = 0; i < 1000; i++) { if (test.request('debug.pairTrace', { id: node.id }).records.some(r => r.phase === 'began')) { began = true; break; } await sleep(5); }
  assert.ok(began); test.request('debug.close');
}
function verifyCleanup() {
  const s = test.request('debug.snapshot'); for (const key of ['liveViews', 'liveCells', 'pointerTimerCount', 'pairDispatchLeafLeaseCount', 'pairDispatchUnclaimedLeafCount', 'pairDispatchDependencyCount', 'pairDispatchPendingCount', 'pairProbeCohortOwners']) assert.equal(s[key], 0, key);
  assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); console.log('LEAF_CLEAN');
}
await app;
if (mode.endsWith('close')) {
  verifyCleanup(); console.log(`PASS ${mode} disposes leaf leases and suppresses queued sibling/group callbacks`);
}
