#!/usr/bin/env python3
"""Integration tests launch real AppKit windows; run in a macOS GUI session."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
binary = ROOT / 'bin/jonui'


def run(entry, case='', failure=None, driver=None, timeout=30, layout=False):
    env = {**os.environ, 'JONUI_TEST': '1', 'JONUI_CASE': case, 'JONUI_TEST_OFFSCREEN': '1'}
    env.pop('JONUI_TEST_DRIVER', None)
    env.pop('JONUI_TEST_LAYOUT', None)
    if layout:
        env['JONUI_TEST_LAYOUT'] = '1'
    if driver:
        env['JONUI_TEST_DRIVER'] = str(ROOT / driver)
    result = subprocess.run([str(binary), entry], cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
    print(result.stdout, end='', flush=True)
    if entry.endswith('contracts.mjs') and case != 'overflow':
        assert result.stdout.count('STOP_HOOK') == 1, (case, result.stdout, result.stderr)
    if entry.endswith('component-cleanup-error.mjs'):
        assert result.stdout.count('CLEANUP_a') == 1 and result.stdout.count('CLEANUP_b') == 1, (result.stdout, result.stderr)
    if entry.endswith('effect-error.mjs'):
        assert result.stdout.count('SCOPE_DISPOSE') == 1 and result.stdout.count('OTHER_EFFECT_CLEANUP') == 1, (case, result.stdout, result.stderr)
    if entry.endswith('task-error.mjs'):
        assert result.stdout.count('SCOPE_DISPOSE') == 1 and result.stdout.count('OTHER_TASK_CLEANUP') == 1, (case, result.stdout, result.stderr)
    if entry.endswith('computed-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['SCOPE_DISPOSE', 'OTHER_EFFECT_CLEANUP']), (case, result.stdout, result.stderr)
    if entry.endswith('text-submit-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['SUBMIT_SCOPE_DISPOSE', 'SUBMIT_STOP']), (result.stdout, result.stderr)
    if entry.endswith('text-editing-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['EDITING_SCOPE_DISPOSE', 'EDITING_STOP']), (result.stdout, result.stderr)
    if entry.endswith('focus-names-error.mjs'):
        assert result.stdout.count('NAMES_FAILURE_CLEANUP') == 1, (result.stdout, result.stderr)
    if entry.endswith('web-rpc-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['RPC_SCOPE_DISPOSE', 'RPC_STOP']), (result.stdout, result.stderr)
    if entry.endswith('focus-subscribe-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['FOCUS_SCOPE_DISPOSE', 'FOCUS_STOP']), (result.stdout, result.stderr)
    if entry.endswith('taps-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['TAP_DISPOSE', 'TAP_STOP']), (case, result.stdout, result.stderr)
    if entry.endswith('shortcuts-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['SHORTCUT_DISPOSE', 'SHORTCUT_STOP']), (result.stdout, result.stderr)
    if entry.endswith('focus-selection-error.mjs'):
        assert result.stdout.count('SELECTION_FAILURE_CLEANUP') == 1, (result.stdout, result.stderr)
    if entry.endswith('appearance-error.mjs'):
        markers = ['APPEARANCE_DISPOSE', 'APPEARANCE_STOP']
        if case == 'startup': markers += ['APPEARANCE_CHILD_DISPOSE', 'APPEARANCE_FAILURE_CLEANUP']
        assert all(result.stdout.count(marker) == 1 for marker in markers), (result.stdout, result.stderr)
    if entry.endswith('availability-subscribe-error.mjs'):
        assert all(result.stdout.count(marker) == 1 for marker in ['AVAILABILITY_DISPOSE', 'AVAILABILITY_STOP']), (result.stdout, result.stderr)
    if entry.endswith('windows-error.mjs'):
        assert result.stdout.count('WINDOW_APP_STOP') == 1, (case, result.stdout, result.stderr)
        if case != 'cross':
            assert result.stdout.count('WINDOW_OWNER_DISPOSE') == 1, (case, result.stdout, result.stderr)
        if case != 'cleanup':
            assert result.stdout.count('WINDOW_FAILURE_CLEANUP') == 1, (case, result.stdout, result.stderr)
    if failure:
        assert result.returncode != 0 and failure in result.stderr, (entry, result.returncode, result.stdout, result.stderr)
        print(f'PASS expected failure: {failure}', flush=True)
    else:
        assert result.returncode == 0 and 'PASS' in result.stdout, (entry, result.returncode, result.stdout, result.stderr)


for mode in ['', 'quit']:
    run('tests/integration/contracts.mjs', case=mode)
run('tests/integration/contracts.mjs', case='action-error', failure='intentional action failure')
run('tests/integration/contracts.mjs', case='body-error', failure='intentional reactive body failure')
run('tests/integration/contracts.mjs', case='timer-error', failure='intentional timer failure')
run('tests/integration/contracts.mjs', case='overflow', failure='native event queue overflow')
run('tests/integration/no-timers.mjs')
run('tests/integration/startup-error.mjs', failure='intentional body failure')
run('examples/landmarks/app.ts', driver='tests/integration/landmarks-driver.mjs', timeout=180)

run('examples/playground/app.ts', driver='tests/integration/playground-driver.mjs')

run('tests/integration/webview.mjs', timeout=45)

run('tests/integration/components.mjs', timeout=45)
run('tests/integration/component-cleanup-error.mjs', failure='intentional component cleanup failure')

run('tests/integration/effects.mjs', timeout=45)
for mode, message in [
    ('body', 'intentional effect body failure'),
    ('cleanup', 'intentional effect cleanup failure'),
    ('cycle', 'did not settle after 100 cycles'),
    ('async-body', 'Effect must synchronously return'),
    ('async-cleanup', 'Effect cleanup must be synchronous'),
]:
    run('tests/integration/effect-error.mjs', case=mode, failure=message)

run('tests/integration/tasks.mjs', timeout=45)
for mode, message in [
    ('body', 'intentional task body failure'),
    ('rejection', 'intentional task rejection'),
    ('cleanup', 'intentional task cleanup failure'),
    ('async-cleanup', 'Task cleanup must be synchronous'),
    ('invalid-return', 'Task callbacks must return undefined or a Promise'),
    ('async-commit', 'Task commit must be synchronous'),
]:
    run('tests/integration/task-error.mjs', case=mode, failure=message)

run('tests/integration/structured-state.mjs', timeout=45)
run('tests/integration/computed.mjs', timeout=45)
for mode, message in [
    ('body', 'intentional computed failure'),
    ('cycle', 'Computed dependency cycle'),
    ('async', 'Computed callbacks must return synchronous JSON values'),
    ('mutation', 'Computed callbacks cannot write State'),
    ('invalid-json', 'State objects must be plain records'),
]:
    run('tests/integration/computed-error.mjs', case=mode, failure=message)

run('tests/integration/layout.mjs', timeout=45, layout=True)
run('tests/integration/inputs.mjs', timeout=45, layout=True)
run('tests/integration/picker.mjs', timeout=45, layout=True)
run('tests/integration/text-submit.mjs', timeout=45)
run('tests/integration/text-submit-error.mjs', failure='intentional text submit failure')
run('tests/integration/date-picker.mjs', timeout=45, layout=True)
run('tests/integration/text-editing.mjs', timeout=45)
run('tests/integration/text-editing-error.mjs', failure='intentional text editing failure')
for axis in ['vertical', 'horizontal']:
    run('tests/integration/lazy-stack.mjs', case=axis, timeout=45, layout=True)
run('tests/integration/lazy-webview.mjs', timeout=45, layout=True)
for axis in ['vertical', 'horizontal']:
    run('tests/integration/lazy-grid.mjs', case=axis, timeout=45, layout=True)
run('tests/integration/focus-navigation.mjs', timeout=45)
run('tests/integration/focus-target.mjs', timeout=45)
run('tests/integration/focus-target-lazy.mjs', timeout=45, layout=True)
run('tests/integration/focus-traversal.mjs', timeout=45)
run('tests/integration/tab-navigation.mjs', timeout=45)
run('tests/integration/focus-sections.mjs', timeout=45, layout=True)
run('tests/integration/focus-controls.mjs', timeout=45)
run('tests/integration/focus-web.mjs', timeout=60)
run('tests/integration/focus-sheets.mjs', timeout=60)
run('tests/integration/focus-names.mjs', timeout=60, layout=True)
run('tests/integration/focus-names-error.mjs', failure='Duplicate focus name')
run('tests/integration/focus-names-error.mjs', case='date', failure='Duplicate focus name')
for mode in ['stepper', 'picker', 'button', 'toggle', 'slider']:
    run('tests/integration/focus-names-error.mjs', case=mode, failure='Duplicate focus name')
run('tests/integration/web-rpc.mjs', timeout=60)
for mode in ['reload', 'unmount']:
    run('tests/integration/web-rpc-error.mjs', case=mode, failure='RPC cancellation cleanup failed')
run('examples/web-rpc/app.ts', driver='tests/integration/web-rpc-demo-driver.mjs')
run('tests/integration/web-tab-boundary.mjs', timeout=60)
run('tests/integration/focus-native-names.mjs', timeout=60, layout=True)
run('tests/integration/focus-date-names.mjs', timeout=60, layout=True)
run('tests/integration/focus-direction.mjs', timeout=90, layout=True)
run('tests/integration/focus-mixed-sheet.mjs', timeout=90)
run('tests/integration/focus-current-name.mjs', timeout=60)
run('tests/integration/focus-subscribe.mjs', timeout=60)
run('tests/integration/focus-subscribe-error.mjs', failure='intentional focus listener failure')
run('tests/integration/focus-controller.mjs', timeout=60)
run('tests/integration/focus-binding.mjs', timeout=60)
run('tests/integration/focus-boolean.mjs', timeout=60)
run('tests/integration/focus-selection.mjs', timeout=60)
run('tests/integration/focus-selection-error.mjs', failure='Duplicate focus name')
run('tests/integration/focus-choices.mjs', timeout=60, layout=True)
run('tests/integration/focus-availability.mjs', timeout=60, layout=True)
run('tests/integration/focus-owned-availability.mjs', timeout=60, layout=True)
run('tests/integration/appearance.mjs', timeout=60, layout=True)
for mode, message in [('throw', 'intentional appearance failure'), ('disappear', 'intentional appearance failure'), ('promise', 'must be synchronous'), ('startup', 'appearance startup failure')]:
    run('tests/integration/appearance-error.mjs', case=mode, failure=message)
run('tests/integration/availability-subscribe.mjs', timeout=60, layout=True)
for mode, message in [('throw', 'intentional availability listener failure'), ('promise', 'must be synchronous')]:
    run('tests/integration/availability-subscribe-error.mjs', case=mode, failure=message)
run('tests/integration/owned-availability-subscribe.mjs', timeout=60, layout=True)
for mode, message in [('owned-throw', 'intentional availability listener failure'), ('owned-promise', 'must be synchronous')]:
    run('tests/integration/availability-subscribe-error.mjs', case=mode, failure=message)
run('tests/integration/focus-retry.mjs', timeout=90, layout=True)
run('tests/integration/focus-actions.mjs', timeout=90, layout=True)
run('tests/integration/focus-window.mjs', timeout=90)
run('tests/integration/windows.mjs', timeout=90)
for mode, message in [('duplicate', 'Duplicate focus name'), ('cross', 'share their controller window root'), ('setup', 'intentional window setup'), ('cleanup', 'intentional window cleanup')]:
    run('tests/integration/windows-error.mjs', case=mode, failure=message)
run('tests/integration/shortcuts.mjs', timeout=90)
run('tests/integration/shortcuts-error.mjs', failure='intentional shortcut action failure')

run('tests/integration/taps.mjs', timeout=90, layout=True)
run('tests/integration/taps-error.mjs', failure='intentional tap failure', layout=True)
run('tests/integration/taps-error.mjs', case='promise', failure='must be synchronous', layout=True)
run('tests/integration/tap-windows.mjs', timeout=90, layout=True)
