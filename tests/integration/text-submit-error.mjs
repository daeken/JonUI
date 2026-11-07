import { Component, SecureField, State, runApp, __testing as test } from 'jonui';
const text = State('dummy-only');
const Child = Component(scope => {
  scope.state('owned');
  scope.onDispose(() => console.log('SUBMIT_SCOPE_DISPOSE'));
  return () => SecureField('Dummy submit', { text: text.binding, onSubmit: () => { throw new Error('intentional text submit failure'); } });
});
const app = runApp({ title: 'JonUI text submit error test', width: 400, height: 300, content: Child(), onStop: () => console.log('SUBMIT_STOP') });
setTimeout(() => {
  const field = test.request('debug.snapshot').nodes.find(node => node.kind === 'securefield');
  test.request('debug.submit', { id: field.id });
}, 30);
await app;
