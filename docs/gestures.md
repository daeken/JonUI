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


## Owned pressing state

Use setup-only `scope.gestureState()` for a read-only boolean that automatically
returns to false. Pass it as the `pressing` option of one descendant long press:

```ts
const held = scope.gestureState(), count = scope.state(0);
return () => Text(held.value ? 'Holding' : 'Ready')
  .onLongPressGesture(() => { count.value++; }, { pressing: held });
```

The initial value is false; view, Computed and effect reads track changes. There
is no public setter, native Binding or native state cell. The native pressing
phase updates the value before an optional `onPressingChanged` callback runs.
Recognizing the action leaves it true until the native press ends or cancels.
Normal control competition still reports pressing even when the long-press action
loses; normal and simultaneous modes share this state contract.

End/cancel, disabling, native disappearance, attachment/configuration replacement,
logical removal and shutdown reset the state. Lazy/sheet disappearance resets it
without disposing logical state or changing its token; a new visible press can
set it true again. Retirement resets are internal state changes and do not
synthesize `onPressingChanged(false)` notifications. Changes to observer presence, configuration, or attached pressing
state retire the token; old events cannot update the new attachment.
Live values reset before the app stop hook and are false during owner cleanup; reads after owner
disposal throw. A later owner instance starts with fresh false state.

One GestureState can attach to one mounted long press within descendants of its
component and its logical window root. Sharing across gestures, unrelated owners
or owned window roots is rejected. Descendant components may use it. Detach and
commit before attaching a retained state at another mounted identity; keyed
reordering preserves an existing attachment. Changing the GestureState option
resets the previous state, then attaches the new one. State stays alive until its
component is disposed, including when temporarily detached from a gesture.

This is a boolean long-press subset, not generic SwiftUI `@GestureState` or an
arbitrary Gesture/updating API. Input coalescing, drag values, animation/reset
transactions and explicit cancellation reasons remain future work. It follows
native disappearance, not general partial clipping or occlusion. Offscreen
Command-event tests retain the hardware/inactive-pointer limits above.

## Typed gesture values

`TapGesture`, `SpatialTapGesture` and `LongPressGesture` create immutable reusable
leaf descriptions. Attach one with `view.gesture(value, { priority })`:

```ts
const doubleTap = TapGesture({ count: 2 }).onEnded(() => { count.value++; });
Text('First').gesture(doubleTap);
Text('Second').gesture(doubleTap, { priority: 'high' });

Text('Point').gesture(SpatialTapGesture().onEnded(point => { location.value = point; }));
Text(held.value ? 'Held' : 'Ready').gesture(
  LongPressGesture({ pressing: held, minimumDuration: 0.4 }).onEnded(() => { count.value++; }),
  { priority: 'simultaneous' },
);
```

| Constructor | Description options | Action value | Attachment priorities |
| --- | --- | --- | --- |
| `TapGesture` | `count: 1 \| 2` (default 1) | No arguments | normal, high, simultaneous |
| `SpatialTapGesture` | `count: 1 \| 2` (default 1) | Frozen local `TapLocation` | normal, high, simultaneous |
| `LongPressGesture` | `minimumDuration`, `maximumDistance`, `pressing`, `onPressingChanged` | Boolean `true` on successful recognition | normal, simultaneous |

Priority belongs to each attachment, defaults to normal, and is rejected in
constructor options. Long-press high priority remains rejected by TypeScript and
runtime validation. The constructors copy and validate options immediately.
`onEnded` returns a new leaf with one terminal action; a later `onEnded` replaces
that action in the new value, leaving the original value unchanged. There is no
callback chain. Omitting `onEnded` attaches a native gesture without a user action;
it still participates in native competition and owns a normal attachment.

Constructing/copying a description allocates no native view, token, cell or
subscription. Each mounted attachment independently owns its configuration token
and latest callback. Sharing a stateless description across views shares the
callback function, while retirement of one view leaves other attachments intact.
Callbacks are synchronous, untracked and task-isolated, with the same failure
cleanup as the `onTapGesture`/`onSpatialTapGesture`/`onLongPressGesture` conveniences.
Create a new `onEnded` action inside a tracked body when it captures changing
props; a stored closure retains its ordinary JavaScript captures.

The lowering uses those same native modifier contracts. A typed long-press action
receives `true` for the native performed phase; cancellation never calls it. The
`onLongPressGesture` convenience retains its zero-argument callback. Tap count/mode/priority,
long-press configuration/observer presence/pressing state, current-handler
replacement, disabled ancestors, coordinates, lazy realization and cleanup retain
their existing rules. Rebuilding an equivalent description does not retire its
attachment. Long-press `GestureState` stays exclusive to one mounted attachment in
its owner subtree/window root; copying its description grants no extra ownership.
Reusing a description with disposed owned state is rejected on attachment.

