import { Button, Component, Focus, HStack, State, Text, TextField, Toggle, VStack, runApp } from 'jonui';
import type { FocusAvailability } from 'jonui';

const Panel = Component(scope => {
  const watching = scope.state(true), present = scope.state(true), blocked = scope.state(false), sheet = scope.state(false);
  const text = scope.state('Jonathan Swift'), sheetText = scope.state('Sheet'), status = scope.state<FocusAvailability | 'not watching'>('not watching');
  const result = scope.state('No focus request yet');
  scope.effect(() => {
    if (!watching.value) { status.value = 'not watching'; return; }
    return Focus.subscribeAvailability('search', value => { status.value = value; });
  });
  return () => VStack([
    Text('Watch native focus availability').font('headline'),
    HStack([Toggle('Watch', { isOn: watching.binding }), Toggle('Show target', { isOn: present.binding }), Toggle('Disable target', { isOn: blocked.binding })]),
    present.value ? TextField('Search', { text: text.binding, focusName: 'search' }).disabled(blocked.value) : Text('Target removed'),
    Text(`Availability: ${status.value}`),
    HStack([
      Button('Request focus', () => { result.value = Focus.requestNamed('search') ? 'Focus accepted' : 'Target unavailable or refused focus'; }),
      Button('Open sheet', () => { sheet.value = true; }),
    ]),
    Text(result.value).font('caption'),
    Text('Notifications update the status without requesting focus. Watch off releases the subscription.').font('caption'),
  ], { alignment: 'leading', spacing: 12 }).padding(20).sheet({ isPresented: sheet.binding, content: VStack([
    TextField('Sheet', { text: sheetText.binding, focusName: 'sheet' }), Button('Done', () => { sheet.value = false; }),
  ]).frame({ width: 320, height: 160 }).padding(16) });
});
await runApp({ title: 'JonUI availability subscriptions', width: 650, height: 330, content: Panel() });
