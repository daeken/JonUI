# WebView visualization data and RPC

Keep application models in Node. A WebView receives JSON snapshots through
`data`/`window.jonui.onMessage` and renders them. Expose small Node methods for
interactions such as selecting a point, changing a filter, or requesting details.

```ts
// Node
const selected = State<number | null>(null);
const api = {
  select(id: number) {
    selected.value = id;
    return { selected: id };
  },
};
export type ChartAPI = typeof api;
View(() => WebView({ html, data: { selected: selected.value }, api }));
```

```ts
// Browser TypeScript; the type-only import does not execute the Node module.
import type { ChartAPI } from './app.ts';
const node = window.jonui.remote<ChartAPI>();
await node.select(3);
```

`remote()` is injected into the document; it needs no browser runtime import.
Inline HTML uses the same calls without a type argument. Browser TypeScript
still needs transpilation/bundling before being placed in `html`; JonUI does not
yet bundle browser modules automatically. The standalone example uses inline JS:

```sh
bin/jonui examples/web-rpc/app.ts
```

Click a bar or focus one and press Enter/Space. The browser calls Node's `select`,
Node updates its selected ID, and `data` updates the chart. Native buttons change
data or clear selection without reloading the page. Keyed SVG elements retain
identity through data/selection changes. Reloading reapplies the Node model.
**Chart Tab stop** controls native key-view participation. Turning it off keeps
mouse selections and RPC available without reloading or changing request lifetime.
Use `tabFocusable: false` for passive visualizations that should be skipped by Tab.

## Method contracts

`api` is a plain, string-keyed object of own enumerable functions. It is copied
when the WebView value is constructed; functions stay on Node. A tracked body can
replace the table to update handlers without reloading. The handler selected when
a request starts continues through that request; later calls use the latest table.

Arguments and results cross as finite, acyclic JSON records/arrays/scalars. Named
model interfaces are accepted by the TypeScript checks. Methods may return a
value, a Promise of one, or void; every browser call returns a Promise. A void
result resolves to undefined, distinct from a JSON null result. Omit optional
arguments instead of passing undefined. Functions, dates, binary buffers, class
instances, and cyclic values require explicit application serialization.

Method exceptions, rejected Promises, and serialization failures reject the
browser call with an Error carrying the original name/message. They do not stop
the application. Error stacks and arbitrary custom Error fields are not sent.
An unhandled browser rejection follows the existing WebView `onError` route.

Only exported method names are callable. `then`, `toJSON`, `constructor`,
`prototype`, and `__proto__` are reserved. Unknown methods reject with TypeError.
TypeScript checks arguments/results, while application-specific runtime checks
(for example whether a point ID exists) remain inside the method. The browser
receives no general Node execution or filesystem interface.

## Request lifetimes

`WebRequest.current` provides the same signal/cleanup/guarded-commit contract as
scoped tasks, available inside a Node method and its async continuations:

```ts
async function details(id: string) {
  const request = WebRequest.current;
  const result = await readDetails(id, { signal: request.signal });
  request.commit(() => publishToExternalCache(id, result));
  return result;
}
```

Capture the context before awaiting when passing its signal to I/O. Register
timers, subscriptions, and other external resource cleanup with `onCancel`.
Cleanup runs once when the request settles or is canceled; the signal is aborted
at that point. `isCurrent` becomes false and `commit` becomes a no-op. Accessing
`WebRequest.current` outside an RPC call throws. Keep durable models in ordinary
application/component State; requests do not introduce a new model store.

HTML replacement, native document retirement, unmount, and shutdown cancel pending
requests. Browser calls reject with AbortError while their document remains able
to observe the reply. Cancellation drops late results, prevents obsolete async
State writes/focus operations/subscriptions, and rejects late State allocation.
User I/O should honor the signal; cancellation cannot force arbitrary external
Promises to settle. Use `commit` for external publication after an await.

The same rules apply inside a SwiftUI sheet. Presentation visibility and logical
component ownership are separate: closing a sheet does not promise disposal of
its logical API/model, while native document retirement cancels that document's
requests. Removing the logical owner always cancels its work. Reopening can
reapply retained Node state to the current browser document. Mixed-sheet tests
verify reload/removal cancellation and guarded late shared-state/focus work.

Every request/reply carries the logical node, Node source epoch, native document
token, and call ID. Native validity is checked before dispatch and guarded late
work, so an old document cannot invoke a new handler or resolve a new document's
reused call ID. Rapid A → B → A source updates still replace the request epoch
when SwiftUI coalesces the final HTML back to identical bytes.

Data-only updates, handler replacement, focus-name changes, and `.disabled()`
preserve the document/request lifetime. Disabling stops user interaction; scripts,
data delivery, and exposed methods continue. A request is bounded to its WebView
document, independently of other WebViews. At most 128 requests may be pending
per native view; excess calls reject with RangeError. Cleanup failures during a
completed call reject that call; teardown cleanup failures use normal orderly
application error shutdown.

## Validation

Unit/type tests cover method-table validation and copying, no function transport,
typed asynchronous methods, JSON/void/errors, current handlers, request cleanup,
obsolete continuations, reused call IDs, native invalidation, and teardown errors.
Real WKWebView tests exercise promise replies, out-of-order completion, model
snapshots, source epochs and stale tokens, rapid source coalescing, 128-call
backpressure, cancellation, and 20 pending-request owner mount/unmount cycles at
baseline resources. Separate error scenarios verify reload/unmount cleanup runs
once. The visualization demo is driven through real SVG mouse/keyboard events.