Multiple `.gesture(...)` modifiers are independent native attachments whose
precedence is governed by their individual priority. They do not expose a compound
value or a shared recognition transaction. Simultaneous attachment priority is
supported; a SwiftUI-style `SimultaneousGesture`, sequence or exclusive value has
not been implemented.

Before compound values are exposed, the implementation must establish:

- One native recognition-session identity and configuration epoch for a compound
  tree, with stable leaf paths. An old branch must not complete into a replacement
  tree or reset a new branch's state.
- Native recognition/arbitration and typed result rules for missing, failed and
  completed branches, including void tap values. Joining independently queued Node
  callbacks cannot establish those rules.
- Exclusive transient-state ownership per live leaf, reset on branch loss,
  cancellation, disappearance, replacement and owner disposal, while preserving
  current callbacks and stable native control identity.
- Actual control/nested-gesture tests, early release/movement/disable/removal,
  lazy/sheet/owned-window tests, synchronous failures and repeated ownership cleanup
  for each composition kind before its coverage is marked available.

Native masks, general updating, generic transient values, high-rate coalescing,
reset transactions and hardware checks remain open. The existing high-priority
nested long-press blocker is unchanged.

## Internal simultaneous-pair probe

The native test harness now has a private `testGesturePair` modifier and drainable
`debug.pairTrace` collector. They require all three flags: `JONUI_TEST=1`,
`JONUI_TEST_OFFSCREEN=1` and `JONUI_TEST_LAYOUT=1`. This is an internal experiment;
there is no public `Gesture.simultaneously` method or compound application callback.
The installed SDK declares SimultaneousGesture with optional first/second values
and macOS 10.15 availability, within JonUI's macOS 14 target.

The probe attaches one real `SimultaneousGesture` of type-erased tap/spatial leaves
(count 1 or 2), plus a simultaneous zero-distance drag observer to capture an
input interval and epoch. It traces native changed/end/reset phases. A present
void tap is encoded as `{ kind: 'tap' }`, a spatial value as
`{ kind: 'spatial', x, y }`, and an absent branch as `null`. Those tags preserve the
difference between absent and void-valued branches. These are raw private traces,
not the final public result schema. Changed-phase presence does not establish
branch completion: a two-tap branch can have a changed value and then be absent
in the group's single-click end value.

Mapping stays a pure payload transformation. The first experimental version
placed ownership stamps in mapped values; native probes showed cached stamps
surviving repeated recognitions/configuration changes. Ownership is now read at
callback delivery from the pointer-start capture. Old epochs are rejected by the
live-node collector, including a demonstrated completion after an epoch changes
while the mouse is held. The collector retains at most 128 records per live probe
node, drains explicitly, and clears owners on graph retirement and shutdown.
In trace-only mode there is no Node callback registry or application-event
dispatch. Neither mode adds a native binding cell, timer or global event monitor.

The current adapter's actual offscreen Command-click results include:

- Equal one-tap leaves produce two group ends for a queued double click. Both
  ends can share one pointer-observer interval, so that interval is not a unique
  native recognition-session ID.
- Mixed one/two-tap leaves end with one absent branch after a single click and
  both present after a double click. Both two-tap leaves produce no single-click
  group end and one double-click group end.
- Normal groups with a one-tap branch let a Button act. A group of two two-tap
  leaves can win a matching double click at normal priority. High groups suppress
  the Button when they recognize, but allow a single-click Button action when
  both two-tap branches fail. Simultaneous priority permits Button actions too.
  These outcomes describe this adapter and installed SDK; they are not a general
  cross-hardware conflict policy.

The pending-group re-arming gap is fixed in the test adapter. An epoch change
removes the old optional gesture and arms the other of two fixed gesture slots.
The child content stays outside that change of recognizer identity. Slot selection
toggles for each observed epoch change, so skipped/even-numbered epochs also retire
the previous recognizer. The installed SDK exposes Optional's Gesture conformance
on macOS 10.15+, within the macOS 14 target.

Start capture is cleared on re-arming. If the pointer is already held, the new
recognizer stays blocked until release; it cannot adopt the old press or its
movement. Disable/re-enable and appearance use the same arming lifecycle. Native
records validate both the callback definition's epoch and captured start epoch,
plus the currently armed slot. Arm metadata clears on retirement/shutdown and
superseded epochs. Descriptor/priority changes require a strictly newer epoch;
backward epochs are rejected before graph mutation.

