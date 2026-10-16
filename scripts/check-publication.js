import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// Check both the Git index (what will be committed) and the working files.
// Never print matched credentials or read excluded business data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
let files;
try {
  files = git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
} catch {
  console.error('Run this check from a Git checkout after staging the public project files.');
  process.exit(1);
}
if (!files.length) {
  console.error('No tracked files found. Stage the intended public files before checking.');
  process.exit(1);
}

const forbidden = /(^|\/)(?:data|certs|node_modules|backups|releases|\.codex|\.agents)(?:\/|$)|(^|\/)\.env(?:$|\.(?!example$))|\.(?:pem|key|p12|pfx|sqlite(?:-wal|-shm)?|db|log)$/i;
const localOnly = new Set(['deploy/known_hosts', '\u63d0\u793a\u8bcd.txt']);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bLTAI[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9]{24,}\b/
];
const envPath = path.join(root, '.env');
const localSecrets = fs.existsSync(envPath)
  ? Object.entries(parseEnv(fs.readFileSync(envPath, 'utf8')))
    .filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value.length >= 12)
    .map(([, value]) => value)
  : [];

const failures = new Set();
for (const file of files) {
  if (forbidden.test(file) || localOnly.has(file)) {
    failures.add(`${file}: private or generated file`);
    continue;
  }
  const contents = [git(['show', `:${file}`]).toString('utf8')];
  const fullPath = path.join(root, file);
  if (fs.existsSync(fullPath)) contents.push(fs.readFileSync(fullPath, 'utf8'));
  for (const content of contents) {
    if (secretPatterns.some(pattern => pattern.test(content)) ||
        localSecrets.some(secret => content.includes(secret))) {
      failures.add(`${file}: possible credential; inspect locally`);
    }
  }
}

if (failures.size) {
  console.error('Public release check failed:\n' + [...failures].join('\n'));
  process.exit(1);
}
console.log(`Public release check passed: ${files.length} files; no excluded files or recognized credentials.`);
console.log('This check supplements manual review; it cannot detect every possible secret.');
