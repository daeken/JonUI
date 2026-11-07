# Editable TypeScript playground

```sh
bin/jonui examples/playground/app.ts
```

Edit the TypeScript **view body** on the left, then click **Reload**. The right
side is a native SwiftUI subtree in the same running app. **Reset** restores the
example code. **Web control** loads a native/web hybrid example; its
`hueControlHTML` constant and shared `count` State are available in the edited body.
Source edits are held in memory for this session.

The body can use JonUI constructors and the shared `count: State<number>`.
It should return a synchronous View. Type annotations are stripped by the pinned
Node runtime; reload compiles the code without running a TypeScript typecheck.
Imports and top-level module declarations belong in the app source, outside the
editable function body. Allocate persistent state outside recomputed view bodies.

```ts
const title: string = "Edited while running 👀";
return VStack([
  Text(title).font("title"),
  Text(`Count: ${count.value}`),
  Button("Add ten", () => { count.value += 10; }),
], { alignment: "leading", spacing: 16 }).padding(24);
```

The shared counter survives Reload and Reset. Syntax errors leave the previous
preview intact. Render errors, including errors inside nested tracked views,
replace only the preview with an error message; editing and Reload remain usable.
Errors from edited button actions appear in the status area. Code executes with
the same access as the application's Node process.

The editor itself is authored in TypeScript using `TextEditor({ text: binding,
monospaced: true })`. The runtime's optional `View(body, { fallback })` contains
render failures. Failed partial mounts release their callbacks and dependencies;
state reads from the failed render remain subscribed so the view can recover.
The compiler creates ordinary functions without accumulating ESM module-cache
entries for every revision.

Validation covers keyboard typing, multiline Unicode paste, native Reload
clicks, preserved counter state, syntax/render/action errors and recovery. The
native integration driver also performs 25 successive reloads and checks stable
view, callback, state-cell, and dependency registration counts. All twenty-seven unit
tests, nineteen native integration scenarios, Deno checks, and TypeScript checks pass.
