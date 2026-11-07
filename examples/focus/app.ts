import { Button, Focus, HStack, SecureField, State, Text, TextEditor, TextField, Toggle, View, VStack, runApp } from 'jonui';
import type { FocusTarget } from 'jonui';
let saved: FocusTarget | null = null;
let nameTarget: FocusTarget | null = null, secretTarget: FocusTarget | null = null;
const name = State('JonUI'), secret = State(''), notes = State('');
const secretDisabled = State(false);
const status = State('Use Next/Previous, or Return in a single-line field.');
const editing = (label: string) => (active: boolean) => {
  if (active) status.value = `Editing ${label}`;
  else if (status.value === `Editing ${label}`) status.value = 'No text input focused';
};
await runApp({ title: 'JonUI native focus navigation', width: 560, height: 560, content: VStack([
  HStack([Button('Next', Focus.next), Button('Previous', Focus.previous), Button('Clear focus', Focus.clear)]),
  HStack(['name', 'secret', 'notes'].map(target => Button(`Focus ${target}`, () => { status.value = Focus.requestNamed(target) ? `Focused ${target}` : `${target} unavailable`; }))),
  HStack([
    Button('Remember current', () => { saved = Focus.capture(); status.value = saved ? 'Native responder remembered' : 'No eligible responder to remember'; }),
    Button('Restore remembered', () => { status.value = saved && Focus.request(saved) ? 'Native responder restored' : 'Remember a focused control again'; }),
  ]),
  HStack([
    Button('Cycle remembered only', () => { status.value = saved && Focus.setTraversal([saved]) ? 'Next/Previous cycle the remembered control' : 'Remember a focused control again'; }),
    Button('Native traversal', () => { Focus.setTraversal([]); status.value = 'Next/Previous use native order'; }),
  ]),
  Button('Tab between remembered fields', () => {
    if (!nameTarget || !secretTarget) { status.value = 'Press Return once in Name and Demo secret first'; return; }
    try { status.value = Focus.setTraversal([nameTarget, secretTarget], { tabNavigation: true }) ? 'Tab/Shift-Tab cycle the remembered fields' : 'Remember both fields again'; }
    catch { status.value = 'Remember both distinct fields again'; }
  }),
  TextField('Name — Return remembers and advances focus', { text: name.binding, focusName: 'name', onSubmit: () => { saved = nameTarget = Focus.capture(); Focus.next(); }, onEditingChanged: editing('name') }),
  Toggle('Disable demo secret', { isOn: secretDisabled.binding }),
  View(() => SecureField('Demo secret — Return remembers and advances', { text: secret.binding, focusName: 'secret', onSubmit: () => { secretTarget = Focus.capture(); Focus.next(); }, onEditingChanged: editing('demo secret') }).disabled(secretDisabled.value)),
  TextEditor({ text: notes.binding, focusName: 'notes', onEditingChanged: editing('notes') }).frame({ height: 120 }),
  View(() => Text(status.value)),
  View(() => Text(`${name.value}; demo secret length: ${secret.value.length}; notes length: ${notes.value.length}`)),
], { alignment: 'leading', spacing: 12 }).padding(16) });
