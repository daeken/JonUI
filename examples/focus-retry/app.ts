import { Button, Component, HStack, Text, TextField, Toggle, VStack, runApp } from 'jonui';

const Panel = Component(scope => {
  const focus = scope.focus(), blocked = scope.state(true), text = scope.state('Jonathan Swift'), other = scope.state('Try moving here');
  const message = scope.state('Disable the target, request focus, then enable it.'), sheet = scope.state(false);
  let cancel = () => {};
  return () => VStack([
    Text('Retry retained focus once ready').font('headline'),
    Toggle('Disable target', { isOn: blocked.binding }),
    TextField('Target', { text: text.binding }).focused(focus.binding('target')).disabled(blocked.value),
    TextField('Another field (cancels waiting retry)', { text: other.binding }),
    HStack([
      Button('Request + arm retry', () => {
        focus.request('target'); cancel = focus.retryWhenReady(); message.value = 'Armed once. Enable the target, or move to another field to cancel.';
      }),
      Button('Cancel retry', () => { cancel(); message.value = 'Retry canceled; desired intent is retained.'; }),
      Button('Open sheet', () => { sheet.value = true; }),
      Button('Resume + rearm', () => { focus.resume(); cancel = focus.retryWhenReady(); message.value = 'New session; retained intent explicitly rearmed.'; }),
    ]),
    Text(`Desired: ${focus.desired.value ?? 'none'} · actual: ${focus.actual.value ?? 'unnamed/none'} · retired: ${focus.retired.value}`),
    Text(message.value).font('caption'),
    Text('One attempt, no polling or scrolling. Session changes cancel it; resume requires a fresh arm.').font('caption'),
  ], { alignment: 'leading', spacing: 12 }).padding(20).sheet({ isPresented: sheet.binding, content: VStack([
    Text('The sheet retires the parent focus session.'), Button('Done', () => { sheet.value = false; }),
  ]).frame({ width: 360, height: 140 }).padding(16) });
});
await runApp({ title: 'JonUI one-shot focus retry', width: 820, height: 340, content: Panel() });
