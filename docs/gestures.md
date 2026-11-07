# Native taps

`view.onTapGesture(callback, { count: 1 | 2 })` attaches SwiftUI's native
`TapGesture`. Count defaults to 1. Use it for native content, for example:

```ts
Text(`Selected ${selected.value} times`)
  .padding(16)
  .onTapGesture(() => { selected.value++; });
```

Callbacks run synchronously in Node, outside reactive tracking and cancellable
task context. They can write State; start asynchronous work with `scope.task`.
A thrown error or returned Promise stops the app through normal owner cleanup.
Handlers and functions stay in Node; only count and an owned token cross the
bridge. Ordinary property updates and keyed reorder retain the token and call
the latest handler. Changing count retires the token; removal, window close and
app disposal retire the owner. Events for old tokens/counts/owners are discarded.

Disabled content and disabled ancestors suppress recognition. The modifier uses
SwiftUI's ordinary gesture mask/priority and content hit-testing; padding or a
frame alone does not promise an opaque rectangular hit region. Single and double
taps on the same content, interactions with Button/ScrollView/WebView, location
payloads, explicit gesture composition/priority, long press/drag/magnification and
animation/transition APIs are not part of this initial contract.

Run `bin/jonui examples/gestures/app.ts` to try single and double taps. Automated
recognition checks post real AppKit mouse-down/up events to the main hidden
window, with `JONUI_TEST=1 JONUI_TEST_OFFSCREEN=1 JONUI_TEST_LAYOUT=1`.
The test hosting view accepts first mouse because hidden windows never become
key; production retains AppKit's ordinary first-click policy. Tests verify
SwiftUI recognition, rather than invoking its callback directly. Positive
pointer coverage for sheets, independent roots, lazy scrolling and competing
controls remains to be added.
