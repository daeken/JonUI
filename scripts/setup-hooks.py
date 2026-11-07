#!/usr/bin/env python3
"""Install this checkout's versioned coverage-review hook."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
current = subprocess.run(['git', '-C', str(root), 'config', '--get', 'core.hooksPath'], capture_output=True, text=True)
if current.returncode == 0 and current.stdout.strip() != '.githooks':
    raise SystemExit('Existing custom core.hooksPath retained: ' + current.stdout.strip() + '. Chain .githooks/pre-commit from that hook before committing.')
subprocess.run(['git', '-C', str(root), 'config', '--local', 'core.hooksPath', '.githooks'], check=True)
print('Installed .githooks/pre-commit for this checkout.')
