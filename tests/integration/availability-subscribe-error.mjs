import { Component, Focus, Text, runApp } from 'jonui';
const Owner = Component(scope => {
  scope.state('owned'); scope.onDispose(() => console.log('AVAILABILITY_DISPOSE'));
  scope.effect(() => Focus.subscribeAvailability('missing', () => {
    if (process.env.JONUI_CASE === 'promise') return Promise.reject(new Error('consumed availability rejection'));
    throw new Error('intentional availability listener failure');
  }));
  return () => Text('availability listener failure');
});
await runApp({ title: 'JonUI availability listener failure', width: 400, height: 200, content: Owner(), onStop: () => console.log('AVAILABILITY_STOP') });
