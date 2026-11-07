# Native focus navigation

`Focus.next()`, `Focus.previous()`, and `Focus.clear()` operate on the active
attached sheet, or the main window when no sheet is attached. Next and Previous select the next/previous
eligible native key view. Clear asks the current responder to resign.

```ts
import { Button, Focus, HStack, State, TextField } from "jonui";

const name = State("");
HStack([Button("Next", Focus.next), Button("Previous", Focus.previous),
  Button("Clear focus", Focus.clear)]);
TextField("Name", { text: name.binding, onSubmit: Focus.next });
```

Commands run on the native main thread and return after the responder operation.
They return no value. A command before a window is mounted throws; commands after
application shutdown or from canceled scoped tasks are ignored. Call them from
actions, submit handlers, effects, or current tasks. Render bodies and computed
values cannot move focus. Native key-loop traversal with no eligible control is
harmless; a responder refusing to resign during Clear produces a diagnostic.

The host lays out pending content and recalculates the key-view loop before
traversing. Ordering and eligible controls follow AppKit/SwiftUI geometry and the
system's keyboard-access settings. This API does not assign explicit tab indices
or realize/scroll to offscreen lazy rows. Keyboard traversal remains local to the
current native window; commands do not activate the app or make the window key.

Use `onEditingChanged(boolean)` on TextField, SecureField, and TextEditor to
observe editing sessions, or update application-owned State from those callbacks.
Native text changes synchronize before submit handlers run, so a Return handler
can read the updated text and then call Focus.next(). Editing notifications are
queued back to Node; the focus command does not wait for those callbacks.

Keyed reorder preserves the current input/control identity. Subsequent traversal
uses the reordered native key loop. Removing focused content retires its callbacks
and scoped cells normally; use scope.onDispose for cleanup rather than expecting
a final editing-exit callback. Focus commands allocate no cells or callbacks.

## Directional commands

`Focus.move('left' | 'right' | 'up' | 'down')` moves from the current eligible
native responder to a visible geometric neighbor and returns a boolean. It
returns false when there is no eligible current responder, no neighbor in that
direction, or the responder refuses the change. It does not wrap at an edge.
Before a mounted window it throws; render/computed use is rejected, while
canceled tasks and calls after shutdown return false without native work.

```ts
Button('Move right', () => { Focus.move('right'); });
TextField('Name', { text: name.binding, onSubmit: () => { Focus.move('down'); } });
```

Candidates follow the active window's existing [native key-view loop](https://developer.apple.com/documentation/appkit/nsview/nextvalidkeyview),
eligibility, and actual clipped geometry. Unrealized and fully clipped lazy rows
are excluded; the command issues no scroll request to find a neighbor. Normal
native focus/caret behavior still applies to the selected control. A valid explicit
`Focus.setTraversal` cycle restricts the candidate set without imposing its order.
Unavailable cycle membership resets to native candidates, as with Next/Previous.
Clipping alone does not retire an otherwise valid explicit cycle.
The current responder can start outside a configured cycle.

The selection rule prefers controls whose perpendicular spans overlap. Among
those aligned candidates, it chooses the closest forward edge, then center
distance. Other candidates must fall within the direction's 90-degree cone and
are ranked by center distance. Native key-loop order breaks ties. View bounds
are intersected with `visibleRect` before conversion to window-content coordinates;
non-clipping native views can report a visible extent larger than their bounds.
Up/down respect the content view's flipped coordinates. Parent containers with
eligible key-view descendants are skipped in favor of their leaves.

WebKit is treated as one browser container, including when a DOM input owns the
native responder. DOM input order, caret motion, and browser selection remain
browser behavior. Disabled or `tabFocusable: false` browsers are unavailable.
A boundary request leaves DOM selection untouched. Commands work inside the
active attached sheet and cannot select a control in its parent window.

These are explicit commands. JonUI installs no arrow-key handler for them, so
native text caret movement, input methods, multiline editing, and browser widget
keys keep their current behavior. Optional arrow-key routing for non-editing
contexts remains future work. Commands allocate no capture IDs, cells, callbacks,
or subscriptions and do not activate/key the app window. See the
[directional focus example](../examples/focus-direction/app.ts).

## Current focus name

`Focus.currentName(): string | null` reads the declared `focusName` of the actual
eligible first responder in the active window or sheet. Plain/secure field editors
resolve to their owning control; a WebKit DOM responder resolves to its browser's
name. Unnamed or cleared focus returns null, as does a hidden/disabled control or
a browser excluded with `tabFocusable: false`. It never reports a parent-window
name behind an active sheet. Names retain exact Unicode spelling.

```ts
Button('Next', () => {
  Focus.next();
  status.value = Focus.currentName() ?? 'No named control';
});
```

This is a synchronous snapshot. It does not subscribe, track a dependency, update
State, allocate a capture, or issue a focus request. Reading it repeatedly preserves
native editing sessions and DOM caret/selection. Updating/removing a name changes
the next snapshot without requiring a blur/refocus. A missing name returns null
even when an unnamed control is actively editing; null does not prove that no
native responder has focus.

