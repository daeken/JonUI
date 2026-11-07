# Native gestures

`view.onTapGesture(callback, { count: 1 | 2, priority: "normal" | "high" | "simultaneous" })`
attaches SwiftUI's native `TapGesture`. Count defaults to 1 and priority to "normal".
Use it for native content, for example:

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
close and app disposal retire the owner. Events for old tokens/counts/owners are
discarded.

`view.onSpatialTapGesture(point => …, options)` recognizes native spatial taps
and delivers a `TapLocation`: a frozen `{ x, y }` snapshot in local SwiftUI logical
points. It supports the same single/double count and priority options. Coordinates
start at the top-left of the content at the gesture modifier; x increases to the
right and y downward. Sizing and padding applied before the gesture belong to
that coordinate space; padding added outside the gesture does not.

```ts
const point = scope.state({ x: 0, y: 0 });
Text('Pick a point')
  .frame({ width: 200, height: 80 })
  .padding({ top: 12, leading: 20, bottom: 8, trailing: 10 })
  .contentShape('rectangle')
  .onSpatialTapGesture(location => { point.value = location; });
```

The example's gesture bounds are 230 × 100 points. A click at 20% across and 30%
down yields `{ x: 46, y: 30 }`. Coordinates are captured by native recognition,
then queued to Node; later resizing, scrolling or pointer motion does not change
the snapshot. Node validates finite numeric coordinates and freezes a fresh
object. It does not clamp coordinates or add a State cell. Callbacks run
synchronously outside reactive/task tracking, can replace State with the point,
and use the normal error/Promise cleanup path.

`onTapGesture` continues calling its handler without arguments. Switching between
ordinary and spatial modifiers retires the old token, as do count/priority
changes. Property updates retain current handlers; native/Node mode, owner,
count and token checks reject stale events, and malformed location payloads are
discarded. Named/global coordinate spaces, input-kind filtering, event phases,
3D spatial events and general coordinate conversions remain open. The installed
SDK declares SpatialTapGesture available since macOS 13; JonUI targets macOS 14+.

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

`view.contentShape("rectangle" | "circle" | "ellipse" | "capsule")` sets the
native **interaction** region. It neither draws nor clips content and does not
change layout. Rectangle covers its bounds; Circle, Ellipse and Capsule use
SwiftUI's own paths. Apply sizing first, then the shape, then the gesture:

```ts
Text('Select')
  .frame({ width: 260, height: 100 })
  .contentShape('rectangle')
  .onTapGesture(select);
```

This makes the transparent framed margin tappable. Applying contentShape before
the frame keeps the interaction region at the smaller content size. Native
margin/corner tests distinguish rectangular and curved regions and verify this
modifier order. Changing shape preserves layout, keyed local State, the outer
tap token/current handler and a captured native text-field focus target. No new
callback registration, binding cell or observer is needed. Disabling an ancestor
still suppresses taps. The demo changes shape at runtime.

Only interaction regions and these four primitive paths are supported. General
Shape drawing/fill/stroke, custom paths, rounded-rectangle parameters, even-odd
fill, preview/hover kinds, browser/AppKit hit-test interop, gesture masks and
sequential/exclusive composition, different-count competition, global/named coordinates,
drag/magnification and animation/transition APIs remain open. Content
shapes do not promise occlusion detection or that an arbitrary NSView/WebView
will adopt SwiftUI's hit region.

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

The driver checks the requested point (center by default) against native window
content bounds and every ancestor ScrollView viewport. Internal `at: { x, y }`
fractions select test points within the target frame. They are separate from
the public local-point snapshots delivered by onSpatialTapGesture. A clipped center or edge is rejected even when that coordinate is
still inside the window. Rectangular-margin Command-clicks pass in all four
lazy variants, including rejection of a clipped edge while the center is visible.
The driver does not detect occlusion or pixel-level visibility. Each lazy variant
verifies partial native realization with eager logical owners, retained local
State/current tokens across keyed reorder and scrolling, count changes,
offscreen logical removal and 20 owner lifetimes.

Ordinary unmodified first-mouse delivery to inactive scroll descendants and
SwiftUI-owned sheets remains unverified: the unmodified lazy probe produced no
callback, while Command-clicks passed. Active-window/hardware checks are still
needed for that path. Broader control/browser/scroll gesture interoperability,
broader coordinate spaces, general shape/gesture-mask contracts and the recorded
AppKit sheet-close SIGSEGV also remain open.

Spatial snapshots are verified with actual Command-clicks in main, owned and sheet
windows and after scrolling all four lazy layouts. Tests cover asymmetric
padding/order, resize, count/priority/mode token retirement, stable field focus,
current callbacks/State, invalid payloads, native close, callback failures and 20
owner lifetimes. Spatial priority tests also cover Button/Toggle/nested gesture
competition. These results retain the inactive unmodified-pointer and hardware
limits described above.

