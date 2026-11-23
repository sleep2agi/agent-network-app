import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('publish', Path(__file__).with_name('modelscope-android-publish.py'))
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class PublicationRecordTest(unittest.TestCase):
    def setUp(self):
        self.record = dict(schemaVersion=1, repository='sleep2agi/agent-network-app',
                           commit='a' * 40, version='0.2.614', versionCode=2614,
                           runId=10, runAttempt=1, artifactId=20,
                           artifactName='agent-network-android-apk',
                           artifactDigest='sha256:' + 'c' * 64, apkSha256='b' * 64)

    def check(self, candidate=None, held='0.2.613', existing=None):
        return publish.publication_record_files(candidate or self.record, '0.2.614', 'b' * 64, held, existing)

    def test_first_publish_and_identical_retry(self):
        self.assertIn('android/0.2.614/publication.json', self.check())
        self.assertEqual(self.check(), self.check(held='0.2.614', existing=self.record))

    def test_rebuild_cannot_replace_even_same_apk(self):
        for key in ('runId', 'runAttempt', 'artifactId'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check({**self.record, key: 999}, existing=self.record)

    def test_rollback_or_unproven_equal_code_rejected(self):
        for held in ('0.2.615', '0.2.614'):
            with self.subTest(held=held), self.assertRaises(ValueError):
                self.check(held=held)

    def test_wrong_apk_and_version_code_rejected(self):
        for change in ({'apkSha256': 'd' * 64}, {'versionCode': 2615}, {'artifactDigest': ''}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.check({**self.record, **change})


if __name__ == '__main__':
    unittest.main()
