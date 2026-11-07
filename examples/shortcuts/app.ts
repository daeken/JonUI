import { Button, Component, HStack, Text, TextField, Toggle, VStack, runApp } from 'jonui';

const Form = Component(scope => {
  const name = scope.state('Jonathan Swift'), notes = scope.state('Native shortcuts, TS callbacks'), saved = scope.state(0), disabled = scope.state(false), focus = scope.focus();
  return () => VStack([
    Text('Native Command shortcuts').font('headline'),
    TextField('Name', { text: name.binding }).focused(focus.binding('name')),
    TextField('Notes', { text: notes.binding }).focused(focus.binding('notes')),
    HStack([
      Button('Name (⌘1)', () => focus.request('name')).keyboardShortcut('1'),
      Button('Notes (⌘2)', () => focus.request('notes')).keyboardShortcut('2'),
      Button('Save (⌘S)', () => { saved.value++; }).keyboardShortcut('s').disabled(disabled.value),
    ]),
    Toggle('Disable Save', { isOn: disabled.binding }),
    Text(`Saved ${saved.value} times · actual focus: ${focus.actual.value ?? 'none'}`),
    Text('Each shortcut uses SwiftUI’s native Command key equivalent. Close the window to release its handlers.').font('caption'),
  ], { alignment: 'leading', spacing: 14 }).padding(20);
});
await runApp({ title: 'JonUI Button shortcuts', width: 650, height: 300, content: Form() });