Each accepted native group end now gets a monotonically increasing `completion`
number from the host. Two ends sharing a pointer-observer interval still have
distinct completion numbers. This is terminal completion identity, not a causal
session for future per-leaf callbacks. Values remain raw private traces; no public
group dispatch or compound callback API is added.

The former lost-click test now requires the first fresh click to complete in the
current epoch. A dedicated fixture repeats pending replacements twenty times
across all priorities, even/odd epoch jumps and slot reuse. It changes the click
position and checks the new spatial point, asserts that input arrives before the
old timeout, and retains the captured native field target and focus through
configuration changes. Rapid replacements while held/moving reject the old press
and accept the fresh one after release. The full optional-value/control matrix,
bounded trace draining, malformed/gated input, held shutdown and 20 owner lifetimes
remain verified.

Before public exposure, complete leaf callback/path and causal-session semantics,
choose immutable public optional results, add transient branch-state reset, and
expand lazy/owned-window composition tests. Long-press leaves and nested
groups remain outside this tap/spatial prototype. Hardware/minimum-OS validation
and the existing inactive-pointer limitations remain open.


### Internal owned group-end dispatch

The test-only `__testing.gesturePair(view, first, second, callback, options)`
attaches one owned synchronous group-end callback. It accepts tap/spatial leaves
with optional onEnded callbacks and a normal/high/simultaneous priority. Long-press
leaves and nested groups remain rejected. All three native test flags above
remain required; this is not a public composition API.

Each accepted end produces a copied, frozen `{ first, second }` snapshot with the
same tagged tap/spatial/null branches as the probe. Both-null and malformed values
are dropped. These private tags distinguish void presence from absence without
committing the public API to this representation. No leaf callback is synthesized
from a group result; changed values still do not establish completed branches.

A mounted group owns a token independent of other attachments. Count/kind/priority,
disabled eligibility, ancestor sheet/window presentation changes and switching
between leaf-dispatch/root-only mode retire the token; current callback rebuilds
preserve it. Presentation bindings are tracked
by the modifier even when the logical group description is static. Delivery also
checks current ancestry before calling a handler. Callbacks run untracked outside
task context; throws or thenables stop the app and dispose its owners.

The host assigns an arm lease whenever the native recognizer becomes armed and
invalidates it on reset, disappearance, reconfiguration or removal. Before a Node
handler runs, a synchronous native claim must consume the completion once under
the matching live node/token/arm. This prevents an end queued before native
retirement from surviving a later reset queued behind it. Completion sequence and
arm high-water checks reject repeats and old leases. Native pending completions
are bounded to 128 per arm; overflow retires native ownership and reports a managed
Node failure instead of silently dropping ends.
Claims, re-arming, graph retirement and shutdown release pending entries.

Native checks cover current callbacks and State writes, equal-count double-click
ends, mixed-count optional results across priorities, pending/held replacements,
disabled ancestors, retained-sheet dismissal/re-entry, failure/thenable/held-close
cleanup and twenty owner lifetimes. Unit checks additionally inject malformed,
duplicate and retired events and synchronous owner removal. Compound leaf paths,
causal sessions, branch GestureState and lazy/owned-window dispatch remain future
work. Existing raw recognition/control tests do not prove those dispatch paths.


### Native completed-branch receipts

The raw private modifier accepts `traceLeaves: true` to attach real native
`onEnded` observers to its two leaves. It requires the same three test flags.
Changing this flag requires a newer configuration epoch; malformed flags are
rejected before graph mutation. This opt-in changes no public descriptor or Node
callback API. Pure mapped values still carry no ownership stamps.

Each native leaf end records a unique monotonic receipt and its constructor path:
`[0]` for first, `[1]` for second. Paths describe tree position, not callback order.
A native completed-branch cohort begins at the first leaf receipt under the current
epoch/armed slot. The next group end must reference exactly those receipts whose
paths and payloads match its present branches; absent branches have null receipts.
Duplicate paths, missing/extra receipts or payload mismatches invalidate correlation
and increment a test diagnostic rather than silently pairing unrelated values.
One live node retains at most one cohort with two receipts. The bounded diagnostic
trace can be drained independently while a group still waits. Terminal completion,
inactivity, re-arming, disable/disappearance, graph retirement and shutdown release
cohort ownership.

Offscreen native measurements establish this tap/spatial subset:

- For equal one-tap leaves, a double click produces two pairs of leaf ends and
  two group ends. The groups have different cohort/receipt/completion IDs even
  though the input-observer interval can be shared.
