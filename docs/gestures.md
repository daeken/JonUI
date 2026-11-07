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
recognition checks post real AppKit mouse-down/up events to the main and owned
hidden windows, with `JONUI_TEST=1 JONUI_TEST_OFFSCREEN=1 JONUI_TEST_LAYOUT=1`.
The test hosting views accept first mouse because hidden windows never become
key; production retains AppKit's ordinary first-click policy. Tests verify
SwiftUI recognition, rather than invoking its callback directly.

Test layout records are scoped to physical windows, including sheet surfaces.
Their probes never intercept hit-testing and hold no windows or bridge boxes.
The tap driver rejects targets outside the current window, including blocked
parents while a sheet is presented. Native close and logical removal retire the
records; reopen gets fresh state/handlers. Independent roots, current handlers,
disabled content, single/double taps, 20 close/reopen lifetimes and shutdown with
an open root are verified without desktop activation.

Positive pointer recognition in inactive SwiftUI-owned sheets is still a gap:
a probe found the sheet's native window and valid target frame, but queued real
mouse-down/up events produced no tap callback. Physical-window frame scoping does
not resolve that failure; no private delegate/eligibility override is used to
claim it passes. Positive lazy-scroll and competing-control pointer coverage,
location/content-shape/priority contracts and hardware checks remain open. The
separately recorded AppKit sheet-close SIGSEGV also remains unresolved.
