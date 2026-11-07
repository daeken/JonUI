import assert from 'node:assert/strict';
import { Text, runApp, __testing as test } from 'jonui';
let stopped = false;
const app = runApp({ title: 'No Node handles', width: 400, height: 300, content: Text('No timers'), onStop() { stopped = true; } });
// The close is scheduled on AppKit, not with a Node timer or an I/O handle.
test.request('debug.closeAfter');
await app;
assert.equal(stopped, true);
console.log('PASS native event queue keeps a timer-free Node app alive');
