import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const bridge = process._linkedBinding('jonui');
Object.defineProperty(globalThis, '__jonuiNative', { value: bridge });
const runtime = new URL('./index.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'jonui' ? { url: runtime, shortCircuit: true } : nextResolve(specifier, context);
} });
let finishing = false;
function fail(error) {
  if (finishing) return;
  finishing = true;
  console.error(error?.stack ?? error);
  // If the runtime was imported, its stop hook owns application cleanup.
  globalThis.__jonuiFail?.(error);
  bridge.finish(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
try {
  const application = import(pathToFileURL(resolve(process.argv[2])).href);
  if (process.env.JONUI_TEST === "1" && process.env.JONUI_TEST_DRIVER) {
    await import(pathToFileURL(resolve(process.env.JONUI_TEST_DRIVER)).href);
  }
  await application;
  await Promise.all([process.stdout, process.stderr].map(stream => new Promise(resolve => stream.write("", resolve))));
  finishing = true;
  bridge.finish(0);
} catch (error) { fail(error); }
