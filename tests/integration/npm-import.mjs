import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Text, runApp, __testing as test } from 'jonui';
const require = createRequire(import.meta.url);
assert.equal(require('typescript'), ts, 'ESM import and CommonJS require share the npm module');
const output = ts.transpileModule('export const message: string = "npm 日本 🦊";', { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
assert.ok(output.includes('npm 日本 🦊')); assert.ok(!output.includes(': string'));
const label = `npm TypeScript ${ts.version}`;
const app = runApp({ title: 'npm package import', width: 360, height: 200, content: Text(label) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let i = 0; i < 1000; i++) {
  const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
  if (test.request('debug.snapshot').nodes.some(n => n.props.value === label)) break;
  await sleep(5);
}
assert.ok(test.request('debug.snapshot').nodes.some(n => n.props.value === label)); test.request('debug.close'); await app;
assert.equal(test.request('debug.snapshot').liveViews, 0); assert.equal(test.request('debug.snapshot').liveCells, 0);
console.log('PASS npm: ordinary installed CommonJS package imported from ESM through the embedded launcher, Node API execution and native rendering without activation');
