/**
 * Final Go/No-Go checks: backup docs, admin roles, git secret hygiene.
 *
 * Usage: npm run verify:go-nogo
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

function runGit(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return err.stdout ? String(err.stdout).trim() : '';
  }
}

function checkBackupRollbackDocs() {
  const backupDoc = path.join(root, 'ops', 'backup-rollback.md');
  const runbook = path.join(root, 'SECURITY_RUNBOOK.md');
  if (!fs.existsSync(backupDoc)) {
    throw new Error('ops/backup-rollback.md is missing');
  }
  if (!fs.existsSync(runbook)) {
    throw new Error('SECURITY_RUNBOOK.md is missing');
  }
  const content = fs.readFileSync(backupDoc, 'utf8');
  for (const section of ['mongodump', 'Rollback', 'Rollback drill']) {
    if (!content.includes(section)) {
      throw new Error(`ops/backup-rollback.md missing section: ${section}`);
    }
  }
  console.log('✓ Backup + rollback documentation present (ops/backup-rollback.md, SECURITY_RUNBOOK.md)');
}

function checkAdminRolesMatrix() {
  const matrixPath = path.join(root, 'ops', 'admin-roles-matrix.md');
  const adminRoutes = path.join(root, 'app', 'routes', 'admin.js');
  if (!fs.existsSync(matrixPath)) {
    throw new Error('ops/admin-roles-matrix.md is missing');
  }

  const routesSource = fs.readFileSync(adminRoutes, 'utf8');
  const superAdminOnly = (routesSource.match(/restrictTo\(\s*'super_admin'\s*\)/g) || []).length;
  const matrix = fs.readFileSync(matrixPath, 'utf8');

  if (superAdminOnly < 15) {
    throw new Error(`Expected many super_admin-only routes in admin.js, found ${superAdminOnly}`);
  }
  const criticalRoutes = [
    'users/create',
    'hard-delete',
    'donations-ledger',
    '/settings',
    'stripe-webhook-status',
    'distribution/confirm-bank',
    'activity-logs',
  ];

  for (const route of criticalRoutes) {
    if (!matrix.includes(route)) {
      throw new Error(`admin-roles-matrix.md missing critical route: ${route}`);
    }
  }

  console.log(`✓ Admin roles matrix documented (${superAdminOnly} super_admin-only route guards in code)`);
}

function checkGitignoreHygiene() {
  const required = ['.env', 'seed.js', 'seed-family.js', 'createSuperAdmin.js', 'logs/'];
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  for (const entry of required) {
    if (!gitignore.includes(entry)) {
      throw new Error(`.gitignore must include: ${entry}`);
    }
  }

  const trackedEnv = runGit('ls-files .env');
  if (trackedEnv) {
    throw new Error('.env is tracked by git — remove it immediately');
  }

  const ignored = runGit('check-ignore -v .env');
  if (!ignored.includes('.env')) {
    throw new Error('.env is not gitignored');
  }

  console.log('✓ .env and seed scripts are gitignored; .env is not tracked');
}

const SECRET_PATTERNS = [
  { name: 'stripe_live_secret', grep: 'sk_live_[a-zA-Z0-9]{8,}' },
  { name: 'stripe_test_secret', grep: 'sk_test_[a-zA-Z0-9]{20,}' },
  { name: 'stripe_webhook_secret', grep: 'whsec_[a-zA-Z0-9]{8,}' },
  { name: 'mongodb_uri_with_credentials', grep: 'mongodb(\\+srv)?:\\/\\/[^\\s]+:[^\\s]+@' },
];

function scanTrackedFilesForSecrets() {
  const files = runGit('ls-files').split('\n').filter(Boolean);
  const hits = [];

  for (const file of files) {
    if (file === '.env.example') continue;
    const full = path.join(root, file);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const { name, grep } of SECRET_PATTERNS) {
      const re = new RegExp(grep);
      if (re.test(text)) {
        hits.push({ file, pattern: name });
      }
    }
  }

  if (hits.length) {
    const summary = hits.map((h) => `${h.file} (${h.pattern})`).join(', ');
    throw new Error(`Possible secrets in tracked files: ${summary}`);
  }

  console.log('✓ No live secret patterns in currently tracked files');
}

function scanGitHistoryForSecrets() {
  let historyHits = 0;

  for (const { name, grep } of SECRET_PATTERNS) {
    const log = runGit(`log --all -G "${grep}" --pretty=format:%H`);
    const commits = log ? log.split('\n').filter((line) => /^[a-f0-9]{40}$/.test(line)) : [];
    const unique = [...new Set(commits)];
    if (unique.length) {
      historyHits += unique.length;
      console.warn(`⚠ Git history: ${unique.length} commit(s) may contain ${name} — rotate if real keys were committed`);
    }
  }

  const envHistory = runGit('log --all --oneline -- .env');
  if (envHistory) {
    throw new Error('.env appears in git history — use git filter-repo or BFG to purge');
  }

  const seedHistory = runGit('log --all --oneline -- seed.js createSuperAdmin.js');
  if (seedHistory) {
    console.warn('⚠ seed.js or createSuperAdmin.js found in git history — ensure default passwords were never used in production');
  }

  if (historyHits === 0) {
    console.log('✓ Git history scan: no obvious secret patterns in past commits');
  } else {
    console.log(`✓ Git history scan completed (${historyHits} pattern match(es) flagged for manual review)`);
  }
}

function checkRollbackDrillNote() {
  const backupDoc = fs.readFileSync(path.join(root, 'ops', 'backup-rollback.md'), 'utf8');
  if (!backupDoc.includes('Rollback drill')) {
    throw new Error('Document a rollback drill in ops/backup-rollback.md');
  }
  console.log('✓ Rollback drill checklist documented — run once on staging before public launch');
}

async function main() {
  console.log('Running Final Go/No-Go verification...\n');
  checkGitignoreHygiene();
  scanTrackedFilesForSecrets();
  scanGitHistoryForSecrets();
  checkBackupRollbackDocs();
  checkRollbackDrillNote();
  checkAdminRolesMatrix();
  console.log('\nGo/No-Go verification completed.');
  console.log('Manual: execute rollback drill on staging and sign off in ops/backup-rollback.md');
}

main().catch((err) => {
  console.error('Go/No-Go verification failed:', err.message);
  process.exit(1);
});
