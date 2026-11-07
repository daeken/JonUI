import { Button, Focus, HStack, State, Text, Toggle, View, VStack, WebView, runApp } from "jonui";
import type { JSONValue } from "jonui";
import { controlHTML } from "./control.ts";
const hue = State<number>(180);
const visible = State<boolean>(true);
const interactive = State<boolean>(true);
const pageRevision = State<number>(0);
const error = State<string>("");
const focusStatus = State<string>("");
function onMessage(message: JSONValue): void {
  if (!message || Array.isArray(message) || typeof message !== "object") return;
  const event = message as { [key: string]: JSONValue };
  if (event.type === "hue" && typeof event.value === "number" && Number.isFinite(event.value)) {
    hue.value = Math.min(360, Math.max(0, event.value));
  }
}
await runApp({
  title: "JonUI Hybrid Controls", width: 800, height: 680,
  content: VStack([
    Text("Native SwiftUI + custom web controls").font("title"),
    Text("One shared state value, two rendering engines.").foregroundStyle("secondary"),
    HStack([
      Button("Native +30°", () => { hue.value = (hue.value + 30) % 360; }).accessibilityIdentifier("native-increment"),
      Button("Reset", () => { hue.value = 180; }),
      Button("Reload HTML", () => { pageRevision.value += 1; }),
      Button("Focus web control", () => { focusStatus.value = Focus.requestNamed('hue-control') ? 'Browser focused; Tab moves within the page.' : 'Show and enable the web control to focus it.'; }),
    ]),
    HStack([
      Toggle("Show web control", { isOn: visible.binding }),
      Toggle("Enable web input", { isOn: interactive.binding }),
    ]),
    View(() => Text(`Native hue: ${hue.value}°`).accessibilityIdentifier("native-hue")),
    View(() => visible.value ? WebView({
      focusName: 'hue-control',
      html: controlHTML + `<!-- revision ${pageRevision.value} -->`,
      data: { hue: hue.value }, onMessage,
      onError: message => { error.value = message; },
    }).disabled(!interactive.value).frame({ minHeight: 350 }) : Text("The web control is unmounted.")),
    View(() => Text(error.value || focusStatus.value).font("caption")),
  ], { alignment: "leading", spacing: 12 }).padding(20),
});
