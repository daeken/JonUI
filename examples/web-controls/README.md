# Native SwiftUI and custom web controls

```sh
bin/jonui examples/web-controls/app.ts
```

Or launch the TypeScript playground and click **Web control** to edit the native
wrapper and message handlers while the app is running.

`WebView` hosts app-authored HTML/CSS/JavaScript in a persistent `WKWebView`.
The browser has its own JavaScript environment. App callbacks run on Node;
messages between those environments contain JSON values.

```ts
View(() => WebView({
  html: controlHTML,
  data: { hue: hue.value },
  onMessage(message) { /* validate the message, then update app state */ },
  onError(message) { /* report browser/load errors */ },
})).frame({ minHeight: 350 });
```

Inside the HTML document:

```js
const unsubscribe = window.jonui.onMessage(model => render(model));
window.jonui.postMessage({ type: "hue", value: 210 });
```

`data` is a declarative snapshot, delivered after the document loads and whenever
it changes. It must contain finite, acyclic JSON values. Updating data preserves
the browser document, DOM state, scroll position, and focus. Changing `html`
explicitly loads a new document and reapplies the latest data. Late subscribers
receive the current data immediately. Give the web view a suitable frame; HTML
content measurement does not currently size the SwiftUI view automatically.

`.disabled(flag)` on a WebView or ancestor prevents native pointer/key-view entry
and resigns current browser focus, while keeping the document and data bridge
alive. Re-enable it to resume interaction without reloading; try **Enable web
input** in the example. Document scripts continue to run while disabled.

The `Focus` API can capture/restore the physical browser responder and include it
in a native traversal cycle. DOM controls within one WebView share that native
target. A custom Tab cycle advances between native targets on every Tab; resetting
it restores normal Tab/Shift-Tab within the document. See [focus](../../docs/focus.md)
for lifetime, disabled-target, and coverage details.

Declare `focusName: 'hue-control'` on the WebView and call
`Focus.requestNamed('hue-control')` from an action to focus its native browser
before a user has focused it. The example's **Focus web control** button does this
and reports when the view is hidden or disabled. Names must be unique across the
mounted app graph; they select browser containers. Individual DOM elements keep
their browser-managed focus.

This first API loads HTML strings. It uses an ephemeral website data store,
blocks navigation away from the HTML document, accepts bridge messages only from
the main frame, and rejects messages from replaced documents. Embedded resource
requests follow WebKit's usual rules; app-authored scripts execute with the page's
message interface. Browser code does not receive Node APIs or arbitrary native
execution. The app owns its message validation and the operations it exposes.

For interactions that need a result, expose an `api` method table and call it
through `window.jonui.remote()` in the browser. Methods run on Node and return
Promises to the document, with errors and request-lifetime cancellation handled
by JonUI. Keep visualization models in Node and use `data` to render them. See
[typed WebView RPC](../../docs/web-rpc.md) and the
[bar-chart example](../web-rpc/app.ts).

Unmounting stops loading, removes script handlers, and unregisters Node callbacks.
Load/script failures and web-process termination reach `onError`; without a
handler they are printed to stderr. Remote page browsing, bundled asset URL
schemes and automatic content sizing remain future work.

The implementation uses `NSViewRepresentable` with
[WKWebView](https://developer.apple.com/documentation/webkit/wkwebview) to retain
our macOS 14 deployment target. Apple's direct SwiftUI
[WebView](https://developer.apple.com/documentation/webkit/webview-swift.struct)
requires macOS 26 or newer.

The native integration test uses real WebKit input events and verifies both
message directions, document/focus preservation over 25 model updates, explicit
HTML reload, stale-document rejection, navigation restrictions, error delivery,
and callback/handler cleanup. The playground example was also exercised through
native accessibility controls in both directions.
