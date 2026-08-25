#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.appstoreconnect.apple.com/v1';
const mode = process.argv[2] || 'prepare';
const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const b64url = value => Buffer.from(value).toString('base64url');
function jwt() {
  const keyId = required('ASC_KEY_ID');
  const issuer = required('ASC_ISSUER_ID');
  const privateKey = fs.readFileSync(required('ASC_KEY_PATH'), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const encoded = `${b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: issuer, iat: now - 5, exp: now + 600, aud: 'appstoreconnect-v1' }))}`;
  const signature = crypto.sign('sha256', Buffer.from(encoded), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${encoded}.${signature.toString('base64url')}`;
}

async function api(method, endpoint, body) {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${method} ${endpoint} failed (${response.status}): ${detail.slice(0, 2000)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function output(name, value) {
  fs.appendFileSync(required('GITHUB_OUTPUT'), `${name}=${value}\n`);
}

function env(name, value) {
  fs.appendFileSync(required('GITHUB_ENV'), `${name}=${value}\n`);
}

async function prepare() {
  const team = required('APPLE_TEAM_ID');
  const bundleIdentifier = required('BUNDLE_ID');
  const temp = fs.mkdtempSync(path.join(required('RUNNER_TEMP'), 'ios-distribution-'));
  fs.chmodSync(temp, 0o700);
  env('IOS_SIGNING_TEMP', temp);
  const privateKey = path.join(temp, 'distribution.key');
  const csr = path.join(temp, 'distribution.csr');
  const certificateDer = path.join(temp, 'distribution.cer');
  const certificatePem = path.join(temp, 'distribution.pem');
  const p12 = path.join(temp, 'distribution.p12');
  const keychain = path.join(temp, 'distribution.keychain-db');
  env('IOS_KEYCHAIN_PATH', keychain);
  const keychainPassword = crypto.randomBytes(32).toString('hex');
  const p12Password = crypto.randomBytes(32).toString('hex');

  execFileSync('openssl', ['genrsa', '-out', privateKey, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-key', privateKey, '-out', csr, '-subj', `/CN=Agent Network CI/OU=${team}/O=Agent Network`], { stdio: 'ignore' });

  const certificate = await api('POST', '/certificates', {
    data: {
      type: 'certificates',
      attributes: {
        certificateType: 'IOS_DISTRIBUTION',
        csrContent: fs.readFileSync(csr, 'utf8'),
      },
    },
  });
  const certificateId = certificate.data.id;
  env('IOS_CERTIFICATE_ID', certificateId);
  fs.writeFileSync(certificateDer, Buffer.from(certificate.data.attributes.certificateContent, 'base64'));
  execFileSync('openssl', ['x509', '-inform', 'DER', '-in', certificateDer, '-out', certificatePem]);
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', privateKey, '-in', certificatePem, '-out', p12, '-passout', `pass:${p12Password}`], { stdio: 'ignore' });

  const bundles = await api('GET', `/bundleIds?filter%5Bidentifier%5D=${encodeURIComponent(bundleIdentifier)}&limit=2`);
  if (bundles.data.length !== 1) throw new Error(`expected one bundle id for ${bundleIdentifier}, got ${bundles.data.length}`);
  const profileName = `Agent Network App Store CI ${process.env.GITHUB_RUN_ID || Date.now()}`;
  const profile = await api('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundles.data[0].id } },
        certificates: { data: [{ type: 'certificates', id: certificateId }] },
      },
    },
  });
  const profileId = profile.data.id;
  env('IOS_PROFILE_ID', profileId);
  const profileDir = path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');
  fs.mkdirSync(profileDir, { recursive: true });
  const profilePath = path.join(profileDir, `${profile.data.attributes.uuid}.mobileprovision`);
  env('IOS_PROFILE_PATH', profilePath);
  fs.writeFileSync(profilePath, Buffer.from(profile.data.attributes.profileContent, 'base64'));

  execFileSync('security', ['create-keychain', '-p', keychainPassword, keychain]);
  execFileSync('security', ['set-keychain-settings', '-lut', '21600', keychain]);
  execFileSync('security', ['unlock-keychain', '-p', keychainPassword, keychain]);
  execFileSync('security', ['import', p12, '-k', keychain, '-P', p12Password, '-A', '-T', '/usr/bin/codesign'], { stdio: 'ignore' });
  execFileSync('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain], { stdio: 'ignore' });
  const login = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
  execFileSync('security', ['list-keychains', '-d', 'user', '-s', keychain, login]);

  output('certificate_id', certificateId);
  output('profile_id', profileId);
  output('profile_name', profileName);
  output('profile_path', profilePath);
  output('keychain_path', keychain);
  output('temp_dir', temp);
  console.log(`Prepared ephemeral Apple Distribution identity and IOS_APP_STORE profile for ${bundleIdentifier}`);
}

async function cleanup() {
  const profileId = process.env.IOS_PROFILE_ID;
  const certificateId = process.env.IOS_CERTIFICATE_ID;
  const retainRemote = process.env.IOS_RETAIN_REMOTE_SIGNING_ASSETS === 'true';
  if (retainRemote) {
    console.log('Retaining the remote distribution certificate and profile because Apple still needs them to validate the uploaded binary');
  } else {
    if (profileId) await api('DELETE', `/profiles/${encodeURIComponent(profileId)}`).catch(error => console.error(`profile cleanup: ${error.message}`));
    if (certificateId) await api('DELETE', `/certificates/${encodeURIComponent(certificateId)}`).catch(error => console.error(`certificate cleanup: ${error.message}`));
  }
  const profilePath = process.env.IOS_PROFILE_PATH;
  if (profilePath) fs.rmSync(profilePath, { force: true });
  const keychain = process.env.IOS_KEYCHAIN_PATH;
  if (keychain) {
    try { execFileSync('security', ['delete-keychain', keychain], { stdio: 'ignore' }); } catch {}
  }
  const temp = process.env.IOS_SIGNING_TEMP;
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  console.log('Removed runner-local iOS signing keychain and private-key material');
}

await (mode === 'cleanup' ? cleanup() : prepare());
