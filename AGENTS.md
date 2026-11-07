# JonUI repository instructions

- Work in priority order from TODO.md and continue recorded in-progress work.
- Review SWIFTUI_TODO.md for every code, API, state, lifecycle, test, or documentation change. Update the affected widget/state rows, remaining work, and validation evidence. Never mark full SwiftUI parity from a narrow working subset.
- **Every commit must include an actual reviewed change to SWIFTUI_TODO.md.** When no widget/state status changes, update its Current review notes with that conclusion and the relevant validation/reason. Stage only intended changes.
- Run `python3 scripts/setup-hooks.py` once per checkout. The versioned commit hooks require the staged coverage review and classification of public API export/View/Focus/ComponentScope members. Pre-commit stamps before Git caches its tree; prepare-commit-msg, pre-merge-commit and pre-applypatch only verify. For a paused cherry-pick/rebase/patch flow, review/stage the ledger, run `python3 scripts/swiftui_coverage.py --staged --stamp`, then retry/continue. Stamping preserves unstaged edits. Do not disable hooks to avoid coverage review.
- The coverage hook is local; future clones must install it too. Keep its behavior documented and tested. Public API additions need a row's `<!-- api: ... -->` classification as well as accurate human-facing state/coverage notes.
- Use the existing checkout; preserve unrelated edits. Do not run overlapping native builds or integration jobs.
- Native UI automation must use `JONUI_TEST=1 JONUI_TEST_OFFSCREEN=1`; use focused integration gates for bridge/lifecycle changes. Do not change the user's keyboard-access preferences or force native eligibility to claim a path verified.
- Wait for a build to finish before launching `bin/jonui`, which otherwise rebuilds automatically. Run checks appropriate to the change and record concrete limitations.
- Keep the local chat-transfer archive excluded from publication. Build outputs and dependencies belong in ignored directories.
- Do not push, publish, deploy, send messages, or schedule work without the user's authorization for that action.