Call it in mounted-window actions, effects or current tasks. Before a mounted
window it throws; render/computed use is rejected because native focus is not a
tracked dependency. Canceled tasks, retired RPC continuations and calls after
shutdown return null without native work. It uses the same layout/context check
as other focus operations: detecting a new active window retires old captures and
cycles. Snapshot reads are independent of the owned controller and projection
lifetimes described below.

## Focus-change subscriptions

`Focus.subscribe(listener)` reports changes to the actual eligible responder's
declared name and returns an idempotent unsubscribe function. It uses the same
name/null rules as `currentName()`, including exact Unicode, active-sheet
isolation, and disabled/passive controls. It does not replay the current name on
subscription. Use `currentName()` when a separate synchronous snapshot is needed.

```ts
const actual = scope.state<string | null>(null);
scope.effect(() => Focus.subscribe(name => { actual.value = name; }));
// Return the unsubscribe function so unmount/effect cleanup releases it.
```

Subscriptions are asynchronous and coalesced. Rapid native movements can produce
only the final name; they do not promise every intermediate responder transition.
Switching DOM inputs within one named browser does not change its name. Committed
renames, removal, availability and sheet-context changes are sampled as well as
responder movement. A callback can lag a synchronous snapshot: keep observed
focus separate from desired focus requests. This API does not write focus or
provide a two-way binding.

While subscribed, imperative focus movement also acknowledges its actual result
before returning. Next/Previous/Clear, geometric moves, captured restoration and
named requests advance a request generation and observation sequence. Queued
observations from before that acknowledgement cannot later replace its result.
Callbacks remain asynchronous: a rapid request followed by Clear can coalesce
to cleared focus without delivering an obsolete intermediate gain. If a listener
moves focus during delivery, later listeners wait for the newer result rather
than receiving the older name. Each listener keeps its own baseline, preserving
no initial replay when it joins during pending delivery.

These acknowledgements protect the observed stream; they do not turn it into a
desired-state binding. Ordinary commands continue to target the current active
window. Internal context-bound requests can reject a retired window context,
which is groundwork for future declarative ownership.

