# Button Command shortcuts

Add a native Command shortcut to a Button:

```ts
Button('Save', save).keyboardShortcut('s');
Button('Focus notes', () => focus.request('notes')).padding(4).keyboardShortcut('2');
```

The key must be one lowercase ASCII letter (`a`–`z`) or digit (`0`–`9`). The
initial API always uses Command and accepts no options argument. Uppercase,
Unicode/punctuation, named special keys and explicit modifier combinations are
rejected before transport. It applies only to a Button, including through
single-child modifiers. Apply it before a sheet/window boundary. Calling it
again replaces the Button's descriptor; omitting it in the next render removes
the shortcut.

SwiftUI's [native key equivalents](https://developer.apple.com/documentation/swiftui/keyequivalent)
perform recognition. There is no JonUI key-down interceptor, global event monitor,
extra callback token, state cell or manual command dispatcher in production.
The Button's existing Node action table receives the action asynchronously and
uses the current handler. Key/property changes and keyed reorder preserve its
logical ID. Standard disabled/ancestor-disabled environment rules apply. A
shortcut does not require the Button to expose a focusable NSButton, so it also
works for the currently custom-drawn SwiftUI Buttons and named bounded hosts.

Recognition belongs to the native window/sheet processing the key equivalent.
The same chord in independent roots invokes the selected root's action. A sheet
does not fall through to its parent's shortcut. Closing/removing an owner retires
its action/registration through normal SwiftUI and JonUI teardown. Unmatched,
disabled and removed chords are verified unhandled. Conflicting shortcuts in one
window follow native SwiftUI/platform priority; no conflict registry, menu command
tree or priority API is provided. Application/system menus can have their own
shortcut priority. Root focus commands inside a callback keep their normal
after-commit/session guards.

Only the shortcut's key is serialized. The native host validates its descriptor
again before mutating the graph. Functions remain on Node. Callback failures take
the existing app-stop path and dispose owned resources once.

## Validation and remaining work

The offscreen gate posts synthetic Command events through AppKit's event loop and
invokes the actual NSWindow key-equivalent path. It checks that current-event flags
match the posted flags, then verifies both the native handled result and Node
callback. This covers letters/digits, text-focus preservation, current handlers,
keyed reorder, named hosts, disabled ancestors, removal, sheets, independent roots,
20 owner lifetimes, atomic invalid descriptors and callback-failure cleanup. No
window is keyed and the desktop is not activated.

Explicit modifier combinations are deferred. During development, shifted and
unshifted same-letter chords were not distinguished consistently by offscreen
SwiftUI key-equivalent dispatch, even with queued current-event flags and physical
key codes. No modifier-selection API is shipped or claimed verified. Keyboard
layout/localization, hardware IME combinations, menu conflicts, repeat policy,
special/unmodified keys, default/cancel actions and full command/menu scopes need
separate contracts and validation. Ordinary text input, Return handling and Tab
routing retain their existing native paths.

Try `bin/jonui examples/shortcuts/app.ts` for Command-1/2 focus requests and
Command-S saving with a disabled-state toggle.
