import assert from 'node:assert/strict';
import { Component, TapGesture, Text, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE ?? '';
const Owner = Component(scope => {
  scope.state(0); scope.onDispose(() => console.log('PAIR_DISPOSE'));
  return () => test.gesturePair(Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle'), TapGesture(), TapGesture(), () => {
    if (mode === 'promise') return Promise.reject(new Error('consumed pair rejection'));
    throw new Error('intentional pair failure');
  });
});
const app = runApp({ title: 'Pair failure', width: 400, height: 240, content: Owner(), onStop: () => console.log('PAIR_STOP') });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let i = 0; i < 1000 && test.pairStats().armed !== 1; i++) await sleep(10);
assert.equal(test.pairStats().armed, 1); const node = test.request('debug.snapshot').nodes.find(n => n.props.dispatch);
test.request('debug.tap', { id: node.id, hold: mode === 'close' ? 0.2 : 0, command: true });
if (mode === 'close') {
  let began = false;
  for (let i = 0; i < 1000; i++) { if (test.request('debug.pairTrace', { id: node.id }).records.some(r => r.phase === 'began')) { began = true; break; } await sleep(5); }
  assert.ok(began, 'shutdown test must observe a real native pointer-down');
  test.request('debug.close');
}
await app;
if (mode === 'close') {
  const s = test.request('debug.snapshot'); for (const key of ['liveCells', 'liveViews', 'pointerTimerCount', 'pairDispatchArmOwners', 'pairDispatchPendingCount']) assert.equal(s[key], 0);
  assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.deepEqual(test.pairStats(), { active: 0, armed: 0 }); console.log('PASS shutdown during held pair');
}
