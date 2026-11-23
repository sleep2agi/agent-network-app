"""Offline command-boundary checks; real Actions installation remains required."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('install-drive-browser.sh')

class InstallTest(unittest.TestCase):
    def run_install(self, hit, fail=''):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binaries = root / 'bin'
            binaries.mkdir()
            pw = root / 'pw/node_modules/.bin'
            pw.mkdir(parents=True)
            for path in [binaries / 'npm', binaries / 'node', pw / 'playwright']:
                path.write_text('#!/bin/bash\necho "$(basename "$0") $*" >> "$LOG"\n'
                                'if [[ -n "$FAIL" && "$*" == *"$FAIL"* ]]; then exit 42; fi\n')
                path.chmod(0o755)
            env = dict(os.environ, PATH=f'{binaries}:{os.environ["PATH"]}',
                       DRIVE_PW_PREFIX=str(root / 'pw'), LOG=str(root / 'log'),
                       PLAYWRIGHT_CACHE_HIT=hit, FAIL=fail)
            result = subprocess.run(['bash', str(SCRIPT)], env=env, capture_output=True)
            return result.returncode, (root / 'log').read_text()

    def test_exact_hit_skips_browser_download(self):
        code, log = self.run_install('true')
        self.assertEqual(code, 0)
        self.assertIn('playwright install-deps chromium', log)
        self.assertNotIn('playwright install chromium', log)
        self.assertIn('node --input-type=module', log)

    def test_miss_downloads_browser(self):
        code, log = self.run_install('')
        self.assertEqual(code, 0)
        self.assertIn('playwright install chromium', log)

    def test_dependency_failure_stops_before_download(self):
        code, log = self.run_install('', 'install-deps')
        self.assertEqual(code, 42)
        self.assertNotIn('playwright install chromium', log)
        self.assertNotIn('node --input-type=module', log)

if __name__ == '__main__':
    unittest.main()
