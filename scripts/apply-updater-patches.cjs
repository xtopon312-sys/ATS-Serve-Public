'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const patch = require('../patches/updater-lifecycle/patch.json');

function apply(root = path.resolve(__dirname, '..'), checkOnly = false) {
  for (const [name, version] of Object.entries(patch.versions)) {
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.version !== version) throw new Error(`Updater patch incompatible: ${name}@${installed.version}`);
  }
  const digest = text => crypto.createHash('sha256').update(text).digest('hex');
  for (const guard of patch.guards) {
    if (digest(fs.readFileSync(path.join(root, 'node_modules', guard.file))) !== guard.sha256) throw new Error(`Updater patch seam incompatible: ${guard.file}`);
  }
  const writes = [];
  for (const entry of patch.files) {
    const target = path.resolve(root, 'node_modules', entry.file);
    if (!target.startsWith(path.resolve(root, 'node_modules') + path.sep)) throw new Error('Invalid updater patch path');
    const original = fs.readFileSync(target, 'utf8');
    if (digest(original) === entry.patchedSha256) continue;
    if (checkOnly || digest(original) !== entry.originalSha256) throw new Error(`Updater patch incompatible or missing: ${entry.file}`);
    let updated = original;
    for (const { before, after } of entry.changes) {
      if (updated.split(before).length !== 2) throw new Error(`Updater patch context mismatch: ${entry.file}`);
      updated = updated.replace(before, after);
    }
    if (digest(updated) !== entry.patchedSha256) throw new Error(`Updater patch result mismatch: ${entry.file}`);
    writes.push({ target, updated });
  }
  for (const { target, updated } of writes) fs.writeFileSync(target, updated);
  return { id: patch.id, changed: writes.length, verified: patch.files.length };
}
if (require.main === module) {
  try { console.log(JSON.stringify(apply(undefined, process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { apply };
