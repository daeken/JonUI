import { Component, Text, VStack, runApp, __testing as test } from 'jonui';
const Child = Component((scope, name) => {
  scope.state(name);
  scope.onDispose(() => { console.log(`CLEANUP_${name}`); if (name === 'a') throw new Error('intentional component cleanup failure'); });
  return () => Text(name);
});
const app = runApp({ title: 'Component cleanup failure', width: 400, height: 300,
  content: VStack([Child('a'), Child('b')]),
});
test.request('debug.close');
await app;
