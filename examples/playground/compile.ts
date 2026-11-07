import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";
import type * as JonUI from "jonui";

/** Compile an editable synchronous view body without retaining ESM cache entries. */
export function compilePreview(
  source: string,
  ui: typeof JonUI,
  count: JonUI.State<number>,
): () => JonUI.View {
  const names = Object.keys(ui).filter(name => /^[A-Za-z_$][\w$]*$/.test(name) && !name.startsWith("__"));
  const values = names.map(name => (ui as unknown as Record<string, unknown>)[name]);
  // Wrapping before stripping allows typed locals and a normal `return View`.
  const wrapped = `function preview(${[...names, "count"].join(", ")}) {\n${source}\n}`;
  const javascript = stripTypeScriptTypes(wrapped, { mode: "strip", sourceUrl: "preview.ts" });
  const render = compileFunction(`${javascript}\nreturn preview;`, [], { filename: "preview.ts" })();
  return () => render(...values, count);
}
