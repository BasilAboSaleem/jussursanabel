/**
 * Full verification suite: static checks, verify scripts, and HTTP smoke tests.
 *
 * Usage: npm run verify:full
 */
require('dotenv').config();

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const VERIFY_SCRIPTS = [
    'verify-go-nogo.js',
    'verify-guest-donation.js',
    'verify-observability.js',
    'verify-redis.js',
    'verify-rate-limits.js',
    'verify-stripe-webhook.js',
    'verify-http-smoke.js'
];

function runNodeScript(scriptName) {
    console.log(`\n── ${scriptName} ──`);
    const result = spawnSync(process.execPath, [path.join('scripts', scriptName)], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        timeout: 180000
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status !== 0) {
        throw new Error(`${scriptName} failed (exit ${result.status})`);
    }
}

function compileEjsTemplates() {
    const templates = [
        'views/pages/index.ejs',
        'views/pages/donations/checkout.ejs',
        'views/pages/donations/thank-you.ejs',
        'views/pages/cases/case-details.ejs',
        'views/partials/nm-hero-signature.ejs',
        'views/partials/footer.ejs'
    ];

    for (const rel of templates) {
        const full = path.join(root, rel);
        if (!fs.existsSync(full)) {
            throw new Error(`Missing template: ${rel}`);
        }
        ejs.compile(fs.readFileSync(full, 'utf8'), { filename: full });
    }
    console.log(`✓ EJS compile OK (${templates.length} templates)`);
}

function syntaxCheckControllers() {
    const files = [
        'app/controllers/transactionController.js',
        'app/models/Transaction.js',
        'app/middlewares/auth.js',
        'app/utils/stripeDonationMetadata.js',
        'app/routes/donations.js'
    ];
    for (const rel of files) {
        const result = spawnSync(process.execPath, ['-c', rel], { cwd: root, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(`Syntax error in ${rel}: ${result.stderr || result.stdout}`);
        }
    }
    console.log(`✓ Node syntax OK (${files.length} files)`);
}

async function ensureServerReachable() {
    try {
        const res = await fetch(`${baseUrl}/health`);
        if (res.status !== 200) {
            throw new Error(`/health returned ${res.status}`);
        }
    } catch (err) {
        if (err.cause && err.cause.code === 'ECONNREFUSED') {
            throw new Error(`Server not reachable at ${baseUrl} — start with npm run dev`);
        }
        throw err;
    }
}

async function main() {
    console.log('Running full verification suite...\n');

    syntaxCheckControllers();
    compileEjsTemplates();

    for (const script of ['verify-go-nogo.js', 'verify-guest-donation.js']) {
        runNodeScript(script);
    }

    await ensureServerReachable();

    for (const script of VERIFY_SCRIPTS.slice(2)) {
        runNodeScript(script);
    }

    console.log('\n✅ Full verification completed successfully.');
}

main().catch((err) => {
    console.error('\n❌ Full verification failed:', err.message);
    process.exit(1);
});
