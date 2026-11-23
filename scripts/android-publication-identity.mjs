import { validateAndroidBuildSource } from './android-build-source.mjs';

// The caller must obtain artifact/run metadata from GitHub, not user input.
export function publicationIdentity({ source, run, artifact, repository, commit, apkSha256 }) {
  validateAndroidBuildSource(source, { repository, run, commit, apkSha256 });
  if (!artifact || !Number.isSafeInteger(artifact.id) || artifact.id <= 0 || artifact.expired !== false
    || !artifact.name || artifact.workflow_run?.id !== run.id
    || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')) {
    throw new Error('APK artifact identity is missing, expired or belongs to another run');
  }
  return { schemaVersion: 1, repository, commit, version: source.version, versionCode: source.versionCode,
    runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id, artifactName: artifact.name,
    artifactDigest: artifact.digest, apkSha256 };
}

export function assertPublicationAdvance(candidate, { existingVersion = null, latest = null } = {}) {
  if (!Number.isSafeInteger(candidate.versionCode) || candidate.versionCode <= 0) throw new Error('Invalid versionCode');
  if (existingVersion) {
    for (const key of ['schemaVersion', 'repository', 'commit', 'version', 'versionCode', 'runId', 'runAttempt', 'artifactId', 'artifactName', 'artifactDigest', 'apkSha256']) {
      if (existingVersion[key] !== candidate[key]) throw new Error(`Immutable Android version conflict: ${key}`);
    }
  }
  if (latest) {
    if (!Number.isSafeInteger(latest.versionCode) || latest.versionCode <= 0) throw new Error('Invalid latest versionCode');
    if (candidate.versionCode < latest.versionCode) throw new Error('Android versionCode must not decrease');
    if (candidate.versionCode === latest.versionCode && (!existingVersion || latest.version !== candidate.version))
      throw new Error('Equal versionCode requires the same immutable publication');
  }
  return existingVersion ? 'reuse' : 'publish';
}
