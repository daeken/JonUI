import { Component, Focus, Text, runApp } from 'jonui';
const Owner = Component(scope => {
  scope.state('owned'); scope.onDispose(() => console.log('AVAILABILITY_DISPOSE'));
  const mode = process.env.JONUI_CASE ?? 'throw', subscribe = mode.startsWith('owned') ? scope.focus().subscribeAvailability : Focus.subscribeAvailability;
  scope.effect(() => subscribe('missing', () => {
    if (mode.endsWith('promise')) return Promise.reject(new Error('consumed availability rejection'));
    throw new Error('intentional availability listener failure');
  }));
  return () => Text('availability listener failure');
});
await runApp({ title: 'JonUI availability listener failure', width: 400, height: 200, content: Owner(), onStop: () => console.log('AVAILABILITY_STOP') });
