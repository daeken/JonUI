#!/usr/bin/env python3
"""Check public API classification and stamp a reviewed, staged coverage catalog."""
import argparse
import hashlib
from pathlib import Path
import re
import subprocess
import sys

CATALOG = 'SWIFTUI_TODO.md'
API = 'api/index.d.ts'
START = '<!-- coverage-review:generated -->'
END = '<!-- /coverage-review:generated -->'


def git(*args, input=None, check=True):
    return subprocess.run(['git', *args], input=input, capture_output=True, check=check)


def symbols(api):
    result = set(re.findall(r'^export\s+(?:declare\s+)?(?:function|const|class|interface|type)\s+(\w+)', api, re.M))
    for owner in ['View', 'Focus', 'ComponentScope']:
        match = re.search(rf'export (?:interface {owner}(?:<[^\n]+>)?|const {owner}:)\s*\{{(.*?)\n\}}', api, re.S)
        if match:
            body = match[1]
            members = re.findall(r'^  (\w+)(?:<[^\n]*?>)?\(', body, re.M)
            members += re.findall(r'\breadonly (\w+)\s*:', body)
            result.update(f'{owner}.{name}' for name in members)
    return result


def validate(catalog, api):
    classified = set()
    for marker in re.findall(r'<!-- api:\s*(.*?)\s*-->', catalog):
        classified.update(name.strip() for name in marker.split(','))
    missing = symbols(api) - classified
    unknown = classified - symbols(api)
    if missing or unknown:
        details = []
        if missing:
            details.append('Unclassified public API: ' + ', '.join(sorted(missing)))
        if unknown:
            details.append('Stale API classifications: ' + ', '.join(sorted(unknown)))
        raise ValueError('\n'.join(details) + '\nReview widget/state rows and their <!-- api: ... --> markers in ' + CATALOG)


def stamp(catalog):
    baseline = git('rev-parse', '--verify', 'HEAD', check=False)
    baseline = baseline.stdout.decode().strip() if baseline.returncode == 0 else 'unborn'
    digest = hashlib.sha256()
    for entry in sorted(git('ls-files', '--stage', '-z').stdout.split(b'\0')):
        if not entry:
            continue
        metadata, path = entry.split(b'\t', 1)
        if path == CATALOG.encode():
            continue
        if metadata.split()[-1] != b'0':
            raise ValueError('Resolve index conflicts before recording coverage review.')
        digest.update(entry + b'\0')
    block = (f'{START}\n'
             f'Review baseline (checkout HEAD before commit): `{baseline}`.\n\n'
             f'Staged source-tree SHA-256 (excluding this catalog): `{digest.hexdigest()}`.\n'
             f'{END}')
    pattern = re.escape(START) + r'.*?' + re.escape(END)
    if re.search(pattern, catalog, re.S):
        return re.sub(pattern, lambda _: block, catalog, flags=re.S)
    return catalog.rstrip() + '\n\n' + block + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged', action='store_true', help='Check the index, never unstaged content.')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--stamp', action='store_true', help='Require a staged human review, then update its index-only review stamp before Git caches a commit tree.')
    mode.add_argument('--verify-stamp', action='store_true', help='Require a current review stamp without mutating an index Git may already have cached.')
    args = parser.parse_args()
    root = Path(git('rev-parse', '--show-toplevel').stdout.decode().strip())
    if (args.stamp or args.verify_stamp) and not args.staged:
        raise ValueError('--stamp/--verify-stamp requires --staged')
    if args.staged:
        catalog = git('show', ':' + CATALOG).stdout.decode()
        api = git('show', ':' + API).stdout.decode()
    else:
        catalog = (root / CATALOG).read_text()
        api = (root / API).read_text()
    validate(catalog, api)
    if args.stamp or args.verify_stamp:
        changed = git('diff', '--cached', '--name-only', '-z', '--', CATALOG).stdout.split(b'\0')
        if CATALOG.encode() not in changed:
            raise ValueError('Every commit needs a reviewed change to ' + CATALOG + '. Update status/state rows or its Current review notes, then stage it.')
        updated = stamp(catalog)
        if args.verify_stamp and updated != catalog:
            raise ValueError('Coverage review stamp is stale. Run python3 scripts/swiftui_coverage.py --staged --stamp, then retry/continue the commit. This hook leaves the index unchanged because Git may already have cached its commit tree.')
        if updated != catalog:
            blob = git('hash-object', '-w', '--stdin', input=updated.encode()).stdout.decode().strip()
            git('update-index', '--cacheinfo', '100644,' + blob + ',' + CATALOG)
            # Preserve all unstaged user edits. Do not use `git add` here.
            path = root / CATALOG
            if path.exists() and path.read_text() == catalog:
                path.write_text(updated)
    suffix = '; staged review stamped.' if args.stamp else '; staged review verified.' if args.verify_stamp else '.'
    print('SwiftUI coverage: all public exports/members classified' + suffix)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError) as error:
        print('Coverage check failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
