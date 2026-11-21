'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const semver = require('semver');
const policy = require('./policy.json');

function keys(object, required, optional = []) {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object), 'Expected object');
  for (const key of required) assert.ok(Object.hasOwn(object, key), `Missing ${key}`);
  for (const key of Object.keys(object)) assert.ok([...required, ...optional].includes(key), `Unknown ${key}`);
}

function validateVersion(version) {
  assert.equal(typeof version, 'string');
  assert.equal(semver.valid(version), version, 'Noncanonical SemVer');
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/, 'Unsupported version');
  return version;
}

function validateChannel(channel, enabled = policy.enabledChannels) {
  assert.ok(policy.knownChannels.includes(channel), 'Unknown channel');
  assert.ok(enabled.includes(channel), 'Disabled channel');
  return channel;
}

function validateHash(value, algorithm) {
  assert.equal(typeof value, 'string');
  if (algorithm === 'sha256') assert.match(value, /^[a-f0-9]{64}$/, 'Invalid SHA-256');
  else {
    assert.match(value, /^[A-Za-z0-9+/]{86}==$/, 'Invalid SHA-512 base64');
    assert.equal(Buffer.from(value, 'base64').toString('base64'), value, 'Noncanonical SHA-512');
  }
}

function size(value) {
  assert.ok(Number.isSafeInteger(value) && value > 0, 'Invalid byte size');
}

function timestamp(value) {
  assert.equal(typeof value, 'string');
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'Expected UTC timestamp');
  assert.equal(new Date(value).toISOString(), value, 'Invalid timestamp');
}

function validateRelease(record, { enabledChannels = policy.enabledChannels } = {}) {
  keys(record, ['schemaVersion', 'platform', 'arch', 'channel', 'version', 'publishedAt', 'sourceCommit', 'installer', 'blockmap', 'metadata']);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.platform, policy.platform);
  assert.equal(record.arch, policy.arch);
  validateChannel(record.channel, enabledChannels);
  validateVersion(record.version);
  assert.equal(record.version.includes('-beta.'), record.channel === 'beta', 'Version/channel mismatch');
  timestamp(record.publishedAt);
  assert.match(record.sourceCommit, /^[a-f0-9]{40}$/, 'Invalid source commit');
  const installer = `ATS-Serve-${record.version}-win-x64.exe`;
  for (const [kind, filename] of [['installer', installer], ['blockmap', installer + '.blockmap'], ['metadata', policy.channelFiles[record.channel]]]) {
    const file = record[kind];
    keys(file, ['filename', 'path', 'size', 'sha256'], kind === 'installer' ? ['sha512'] : []);
    assert.equal(file.filename, filename, 'Filename/version mismatch');
    assert.equal(file.path, `${policy.artifactBasePath}${record.version}/${filename}`, 'Incompatible artifact path');
    size(file.size);
    validateHash(file.sha256, 'sha256');
  }
  assert.ok(Object.hasOwn(record.installer, 'sha512'), 'Missing native checksum');
  validateHash(record.installer.sha512, 'sha512');
  return record;
}

function validateNativeMetadata(metadata, { channel = policy.defaultChannel, enabledChannels = policy.enabledChannels } = {}) {
  validateChannel(channel, enabledChannels);
  keys(metadata, ['version', 'files', 'path', 'sha512', 'releaseDate'], ['releaseNotes']);
  validateVersion(metadata.version);
  assert.equal(metadata.version.includes('-beta.'), channel === 'beta', 'Version/channel mismatch');
  timestamp(metadata.releaseDate);
  if (Object.hasOwn(metadata, 'releaseNotes')) {
    assert.equal(typeof metadata.releaseNotes, 'string', 'Release notes must be text');
    assert.ok(Buffer.byteLength(metadata.releaseNotes, 'utf8') <= 65536, 'Release notes too large');
  }
  assert.ok(Array.isArray(metadata.files) && metadata.files.length === 1, 'Exactly one NSIS x64 installer');
  const file = metadata.files[0];
  keys(file, ['url', 'sha512', 'size'], ['isAdminRightsRequired']);
  if (Object.hasOwn(file, 'isAdminRightsRequired')) assert.equal(typeof file.isAdminRightsRequired, 'boolean');
  assert.equal(file.url, `${policy.artifactBasePath}${metadata.version}/ATS-Serve-${metadata.version}-win-x64.exe`, 'Metadata points outside release');
  validateHash(file.sha512, 'sha512');
  size(file.size);
  assert.equal(metadata.path, file.url, 'Legacy path disagrees');
  assert.equal(metadata.sha512, file.sha512, 'Legacy checksum disagrees');
  return metadata;
}

function validateMetadata(metadata, record, options) {
  validateRelease(record, options);
  validateNativeMetadata(metadata, { ...options, channel: record.channel });
  assert.equal(metadata.version, record.version, 'Metadata version mismatch');
  assert.equal(metadata.releaseDate, record.publishedAt, 'Publication timestamp mismatch');
  assert.equal(metadata.files[0].sha512, record.installer.sha512, 'Native checksum mismatch');
  assert.equal(metadata.files[0].size, record.installer.size, 'Installer size mismatch');
  return metadata;
}

function verifyReleaseBytes(record, metadataBytes, installerBytes, blockmapBytes, options) {
  validateRelease(record, options);
  for (const [kind, bytes] of [['metadata', metadataBytes], ['installer', installerBytes], ['blockmap', blockmapBytes]]) {
    assert.ok(Buffer.isBuffer(bytes), 'Expected final artifact bytes');
    assert.equal(bytes.length, record[kind].size, `${kind} size mismatch`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record[kind].sha256, `${kind} SHA-256 mismatch`);
  }
  assert.equal(createHash('sha512').update(installerBytes).digest('base64'), record.installer.sha512, 'Installer SHA-512 mismatch');
}

function selectUpdate(current, record, options) {
  validateVersion(current);
  validateRelease(record, options);
  const comparison = semver.compare(record.version, current);
  if (comparison < 0) throw new Error('Remote downgrade is forbidden');
  return comparison === 0 ? 'up-to-date' : 'upgrade';
}

module.exports = { policy, validateVersion, validateChannel, validateRelease, validateNativeMetadata, validateMetadata, verifyReleaseBytes, selectUpdate };
