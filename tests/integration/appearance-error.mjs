import assert from 'node:assert/strict';
import { Component, State, Text, View, VStack, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE, presented = State(true); let disposed = 0, stopped = 0;
const cleanup = [];
const Child = Component(scope => { scope.state('child'); scope.onDispose(() => { cleanup.push('child'); console.log('APPEARANCE_CHILD_DISPOSE'); }); return () => Text('partial child').onAppear(() => {}).onDisappear(() => {}); });
const Owner = Component(scope => {
  scope.state('owned'); scope.onDispose(() => { if (mode === 'startup') assert.deepEqual(cleanup, ['child']); disposed++; console.log('APPEARANCE_DISPOSE'); });
  const fail = () => { if (mode === 'promise') return Promise.reject(new Error('consumed appearance rejection')); throw new Error('intentional appearance failure'); };
  if (mode === 'startup') return () => VStack([Child(), View(() => { throw new Error('appearance startup failure'); })]);
  return () => mode === 'disappear' ? Text('anchor').sheet({ isPresented: presented.binding, content: Text('sheet').frame({ width: 300, height: 120 }).onDisappear(fail) }) : Text('body').onAppear(fail);
});
const app = runApp({ title: 'JonUI appearance failure cleanup', width: 400, height: 250, content: Owner(), onStop: () => { stopped++; console.log('APPEARANCE_STOP'); } });
app.catch(() => {});
if (mode === 'disappear') {
  while (!test.request('debug.focusContext').sheet) await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 30)); presented.value = false;
}
try { await app; assert.fail('Appearance failure must reject'); }
catch (error) {
  // Callback failures stop the embedded runtime immediately; their synchronous
  // onStop/onDispose markers are checked by the outer process, as for actions.
  if (mode !== 'startup') throw error;
  assert.match(error.message, mode === 'startup' ? /appearance startup failure/ : mode === 'promise' ? /must be synchronous/ : /intentional appearance failure/);
  assert.equal(disposed, 1); assert.equal(stopped, 1); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
  const native = test.request('debug.snapshot'); assert.equal(native.liveCells, 0); assert.equal(native.liveViews, 0); console.log('APPEARANCE_FAILURE_CLEANUP'); throw error;
}
