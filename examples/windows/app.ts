import { Button, Component, HStack, State, Text, TextField, Toggle, VStack, runApp } from 'jonui';

const first = State(false), second = State(false), shared = State('Shared app data');
const Editor = Component<{ name: string }>((scope, initial) => {
  const local = scope.state('Local to this opening'), count = scope.state(0), focus = scope.focus('input');
  return () => VStack([
    Text(initial.name).font('headline'),
    TextField('Local note', { text: local.binding }).focused(focus.binding('input')),
    TextField('Shared app data', { text: shared.binding }),
    HStack([
      Button(`Count: ${count.value}`, () => { count.value++; }),
      Button('Resume and focus here', () => { focus.resume(); focus.request('input'); }),
    ]),
    Text(focus.retired.value ? 'Focus session retired; resume explicitly.' : 'Active root focus session.').font('caption'),
    Text('Closing disposes local state; reopening starts fresh. Shared app data stays.').font('caption'),
  ], { alignment: 'leading', spacing: 12 }).padding(20);
});
await runApp({ title: 'JonUI owned windows', width: 520, height: 230, content: VStack([
  Text('Independent owned roots').font('headline'),
  Toggle('First editor', { isOn: first.binding }), Toggle('Second editor', { isOn: second.binding }),
  TextField('Shared app data', { text: shared.binding }),
], { alignment: 'leading', spacing: 12 }).padding(20)
  .window({ isPresented: first.binding, title: 'First editor', width: 520, height: 260, content: Editor({ name: 'First editor' }) })
  .window({ isPresented: second.binding, title: 'Second editor', width: 520, height: 260, content: Editor({ name: 'Second editor' }) }) });
