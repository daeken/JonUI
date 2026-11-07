import assert from 'node:assert/strict';
import { Component, State, Text, TextField, VStack, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE, shown = State(true), text = State('value'); let stopped = 0, disposed = 0;
const Owner = Component(scope => {
  const local = scope.state('local'); scope.onDispose(() => { disposed++; console.log('WINDOW_OWNER_DISPOSE'); if (mode === 'cleanup') throw new Error('intentional window cleanup'); });
  if (mode === 'setup') throw new Error('intentional window setup');
  return () => mode === 'duplicate' ? VStack([
    TextField('A', { text: local.binding, focusName: 'same' }), TextField('B', { text: local.binding, focusName: 'same' }),
  ]) : TextField('Owned', { text: local.binding, focusName: 'same' });
});
const Main = Component(scope => {
  const focus = scope.focus();
  return () => Text('Main').window({ isPresented: shown.binding, title: 'Owned failure', width: 400, height: 250,
    content: mode === 'cross' ? TextField('Cross root', { text: text.binding }).focused(focus.binding('invalid')) : Owner() });
});
try {
  const app = runApp({ title: 'Window failure', width: 400, height: 280, content: Main(), onStop: () => { stopped++; console.log('WINDOW_APP_STOP'); } });
  if (mode === 'cleanup') { await new Promise(resolve => setTimeout(resolve, 80)); shown.value = false; }
  await app; assert.fail('Window failure expected');
} catch (error) {
  assert.match(error.message, /Duplicate focus name|share their controller window root|intentional window/);
  assert.equal(stopped, 1); assert.equal(disposed, mode === 'cross' ? 0 : 1); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
  const native = test.request('debug.snapshot'); assert.equal(native.ownedWindowCount, 0); assert.equal(native.liveCells, 0); assert.equal(native.liveViews, 0);
  console.log('WINDOW_FAILURE_CLEANUP'); throw error;
}
