import { Component, TextEditor, runApp, __testing as test } from 'jonui';
const Child = Component(scope => {
  const text = scope.state('dummy');
  scope.onDispose(() => console.log('EDITING_SCOPE_DISPOSE'));
  return () => TextEditor({ text: text.binding, onEditingChanged: () => { throw new Error('intentional text editing failure'); } });
});
const app = runApp({ title: 'JonUI editing failure', width: 400, height: 300, content: Child(), onStop: () => console.log('EDITING_STOP') });
setTimeout(() => test.request('debug.focus', { editor: 0 }), 100);
await app;