- For mixed one/two-tap leaves, the one-tap leaf ends on the first click and its
  value is retained while the group waits. A successful double click does not
  produce another one-tap leaf end. On a single click, the two-tap branch can
  appear in changed values but has no leaf receipt and is absent at the group end.
- With a two-tap first leaf and one-tap second leaf, successful double-click leaf
  callbacks occur at paths `[1]`, then `[0]`, then the group callback. Sorting by
  path would change native order. Equal-count first/second order is an observed
  SDK outcome, not a promised order for all future gesture types.
- The normal/high/simultaneous Button outcomes remain the same with observers
  attached. Epoch replacement while a completed branch waits discards its receipt;
  the first fresh point belongs to a new cohort. Native sheet disappearance also
  retires pending receipts while keeping logical owner State for re-entry.

The internal Node leaf-callback contract delivers actual leaf-end receipts
in observed native order, before the associated group end. A receipt fires once;
a retained leaf value in a later group result does not fire it again. Native claims
must revalidate ownership before **each** callback so a handler that replaces or
removes its group suppresses remaining retired leaf/group events. Each callback
uses the latest handler and the existing synchronous, untracked, task-isolated
failure rules. No path-sorted batch or synthetic leaf completion is planned.

The receipt cohort remains a completed-branch correlation model, not a general
gesture session: it does not identify branches that have begun but have not
completed. Trace-only cohorts retire at native group completion. The dispatch mode
below retains claimable leases separately; earlier session/state identity for
branch GestureState reset remains open. Long/nested groups, lazy/owned-window
receipt ownership, general cancellation and hardware/minimum-OS validation remain
open.


### Internal claimed leaf callbacks

The test helper now accepts tap/spatial leaves with `onEnded` handlers. If either
leaf has a handler, it enables native leaf tracing and dispatch together. Functions
stay in Node. Each leaf event must claim its exact live node/configuration/arm,
cohort, receipt and constructor path before invoking the latest handler. Claims
are single-use. Tap callbacks receive no arguments; spatial callbacks receive a
copied, frozen `{ x, y }`, matching their existing typed leaf contract. Group-end
callbacks retain the private frozen tagged optional `{ first, second }` snapshot.

Native leases survive group completion and retain a claimed bit until the group
itself is claimed. The group claim requires every correlated leaf dependency to
have been claimed, then releases exactly those leases. A leaf without a handler
still gets acknowledged in this mode so it cannot strand its group's dependencies.
A one-tap leaf can already have run while its two-tap sibling waits: a subsequent
partial group result does not invoke it again. Delivered leaf effects are not
rolled back if a later configuration change retires the group.

After each successful user leaf callback, the runtime reconciles its synchronous
State writes before processing another queued leaf/group claim. Handler-only
changes preserve the token and later receipts use the new handlers. Removing one
handler while the other remains active preserves native recognition; removing the
last handler retires the token and switches to root-only mode. Count/priority,
disable, presentation or owner changes suppress remaining retired events. Native
claims also reject queued events after physical disappearance, even before Node
receives its reset. Callbacks run untracked outside task context. A throw or
thenable stops the app and disposes its owners; no retired sibling/group callback
runs after the failure.

Each native owner has at most 256 outstanding leaf leases (claimed or unclaimed)
and 128 pending group completions. Lease/dependency registries retire on group
claim, canceled-cohort inactivity, rearming, disabling/disappearance, graph removal
and shutdown. Queue overflow or failed native correlation retires the affected
native arm and reports a managed failure through the available bridge queue, so
Node cleanup hooks can run. This differs from exhaustion of the bridge's own event
queue, where graceful delivery is unavailable and the existing runtime abort
policy still applies.

Native checks cover the full tap-count/priority/Button matrix, observed callback
order, current handlers, handler removal, synchronous first-leaf revision/config/
disable/removal changes, sheet dismissal inside a leaf callback, pending leases,
strict direct claims and root dependency gating, both queue bounds, throw/thenable/
held/pending shutdown, stable eligible field focus and twenty owner lifetimes.
Failure gates require exact exit status and one stop/disposal. Overflow checks
also verify native lease/dependency retirement inside disposal; normal/close gates
verify zero native leases/dependencies/views/cells/timers. Disabled fields correctly
refuse focus requests; tests preserve the user's native eligibility settings.

This remains an internal prototype. Public composition/result types, earlier
branch session identity and transient-state reset, nested/long groups, lazy/owned
windows, hardware and minimum-OS checks remain unfinished. No compound method is
exposed on the public Gesture interface.
