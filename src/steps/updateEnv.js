const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');
const { buildEnvFile, mergeEnv } = require('../transforms/envExample');

const REQUIRED_KEYS = ['DATABASE_URL', 'PORT', 'NODE_ENV', 'FRONTEND_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN'];

/** Placeholder values written into .env.example. JWT_SECRET is random per project. */
function envBlueprint(crypto) {
    return {
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/mydb?schema=public',
        PORT: '3000',
        NODE_ENV: 'development',
        FRONTEND_URL: '*',
        JWT_SECRET: crypto.randomBytes(32).toString('hex'),
        JWT_EXPIRES_IN: '7d',
    };
}

module.exports = {
    id: 'env',
    title: 'Set up .env.example with the required Joi variables',

    async plan(ctx) {
        const entries = [];
        const file = rel(ctx, ctx.paths.envExample);

        if (!(await fsHelpers.exists(ctx.paths.envExample))) {
            entries.push({ kind: 'create', label: `${file} (with all ${REQUIRED_KEYS.length} variables)` });
        } else {
            const source = await fsHelpers.readFile(ctx.paths.envExample);
            const missing = REQUIRED_KEYS.filter(
                (key) => !new RegExp(`^${key}\\s*=`, 'm').test(source),
            );
            entries.push(
                missing.length
                    ? { kind: 'modify', label: `${file} (add ${missing.join(', ')})` }
                    : { kind: 'skip', label: file, reason: 'already contains all required variables' },
            );
        }

        entries.push(...(await gitignoreEntries(ctx)));
        return { entries, data: {} };
    },

    async run(ctx) {
        const crypto = require('crypto');
        const blueprint = envBlueprint(crypto);
        const files = [];

        if (await fsHelpers.exists(ctx.paths.envExample)) {
            const source = await fsHelpers.readFile(ctx.paths.envExample);
            const merged = mergeEnv(source, blueprint);
            if (merged.added.length) {
                await fsHelpers.writeFile(ctx.paths.envExample, merged.source);
                ui.success(`Patched missing variables into .env.example: ${merged.added.join(', ')}`);
                files.push({ kind: 'modify', path: '.env.example' });
            } else {
                ui.skip('.env.example already contains all required Joi variables');
            }
        } else {
            await fsHelpers.writeFile(ctx.paths.envExample, buildEnvFile(blueprint));
            ui.success('.env.example created with default Joi requirements');
            files.push({ kind: 'create', path: '.env.example' });
        }

        ui.detail('Copy the values you need from .env.example into your own .env file.');

        if (await fsHelpers.exists(ctx.paths.gitignore)) {
            const gitignore = await fsHelpers.readFile(ctx.paths.gitignore);
            if (!/^\.env$/m.test(gitignore)) {
                ui.warn('".env" is not listed in .gitignore — add it to avoid committing real secrets.');
            }
        } else {
            ui.warn('No .gitignore found — make sure your real .env file is never committed.');
        }

        return { files };
    },
};

async function gitignoreEntries(ctx) {
    if (!(await fsHelpers.exists(ctx.paths.gitignore))) {
        return [{ kind: 'warn', label: '.gitignore', reason: 'not found — make sure the real .env is never committed' }];
    }
    const gitignore = await fsHelpers.readFile(ctx.paths.gitignore);
    return /^\.env$/m.test(gitignore)
        ? []
        : [{ kind: 'warn', label: '.gitignore', reason: '".env" is not listed — secrets could be committed' }];
}

module.exports.envBlueprint = envBlueprint;

