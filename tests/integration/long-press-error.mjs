import assert from 'node:assert/strict';
import { Component, Text, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE ?? '';
const fail = () => { if (mode.includes('promise')) return Promise.reject(new Error('consumed long press rejection')); throw new Error('intentional long press failure'); };
const Owner = Component(scope => {
  scope.state(0); scope.onDispose(() => console.log('PRESS_DISPOSE'));
  return () => Text('Hold').frame({ width: 260, height: 80 }).contentShape('rectangle').onLongPressGesture(mode.startsWith('pressing') ? () => {} : fail, { minimumDuration: 0.05, onPressingChanged: value => { if (value && mode === 'close') test.request('debug.close'); if (value && mode.startsWith('pressing')) return fail(); } });
});
const app = runApp({ title: 'Long press failure', width: 400, height: 240, content: Owner(), onStop: () => console.log('PRESS_STOP') });
await new Promise(r => setTimeout(r, 100)); const node = test.request('debug.snapshot').nodes.find(n => n.props.press); test.request('debug.tap', { id: node.id, hold: 0.15, command: true }); await app;

if (mode === 'close') {
  const snapshot = test.request('debug.snapshot'); assert.equal(snapshot.pointerTimerCount, 0); assert.equal(snapshot.liveCells, 0); assert.equal(snapshot.liveViews, 0);
  assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); console.log('PASS shutdown during held native long press');
}
