# Owned windows

`view.window(options)` keeps the original view in place and presents independent
content in an owned native window while its boolean binding is true:

```ts
const presented = State(false);
const Editor = Component(scope => {
  const note = scope.state('A fresh note');
  return () => TextField('Note', { text: note.binding, focusName: 'input' });
});
Button('Open editor', () => { presented.value = true; }).window({
  isPresented: presented.binding, title: 'Editor', width: 520, height: 300,
  content: Editor(),
});
```

Options are copied. Title must be a string; dimensions must be positive finite
numbers. Width/height set initial content size on each opening; later renders
preserve user geometry. Title changes update the existing window. Each modifier
owns one window, preserving logical identity through property updates/keyed reorder.
Chaining modifiers can present independent sibling roots. Replacing a window
boundary with another view/modifier is structural and ends its scopes; restoring
the boundary creates fresh ownership.

## State and lifetime

Content scopes mount only while presented. Setting false or native closing
disposes components, effects, tasks, focus sessions, adapters and WebView requests.
The close button writes false through the presentation binding; Node cleanup
follows through the event queue. Native adapters/documents retire immediately on
close. The original view and sibling windows keep running. Reopening mounts fresh
local state. Explicitly shared app-owned State survives individual windows.
Constructing a component View description does not run setup before presentation.
The close event unmounts content before notifying presentation subscribers, so an
immediate subscriber-driven reopen also starts fresh. Ordinary false/true writes
coalesced before reconciliation need not produce a physical close.

Removing the modifier/owner closes its window. Nested owned windows end when
parent content is disposed. Closing the launcher window or Quit ends the whole
app, invokes onStop once and disposes all roots. Errors retain the app-wide failure
policy; use a View fallback for local recovery. Cleanup errors attempt remaining
cleanup before app shutdown. Guaranteed resource cleanup belongs in scope.onDispose
and scoped tasks, rather than appearance callbacks.

Each root has its own native hosting view. Apply environment-dependent modifiers
such as fonts, padding and disabled **inside content**; the original view's
surrounding environment is not implicitly copied to the independent root.
Sheets inside content belong to that root's native window and lifetime.

## Focus and events

Names are unique within a logical root, including its sheets. Independent roots
can both register `input`; two controls within one root cannot. Names retain exact
UTF-8 identity. A transaction cannot share one native view handle between roots.

Global Focus operations use the current owned key window/deepest sheet, or the
last selected owned root when inactive. Query/request operations do not activate
the app. Offscreen tests select a root with a test-only hook while all native
windows and sheets remain transparent and non-key.

Focus controllers belong to their component's logical root. Activation/resume,
owned subscription delivery and native request stamps enforce that root. Projected
views must share it, even across otherwise valid logical ancestry. Construct
controllers inside window content components. Optional [physical guards](focus.md#physical-window-guards)
apply in addition to logical root ownership.

Switching roots retires focus sessions; explicitly resume on return, without
replaying old intent. Owned availability snapshots inspect their own root and may
report inactiveWindow while a sibling's same name is ready. Global availability
subscriptions follow the active root namespace and coalesce equal statuses.
Public focus observers still deliver names only, so switching between identically
named responders need not deliver a callback.

Application traversal routing accepts only the current owned window/sheet's
events. Captures and the explicit Tab cycle remain context-scoped and retire on
root/context/structural changes. Persistent per-window traversal history and
automatic resumption are not provided.

Try `bin/jonui examples/windows/app.ts` for two editors sharing app data. Tests
cover independent state/names, native edits, application Tab routing, auxiliary
sheets, nested close, pending task/RPC cancellation, fresh reopen state, 20 lifetimes,
app shutdown with an open root, malformed/shared-root transactions and failure
cleanup. Native automation runs offscreen.

Scene-based WindowGroup, user scene IDs, restoration, ordering/activation APIs,
menus/commands, windows outliving their logical owner, persistent focus history
and richer reopen/last-window policies remain future work.
