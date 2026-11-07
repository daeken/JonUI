import assert from 'node:assert/strict';
import { LongPressGesture, Component, Text, runApp, __testing as test } from 'jonui';
const rawMode = process.env.JONUI_CASE ?? '', priority = rawMode.startsWith('simultaneous-') ? 'simultaneous' : 'normal';
const mode = rawMode.replace(/^simultaneous-/, '');
const fail = () => { if (mode.includes('promise')) return Promise.reject(new Error('consumed long press rejection')); throw new Error('intentional long press failure'); };
const Owner = Component(scope => {
  scope.state(0); const pressing = scope.gestureState(); scope.onDispose(() => { assert.equal(pressing.value, false); console.log('PRESS_DISPOSE'); });
  return () => Text('Hold').frame({ width: 260, height: 80 }).contentShape('rectangle').gesture(LongPressGesture({ pressing, minimumDuration: 0.05, onPressingChanged: value => { if (value && mode === 'close') test.request('debug.close'); if (value && mode.startsWith('pressing')) return fail(); } }).onEnded(mode.startsWith('pressing') ? () => {} : fail), { priority: priority });
});
const app = runApp({ title: 'Long press failure', width: 400, height: 240, content: Owner(), onStop: () => console.log('PRESS_STOP') });
await new Promise(r => setTimeout(r, 100)); const node = test.request('debug.snapshot').nodes.find(n => n.props.press); test.request('debug.tap', { id: node.id, hold: 0.15, command: true }); await app;

if (mode === 'close') {
  const snapshot = test.request('debug.snapshot'); assert.equal(snapshot.pointerTimerCount, 0); assert.equal(snapshot.liveCells, 0); assert.equal(snapshot.liveViews, 0);
  assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(test.gestureStats().active, 0); console.log('PASS shutdown during held native long press');
}
