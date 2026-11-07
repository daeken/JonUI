# Component scopes

Define a component once, then instantiate it as a View value. Setup runs once for
each mounted instance; its returned body receives current props and tracks State
reads normally.

```ts
import { Button, Component, Text, TextField, VStack } from "jonui";

const Counter = Component<{ title: string }>((scope, initialProps) => {
  const count = scope.state<number>(0);
  const note = scope.state<string>(initialProps.title);

  return props => VStack([
    TextField("Note", { text: note.binding }),
    Button(`${props.title}: ${count.value}`, () => { count.value++; }),
  ]);
});

// This creates a descriptor. State is allocated only when it actually mounts.
const content = Counter({ title: "Counter" });
```

A component factory is its type identity. Declare it outside recomputed bodies
(or once during another component's setup). Instances preserve state at matching
structural positions and matching `ForEach` keys. Reordering keyed rows retains
their instances; removing a row unmounts it, so reinserting it initializes fresh
state. Changing the factory at a position also creates a fresh instance.

`initialProps` is the setup snapshot. Read the returned body's props argument for
current values; setup is not rerun when props change. Plain props are not deeply
observable—changes arrive through parent reconciliation or State reads.

## Ownership and cleanup

Use `scope.state(initial)` for local cells. Root-level `State(initial)` remains
app-owned for shared models. Allocate scoped cells during setup, not in a render
body or event callback.

Register synchronous lifetime cleanup during setup:

```ts
const Clock = Component(scope => {
  const ticks = scope.state<number>(0);
  const timer = setInterval(() => { ticks.value++; }, 1000);
  scope.onDispose(() => clearInterval(timer));
  return () => Text(`Ticks: ${ticks.value}`);
});
```

Child scopes dispose before their parents. Cleanup runs once, in reverse registration order, when the instance unmounts or
its setup fails. All sibling cleanups and state disposal still run if a cleanup
throws. Such failures propagate to a containing render recovery boundary, or
cause an orderly application failure during shutdown. This is a synchronous
lifetime hook. Use `scope.effect` for synchronous dependency-based work and
`scope.task` for owned asynchronous work.

Disposal immediately removes Node subscriptions and callback registrations.
Writes and new subscriptions through old State references become no-ops, so late
callbacks cannot resurrect an instance. Reads outside a render retain the last
value; reading disposed state from a new render or requesting its binding throws.
State and bindings must not outlive their owning component.

Native cells are released after the view transaction removes their bindings.
The host rejects release while a committed native view still uses a cell, rather
than leaving a dangling binding. Native bindings weakly reference registered
cells, and stale view bodies check their mount identity before creating bindings.

## Structured state

Both `State(initial)` and `scope.state(initial)` accept JSON records and arrays,
as well as scalars. Every value is a detached, deeply frozen snapshot. Update a
model by assigning a replacement; mutating its nested fields or arrays throws.
Objects passed into a write remain independent of the stored snapshot.

```ts
interface Row { id: string; label: string }
const rows = State<Row[]>([{ id: "a", label: "First" }]);

rows.value = [...rows.value, { id: "b", label: "Second" }];
rows.value = rows.value.map(row => row.id === "a"
  ? { ...row, label: "Updated" } : row);

const content = View(() => ForEach(
  rows.value, { id: row => row.id }, row => Text(row.label),
));
```

Import `State`, `View`, and `ForEach` for this example. Keys continue to select
component identity when arrays are filtered, replaced, or reordered.
`StateSnapshot<T>` describes the deeply readonly value returned by reads and
subscriptions. Model interfaces work without an index signature. Use an explicit
model type for empty arrays, nullable fields, or intentionally narrow unions.

Dependencies track the whole cell. A changed nested field invalidates every
consumer that reads that State. Replacements compare structurally: object key
order is ignored and array order matters. Equal replacements preserve the
existing snapshot reference, skip notifications/renders/effects, and do not
advance native revisions. Synchronous changed replacements still batch view and
effect work, while explicit subscribers see each acknowledged change.

Values must contain only finite numbers, booleans, strings, null, dense arrays,
and plain records with enumerable data properties. Cycles, undefined (including
explicit undefined properties), functions, BigInt, symbols, sparse/custom arrays,
getters, hidden properties, Dates, Maps, Sets, and class instances are rejected
before a native write. Convert such application values to JSON data explicitly.
Repeated references are copied as independent nested values.

Native `.binding` is available only for scalar State types. A record or array
cannot bind directly to a text field or toggle; keep editable input in a scalar
cell and replace the model from an action or subscription. No field/path binding
API is provided yet. Structured scoped cells use the same unmount release and
late-task write protection as scalar cells.

## Computed values

Use `Computed(() => …)` for an app-owned, read-only derived value, or
`scope.computed(() => …)` during setup for one owned by a component. Import
`Computed` with the other constructors.

```ts
const rows = State<{ id: string; label: string }[]>([]);
const query = State<string>("");
const visible = Computed(() => rows.value.filter(row =>
  row.label.toLowerCase().includes(query.value.toLowerCase())));
const count = Computed(() => visible.value.length);

const content = View(() => Text(`Showing ${count.value} rows`));
```

Construction does not evaluate the callback. The first `.value` read evaluates
and caches its deeply frozen JSON snapshot. Subsequent reads share that cache
until a State, current `scope.props`, or another computed value read by the
callback invalidates it. Conditional reads replace the dependency set. Reading a
derived value from a State subscriber sees the latest acknowledged input
immediately; view/effect work still batches normally. No native cell is allocated
for a computed value.

Any input invalidation propagates to consumers, even if the next derived result
is equal. Equal results preserve their previous snapshot reference. Computed
values have no `.binding`, setter, or direct subscription API; read them from a
view, `scope.effect`, or the synchronous prefix of `scope.task` to observe changes.
Use a scalar State cell for editable native input.

Callbacks must be pure and return synchronous JSON data. State writes,
allocations, explicit subscriptions, owned resource registration, and effect/task
stop operations are rejected during a derivation. Use an effect or task for such
work. Promise-returning callbacks get a diagnostic, and their async
continuations cannot write State. Plain nonreactive data read by a callback does
not invalidate the cache; put changing inputs in State or props.

Errors are cached until a tracked input changes. A view recovery boundary can
display them and retry through normal dependency updates. Direct and indirect
dependency cycles throw a diagnostic rather than recursing indefinitely. A
failure reached from a scheduled effect or task follows that callback's normal
application failure path.

Invalidation immediately detaches stale input subscriptions; the next read
reestablishes them. Root computations live until app shutdown. Scoped ones
release their dependencies, callback, and cache when their owner unmounts or
fails to mount. During component lifetime cleanup, a previously successful cached
result can be inspected without reevaluating already detached inputs. Never-read
or failed computations cannot be evaluated during unmount, and all reads after
final disposal throw. Allocate shared computations outside reactive callbacks;
allocate local ones once during component setup.

## Reactive effects

Register effects during setup. Each runs after its instance's native view has
committed, then reruns when a State value read synchronously by the callback
changes. It cleans up the previous run before starting the next one.

```ts
const DelayedLabel = Component<{ label: string }>(scope => {
  const output = scope.state<string>("");
  scope.effect(() => {
    const label = scope.props.label;
    const timer = setTimeout(() => { output.value = label.toUpperCase(); }, 100);
    return () => clearTimeout(timer);
  });
  return () => Text(output.value);
});
```

Read `scope.props` inside the callback to observe current props. This tracks the
whole props snapshot: top-level keys and values are compared shallowly, while
nested objects are compared by reference. Pass immutable props; unrelated parent
renders with equal shallow props do not restart effects. Setup's `initialProps`
argument remains the original snapshot.

Effects can write State. Multiple synchronous input writes batch into one run,
and conditional reads replace the dependency set on each execution. Cleanup
reads and synchronous State subscriber reads do not add dependencies to the
calling effect. Effects without tracked inputs run once until stopped or unmounted.

`scope.effect` returns an idempotent stop function. Call it from an action,
another effect, or other non-render code to remove subscriptions and run cleanup
immediately. Stopping a queued effect prevents it from starting. Stopping during
its own callback still runs a newly returned cleanup exactly once. View bodies
cannot stop effects because doing so would execute resource cleanup during render.

Effect callbacks must synchronously return `undefined` or a cleanup function.
Cleanup must also be synchronous. Promise-returning callbacks/cleanups produce
a clear diagnostic. Use `scope.task` for an async callback.

Dependency-triggered runs always follow pending view commits. An effect write
that removes another component is reconciled before the removed component's
queued effect starts. Failed setups/renders never start their effects. Unmount
stops all effects and cleanup functions even if one fails. Exceptions during
scheduled effect callbacks or rerun cleanup use the app's orderly failure path;
render-time unmount failures follow the containing render boundary's policy.

Feedback loops are diagnosed after 100 executions at one structural effect site
within a flush. Independent effects in large keyed lists are counted separately.
A separate 10,000-wave guard bounds more general non-settling render/effect chains.

## Asynchronous tasks

Register `scope.task` during setup. Its synchronous prefix tracks State reads and
current `scope.props`, using the same post-commit scheduling and batching as
effects. An input change cancels the previous run before starting another.

```ts
import { setTimeout as delay } from "node:timers/promises";

const DelayedLabel = Component<{ label: string }>(scope => {
  const output = scope.state<string>("");
  const stop = scope.task(async task => {
    // Capture inputs before await: reads after await do not track dependencies.
    const label = scope.props.label;
    await delay(100, undefined, { signal: task.signal });
    output.value = label.toUpperCase();
  });
  return () => VStack([
    Text(output.value),
    Button("Stop", stop),
  ]);
});
```

The returned stop function is idempotent. Stop, input changes, unmount, failed
mounts, and application shutdown follow the same ownership rules as effects.
Failed mounts never start tasks. Each run receives its own `AbortSignal`, which
is aborted on cancellation. Pass it to Node APIs that support cancellation.

Node async context also guards State writes in the task's Promise continuations
and timers. A canceled run cannot overwrite either local or shared State, even
if its underlying operation ignores the signal. This includes late `finally`
blocks, abort listeners, and cancellation cleanup. New subscriptions from stale
work are ignored; allocating root State from a stale task throws. Cancellation
cannot forcibly terminate an arbitrary Promise or undo external side effects.

Use `task.commit(() => …)` to publish results to an external cache or from a
callback API that does not preserve Node async context. It invokes a synchronous
callback only while the run is current and returns whether it ran. The readonly
`task.isCurrent` flag provides the same lifetime check. A completed run remains
current until its next input change, explicit stop, or unmount.

Register resource cleanup with `task.onCancel(() => …)`, for example to clear a
timer or detach an event listener. It returns a function that unregisters that
cleanup. Cleanups run synchronously in reverse registration order; registering
one after cancellation executes it immediately. State subscriptions created
within a task are automatically removed on cancellation, and their callbacks
run in that task's context. Resources stay owned after the task Promise settles,
until cancellation, so subscriptions cannot escape a completed task's lifetime.

Task callbacks return `undefined` or `Promise<void>`. Commit callbacks and cleanup
must be synchronous. A current task's exception/rejection or cleanup failure
uses the app's orderly failure path, disposing sibling tasks and native cells.
Rejections from canceled runs are consumed because their results are obsolete.
Handle expected failures inside the task to display an error in State.

## Recovery and validation

`View(body, { fallback })` also contains component setup/body failures. Partial
instances run their registered cleanup and release their state. Native state IDs
are monotonic, and queued events for disposed cells/actions are ignored.

The unit suite checks keyed identity, current props, fresh state after remount,
failed setup/body cleanup, LIFO disposal, sibling cleanup after an exception,
late events/actions, and setup-only allocation. The native component scenario
adds Unicode text bindings, release validation, and 50 mount/unmount cycles,
checking both registry counts and actual live native Cell counts after each cycle.
All native UI tests run offscreen.

Effect validation covers native Unicode input/output, post-commit ordering,
conditional dependencies, current props, cleanup isolation, explicit/self stop,
queued-effect cancellation, timer cleanup over 20 mount/unmount cycles, failure
teardown, async-callback rejection, feedback loops, and 150 independent keyed
effects that each write local state.

Task coverage includes conditional and synchronous-only tracking, current props,
out-of-order completion, guarded local/shared writes and external publication,
obsolete rejections, subscription and timer cleanup, failed mounts, self-stop,
invalid callback results, and failure teardown. Native tests repeat 20 owner
mount/unmount cycles and verify live cells return to baseline, then close the app
with work still pending to check shutdown cancellation.

Structured-state coverage includes input detachment, deep immutability, invalid
data rejection before bridge calls, structural equality, native revision ordering,
Unicode round trips, scalar editor synchronization, keyed collection identity,
scoped actions, and 30 mount/unmount cycles returning to baseline live cells.

Computed coverage includes lazy shared caching, conditional and chained
dependencies, fresh synchronous reads, stable equal snapshots, current props,
task cancellation, immutable collections, cached-error recovery, cycle/purity
diagnostics, failed mounts, cleanup reads, and 30 native mount/unmount cycles.

Validation on 2026-11-06: 110 unit tests, 67 offscreen native scenarios, and both
Deno and TypeScript checks pass.
