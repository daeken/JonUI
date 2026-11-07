# Native taps

`view.onTapGesture(callback, { count: 1 | 2, priority: "normal" | "high" | "simultaneous" })`
attaches SwiftUI's native `TapGesture`. Count defaults to 1 and priority to "normal". Use it for native content, for example:

```ts
Text(`Selected ${selected.value} times`)
  .padding(16)
  .onTapGesture(() => { selected.value++; });
```

Callbacks run synchronously in Node, outside reactive tracking and cancellable
task context. They can write State; start asynchronous work with `scope.task`.
A thrown error or returned Promise stops the app through normal owner cleanup.
Handlers and functions stay in Node; only count, priority and an owned token cross
the bridge. Ordinary property updates and keyed reorder retain the token and call
the latest handler. Changing count or priority retires the token. Removal, window
close and app disposal retire the owner. Events for old tokens/counts/owners are discarded.

A disabled environment at the gesture modifier suppresses recognition. Disable
an ancestor or apply `.disabled(true)` outside the tap modifier to disable it;
modifier order follows native SwiftUI environment semantics. Priority maps to
SwiftUI's gesture APIs:

| Priority | Native behavior | Verified Button / Toggle / nested tap result |
| --- | --- | --- |
| `normal` | `gesture` | Button action or Toggle binding update; inner tap wins over outer tap. |
| `high` | `highPriorityGesture` | Outer tap wins; Button action, Toggle update or inner tap is suppressed. |
| `simultaneous` | `simultaneousGesture` | Both outer tap and Button action, Toggle update or inner tap run. |

These outcomes are verified for ordinary Button/Toggle controls and nested taps
with real native Command-clicks in the current SDK. They are not a universal
priority guarantee for AppKit-backed controls, browser documents, scrolling/drag
recognizers or every gesture combination. Simultaneous callbacks have no promised
relative order. One stable native modifier structure preserves control identity
when priority changes; inactive wrappers pass subview gestures through. A native
text field's captured focus target survives priority changes and keyed reorder.

For example, observe a Button while allowing its action to run:

```ts
Button('Apply', apply)
  .onTapGesture(() => { observations.value++; }, { priority: 'simultaneous' });
```

Content hit-testing remains native; padding or a frame alone does not promise an
opaque rectangular region. Gesture masks and general sequential/exclusive
composition, different-count competition on the same content, browser/scroll
interoperability, location payloads, long press/drag/magnification and animation/
transition APIs remain open.

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

Lazy VStack/HStack and VGrid/HGrid recognition is verified after native scrolling
using explicit **Command-click** events. The same background interaction verifies
single/double taps, current callbacks and State writes inside a SwiftUI-owned
sheet. `command: true` belongs only to the internal native test driver; it is not
an `onTapGesture` option or modifier filter. These are real native gesture events;
tests neither activate the app nor override framework descendants' eligibility.

The driver checks the target center against the native window content bounds
and every ancestor ScrollView viewport. It rejects a partially realized row whose
center is clipped, even when that coordinate is still within the window. It does
not promise pixel-level visibility, opaque content shapes or freedom from
occlusion. Each lazy variant verifies partial native realization with eager
logical owners, retained local State/current tokens across keyed reorder and
scrolling, count changes, offscreen logical removal and 20 owner lifetimes.

Ordinary unmodified first-mouse delivery to inactive scroll descendants and
SwiftUI-owned sheets remains unverified: the unmodified lazy probe produced no
callback, while Command-clicks passed. Active-window/hardware checks are still
needed for that path. Broader control/browser/scroll gesture interoperability, location/content-shape/
gesture-mask contracts and the separately recorded AppKit sheet-close SIGSEGV
also remain open.
