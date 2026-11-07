import { Button, Component, Focus, HStack, State, Text, TextField, View, VStack, runApp } from 'jonui';
import type { FocusWindow } from 'jonui';

const shown = State(false);
let window: FocusWindow | null = null;
const Guarded = Component<{ window: FocusWindow }>((scope, initial) => {
  const focus = scope.focus(null, { window: initial.window }), text = scope.state('Jonathan Swift'), sheet = scope.state(false), sheetText = scope.state('Sheet');
  return () => VStack([
    TextField('Guarded main-window field', { text: text.binding }).focused(focus.binding('name')),
    HStack([
      Button('Request main field', () => focus.request('name')),
      Button('Resume main session', () => focus.resume()),
      Button('Open sheet', () => { sheet.value = true; }),
    ]),
    Text(`Desired: ${focus.desired.value ?? 'none'} · actual: ${focus.actual.value ?? 'none'} · retired: ${focus.retired.value}`).font('caption'),
    Text('After dismissing the sheet, resume then request. This controller stays pinned to the captured main window.').font('caption'),
  ], { alignment: 'leading', spacing: 12 }).sheet({ isPresented: sheet.binding, content: VStack([
    TextField('Independent sheet field', { text: sheetText.binding, focusName: 'sheet' }),
    Button('Try resuming parent controller here', () => { focus.resume(); focus.request('sheet'); }),
    Text(focus.retired.value ? 'Parent controller remains retired in this window.' : 'Parent session has not retired yet.').font('caption'),
    Button('Done', () => { sheet.value = false; }),
  ]).frame({ width: 440, height: 190 }).padding(16) });
});
await runApp({ title: 'JonUI physical focus window guard', width: 720, height: 300, content: VStack([
  Button('Mount a form guarded by this window', () => { if (!shown.value) { window = Focus.captureWindow(); shown.value = window !== null; } }),
  View(() => shown.value && window ? Guarded({ window }) : Text('Capture a mounted window from an action before creating its guarded component.')),
], { alignment: 'leading', spacing: 16 }).padding(20) });
