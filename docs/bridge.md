# Bridge design for the first milestone

## Process and threads

`jonui entry.ts` is a native executable. Its process main thread initializes
AppKit and owns its event loop. A dedicated thread hosts Node's environment,
V8 isolate and libuv loop. AppKit never waits synchronously for JS.

Node embedding requires a small C++ shim for Node/V8 initialization, environment
creation, execution and teardown. Swift can own the window, view wrappers and
application lifecycle, calling the shim through C functions. Node's embedding
API is not a stable C ABI, so the launcher initially pins a Node major/build.
Don't try to declare `node::Environment` or V8 C++ classes directly in Swift.

Relevant upstream contracts:

- [Node embedding](https://nodejs.org/api/embedding.html)
- [Node-API thread-safe callbacks](https://nodejs.org/api/n-api.html#asynchronous-thread-safe-function-calls)
- [NSHostingView](https://developer.apple.com/documentation/swiftui/nshostingview)

## Opaque pointers and ownership

SwiftUI views are mostly value types. A pointer represents a retained reference
box containing a value (initially often `AnyView`), not an address into a transient
Swift struct. Distinct opaque types represent views, state cells and callback
registrations. Use an explicit retain/release contract across the C boundary.

- A constructor or modifier returns an owned box reference. A modifier returns a
  new view value; it does not mutate its receiver.
- A parent retains its children and referenced state independently of temporary
  JS wrappers. A mounted window retains its root until it unmounts.
- A mounted callback registration retains its Node reference/context until the
  view unmounts or the environment shuts down. Queued events also need a lifetime
  token so an event cannot dereference freed context.
- JS GC finalizers enqueue release onto the UI queue; they never destroy a view
  box or AppKit object from the Node/GC thread. Shutdown has explicit disposal;
  it cannot depend on GC running.
- Swift errors and JS exceptions become explicit status/error events. Neither
  unwinds through a C function pointer.

The initial bridge may synchronously dispatch Node constructor calls to the main
queue so factories can return actual owned handles. This is safe only with the
one-way blocking rule: the UI thread never synchronously waits for Node. Callback
trampolines always enqueue and return. A later transaction API can batch calls
without changing the application syntax. Do not synchronously join the Node
thread on main while it may be awaiting main-queue work.

## Callbacks are not arbitrary JS function pointers

Pass a native C trampoline and an opaque callback context. The trampoline retains
or copies event payloads and uses a Node-API thread-safe function to deliver them
on the owning environment. It does not invoke JS/V8 from the AppKit thread.
Use a nonblocking enqueue with an explicit queue-full policy; the UI must never
block for queue capacity. Ordered edits/actions must not be silently dropped.

For the milestone, use a bounded reliable event queue and fail the application
with a diagnostic on overflow; later add appropriate backpressure/coalescing.
An already-closing environment rejects new events and releases their payloads.
The embedding shim exposes registration hooks while the Node environment is live.

## State and synchronous SwiftUI expectations

Primitive `State` cells (bool, number, string, nullable selection) have a native
observable cell and a Node-side mirror. A `Binding<T>` identifies that native cell;
it is not a pair of JS getter/setter callbacks SwiftUI can call synchronously.
Text input, list selection, toggles and sheet dismissal write the native cell
immediately, then enqueue mirror notifications.

Each native cell owns a monotonically increasing revision. All writes, including
JS requests, commit on main; that commit order is authoritative. Node delivers
revision-ordered notifications, ignoring stale/duplicate revisions. A JS setter
must reconcile against the acknowledged native value and revision before invoking
subscribers or scheduling body work. A queued older native event must not roll
back a later acknowledged JS write. The implementation must resolve this before
calling a text binding correct; optimistic local assignment alone is insufficient.

`State.value` reads track dependencies inside `View(() => ...)` on Node. A cell
change schedules affected bodies and commits resulting SwiftUI values on main.
Never run JS inside SwiftUI's synchronous `body`, `Binding.get`, row construction,
or layout callbacks. SwiftUI reads an already available native value/subtree.
Initial mounting waits asynchronously for the Node-built root to be ready.

Structured State uses the same native JSON cells and revision order. Node
validates and copies plain JSON records/arrays before serialization, then freezes
the acknowledged snapshot recursively. Reads track the whole cell. Native JSON
equality (sorted record keys, ordered array elements) keeps equal writes at the
same revision; Node also checks structural equality before replacing its snapshot
or notifying consumers. Native bindings remain scalar handles. Structured models
are consumed by Node view bodies rather than synchronous native field getters.

Dynamic boundaries are persistent native containers; body recomputation updates
their content. A keyed `ForEach` uses application IDs. Rebuilding a parent must
reuse boundaries at the same structural position (and matching keyed item ID),
replace their body registrations, and discard old dependencies. Removing an item
unmounts its boundaries. The implementation needs a small ownership/identity
mechanism, but layout and native view reconciliation still belong to SwiftUI.

The initial `AnyView` boundary is a practical type-erasure seam, not a promise of
perfect structural identity for arbitrary SwiftUI generic compositions. The note
field focus/caret and keyed row acceptance gates constrain how much erasure is
acceptable. Broader APIs may need typed wrapper specializations.

## Lifecycle and first implementation order

1. Native launcher runs one SwiftUI window and an actual Node timer concurrently.
2. Add the C ABI box ownership and callback trampoline; prove button round-trip
   and complete Node shutdown while AppKit is still processing releases.
3. Implement primitive State/Binding cells and ordered mirror synchronization.
4. Implement the declarations used by the sample, dynamic bodies, keyed rows and
   the editor sheet. Preserve the target TypeScript application.
5. Run all acceptance gates, then expand the SwiftUI surface.

On normal stop, reject new UI events, deliver `onStop` once on Node, dispose roots
and registrations, drain releases while both threads can still progress, stop the
environment, then end the AppKit loop and join the runtime thread. The shim must
keep Node alive while the UI is open even when there are no user timers. Startup
failure and uncaught application exceptions use the same teardown with nonzero
exit status. `runApp` resolves only for an orderly stop; it rejects on failure.

Not in this milestone: shipping all of Node in a signed `.app`, runtime downloads,
generated wrappers for every SDK API, arbitrary Swift generic instantiation,
SwiftData, MapKit, hot reload, additional windows or platforms.

## Implemented transport

`native/NodeRuntime.cpp` embeds the pinned shared Node build and registers a
Node-API linked binding. `runtime/bootstrap.mjs` resolves `jonui` imports to
the runtime and executes the application's TypeScript entry point. It handles
uncaught exceptions, rejected imports, and runtime teardown.

The C ABI owns one opaque retained Swift host pointer. UTF-8 JSON requests cross
that ABI; integer handles identify retained Swift `ViewBox` and `Cell` objects.
The first implementation batches view construction and updates in transactions,
rather than passing raw addresses to JavaScript or issuing a C call for every
SwiftUI constructor. A transaction validates child references and cycles before
committing. Native boxes retain children and the mounted root retains its graph;
unreachable handles are removed after each commit. Controls and modifiers are
real SwiftUI values created by `NativeView`, with `AnyView` at the wrapper seam.
Native view values and ForEach data carry weak `ViewReference` handles, keeping
framework caches from retaining unreachable boxes/subtrees. Deferred bodies and
child builders check mount validity; native actions carry IDs and weak hosts.
Bindings reject obsolete mounts/cells before writing.

`runtime/index.mjs` reconciles immutable constructor values into mounted
boundaries. Structural positions and typed `ForEach` keys preserve handles.
Unmounting removes body dependencies and callbacks immediately, so already queued
actions for removed handles are ignored. Native Observation keeps invalidation
local to changed boxes and state cells; unchanged properties are not assigned.

State writes synchronously commit on main and return the authoritative native
value and revision. Native control edits update that same cell immediately and
send revisioned events through a bounded Node-API thread-safe function. Its
referenced handle keeps Node alive until shutdown, including apps without timers.
Queue overflow is a reported fatal failure; payloads are freed even when Node is
closing. Workers cannot import the UI binding because it belongs to the launcher
Node environment.

Window close and the Quit menu enqueue a stop event. The runtime invokes the
stop hook once, unmounts subscriptions and actions, releases native roots, and
resolves `runApp`. After the entry module completes, Node stops, frees its
environment and V8 platform, then tells main to stop AppKit. Main joins only after
Node has stopped, so main-queue releases cannot deadlock behind the join.


## Validation

The shared Node build and launcher link successfully. The 110 runtime/compiler unit
tests and all 67 native integration scenarios pass; the Landmarks acceptance
notes record the tested behavior and remaining platform coverage. Integration
windows are created offscreen with `JONUI_TEST_OFFSCREEN=1`; their real SwiftUI
sheets still present and dismiss through AppKit. Offscreen launcher windows
ignore AppKit key/main promotion requests during sheet dismissal without
disabling responder/key-view tests, and are configured before content attachment.
Ordinary launches use visible
windows and do not expose test operations.
Offscreen launcher/sheet windows set `animationBehavior = .none`; the mixed-sheet
test asserts the actual per-window policy. This suppresses automatic window
ordering animations during focus/lifecycle automation after a reproduced
UpdateCycle crash inside AppKit's sheet-close animation loop. Ordinary app
animations retain their default behavior, and the animated framework path is
still a platform-coverage limitation. No preferences or framework delegates are
changed. Three repeated mixed-sheet runs each retire 20 pending focused owners.
The test-only programmatic scroll operation explicitly drives enclosing SwiftUI
layout after moving the native clip bounds. Transparent/inactive windows may
otherwise leave lazy realization at the previous viewport without scheduling a
display pass. Tests still require actual partial native realization and the
last row's measured geometry after scrolling; no visible/key window is needed.


## Recoverable editable views

`TextEditor` adds native multiline string bindings. The playground compiles typed
function bodies using Node's `stripTypeScriptTypes` and `vm.compileFunction`, then
changes a revision State to invalidate its existing preview boundary. State cells
live outside that body and survive code changes; compilation failures never
replace the current renderer.

`View(body, { fallback })` contains render failures within its subtree. A recovery
scope tracks existing and partial mounts so a failed descendant cannot strand
callbacks, dependencies, or queued view updates. Failed reads remain subscribed
for retries. Reactive updates below a recovery boundary reenter the outer scope,
which also catches a nested fallback failing. A successful retry replaces those
error dependencies with the reads from the new body. Action exceptions remain a
separate concern; the playground wraps edited button callbacks to show their
errors in its status area.


## Embedded web controls

`WebView` uses a persistent `WKWebView` through `NSViewRepresentable`. Node commits
HTML and JSON data as view properties. Data changes deliver a model snapshot into
the existing document; source changes create a fresh document token and load the
HTML again. Main-frame script messages enter the same bounded event queue as
native controls, and Node dispatches them to callbacks belonging to mounted IDs.

The injected `window.jonui` object provides `postMessage(value)` and
`onMessage(listener)`. Main-frame checks and document tokens reject iframe and
replaced-document messages. Navigation outside the HTML document is cancelled;
website storage is ephemeral. No Node context is exposed to page JavaScript.
Dismantling stops the view, removes its script message handler and navigation
delegate, and releases callback registrations. Web/load failures are delivered
through `onError`; stale queued errors are discarded after unmount.

WebKit integration checks run against real browser JavaScript and DOM input.
They prove round trips in both directions, stable browser boot identity and focus
under repeated data updates, HTML reload, stale-token rejection, navigation
policy, errors and unmount/remount cleanup.


## Scoped state ownership

`Component` descriptors reconcile through persistent native dynamic boundaries.
A stable factory identity and structural/keyed position select the mounted setup
scope. Setup creates local cells once, and the returned body receives fresh
props on subsequent evaluations. Component-only functions and props never enter
the JSON/native view transaction.

Unmount removes Node-owned cells and subscriptions immediately and queues their
native IDs for release. `state.release` follows the view commit that detaches
those bindings, and rejects any ID still referenced by the committed graph.
Native binding closures use weak Cell references; stale native view bodies check
whether their box remains mounted. Test diagnostics expose actual live Cell
counts as well as registered handles.

Disposal runs all child/sibling cleanups even after an exception. Shutdown always
clears native roots and cells before surfacing a cleanup failure. Setup failures
and render recovery also dispose partial instances. See components.md for the
public ownership and identity contract.


## Effect scheduling

Mounted scopes own setup-registered effects. Effects share the dependency tracker
with views but have a separate pending queue. State getters subscribe a running
effect immediately so read/write feedback is detected on its first execution.
Writes invalidate observers after native acknowledgement, and subscriber callbacks
run without inheriting the writer's tracking context.

The scheduler settles dirty views, commits their native transactions, then starts
queued effects. Writes from an effect return to reconciliation before another
queued effect starts, so an owner removed by that write does not start stale
work. Cleanup is untracked, occurs before rerun, and removes subscriptions before
invocation. Stop/unmount removes pending entries and retains no cleanup callbacks.

`scope.props` is a component-local dependency signal, separate from native cells.
Shallow prop changes invalidate only observers that read it. Prop signals and
State cells share lifetime validation, so render recovery keeps only surviving
dependencies. Cycle detection counts effect sites by structural/keyed path and
registration slot; large independent lists do not exhaust one shared run budget.

## Asynchronous task ownership

`scope.task` wraps a tracked effect with one owned run per execution. Each run has
an AbortController and a cancellation cleanup stack. The synchronous callback
prefix shares the effect dependency tracker; Promise continuations run outside
that tracker. Cancellation marks a run obsolete before aborting its signal and
running every cleanup, so even synchronous abort handlers cannot publish stale
State. Failed starts cancel their partially registered resources too.

Node's AsyncLocalStorage carries the run through Promise continuations and
timers. State writes and subscription creation check that context before crossing
the native bridge. State subscribers installed by a task restore its context and
are removed on cancellation. `task.commit` explicitly guards synchronous external
publication and callbacks whose source does not preserve async context. Stale
root State allocation is rejected to prevent late cells from leaking into the
application. Component-local disposal remains a second guard for scoped cells.

Settled Promises leave the pending set, while their run retains lifetime cleanup
until input changes, stop, or owner disposal. Canceled runs leave the pending set
immediately; an uncooperative operation may still physically finish later. Its
State writes are ignored and rejection consumed. Current failures cancel their
run and follow normal app failure teardown. Test diagnostics expose pending task
counts; native lifecycle tests verify subscriptions, timers, and actual live
cells return to baseline.

The app scheduler and ordinary State subscriber dispatch clear task async context
before running. Only task-owned subscribers restore their run explicitly. This
keeps a task that cancels itself through a State write from suppressing unrelated
effects, component disposal hooks, or subscriber continuations.

## Computed graph and lifetime

Computed values are Node-only observers and dependencies. A lazy getter records
the consumer's edge, tracks its own synchronous State/props/computed inputs, and
caches an immutable JSON snapshot or the thrown error. Native getters never
execute these callbacks, and no additional native cell is needed. Derivations
share the normal tracker but reject State mutations and owned resource work;
an async context guard also prevents writes from invalid Promise-returning
derivations after await.

Input invalidation marks each reachable cache stale, immediately detaches its
input edges, and propagates to dependent views/effects/computations. All caches
are invalidated before ordinary State subscribers run. Recalculation happens on
the next read, so synchronous subscribers see fresh chained/diamond values while
view/effect changes batch. Consumers rerun on input invalidation; structural
output equality preserves snapshot identity rather than suppressing invalidation.
Error caches retain their tracked inputs for recovery, and an evaluation guard
diagnoses recursive dependency cycles.

Scopes own their derivations just as they own state and effects. Unmount lets
cleanup inspect an already successful cached value without reevaluating disposed
inputs, then removes all derived edges, callbacks, and cached values. Failed
mounts and shutdown use the same teardown. Root computations are app-owned and
released at shutdown. Computed liveness participates in render recovery so a
fallback does not subscribe to an already disposed local derivation. Test-only
diagnostics report active computation and dependency counts.

## Layout descriptors and native verification

Scroll descriptors own exactly one content node and render through SwiftUI
ScrollView. Frames use SwiftUI's fixed or flexible overload according to their
option form. The JSON string `"infinity"` maps to a native infinite maximum;
numeric nonfinite dimensions are rejected. Frame/stack alignment enums, edge
insets, fixed size axes, layout priority, and spacer minimum length are validated
on both sides of the bridge. Native validation runs before any reachable view
descriptor is applied, preserving the previous committed tree after a failure.

Layout tests opt into GeometryReader preferences with `JONUI_TEST_LAYOUT=1` in
addition to `JONUI_TEST=1`. The normal renderer has no geometry probes. Test-only
operations inspect actual SwiftUI node rectangles and AppKit NSScrollView
document/viewport bounds, then move the native clip view without interacting
with the desktop. Preferences store rectangles rather than retaining view boxes,
and shutdown clears their data. Offscreen integration checks cover measured
geometry, native scroll movement, keyed bindings, malformed transaction rejection,
and return to baseline native views/cells after repeated removal.

## Forms and numeric bindings

Form and Section are ordinary native containers with no additional JS actions.
Slider and Stepper reference native number cells through typed handles. Their
SwiftUI Binding getter clamps presentation to the current bounds; its setter
clamps native edits and snaps stepped Slider values on the main thread. Stepper
uses SwiftUI's numeric step from the current value. Programmatic State writes
remain exact. Numeric closures weakly capture the cell, view box, and host, and
reject writes after that view leaves the committed graph.

Native validation checks every bound cell against the types required by all its
committed consumers. Later JS/native writes must preserve those binding types.
Form styles and numeric bounds/steps are validated before any view transaction
mutates the graph. Native edits and JS writes keep the existing cell revision
ordering, including when a numeric cell is shared by multiple controls.

Offscreen tests use actual NSStepper actions and the native SwiftUI number
Binding for Slider edits. Test-only geometry confirms Slider rendering. SwiftUI's
virtual Slider accessibility element is unavailable in the transparent offscreen
window, so visible pointer dragging is outside this automated coverage. Repeated
style changes/removal verify all native controls, cells, and view boxes release.

## Picker identity and selection

Picker descriptors carry a copied array of scalar values and text labels.
Native SwiftUI option tags use base64-encoded JSON bytes. These ASCII tokens
preserve type and exact Unicode representation, avoiding Swift String's
canonical-equivalence comparison for composed/decomposed selection IDs. The
native getter and option tags use the same encoder; tokens never enter the
application State value.

A reserved token represents an unmatched selection and renders a passive
placeholder without changing the cell. Empty choices disable the picker.
Setters look up tokens in the current descriptor's options and publish the
original typed value. Removed tokens, unmounted view boxes, and stopped hosts
cannot write. Weak captures let framework adapters release view boxes/cells on
removal. No per-option JS actions or native state handles are allocated.

Validation rejects duplicate IDs, invalid option shapes/types, invalid styles,
and incompatible selection cells before native graph mutation. It also checks
every choice against other controls sharing that cell, so a text/numeric consumer
cannot receive an incompatible value from an otherwise valid Picker. Native segmented
target/action tests cover typed and exact Unicode round trips. Menu rendering
and its native Binding are checked offscreen; opening a menu remains a manual
check. Available AppKit menu target/action adapters are exercised without
opening a menu on the desktop.

The hosting view leaves window dimensions under AppKit/AppOptions control rather
than tracking SwiftUI's intrinsic minimum/maximum sizes. This prevents a small
transient root (such as an unmounted-state label) from shrinking the window and
leaving a subsequently remounted flexible form/picker at zero width. Geometry
tests check configured content bounds across that transition.

## Lazy container realization and grid tracks

LazyVStack and LazyHStack unwrap unmodified foreach/dynamic component boundaries
into direct native ForEach items keyed by the actual row handle. Without this,
an erased wrapper containing a whole group would turn that group into one eager
item. Modifiers/eager containers remain intentional row boundaries. Native
controls and layout are lazy; Node still mounts all logical descriptors/scopes.
Offscreen scopes retain state/effects/tasks until explicit logical removal.

LazyVGrid/LazyHGrid use the same direct keyed-item expansion and weak ownership.
The public columns/rows arrays normalize to a `tracks` descriptor array, avoiding
the runtime's internal ForEach row metadata. Each track is copied/frozen and
validated before serialization. Native validation independently rejects empty or
malformed track arrays, unknown options, invalid alignment/gaps, mixed fixed and
bounded sizing, and invalid or inverted dimensions before committing any boxes.
JSON-safe `"infinity"` maxima convert to CGFloat infinity only when building
SwiftUI GridItem values. The native grid owns packing and cross-axis measurement;
track/viewport changes preserve the keyed item handles and logical scopes.

SwiftUI may cache platform controls and render values after a row disappears.
Weak native view references and collection data release logical boxes immediately;
retired binding/action callbacks cannot reach removed cells. The native host
tracks mounted WebView coordinators in ordinary launches as well as tests, and
invalidates them when a commit removes their node or the host disposes. This
clears navigation/script handlers and replaces cached documents with an empty
document. Framework dismantling follows the same idempotent path. Old documents
cannot retain a row box or publish messages while waiting for cache eviction.

Offscreen tests cover partial realization, actual viewport movement, stable
keyed Unicode cells/actions across reorder, empty/removal cleanup, stale cached
adapters, and 20 mount/unmount cycles in each direction. A native WebView timer
case verifies coordinator and scoped state retirement after offscreen removal.
Grid scenarios add actual fixed/flexible/adaptive measurement, viewport repacking,
per-track alignment, malformed atomic transaction rejection, Unicode input/action
identity through track updates/reorder, and 20 cleanup cycles in each direction.

## Native focus traversal

The frozen Node `Focus` API sends `focus.move` with next/previous/clear. The host
validates direction and mounted-window availability, lays out pending content,
and recalculates AppKit's key-view loop. For field editors it resolves the
delegate control before selecting the following/preceding key view; traversing
from the shared NSTextView editor itself can reselect the same field. Clear
uses makeFirstResponder(nil) and reports a refusal. Commands never activate the
app or make the window key, and allocate no state cells or callbacks.

Node rejects calls from render/computed work and suppresses them after shutdown
or from canceled scoped tasks. Normal actions, submit handlers, effects, and
current tasks can move focus. The bridge returns after the native operation;
editing notifications still arrive through the ordinary asynchronous event queue.
An actual first-responder test covers plain/secure/multiline inputs, Return,
Unicode, keyed reorder, native traversal order, rapid movement, empty content,
invalid directions, and 20 focused mount/unmount cycles offscreen.

`Focus.capture` resolves the current physical key-view responder (a field editor
maps to its delegate control), storing one weak NSView reference per native
control. Node wraps the monotonically allocated handle in a frozen object backed
by a private WeakMap. `Focus.request` rejects forged/foreign objects before the
bridge and asks makeFirstResponder to focus an eligible captured view synchronously.
An already focused target is a no-op. The host verifies window ownership,
descendancy, hidden/key-view eligibility, and releases expired weak entries.
No State cells or JS callback registrations are introduced.

Any commit adding/removing native handles retires all captures before mutating
the graph, including references to otherwise unaffected controls. This conservative
invalidation rejects cached adapters without guessing a logical owner from view
geometry or accessibility metadata. Property-only commits and keyed reorder keep
valid physical identities; failed transactions leave registrations untouched.
Shutdown clears the registry, and handles are never reused. Tests cover exact
plain/secure/editor restoration, bounded recapture, ordered rapid requests/clear,
keyed/value updates, structural edits, lazy cache retirement, and 20 unmount cycles.

`Focus.setTraversal` transports a copied array of captured target IDs. Both Node
and native validate distinct identities; the host validates all views before
replacing the window-global cycle. Stale/unavailable configuration returns false
without changing a valid existing cycle. Next/Previous use direct native
makeFirstResponder calls to advance/wrap the cycle, entering at the first/last
target when the current responder is outside it. Clear retains the configured
cycle; an empty array restores native command traversal. Repeated traversal of a
single already focused target is a no-op.

Only numeric IDs are stored, so cycles add no strong view references. Expired
registrations, structural retirement, and disposal clear the cycle; unavailable
members cause traversal to discard the whole cycle and fall back to native order.
The custom order is not installed into key-view links. Without an explicit opt-in,
Tab/Shift-Tab use native handling.
Tests cover real first responders, copied/atomic configuration, Return ordering,
keyed identity, outside/single-target cycles, invalid input, lazy cache retirement,
and 20 configured mount/unmount cycles with baseline resource counts.

`tabNavigation: true` enables window-local Tab/Shift-Tab routing through the same
weak cycle. The bundle's `NSPrincipalClass` is the owned `JonUIApplication`
subclass. Its `sendEvent` override delegates eligible Tab key-down messages for
the active window/sheet to the host, which checks marked-text composition and
target eligibility before making the next native responder first.
Command/Control/Option shortcuts, key-up, marked text, disabled/retired cycles,
and all other events pass to `super.sendEvent` for ordinary AppKit dispatch.
Native resignation refusal consumes that traversal key without retrying.
This uses the documented [NSApplication dispatch extension point](https://developer.apple.com/documentation/appkit/nsapplication/sendevent(_:)).

Mode flags are type-checked on both sides and committed only with a valid full
target list. Default/false and empty configurations disable routing; invalid
updates preserve a valid prior cycle/mode. Expiry, ineligibility, structural edits,
and disposal clear both. No global monitors, native key-view links, strong target
references, state cells, or callback registrations are installed. Real NSEvent
tests cover dispatch, modifiers/composition, native reset behavior, keyed identity,
lazy cache retirement, and 20 non-key window mount/unmount cycles.

`view.focusSection()` emits a single-child modifier with no additional options.
Native validation checks keys and child count before committing; NativeView
applies SwiftUI's `.focusSection()` directly to its child. It adds no cells,
callbacks, responder registry, or event interception. SwiftUI owns native grouping;
an enabled explicit captured Tab cycle still takes precedence in the application
dispatcher. Tests compare native forward/reverse grouped and geometric order,
unchanged frames, Unicode/keyed/captured identity, reset from custom routing,
empty sections, atomic validation, and 20 focused owner mount/unmount cycles.
The test-only NSEvent generator preserves Shift in both character strings so
native reverse traversal receives a proper backtab event.

`view.disabled(flag)` emits a single-child modifier with a required boolean value
(the Node default is true). Native validation rejects unknown keys, non-booleans,
or incorrect child counts atomically, then applies SwiftUI's `.disabled(flag)`.
SwiftUI propagates inherited availability to native controls. Property-only
updates introduce no new handles, cells, callbacks, or ownership, so weak captured
identities survive disable/re-enable while their physical controls remain alive.
Existing eligibility checks reject unavailable/hidden targets and discard a cycle
containing one when traversed. A non-text integration scenario verifies this on
real NSDatePicker controls, native date edits, command/Tab traversal with a text
field, keyed reorder, malformed transactions, and 20 focused owner lifetimes.
Test-only diagnostics inspect actual NSControl eligibility and keyboard-access
settings without overriding them; stepper/segmented exclusion is verified on the
current machine, with their enabled-keyboard path still unverified.

The WebKit representable explicitly reads Context.environment.isEnabled on
creation and update. A native ControlWebView gate declines key-view/first-responder
entry and pointer hit testing while disabled, and clears an existing descendant
responder using NSWindow.makeFirstResponder. JonUI's eligibility check walks
ancestors so an internal WebKit responder cannot bypass its disabled container.
See Apple's [hit-testing contract](https://developer.apple.com/documentation/appkit/nsview/hittest%28_%3A%29/)
and [responder-entry contract](https://developer.apple.com/documentation/appkit/nsresponder/becomefirstresponder%28%29/).
Availability changes preserve documents, data delivery, and weak physical targets.
Invalidation disables cached adapters; every deferred update checks the logical
mount before applying enabled state, so retired adapters cannot reactivate.

Mixed-focus tests cover two real WebKit responders versus DOM inputs, native
command/Tab cycles and default DOM navigation after reset, Unicode/selection/keyed
identity, inherited disabling, pointer/key-view exclusion, source/data lifetimes,
late-message rejection, and 20 focused mount/unmount cycles at baseline resources.

Focus operations select the deepest attached sheet, falling back to the main
window, before layout and key-loop preparation. A weak focus-context reference
detects window switches and retires captured identities/cycles independently of
logical graph edits. This prevents requesting a parent control behind a modal
sheet and discards dismissed-sheet targets on the next parent-window operation.
Command cycles and opt-in Tab routing support the active sheet. The owned
application dispatcher filters to that window without replacing SwiftUI's sheet
delegates. Empty resets restore native sheet handling; invalid/stale target lists
leave the configured cycle/mode intact. Parent-window events are never routed
through the active sheet's cycle.
Tests inspect actual sheet responders plus the parent window, verify Return/Unicode,
application-dispatched Tab/Shift-Tab, native Tab/multiline reset, bounded captures,
marked-text/modifier bypass and atomic stale-target rejection,
disabled/keyed identity, context retirement with unchanged logical handles, and
20 focused owner removals returning views/cells/callbacks/targets to baseline.

WebView `tabFocusable` is a boolean descriptor flag, true by default. The
representable forwards it to ControlWebView.canBecomeKeyView; existing pointer
hit testing/first-responder acceptance stay governed by interaction availability.
Eligibility also checks the ancestor flag for captured internal WebKit responders.
Flag-only commits preserve documents, request epochs, callbacks, and weak target
IDs; inactive targets reject capture/named restoration and invalidate a traversal
cycle when used. Native Tab-boundary tests verify forward/reverse DOM entry/exit,
disabled/passive skipping, the default empty-browser container stop, live data/RPC
while excluded, malformed-flag atomicity, re-enabled captures, keyed reorder/reload,
and 20 owner removals during an asynchronous boundary handoff.

TextField, SecureField, TextEditor, DatePicker, and WebView `focusName` options supply
declarative registration before first focus, sharing the same namespace.
Commit validation builds an app-wide map from UTF-8 Data keys to logical node IDs,
checking nonempty names and duplicates across the reachable graph before mutating
anything. Byte keys preserve exact JS Unicode identity. Successful commits replace
the map; invalid transactions leave it intact. The map stores no native views or
callbacks and is cleared on removal/disposal.

`Focus.requestNamed` validates well-formed nonempty strings and sends `focus.named`.
The host resolves the current node's live coordinator, checks the active window's
eligibility, and focuses its native target through NSWindow. A post-request responder
check resolves shared field editors to their control and accepts the target or
its descendants; an already-focused request is a
no-op. Missing, unrealized, disabled, hidden, other-window, or refusing views return
false. Requests create no weak capture IDs and leave cycles unchanged. Property-
only rename/reassignment does not reload WebKit or change captured physical IDs.
Tests cover naming/Unicode/renaming, atomic rejection, document/cycle identity,
modal/lazy/disabled availability, 20 focused owner lifetimes, and duplicate-name
startup cleanup.

Text inputs and date pickers each own a bounded NSHostingView through
HostedNativeControl, using their existing SwiftUI control implementation and forwarding
the representable's full environment. Intrinsic sizing participates in surrounding
layout without imposing window min/max constraints. Coordinators weakly reference
the host, native hosting view, and logical box. Resolution walks only that owned
subtree for public editable NSTextField, non-field-editor NSTextView, or eligible
NSDatePicker types. A date control chooses its first eligible native component,
without opening a popover or targeting a specific date/time segment.
It never matches display labels, global enumeration order, geometry, private
SwiftUI classes, or accessibility identifiers. Inputs use the same hosting path
with or without names, retaining physical identity when registration changes.
Logical removal/shutdown immediately invalidates the coordinator, clears cached
root content, and removes the registry entry. Deferred make/update/dismantle work
cannot re-register a retired input or remove a newer coordinator. Native tests
verify actual first responders, bindings/Return/newline ordering, inherited
disabled state, physical cycles, sheets, lazy realization, cross-kind duplicate
rejection and 20 owner retirements with zero retained adapters/cells/callbacks.
Date-name tests additionally cover two controls with identical labels, actual
NSDatePicker actions and physical Tab cycles, property/keyed identity,
native/native-date/web namespace collisions, inherited disabled/hidden targets,
compact/automatic/graphical styles and component/zone changes, active-sheet
isolation, actual lazy realization, 20 focused owner retirements, and duplicate-
name startup failure cleanup. Test snapshots retain a text-only adapter count
and report the total hosted-control count for teardown assertions.

`Focus.move(direction)` sends `focus.direction` with one of four spatial directions.
After layout/key-loop recalculation, the host resolves a shared field editor to
its control and normalizes internal WebKit responders to the browser container.
It walks nextValidKeyView with cycle detection, or uses eligible explicit-cycle
members, deduplicates normalized views, and excludes fully clipped targets.
Geometry uses bounds intersected with visibleRect; an unclipped view's visible
extent can exceed its own rectangle. Window coordinates account for flipped
vertical axes. Aligned candidates rank by forward-edge gap then center distance;
other candidates must lie inside a 90-degree cone and rank by center distance.
Key-loop order breaks ties, with leaf views preferred over their parent
containers. The winning target receives one makeFirstResponder request with a
post-request responder check. No candidate/refusal returns false; there is no
wrapping, explicit scroll request, new registration, or arrow event interceptor. Active-
window, disabled, WebView Tab eligibility, purity, canceled-task, and shutdown
guards apply. A native matrix test covers all four axes with plain/secure/editor/
date/WebKit controls, visible lazy targets, sheets, cycle fallback, DOM selection,
keyed identity, atomic directions, and 20 owner retirements.

Mixed-sheet integration covers plain/secure/editor/date/WebKit responders in one
real AppKit sheet. It verifies captures/command cycles, application-dispatched
mixed-control Tab/Shift-Tab and wrapping, native DOM Tab boundaries after reset,
actual text/newline/date actions, disabled/passive
browser eligibility, keyed identity, snapshot/selection preservation, and retained
logical state/handles through dismissal/reopening. The test-only `debug.dates`
and `debug.date` adapters enumerate/act in the active sheet (otherwise main
window), matching existing field/editor/focus adapters; an independent parent
date proves that sheet actions reach the correct scoped binding.
Pending browser calls are canceled on document reload and focused logical-owner
removal. Twenty repeated sheet-owner retirements assert aborted signals, zero
pending replies/requests, retired native views/cells/names/callbacks, and guarded
late shared-state/focus work while every window remains transparent/non-key and
the app inactive. Native date binding lookup by logical node ID remains separate
from the active-window enumeration/action adapters.

## WebView RPC

WebView `api` tables are copied/frozen on Node and stripped from native view
descriptors. Only method names and a source epoch cross with ordinary view props.
The document's `jonui.remote()` Proxy invokes a separate
WKScriptMessageHandlerWithReply channel; WebKit supplies its Promise transport.
The coordinator validates the main frame, current document token/epoch, exported
method, JSON arguments, and a 128-call limit before queuing a Node request.

Node runs the selected handler in request-owned AsyncLocalStorage context using
the existing task signal/cleanup/late-write guards. A request is keyed by native
document token and call ID, so framework view recreation cannot alias a new call
with an old one. Native `web.claim` validates the pending call before dispatch and
guarded continuation work; replies also verify the token/epoch and committed graph
before removing their completion block. No synchronous wait for Node runs on the
AppKit thread. Successful JSON/void results and normalized name/message errors
settle the original WebKit Promise.

HTML changes retire Node work before deferred SwiftUI realization. Coordinator
replacement, navigation failure, process termination, logical removal, and shutdown
drain native reply blocks and send cancellation IDs. Epoch changes force reload
even when coalesced source bytes match the old document. Completed/canceled calls
abort their signal and release registered work; late continuations cannot publish
State or replies. Handler/data updates retain the epoch. There are no extra native
state cells; test callback counts include exported API methods. See
[API contracts and validation](web-rpc.md).

An experimental two-way boolean FocusState adapter was discarded:
late framework observations could revive an obsolete blur request, so it is not
part of the public API or native graph validation. SwiftUI accessibility identifiers
were also absent from the underlying NSViews in the offscreen probe, so identifier
matching is not used for targeting.

## Text callback registrations

Plain and secure single-line inputs use string cells. Their weak native setters
check both mount identity and the currently bound cell before publishing an edit.
SwiftUI's `onSubmit` emits a view ID, opaque registration token, and the native
cell snapshot. Node verifies the registration/source, accepts the snapshot with
normal revision precedence, then invokes the latest current callback. Functions
never enter native descriptors; only the integer token is serialized.

Tokens persist across handler replacements on one binding, so a state-triggered
render between the edit and submit events does not lose a valid submit. Removing
the handler, rebinding, or unmounting retires the token; queued events for it are
ignored. Native closures also reject tokens that no longer match the committed
box. Partial mounts, render recovery, and failure shutdown clear all registrations.
Text callbacks contribute to test callback counts alongside button/web handlers.

Offscreen tests use real NSTextField/NSSecureTextField delegate updates and their
Return action adapters, without focusing a visible window. They verify ordering,
registration rotation, rebinding, failures, and repeated cleanup. SecureField
masks presentation while its application-owned string still traverses the normal
state bridge; it introduces no separate secret-storage mechanism.

TextField, SecureField, and TextEditor each use a stable SwiftUI wrapper with
private FocusState for editing-session observation. Focus changes emit a
`textEditing` event containing the view ID, its independent `editing` token,
boolean session state, and the bound cell snapshot. Node checks the token,
view/binding source, and boolean flag before accepting the snapshot, then invokes
the latest handler with normal revision precedence. Tokens follow the same
retirement and cleanup rules as submit registrations. The wrapper stores only
weak bridge callbacks/bindings, so removed focused inputs release their view boxes
and cells. Initial focus state is not replayed on callback attachment; unmount
retires callbacks before framework focus teardown can publish a final exit.

Tests move the offscreen window's first responder directly without keying or
activating it, exercising SwiftUI's actual FocusState notifications for all three
input types. Editor changes and newline insertion use NSTextView's normal
text-change path. Guarded test events additionally exercise registration races.

## Date/time value boundary

DatePicker stores Unix milliseconds in ordinary number cells. Its native Binding
converts to/from Foundation Date seconds only at the UI boundary. The getter
clamps display to optional inclusive bounds, while the setter rounds native edits
to millisecond precision and clamps the result. Programmatic supported timestamps
remain exact in the model, even outside the control's configured bounds.

The supported numeric domain spans UTC years 0001...9999. Bound-cell validation
rejects nonnumeric/out-of-domain writes, checks shared Picker options, and rejects
shared numeric input ranges that could publish unsupported timestamps. Bounds,
components, styles, and time-zone names are validated before graph mutation.
Node's Intl validation canonicalizes zone names; Foundation supplies native
Gregorian calendar/time-zone presentation without changing the stored instant.

Weak date bindings also check the currently committed cell/mount before writing.
Native NSDatePicker target/action tests verify millisecond and zone/DST behavior,
range updates, rebinding, revision precedence, and repeated release. Test-only
date diagnostics do not open a calendar popup or interact with the desktop.
