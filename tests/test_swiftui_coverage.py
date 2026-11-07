"""Exercise commit-review enforcement against real temporary Git indexes."""
from pathlib import Path
import subprocess
import shutil
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

    def install_hooks(self):
        (self.root / 'scripts').mkdir()
        shutil.copyfile(SCRIPT, self.root / 'scripts/swiftui_coverage.py')
        hooks = self.root / '.githooks'
        hooks.mkdir()
        for name in ['pre-commit', 'prepare-commit-msg', 'pre-applypatch', 'pre-merge-commit']:
            shutil.copyfile(SCRIPT.parents[1] / '.githooks' / name, hooks / name)
            (hooks / name).chmod(0o755)
        self.git('config', 'core.hooksPath', '.githooks')

    def commit_result(self, *args):
        return subprocess.run(['git', '-c', 'commit.gpgsign=false', *args], cwd=self.root, capture_output=True, text=True)

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

    def test_no_verify_still_requires_review_and_allows_reviewed_commit(self):
        self.install_hooks()
        before = self.git('rev-parse', 'HEAD')
        (self.root / 'notes.txt').write_text('new change\n')
        self.git('add', 'notes.txt')
        result = self.commit_result('commit', '--no-verify', '-qm', 'unreviewed')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Every commit needs a reviewed change', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), before)
        self.review()
        result = self.commit_result('commit', '--no-verify', '-qm', 'reviewed')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stamp is stale', result.stderr)
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        result = self.commit_result('commit', '--no-verify', '-qm', 'reviewed')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(self.git('rev-parse', 'HEAD'), before)
        self.assertIn(before.decode().strip(), self.git('show', 'HEAD:SWIFTUI_TODO.md').decode())

    def test_amend_records_review_baseline_without_claiming_it_is_a_parent(self):
        self.install_hooks()
        before = self.git('rev-parse', 'HEAD').decode().strip()
        self.review()
        result = self.commit_result('commit', '--amend', '--no-edit')
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = self.git('show', 'HEAD:SWIFTUI_TODO.md').decode()
        self.assertIn('Review baseline (checkout HEAD before commit): `' + before + '`', catalog)
        self.assertNotIn('Reviewed against parent commit', catalog)
        self.assertEqual(len(self.git('rev-list', '--parents', '-n', '1', 'HEAD').split()), 1)

    def test_merge_commit_needs_review_before_it_can_finish(self):
        branch = self.git('branch', '--show-current').decode().strip()
        self.git('checkout', '-qb', 'incoming')
        (self.root / 'incoming.txt').write_text('older branch without ledger updates\n')
        self.git('add', 'incoming.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'incoming')
        self.git('checkout', '-q', branch)
        (self.root / 'main.txt').write_text('main side\n')
        self.git('add', 'main.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'main side')
        self.install_hooks()
        before = self.git('rev-parse', 'HEAD')
        result = self.commit_result('merge', '--no-ff', '--no-edit', 'incoming')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Every commit needs a reviewed change', result.stderr)
        self.assertEqual(before, self.git('rev-parse', 'HEAD'))
        self.review()
        result = self.commit_result('commit', '--no-edit')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.git('rev-list', '--parents', '-n', '1', 'HEAD').split()), 3)

    def test_cherry_pick_does_not_skip_the_review_guard(self):
        baseline = self.git('rev-parse', 'HEAD').decode().strip()
        (self.root / 'incoming.txt').write_text('older commit without review\n')
        self.git('add', 'incoming.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'incoming')
        incoming = self.git('rev-parse', 'HEAD').decode().strip()
        # Return only this isolated fixture to its base to simulate picking an old commit.
        self.git('checkout', '--detach', '-q', baseline)
        self.install_hooks()
        result = self.commit_result('cherry-pick', incoming)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Every commit needs a reviewed change', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD').decode().strip(), baseline)

    def test_patch_application_requires_review_and_can_resume_after_review(self):
        baseline = self.git('rev-parse', 'HEAD').decode().strip()
        (self.root / 'incoming.txt').write_text('older patch without review\n')
        self.git('add', 'incoming.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'incoming')
        patch = self.git('format-patch', '-1', '--stdout')
        self.git('checkout', '--detach', '-q', baseline)
        self.install_hooks()
        result = subprocess.run(['git', '-c', 'commit.gpgsign=false', 'am'], input=patch, cwd=self.root, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'Every commit needs a reviewed change', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD').decode().strip(), baseline)
        self.review()
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        result = self.commit_result('am', '--continue')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(baseline, self.git('show', 'HEAD:SWIFTUI_TODO.md').decode())

    def test_rebase_commit_requires_review(self):
        branch = self.git('branch', '--show-current').decode().strip()
        self.git('checkout', '-qb', 'topic')
        (self.root / 'topic.txt').write_text('older topic without review\n')
        self.git('add', 'topic.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'topic')
        self.git('checkout', '-q', branch)
        (self.root / 'main.txt').write_text('new main change\n')
        self.git('add', 'main.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'main')
        self.git('checkout', '-q', 'topic')
        self.install_hooks()
        result = self.commit_result('rebase', branch)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Every commit needs a reviewed change', result.stderr)

    def test_verification_does_not_mutate_a_stale_cached_tree(self):
        self.review()
        staged = self.git('show', ':SWIFTUI_TODO.md')
        worktree = self.catalog.read_bytes()
        result = self.check('--staged', '--verify-stamp')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stamp is stale', result.stderr)
        self.assertEqual(staged, self.git('show', ':SWIFTUI_TODO.md'))
        self.assertEqual(worktree, self.catalog.read_bytes())
        self.assertEqual(self.check('--staged', '--stamp').returncode, 0)
        self.assertEqual(self.check('--staged', '--verify-stamp').returncode, 0)


if __name__ == '__main__':
    unittest.main()
