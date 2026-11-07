import { Button, Component, ForEach, HStack, State, Text, TextEditor, TextField, View, VStack, runApp } from 'jonui';

const name = State('Jonathan Swift'), notes = State(''), sheetValue = State(''), presented = State(false), session = State(0);
const Form = Component(scope => {
  const focus = scope.focus();
  const nameFocus = focus.binding('name'), notesFocus = focus.binding('notes');
  return () => VStack([
    Text('Desired and actual focus').font('headline'),
    TextField('Name — Return requests Notes', { text: name.binding, onSubmit: () => { notesFocus.value = true; } }).focused(nameFocus),
    TextEditor({ text: notes.binding }).frame({ height: 120 }).focused(notesFocus),
    HStack([
      Button('Request Name', () => { nameFocus.value = true; }),
      Button('Request Notes', () => { notesFocus.value = true; }),
      Button('Clear', () => focus.request(null)),
      Button('Resume here', () => focus.resume()),
    ]),
    Text(`Desired: ${focus.desired.value ?? 'none'}; actual: ${focus.actual.value ?? 'none'}`).font('caption'),
    Text(focus.retired.value ? 'This focus session ended. Resume here to keep its intent and form values.' : 'Tab or click to change actual focus without changing the request.').font('caption'),
  ], { alignment: 'leading', spacing: 12 });
});

await runApp({ title: 'JonUI owned focus controller', width: 620, height: 420, content: View(() => VStack([
  ForEach([session.value], { id: id => id }, () => Form()),
  HStack([
    Button('Open sheet', () => { presented.value = true; }),
    Button('Reset focus session', () => { session.value++; }),
  ]),
  Text('Resume binds the current window without replaying the old request. Reset also starts a new component.').font('caption'),
], { alignment: 'leading', spacing: 12 }).padding(20).sheet({ isPresented: presented.binding, content: VStack([
  Text('Independent sheet focus').font('headline'),
  TextField('Sheet field', { text: sheetValue.binding, focusName: 'sheet' }),
  Button('Done', () => { presented.value = false; }),
], { spacing: 12 }).frame({ width: 360, height: 160 }).padding(20) })) });
