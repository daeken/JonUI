"""Exercise commit-review enforcement against real temporary Git indexes."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/swiftui_coverage.py'


class CoverageReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Coverage test')
        self.git('config', 'user.email', 'coverage@example.invalid')
        (self.root / 'api').mkdir()
        (self.root / 'api/index.d.ts').write_text('export interface View {\n  frame(): View;\n}\nexport function Text(value: string): View;\n')
        self.catalog = self.root / 'SWIFTUI_TODO.md'
        self.catalog.write_text('# Coverage\n\nReviewed initial surface.\n<!-- api: View, View.frame, Text -->\n')
        self.git('add', '.')
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, capture_output=True, check=True).stdout

    def check(self, *args):
        return subprocess.run(['python3', str(SCRIPT), *args], cwd=self.root, capture_output=True, text=True)

    def review(self):
        self.catalog.write_text(self.catalog.read_text().replace('Reviewed initial surface.', 'Reviewed next change: widget coverage unchanged.'))
        self.git('add', 'SWIFTUI_TODO.md')

    def test_commit_without_catalog_review_is_rejected(self):
        (self.root / 'notes.txt').write_text('A documentation change still requires review.\n')
        self.git('add', 'notes.txt')
        result = self.check('--staged', '--stamp')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Every commit needs a reviewed change', result.stderr)

    def test_new_public_api_must_be_classified_before_index_mutation(self):
        self.review()
        before = self.git('show', ':SWIFTUI_TODO.md')
        api = self.root / 'api/index.d.ts'
        api.write_text(api.read_text() + 'export function NewWidget(): View;\n')
        self.git('add', 'api/index.d.ts')
        result = self.check('--staged', '--stamp')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('NewWidget', result.stderr)
        self.assertEqual(before, self.git('show', ':SWIFTUI_TODO.md'))

    def test_stamping_preserves_unstaged_hunks_and_uses_staged_api(self):
        self.review()
        api = self.root / 'api/index.d.ts'
        api.write_text(api.read_text() + 'export function UnstagedWidget(): View;\n')
        self.catalog.write_text(self.catalog.read_text() + '\nUnstaged user notes must survive.\n')
        worktree = self.catalog.read_bytes()
        result = self.check('--staged', '--stamp')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.catalog.read_bytes(), worktree)
        staged = self.git('show', ':SWIFTUI_TODO.md').decode()
        self.assertNotIn('Unstaged user notes', staged)
        self.assertIn(self.git('rev-parse', 'HEAD').decode().strip(), staged)
        self.assertNotEqual(staged, worktree.decode())

    def test_clean_worktree_stamp_is_idempotent_and_tracks_source_changes(self):
        self.review()
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        first = self.git('show', ':SWIFTUI_TODO.md')
        self.assertEqual(first, self.catalog.read_bytes())
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        self.assertEqual(first, self.git('show', ':SWIFTUI_TODO.md'))
        (self.root / 'notes.txt').write_text('staged change\n')
        self.git('add', 'notes.txt')
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        self.assertNotEqual(first, self.git('show', ':SWIFTUI_TODO.md'))


if __name__ == '__main__':
    unittest.main()
