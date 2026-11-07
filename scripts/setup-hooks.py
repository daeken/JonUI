#!/usr/bin/env python3
"""Install this checkout's versioned coverage-review hook."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
current = subprocess.run(['git', '-C', str(root), 'config', '--get', 'core.hooksPath'], capture_output=True, text=True)
if current.returncode == 0 and current.stdout.strip() != '.githooks':
    raise SystemExit('Existing custom core.hooksPath retained: ' + current.stdout.strip() + '. Chain the corresponding coverage hooks in .githooks before committing.')
subprocess.run(['git', '-C', str(root), 'config', '--local', 'core.hooksPath', '.githooks'], check=True)
print('Installed coverage hooks for commits, merges, cherry-picks, and patch application in this checkout.')
