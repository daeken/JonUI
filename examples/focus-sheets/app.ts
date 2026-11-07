import { Button, Component, Focus, HStack, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp } from 'jonui';
import type { FocusTarget } from 'jonui';
const presented = State(false), mainName = State('Jonathan Swift');
const Sheet = Component(scope => {
  const name = scope.state(''), secret = scope.state(''), notes = scope.state('');
  const status = scope.state('Return remembers a field and advances inside this sheet.');
  let saved: FocusTarget | null = null;
  const rememberAndNext = () => { saved = Focus.capture(); Focus.next(); };
  return () => VStack([
    Text('Focus stays in the open sheet').font('headline'),
    TextField('Name — Return advances', { text: name.binding, onSubmit: rememberAndNext }),
    SecureField('Demo secret — Return advances', { text: secret.binding, onSubmit: rememberAndNext }),
    TextEditor({ text: notes.binding }).frame({ height: 110 }),
    HStack([Button('Previous', Focus.previous), Button('Next', Focus.next), Button('Clear', Focus.clear)]),
    HStack([
      Button('Restore remembered', () => { status.value = saved && Focus.request(saved) ? 'Responder restored' : 'Press Return to remember a field again'; }),
      Button('Cycle remembered', () => { status.value = saved && Focus.setTraversal([saved]) ? 'Next/Previous cycle the remembered field' : 'Remember a field again'; }),
      Button('Native order', () => { Focus.setTraversal([]); status.value = 'Native commands and Tab order'; }),
    ]),
    Text(status.value).font('caption'),
    Text(`${name.value}; demo secret length: ${secret.value.length}; notes length: ${notes.value.length}`).font('caption'),
    Button('Done', () => { presented.value = false; }),
  ], { alignment: 'leading', spacing: 12 }).frame({ width: 520, height: 390 }).padding(20);
});
await runApp({ title: 'JonUI sheet focus', width: 600, height: 260, content: VStack([
  Text('Main window').font('title'),
  TextField('Main name', { text: mainName.binding }),
  Button('Next in active window', Focus.next),
  Button('Open sheet', () => { presented.value = true; }),
  Text('The sheet keeps native Tab; its command cycle controls Next/Previous.').font('caption'),
], { alignment: 'leading', spacing: 12 }).padding(20).sheet({ isPresented: presented.binding, content: Sheet() }) });