All listeners share one active-window native observation session. Its token,
sequence and window-context counter reject events from retired sessions and
out-of-order deliveries. Native callbacks queue a fresh responder read rather
than preserving a possibly stale framework observation. AppKit's documented
[KVO-compliant firstResponder](https://developer.apple.com/documentation/appkit/nswindow/firstresponder)
property supplies responder changes; window notifications and committed graph
updates cover shared field-editor assignment, sheets and descriptor changes.
No input events, framework delegates or user keyboard preferences are changed.

Register outside render/computed bodies in a mounted app. Tasks own subscriptions
created in their async context and release them on cancellation; late canceled
subscriptions and post-shutdown registrations are inert. For component/effect
ownership, return cleanup as above. Otherwise explicitly unsubscribe or retain
the listener until app shutdown. Stopping the last listener invalidates the KVO
and notification registrations. Listener failures follow the normal callback
error path and stop the app with owner cleanup. Delivery is untracked; it does
not add dependencies to the effect that registered the listener.

## Owned focus controllers

Allocate `scope.focus(initialName?)` during component setup. Its `desired.value`
is tracked, writable intent; `actual.value` is a read-only tracked snapshot.
Native Tab/click movement updates actual focus without changing desired focus or
automatically requesting it again. The controller's names use the same app-wide
namespace and native eligibility as `Focus.requestNamed`.

```ts
const Form = Component(scope => {
  const name = scope.state('');
  const focus = scope.focus();
  return () => VStack([
    TextField('Name', { text: name.binding, focusName: 'name' }),
    Button('Request Name', () => focus.request('name')),
    Text(`Actual: ${focus.actual.value ?? 'none'}`),
  ]);
});
```

Requests run after the Node view transaction commits. Changing `desired.value`
queues a request; `request(name)` also queues a fresh attempt when the desired
name is unchanged. `request(null)` explicitly clears. Initial null/omitted names
are passive and preserve existing focus; an initial non-null name gets one
after-commit attempt. Unavailable/unrealized targets leave desired intent intact
and report the actual native responder; retry explicitly once eligible. There
is no polling or automatic refocus when user movement or availability changes.

Each controller captures the active window context through a fresh native
snapshot on its first post-commit effect. Its `actual` can reflect any named
control in that context, including controls declared by another component.
Every request is generation-stamped and bound to the captured context. A context
change sets read-only `retired.value` to true, clears actual to null
and releases its observation subscription. A request racing ahead of the context
notification is rejected by the native context guard. Parent-controller requests
cannot move focus into a new sheet. Returning to the parent does not resume that
controller automatically; call `resume()` or remount its owner to start a new context.

Retired controllers retain editable desired intent for display but issue no
further focus requests. `request` after retirement is inert. Unmount/setup failure
releases all controller cells, effects, computations and subscriptions; late
requests/writes from canceled tasks or disposed owners are ignored. Read-only
computed views follow normal scoped Computed disposal rules. Render/computed
focus writes and allocation outside setup are rejected.

### Explicit resumption

`resume()` ends the old observation immediately and queues a fresh active-window
snapshot after view commit. It preserves the controller object, desired value,
subscriptions to desired data and component model. Actual is cleared and retired
remains true until the fresh snapshot succeeds; the controller then tracks its
new context with retired false. Resumption is passive: retained intent and older
pending requests are not replayed, and focus does not move just to resume.

```ts
focus.resume();              // Bind the current active context after commit.
focus.request('name');       // A new request in this turn applies after resuming.
```

A desired-value change made after `resume()` is also a new request. An unchanged
value needs `request(name)`. Multiple resumes coalesce; the last one discards
requests queued before it. This can rebind to a sheet while it is active or to
the parent after dismissal. It does not automatically select a physical window,
activate the app or restore the old desired responder.

Task and RPC calls carry their starting focus lifetime. After another caller
resumes a controller, those older contexts cannot write its desired value or
queue requests. Newly started work can write it. A current task that explicitly
calls `resume()` authorizes its own following writes until another resumption.
Canceled tasks cannot resume, and commands whose caller is canceled before their
after-commit effect runs are suppressed. Already accepted desired data may remain
for display; no canceled queued command moves native focus. Disposal before a
queued resumption prevents the new observation session from starting.

The controller exposes no scalar `binding` for desired focus. Named boolean
projections and standalone boolean controllers are described below. Typed non-string
selections, automatic physical-window resumption and realization-aware policies
remain future work. Controllers created in a parent context before a
sheet appears retire when that sheet becomes active; this is not a sheet
appearance hook. Try `bin/jonui examples/focus-controller/app.ts` for requests,
actual/desired display, passive resumption and a full component reset preserving form values.

## Projected focus bindings

`focus.binding(name)` creates a branded `FocusBinding` for a named target.
Its tracked boolean `value` reads actual native focus; setting true queues a
request after view commit. `.focused(binding)` declares that target on a control:

```ts
const Form = Component(scope => {
  const text = scope.state('');
  const focus = scope.focus();
  const name = focus.binding('name');
  return () => VStack([
    TextField('Name', { text: text.binding }).padding(4).focused(name),
    Button('Focus Name', () => { name.value = true; }),
    Text(name.value ? 'Name is focused' : 'Name is not focused'),
  ]);
});
```

TextField, SecureField, TextEditor, DatePicker and WebView support the modifier,
including through single-child modifiers such as frame, padding and disabled.
Apply it to the input before a two-child sheet modifier. Containers and other
controls are currently rejected. An explicit different `focusName` conflicts;
names still share the app-wide unique, exact-Unicode namespace. Projected views
must live in the owning controller component's logical subtree, including nested
components, so their registrations end with that owner. Disposed/foreign/forged
projections are rejected when wiring views.

Setting false clears retained intent for that target and conditionally blurs it.
It leaves a newer pending request for a different target intact. Native code
checks the exact current name immediately before clearing: a stale observed true
cannot blur a different target that has since gained focus. An unavailable target's
retained intent can also be canceled without clearing an unrelated responder.
False on an already-unfocused target with no matching intent is inert.

Reads reflect native observation, so a true write does not immediately make the
getter true. Repeated true writes explicitly retry. Native movement updates the
getter through the controller's read-only actual value; no editing callback writes
back into desired intent. Invalid non-boolean writes throw. Retirement, resumption,
task/RPC leases and cancellation follow the controller contract.

Projections allocate no cells, effects, callbacks or native handles and can be
created in render bodies. Only the name reaches native view descriptors. They
are distinct from scalar `Binding<boolean>` and cannot be substituted for a
Toggle's value binding. This is the named-target subset of focus binding;
general SwiftUI FocusState overloads remain partial.

## Boolean focus controllers

Use setup-only `scope.focusBoolean(initialFocused = false)` when a control needs
its own boolean focus state without choosing a name:

```ts
const Form = Component(scope => {
  const text = scope.state('');
  const focus = scope.focusBoolean(true);
  return () => VStack([
    TextField('Name', { text: text.binding }).focused(focus.binding),
    Button('Request focus', () => focus.request(true)),
    Button('Clear this field', () => focus.request(false)),
    Text(`Desired ${focus.desired.value}; actual ${focus.actual.value}`),
  ]);
});
```

`desired.value` is tracked boolean intent; `actual.value` is read-only observed
focus. `binding.value` also reads observed focus and accepts deferred requests.
Native movement changes actual without changing desired. Setting desired true
requests focus after commit; setting false cancels its intent and conditionally
clears only this target. A different focused control stays focused. Equal desired
writes are inert; use `request(true)` to retry an unavailable target or
`request(false)` to clear it when desired is already false. Initial false is
passive; initial true attempts once after commit, without polling realization.

Attach the stable `binding` property to one supported descendant input using
`.focused(focus.binding)`. The supported controls, modifier/ownership rules and
native eligibility are the same as named projections. Reusing one binding on
multiple inputs fails the existing duplicate-name check. Independent controllers
have distinct generated names, stable for that component's lifetime and keyed
reorders. `Focus.currentName()` and `Focus.subscribe()` expose these opaque names;
use the controller's boolean actual value instead of storing or matching them.
Do not supply a separate explicit `focusName` on its input.

`retired` and passive `resume()` follow the named controller contract, including
modal context changes, stale task/RPC leases and canceled pending requests.
Independent controllers retain independent intent and leases. Resume does not
replay true intent. Disposal makes late writes inert and releases all owned work.
Each boolean controller uses one named controller internally, with the same five
cells, two effects and two computations; its boolean wrappers add no native
resources. Try `bin/jonui examples/focus-boolean/app.ts`.

## Captured responder targets

`Focus.capture()` returns an opaque `FocusTarget` for the current eligible native
first responder, or null when none is focused. A text field's shared field editor
is resolved to the actual NSTextField/NSSecureTextField control; a multiline
editor uses its NSTextView. `Focus.request(target)` returns true if that same
physical control is already focused or accepts first responder, and false if the
target has expired, become unavailable, or refuses focus. Neither operation keys
the window or activates the app. Requests use native makeFirstResponder directly;
named controller projections provide deferred requests as described above.

```ts
import { Focus } from "jonui";
import type { FocusTarget } from "jonui";

let saved: FocusTarget | null = null;
// Inside an action/submit handler, while the desired control has focus:
saved = Focus.capture();
// Later, restore it if its native identity remains available:
if (saved && !Focus.request(saved)) saved = null;
```

Keep handles in ordinary variables or component closures; they are not JSON or
JonUI State values. They are frozen, unforgeable runtime objects, with no exposed
native ID or control contents. Deserializing/copying a handle cannot create a
target. Malformed objects throw before reaching native code. Before a window is
mounted, capture throws just like traversal. After shutdown or in canceled tasks,
capture returns null and request returns false; render/computed use is rejected.

The host stores weak NSView references and reuses one registration per physical
control. Captures do not retain controls, cells, or component scopes. Value/label
updates and keyed reordering preserve a capture when SwiftUI keeps the same
native control. They cannot target a control that has never been focused or one
that an unrealized lazy row has not created.

**Adding/removing any native view handle retires all captures**, including those
for otherwise unchanged controls. This conservative policy prevents a saved
handle from focusing a cached adapter after its logical owner disappears.
Reordering existing handles and property-only updates do not retire captures.
Rejected transactions leave them intact. Re-capture the current responder after
a structural edit; a stale target always returns false and its numeric ID is
never reused. A control removed/recreated by SwiftUI can also expire its weak
reference independently. Detecting a different active window also retires all
captures, as described below. Named text-input targeting is described below. WebKit captures
address a physical browser responder, as described below.

## Declared focus names

Give a TextField, SecureField, TextEditor, DatePicker, or WebView an app-wide unique
`focusName`, then request it without first
capturing a responder:

```ts
TextField('Search', { text: query.binding, focusName: 'search' });
WebView({ html: '<input aria-label="Search">', focusName: 'search-browser' });
DatePicker('Appointment', { selection: appointment.binding, focusName: 'appointment' });
// Inside a mounted-window action or current effect/task:
const focused = Focus.requestNamed('search');
```

The request returns true when the target is already focused or accepts native
focus, and false when its name is absent, its native view is unrealized, it is
disabled/hidden, belongs to a different active window, or refuses focus. A sheet
can use its own named inputs, while requests for parent-window names are rejected.
An unrealized lazy row is not created by name lookup; requesting its name can
succeed after native scrolling realizes the row. Native realization remains
asynchronous, so an immediate request after declaring a view can return false.

Names are nonempty, well-formed Unicode strings with exact spelling, case, and
UTF-8 identity; canonically equivalent composed/decomposed spellings are distinct.
All named views in the mounted logical graph must have unique names, including
hidden sheet content and unrealized rows. Duplicate names reject the native
transaction atomically, retaining the prior graph/name registry until normal error
handling runs. Invalid name types, empty strings, and malformed Unicode throw.
Before a mounted window, valid requests throw; render/computed use is rejected.
Canceled tasks and calls after shutdown return false with no native operation.

Changing or removing `focusName` updates lookup on the next commit without
replacing a text input, reloading a browser document, or retiring an existing
physical capture. Reassigning a name makes subsequent requests select its new
owner. An already-focused request preserves its editing session and browser DOM
selection. Name lookup
adds no capture registrations, cells, or callbacks and does not alter a traversal
cycle. Registry entries contain only logical node IDs; removal/shutdown clears
them without retaining native controls or component scopes.

Native text inputs and date pickers own a bounded [NSHostingView](https://developer.apple.com/documentation/swiftui/nshostingview)
subtree, with the surrounding SwiftUI environment forwarded to their existing
SwiftUI controls. The host resolves editable NSTextField/NSTextView descendants
or an eligible NSDatePicker only inside that control's subtree. It uses public AppKit types and live window
eligibility, without matching labels, accessibility IDs, geometry, or private
SwiftUI class names. The same hosting surface is used with and without a name;
registration changes preserve the native input's identity. Logical removal
immediately retires its coordinator and clears cached content, preventing a late
representable update from registering an obsolete input. Shutdown releases all
registrations. Buttons, toggles, sliders, steppers, and choice pickers still need
named registration. Individual DOM elements use browser code. Declarative focus
bindings remain open. A named request selects the physical responder; a captured
target can then be used in `Focus.setTraversal` as usual. The native focus example
includes **Focus name**, **Focus secret**, and **Focus notes** buttons, and the web-control example includes
**Focus web control** alongside its show/enable toggles.

A named DatePicker request focuses its first realized, eligible NSDatePicker
component in native subtree order. It does not open a calendar popover or select
a particular date/time segment. The date's value, bounds, time zone, and normal
target/action binding remain independent of naming. Availability follows actual
platform key-view rules for the current style/components; a style that exposes no
eligible NSDatePicker returns false. Dynamic style changes can recreate platform
controls and expire physical captures; names resolve the current native surface.
The form example includes **Focus appointment**. Compact date, graphical date,
automatic time, and compact date-and-time requests are verified in the inactive
offscreen window with full keyboard access left at its existing setting.

## Command traversal cycles

`Focus.setTraversal(targets)` configures an explicit cycle of captured responders
for `Focus.next()` and `Focus.previous()`, including Return handlers that call
those commands. The array is copied and its targets must identify distinct native
controls; recapturing one physical control does not make it a second target.

```ts
import { Focus } from "jonui";
import type { FocusTarget } from "jonui";

function useFormCycle(name: FocusTarget, notes: FocusTarget, secret: FocusTarget) {
  return Focus.setTraversal([name, notes, secret]);
}
// Inside a mounted-window action, restore the native command order:
// Focus.setTraversal([]);
```

Next advances and wraps through the supplied order; Previous reverses and wraps.
If focus is outside the cycle or cleared, Next enters its first target and
Previous its last. A one-target cycle keeps that responder without restarting its
editing session. `Focus.clear()` clears the first responder while retaining the
cycle. `Focus.setTraversal([])` removes the cycle and restores native traversal
for these commands. Direct `Focus.request(target)` remains independent.

Configuration returns true on success. A stale or unavailable target returns
false and leaves a still-valid prior cycle intact. Invalid arrays, forged handles,
and duplicate native identities throw before configuration changes. As with
other focus operations, render/computed calls are rejected; canceled tasks and
post-shutdown calls return false. Effects can configure a cycle using a block
callback that returns undefined.

The cycle stores only weak native target IDs and adds no cells or callbacks.
Structural capture retirement clears it automatically. If any member later
expires or becomes ineligible, the next traversal discards the entire cycle and
uses native order. Re-capture and configure the controls again after such changes.
Keyed reorder and value/label updates retain the explicit order while captured
physical views remain available.

By default, the cycle applies only to Focus commands; Tab/Shift-Tab keep platform
handling. One cycle belongs to the current focus window; a detected window switch
discards it. Independently mounted components in one window share the cycle.

## Tab and Shift-Tab routing

Opt in to keyboard routing for the same captured cycle:

```ts
Focus.setTraversal([name, notes, secret], { tabNavigation: true });
```

Here `name`, `notes`, and `secret` are already captured FocusTargets. Unmodified
Tab and Shift-Tab key-down events in the active JonUI window or sheet follow
that explicit order and wrap, including entry from cleared/unlisted focus. A
multiline editor leaves for the next target instead of inserting Tab while routing is enabled.
A one-target cycle preserves its existing editing session. A responder that
refuses to resign keeps focus; the same key is not retried through another path.

Command/Control/Option-modified Tab, key-up events, and responders with marked
text pass through to native handling. This lets shortcuts and input-method
composition/candidate selection continue normally. Routing is window-local; it
uses neither global event monitors nor rewritten next-key-view links and does
not activate/key the window. An application-owned dispatcher handles the opt-in
before window dispatch, including SwiftUI-owned sheets. Unhandled events continue
through AppKit. WebKit input-method/composition remains separate coverage work.

Use `Focus.setTraversal(order, { tabNavigation: false })` or omit the option to
keep only command traversal; omitting it also disables a prior opt-in. Use `[]`
to clear both the cycle and routing. Empty cycles never intercept Tab, even if
the option is true. Reset restores native key handling, including ordinary Tab
insertion in a multiline editor.

All configuration is validated before replacing a valid cycle/mode. A failed
configuration leaves both intact. Structural retirement, disposal, expired weak
targets, or ineligible members clear routing with the cycle. Reconfigure after
re-capturing targets. Declared text-input names offer lookup before first capture.

```sh
bin/jonui examples/focus/app.ts
```

The example provides Next/Previous/Clear, Remember/Restore, and cycle/reset buttons.
Press Return in Name and Demo secret to remember both controls, then enable Tab
between those fields. Native traversal resets the mode. The multiline editor
keeps normal Return/newline behavior. Only the demo secret's length is displayed.

## Native focus sections

Apply `.focusSection()` to a container to group its focusable descendants:

```ts
HStack([
  VStack([TextField('First', { text: first.binding }), TextField('Last', { text: last.binding })]).focusSection(),
  VStack([SecureField('Secret', { text: secret.binding }), SecureField('Confirm', { text: confirmation.binding })]).focusSection(),
]);
```

With these four fields in two columns, native Tab visits First, Last, Secret,
Confirm; Shift-Tab reverses that order. Without sections, the same layout uses
row order. SwiftUI uses a section's frame to guide directional movement toward
its descendants too. A section adds no focusability; one without eligible
descendants has no focus effect. This follows Apple's
[focusSection semantics](https://developer.apple.com/documentation/swiftui/view/focussection%28%29/).

The modifier takes no arguments and leaves visual layout unchanged. It creates
no cells, target registrations, or callbacks. Native SwiftUI handles movement;
an explicit `Focus.setTraversal(..., { tabNavigation: true })` cycle takes priority
for intercepted Tab events. Reset that cycle with `Focus.setTraversal([])` to
resume native section handling. Direct captured requests still select their
physical control. Sections do not register names or realize offscreen lazy rows.

```sh
bin/jonui examples/focus-sections/app.ts
```

The example uses native grouping with no custom event routing and shows the
current editing session and model summary without displaying secret contents.

## Disabled controls and non-text responders

Use `.disabled()` (default true) or `.disabled(boolean)` to control interaction
for a view subtree. Place dynamic State reads inside a tracked body:

```ts
const blocked = State(false);
View(() => VStack([
  TextField('Name', { text: name.binding }),
  DatePicker('Appointment', { selection: appointment.binding }),
]).disabled(blocked.value));
```

Disabling an ancestor also disables descendants with `.disabled(false)`.
The modifier accepts only booleans and changes no model values. It adds no cells
or callbacks; property-only flag updates preserve scoped state, callbacks, and
captured physical identities. Re-enabling allows an existing captured control
to be requested again if SwiftUI preserved its native view. A cycle already
discarded because of unavailability must be configured again.

Focus capture/request and explicit cycles also support eligible non-text NSViews.
Actual NSDatePicker responders are verified alongside plain text fields, including
Next/Previous, Tab/Shift-Tab, native value updates, and keyed reorder. Disabled
or hidden controls reject requests and new traversal configurations. An existing
cycle falls back to native order when traversal finds an unavailable member.

Eligibility uses native
[canBecomeKeyView](https://developer.apple.com/documentation/appkit/nsview/canbecomekeyview)
and first-responder acceptance. The system's
[keyboard-access setting](https://developer.apple.com/documentation/appkit/nsapplication/isfullkeyboardaccessenabled)
affects available controls. On the current machine it is off: NSStepper and
NSSegmentedControl can be made first responder directly but are excluded from
capture. Tests assert that exclusion without changing system preferences. Their
eligible path still needs a run with keyboard access enabled. SwiftUI Button,
Toggle, Slider, and menu Picker do not expose corresponding NSControl instances
in this SDK's offscreen hierarchy; their capture/keyboard interaction remains
unverified. Sheet text-input coverage and mixed WebView behavior are described
below; non-text controls within sheets remain unverified.

The focus example includes a toggle to disable its demo secret. A previously
captured secret target becomes unavailable while disabled, and its stored
value remains intact.

## WebView responders

While a WebView has native focus, `Focus.capture()` captures its physical WebKit
responder. All DOM controls within that browser share the same native target;
capturing two focused HTML inputs does not create distinct traversal entries.
Two separate WebViews have separate native targets. Captures observe the same
weak-view lifetime and structural-retirement rules as native text controls.

`Focus.request(target)` restores the browser's native responder. WebKit retains
the currently active DOM element and selection across ordinary data updates and
keyed reorder. HTML replacement reloads the document and its DOM state. A native
target can still restore the browser when WebKit keeps its physical responder;
it does not identify an element from the old document. DOM-specific targeting
requires application-authored browser code and is outside this API.

A cycle containing a browser and native fields supports Focus.next/previous and
optional window-local Tab/Shift-Tab. With `tabNavigation: true`, each Tab advances
the native cycle, including leaving a browser containing multiple DOM inputs.
Reset the cycle with `Focus.setTraversal([])` to restore WebKit's own Tab movement
between DOM controls. Native clear/restore and these tests do not activate or
key the window.

WebViews now inherit `.disabled()` from SwiftUI containers. The native WebKit
adapter declines pointer hits and key-view entry, resigns existing native focus,
and rejects captured restoration while disabled. Internal WebKit descendants
also fail JonUI's eligibility check. Re-enabling preserves the loaded document,
DOM state, data bridge, and captures when the physical responder survives. Scripts
and data delivery continue while user interaction is disabled; browser code can
still change DOM state and its active element. The example's **Enable web input**
toggle demonstrates this without unmounting or reloading the control.

By default, Tab enters a browser at its first DOM input, continues through the
document, then leaves its last input for the following native control. Shift-Tab
reverses that path and enters at the last DOM input. These default boundaries are
verified with no custom cycle. A document with no focusable DOM descendants still
has a native browser-container stop; a second Tab leaves it.

Use `WebView({ html, tabFocusable: false })` for a passive visualization that should
be skipped by native Tab/Shift-Tab. The default is true. This flag changes native
key-view eligibility while preserving pointer hits, scripts, data, and RPC. It
does not resign an already-focused browser; that browser can still leave through
native Tab. Captured/named focus uses key-view eligibility, so such targets are
unavailable while the flag is false, and a configured cycle containing one falls
back to native order. Re-enabling preserves an existing physical capture when
its view survives. Put a dynamic flag inside a tracked View body. Malformed flags
fail on Node and again atomically during native commits.

Retiring a WebView disables its cached adapter before stopping navigation,
clearing handlers, and replacing its document. Deferred SwiftUI updates cannot
re-enable a retired adapter. Logical removal also retires captured targets and
configured cycles. WebKit composition/IME, accessibility focus, and WebKit content
inside nested sheets still need separate coverage.

IME coverage remains concretely blocked in the non-key/inactive test window:
WebKit accepted NSTextInputClient.setMarkedText into the DOM, but both the direct
and input-context clients continued to report hasMarkedText false. This does not
establish an active composition session for testing the routing guard. No input
source preference, active context, or key-window state was forced. Actual input-
method/candidate behavior remains a manual check; the existing native NSTextView
marked-text bypass is automated.

## Active sheets and window isolation

Before every focus operation, the host follows the main window's
[attachedSheet](https://developer.apple.com/documentation/appkit/nswindow/attachedsheet)
chain and selects the deepest attached window. Next/Previous/Clear, capture/request,
and traversal cycles operate within that window. A captured parent target
cannot restore focus behind a modal sheet. No operation activates the app or makes
a window key. Native plain/secure/multiline controls are verified in a single
SwiftUI sheet; nested sheets remain a coverage gap.

A detected change of focus window retires all captured targets and the configured
cycle, even when the logical view graph is unchanged. Re-capture after switching
between a sheet and its parent. The host remembers the context weakly, so it
does not retain dismissed windows or their content. After dismissal, the next
operation selects the parent and rejects previously captured sheet targets.

`Focus.setTraversal(order)` supports command cycles inside a sheet. Add
`{ tabNavigation: true }` to route its Tab/Shift-Tab through that same cycle.
The application dispatcher filters events to the active focus window, so parent
events cannot traverse behind the sheet. Resetting with `[]` restores native
Tab/Shift-Tab and multiline Tab insertion. Invalid or stale targets preserve the
existing valid cycle and mode. No framework window delegates or global event
monitors are installed.

```sh
bin/jonui examples/focus-sheets/app.ts
```

The example remembers inputs on Return and supports Next/Previous/Clear and
an opt-in Tab cycle between its named fields inside the sheet. Sheet content
retains normal logical scope ownership: dismissing the presentation preserves models while its declaration
is mounted. Removing the owner releases scoped cells/callbacks and dismisses a
focused sheet; stored targets then become unavailable.

Named native text-input targeting, a reliable two-way focus binding,
and broader platform focus coverage remain future increments. A
boolean SwiftUI FocusState synchronization prototype was discarded because stale
native notifications could revive a newer blur request. Capture/restore avoids
that adapter by retaining weak identity for an already focused native control.
Text-input registration still needs a reliable mapping from logical views to native
controls: SwiftUI accessibility identifiers do not appear on their AppKit NSViews.

## Validation

Offscreen integration tests inspect actual NSTextField/NSSecureTextField field
editors and NSTextView first responders while asserting the window never becomes
key. They cover Next/Previous/Clear, Return and Unicode snapshot ordering, keyed
focus identity and reordered traversal, rapid movement, empty controls, invalid
directions, and 20 focused mount/unmount cycles returning native views/cells and
callback counts to baseline. Unit/type tests cover command transport, frozen API,
render/computed purity, effect use, canceled tasks, and post-shutdown no-ops.

Capture/restore tests cover all three native text input kinds, one weak
registration across 50 recaptures, exact targets through value/label changes and
keyed reorder, rapid request/clear ordering, malformed/stale/foreign handles,
atomic invalid transactions, conservative structural retirement, lazy row/cache
removal, and 20 focused capture/unmount cycles with all native registrations,
view boxes, cells, and callback counts returning to baseline.

Cycle tests verify real forward/reverse wrapping, entry from an unlisted control,
single-target no-op sessions, unavailable-member fallback, Return/Unicode ordering, copied arrays, keyed
reorder, atomic invalid/stale configuration, reset to native order, lazy cache
retirement, and 20 configured capture/unmount cycles with zero retained cycle
members, native registrations, cells, or callbacks.

Window-local keyboard tests dispatch actual NSEvent key-down/up messages through
the NSWindow subclass while asserting it never becomes key. They verify custom
forward/reverse/wrap/cleared entry, multiline focus, Unicode/keyed identity,
modifier and marked-text bypass, default multiline Tab insertion after reset,
atomic flag changes, unavailable/structural retirement, and 20 routed focused
mount/unmount cycles. Lazy cache tests also verify routing retires with targets.

Section tests send real Tab/Shift-Tab events with routing disabled and compare
two-column grouped order against the same ungrouped geometry. They verify
unchanged frames, plain/secure controls, Unicode input, captured/keyed identity,
explicit-cycle reset, empty sections, atomic malformed-modifier rejection, and
20 focused mount/unmount cycles returning views/cells/callbacks to baseline.
Directional arrow movement remains a manual/uncovered case.
The non-text/disabled scenario adds real NSDatePicker capture, bounded recapture,
command/Tab cycles, Unicode/date edits, atomic malformed flags/child counts,
inherited availability changes, hidden-target rejection, keyed identity, and
20 focused disable/re-enable/mount/unmount cycles at baseline resources. It also
checks real stepper/segmented eligibility under the current system setting.

Mixed-browser tests use two actual WKWebViews and a native text field. They verify
one physical handle across DOM inputs, command/custom Tab cycles, default DOM
Tab/Shift-Tab after reset, Unicode/selection/keyed identity, inherited disabling,
pointer/key-view exclusion, data delivery while disabled, HTML replacement,
late-document-message rejection, and 20 focused owner mount/unmount cycles with
native views/cells/handlers/targets returning to baseline.

Sheet tests verify parent isolation with unchanged logical handles, native
plain/secure/editor commands, Return/Unicode ordering, bounded weak captures,
command cycles, atomic rejection of custom Tab routing, native Tab/Shift-Tab and
multiline insertion, disabled/keyed identity, context retirement on dismissal,
and 20 focused owner mount/unmount cycles at baseline resources. Both windows
remain non-key with zero alpha, and the app remains inactive throughout.
Offscreen launchers ignore AppKit key/main promotion requests, including parent
promotion on sheet dismissal, while retaining key-view eligibility for responder
tests. Their transparent/offscreen configuration is applied before SwiftUI content
is attached. Normal launcher windows retain AppKit's usual promotion behavior.
Offscreen launchers and sheets also set
[`NSWindow.animationBehavior = .none`](https://developer.apple.com/documentation/appkit/nswindow/animationbehavior-swift.property)
to suppress automatic window ordering animations. A mixed-sheet regression
reproduced the recorded platform crash in UpdateCycle during AppKit's sheet-close
animation loop. The test checks the per-window policy, with repeated focused
owner-retirement stress. Ordinary launches retain their normal animation policy;
the framework path remains a separate limitation. A later full-suite run also
reproduced the same UpdateCycle null call during sheet-close animation with
`animationBehavior = .none`; that window policy has not eliminated the intermittent
failure. The focused mixed-sheet recheck passed. No platform crash fix is claimed.

Mixed-sheet tests combine plain/secure text inputs, a multiline editor, DatePicker,
and a two-input WebView in the same real AppKit sheet. They verify command cycles
and captures, application-dispatched Tab/Shift-Tab cycles and wrapping, native forward/
reverse Tab entry and exit through the DOM, inherited disabled and passive browser
eligibility, actual Return/Unicode/newline/date edits, snapshot delivery without
selection loss, and keyed identity. A parent date remains unchanged while actual
sheet NSDatePicker actions publish to the sheet's scoped state. Test date adapters
follow the active sheet, consistently with field/editor/focus adapters.

Sheet dismissal/reopening preserves its logical owner's state and handles;
presentation visibility is separate from component ownership. Reload and logical
owner removal cancel pending browser RPC. The mixed-sheet gate removes 20 focused
owners with pending calls and verifies retired views/cells/names/callbacks/requests,
aborted signals, and suppressed late shared-state/focus work. Nested sheets
and additional non-text keyboard-access paths remain open. Sheet text tests also
cover marked-text/modifier bypass, stale-target rejection and multiline reset.
Handled cycle events pass through the actual application `sendEvent` override;
unhandled test events use window-local native dispatch because offscreen windows
are deliberately non-key. Real keyboard/IME behavior still needs manual coverage.

Named tests verify first focus, exact Unicode IDs, case sensitivity, no capture
allocation over repeated requests, preserved DOM selection, rename/reassignment/
removal, physical-cycle interoperability, atomic invalid/duplicate rejection,
disabled availability, named sheet isolation, actual lazy realization, and 20
focused owner lifetimes at baseline resources. A duplicate-name startup case
verifies one stop/disposal and zero remaining native/Node cells/views/callbacks.

Default document-boundary tests send actual Tab/Shift-Tab events between two
native fields and a two-input WebView without custom routing. They verify DOM
entry at the appropriate end, forward/reverse exit to neighboring native fields,
Unicode/caret preservation on data updates, disabled/default-empty/passive
documents, explicit Tab eligibility with live RPC, keyed reorder and HTML reload,
atomic invalid flags, and 20 owner removals during pending native focus handoff.

Named native-input tests cover plain/secure/editor first focus, exact Unicode
names, actual text bindings/Return/newline ordering, repeated requests without
session churn or capture allocations, keyed/captured identity on rename,
reassignment/removal, atomic native/native and native/web duplicate rejection,
inherited disabling, active-sheet isolation, actual lazy realization through
scrolling, and 20 focused owner lifetimes at baseline adapters/views/cells/callbacks.

Named date-control tests verify distinct owners with identical labels, first focus,
exact Unicode names, native date actions/bindings, physical Tab cycles,
keyed/captured rename/reassignment/removal, atomic date/text/web namespace
collisions, inherited disabling/hidden availability, style/component/time-zone
changes, active-sheet isolation, actual lazy realization, 20 focused owner
retirements, and duplicate-name startup cleanup. Eligibility is measured from
real NSDatePicker controls without changing full keyboard access settings.

Directional tests exercise actual first responders in a 2×3 native plain/secure/
editor/date/WebKit layout: all axes, edge no-ops, aligned versus diagonal choices,
cone exclusion, explicit-cycle membership and unavailable reset, browser-container
normalization and preserved DOM selection, keyed/captured identity, malformed
directions, active-sheet isolation, lazily realized neighbors, and 20 focused
owner lifetimes with baseline views/cells/registrations/callbacks and no activation.
