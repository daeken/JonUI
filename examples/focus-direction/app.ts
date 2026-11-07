import { Button, DatePicker, Focus, HStack, SecureField, State, Text, TextEditor, TextField, View, VStack, WebView, runApp } from 'jonui';
const name = State('JonUI'), secret = State('demo'), city = State('Chicago'), notes = State('Native notes');
const date = State(Date.UTC(2026, 10, 7)), status = State('Start in the grid, then move to a visible neighbor.');
const cell = { width: 160, height: 80 };
await runApp({ title: 'JonUI directional focus', width: 680, height: 400, content: VStack([
  HStack([
    Button('Start in grid', () => { status.value = Focus.requestNamed('name') ? 'Name focused' : 'Name unavailable'; }),
    ...(['left', 'right', 'up', 'down'] as const).map(direction => Button(direction, () => {
      status.value = Focus.move(direction) ? `Moved ${direction}` : `No visible neighbor ${direction}`;
    })),
  ]),
  VStack([
    HStack([
      TextField('Name', { text: name.binding, focusName: 'name', onSubmit: () => { Focus.move('down'); } }).frame(cell),
      SecureField('Demo secret', { text: secret.binding, focusName: 'secret' }).frame(cell),
      WebView({ html: '<meta charset="utf-8"><input aria-label="Browser input" placeholder="Browser input">', focusName: 'browser' }).frame(cell),
    ], { spacing: 24 }),
    HStack([
      TextField('City', { text: city.binding, focusName: 'city' }).frame(cell),
      DatePicker('Date', { selection: date.binding, components: 'date', style: 'compact', focusName: 'date' }).frame(cell),
      TextEditor({ text: notes.binding, focusName: 'notes' }).frame(cell),
    ], { spacing: 24 }),
  ], { spacing: 24 }),
  View(() => Text(status.value)),
  Text('Text and browser arrow keys keep their normal editing behavior.'),
], { spacing: 18 }).padding(18) });
