import * as UI from "jonui";
import { compilePreview } from "./compile.ts";
import { controlHTML } from "../web-controls/control.ts";
const { Button, Divider, HStack, Spacer, State, Text, TextEditor, View, VStack, runApp } = UI;

const initialSource = `// Edit this TypeScript view body, then click Reload.
// SwiftUI constructors and a persistent count State are in scope.
const title: string = "Hello from editable TypeScript!";

return VStack([
  Text(title).font("title"),
  Text(\`Count: \${count.value}\`).font("headline"),
  HStack([
    Button("−", () => { count.value -= 1; }),
    Button("+", () => { count.value += 1; }),
  ]),
  Text("Change the title, add a control, or rearrange the layout.")
    .foregroundStyle("secondary"),
], { alignment: "leading", spacing: 16 }).padding(24);
`;
const webSource = `// hueControlHTML is an app-authored HTML/CSS/JS control.
// The native label and web slider share the same count State.
return VStack([
  Text(\`Native hue: \${count.value}°\`).font("headline"),
  Button("Native +30°", () => { count.value = (count.value + 30) % 360; }),
  WebView({
    html: hueControlHTML,
    data: { hue: count.value },
    onMessage: message => {
      if (message && message.type === "hue") {
        count.value = message.value;
      }
    },
  }).frame({ minHeight: 350 }),
], { alignment: "leading", spacing: 12 }).padding(16);
`;
const source = State<string>(initialSource);
const appliedSource = State<string>(initialSource);
const count = State<number>(0);
const revision = State<number>(0);
const status = State<string>("Ready. Edit the code, then Reload.");
const ticks = State<number>(0);
const errorText = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

// Edited actions also report errors in the editor rather than closing it.
const guard = <T extends unknown[]>(action: (...args: T) => unknown) => (...args: T): void => {
  try {
    const result = action(...args);
    if (result instanceof Promise) void result.catch(error => { status.value = errorText(error); });
  } catch (error) { status.value = errorText(error); }
};
const previewUI = { ...UI, hueControlHTML: controlHTML,
  WebView: (options: Parameters<typeof UI.WebView>[0]) => UI.WebView({
    ...options,
    onMessage: options.onMessage ? guard(options.onMessage) : undefined,
    onError: options.onError ? guard(options.onError) : message => { status.value = message; },
  }),
  Button: (title: string, action: () => void) => Button(title, guard(action)),
};
let render = compilePreview(initialSource, previewUI, count);
function reload(): void {
  try {
    const next = compilePreview(source.value, previewUI, count);
    render = next;
    appliedSource.value = source.value;
    revision.value += 1;
    status.value = `Reloaded revision ${revision.value}. Counter state preserved.`;
  } catch (error) {
    status.value = errorText(error); // Syntax errors keep the last compiled preview.
  }
}
const timer = setInterval(() => { ticks.value += 1; }, 1000);
const preview = View(() => {
  revision.value;
  return render();
}, { fallback: error => VStack([
  Text("Preview error").font("headline"),
  Text(errorText(error)).accessibilityIdentifier("preview-error"),
  Text("Fix the code on the left and click Reload.").foregroundStyle("secondary"),
], { alignment: "leading", spacing: 12 }).padding(24) });

try {
  await runApp({
    title: "JonUI TypeScript Playground", width: 1150, height: 720,
    content: HStack([
      VStack([
        HStack([
          Text("TypeScript view body").font("headline"), Spacer(),
          Button("Web control", () => { source.value = webSource; reload(); }).accessibilityIdentifier("web-example"),
          Button("Reset", () => { source.value = initialSource; reload(); }).accessibilityIdentifier("reset-code"),
          Button("Reload", reload).accessibilityIdentifier("reload-code"),
        ]),
        TextEditor({ text: source.binding, monospaced: true })
          .accessibilityIdentifier("source-editor"),
        View(() => Text(status.value).font("caption").accessibilityIdentifier("reload-status")),
        View(() => Text(source.value === appliedSource.value ? "Up to date" : "Unapplied edits")
          .font("caption").foregroundStyle("secondary")),
      ], { alignment: "leading", spacing: 12 }).padding(16).frame({ minWidth: 520 }),
      Divider(),
      VStack([
        Text("Native SwiftUI preview").font("headline").padding(),
        Divider(), preview, Spacer(),
        View(() => Text(`Node ticks: ${ticks.value}`).font("caption").accessibilityIdentifier("playground-ticks")),
      ], { alignment: "leading", spacing: 0 }).frame({ minWidth: 380 }),
    ], { spacing: 0 }),
    onStop: () => clearInterval(timer),
  });
} finally { clearInterval(timer); }