## Long press

`view.onLongPressGesture(action, options)` calls `action()` when SwiftUI recognizes
a held press. Options are `minimumDuration` (seconds, default 0.5),
`maximumDistance` (local logical points, default 10), `priority` (`normal` or
`simultaneous`, default `normal`), and an optional synchronous
`onPressingChanged(boolean)` observer. Duration and distance must be finite and
nonnegative. Normal recognition lets native controls or a descendant long press
win; the outer pressing observer still follows the press. Simultaneous recognition
allows the long-press action together with a Button action, Toggle binding update
or descendant long press. Early release still permits ordinary control actions
without performing the long press. There is no ordering guarantee between separate
control/gesture callbacks. High-priority long presses, input kinds and event
locations remain unsupported.

```ts
const count = scope.state(0), pressing = scope.state(false);
Text(`Recognized ${count.value} times`)
  .frame({ width: 260, height: 80 })
  .contentShape('rectangle')
  .onLongPressGesture(() => { count.value++; }, {
    minimumDuration: 0.5,
    maximumDistance: 10,
    onPressingChanged: value => { pressing.value = value; },
  });
```

Recognition occurs when the duration threshold is met and can run while the
mouse is still down. The native pressing observer reports true at the start and
false when the native press ends or cancels. Early release or excessive movement
cancels recognition without running the action. Small movement within the distance
limit can still recognize. Disabling an ancestor prevents the action; false
notifications may still clear an ongoing press. These phases are verified with
real held Command-mouse events, not a Node timer invoking the gesture callback.

Action and pressing callbacks share one owned configuration token, stay in Node,
run untracked outside task context, and must be synchronous. Throwing or returning
a Promise stops/disposes the app. Current handler changes retain the token.
Duration/distance/priority changes or adding/removing the observer retire it. Native state
captures the starting token, so an old countdown cannot complete through a newer
handler/configuration. Logical removal/close retires callbacks and drops late
events. Native disappearance also clears the pending recognition token, even
when a lazy row or sheet keeps its logical owner alive. A press from the old
presentation cannot perform after disappearance; a fresh visible press captures
the current token again. Logical State and callback identity survive this native
hide/show cycle.

Pressing notifications are not a GestureState binding or a guaranteed cleanup
hook. Configuration replacement and logical retirement discard old notifications,
including a possible final false; reset any shared external flag when you
reconfigure and use `scope.onDispose` for guaranteed owner cleanup. Native lazy
visibility and other controls may also affect recognition. Native disappearance
does not synthesize an observer notification. Explicit cancellation reasons,
automatic transient-state reset, high priority/general composition, partially clipped but still
realized targets, occlusion and broader control interoperability remain open.
No ordering guarantee is added beyond the native phase stream.

Main-window automation covers threshold timing, early release, movement
cancellation, zero thresholds, current handlers/configuration epochs, native field
identity, disabling/removal during a hold and 20 lifetimes. Held test pointers use
main-run-loop release/move timers; teardown balances mouse-up and invalidates them.
Callback failures must exit with status 1, and shutdown while held must exit cleanly,
so crashes cannot masquerade as expected failure in those gates. This test-only
infrastructure adds no production timer.

Owned-window/sheet automation verifies actual held recognition, early-release and
movement cancellation, cross-root target rejection, current handlers and native
close during a hold. Dismissing a sheet cancels its pending recognition while
retaining logical State/token; showing it again accepts a fresh press. All four
lazy layouts verify cancellation when scrolling a held row out of native
realization, retained State/token and fresh reappearance, held logical removal,
and 20 lifetimes each. These are native-disappearance guarantees, not a general
pixel/occlusion visibility test. Unmodified inactive delivery and hardware checks
remain open.

Normal and simultaneous modes use stable native modifier types, preserving a
captured field target through priority changes and keyed reordering. The native
convenience modifier continues to own pressing notifications; an additional native
simultaneous recognizer handles that mode's action. A zero-duration recognition
can precede the native pressing start, so it waits for that start to capture its
configuration token. No production timer or additional bridge registration is
added.

High-priority composition is blocked by a concrete native prototype failure:
`highPriorityGesture(LongPressGesture)` plus a simultaneous pressing observer
recognized over Button/Toggle, but an outer high-priority press and nested normal
long press both failed to perform. Sequence/drag observer variants and `.all`/
`.gesture` masks did not resolve nested arbitration while retaining the existing
pressing contract. The public API rejects `high`; future work must prove both
control and nested behavior, cancellation and stable native identity before
exposing it. This limitation does not block simultaneous composition or owned
transient-state work.

The offscreen control driver can deliver a requested 10 ms hold after roughly
220 ms inside native tracking. Adding the eventTracking run-loop mode did not
resolve that delay and is not retained. Control early-release tests use a 0.5 s
threshold and assert that actual native phase durations end before it. They do
not claim exact synthetic or hardware timing.
