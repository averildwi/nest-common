// Workspace installs and local binary resolution. Run: node --test test/install.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const installStep = require('../src/steps/installDeps');
const { isSatisfied, satisfiesRange } = installStep;
const {
    PACKAGE_MANAGERS,
    getPackageManager,
    commandCwd,
    addArgs,
    devArgs,
    scriptArgs,
} = require('../src/utils/packageManager');
const { resolveDependencies } = require('../src/config/registry');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-common-install-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

/** Silences the CLI's step output so test failures stay readable. */
function quiet(t) {
    const originalOut = process.stdout.write;
    const originalLog = console.log;
    process.stdout.write = () => true;
    console.log = () => {};
    t.after(() => {
        process.stdout.write = originalOut;
        console.log = originalLog;
    });
}

/** Puts a fake `npm` first on PATH that records cwd/args and exits with `code`. */
function fakeNpm(t, root, code = 0) {
    const binDir = path.join(root, 'fake-bin');
    fs.mkdirSync(binDir, { recursive: true });
    const logPath = path.join(root, 'install.log');

    if (process.platform === 'win32') {
        fs.writeFileSync(
            path.join(binDir, 'npm.cmd'),
            [
                '@echo off',
                '>>"%NEST_COMMON_INSTALL_LOG%" echo cwd=%CD%',
                '>>"%NEST_COMMON_INSTALL_LOG%" echo args=%*',
                `exit /b ${code}`,
                '',
            ].join('\r\n'),
            'utf8',
        );
    } else {
        const shim = path.join(binDir, 'npm');
        fs.writeFileSync(
            shim,
            ['#!/bin/sh', '{ echo "cwd=$(pwd)"; echo "args=$*"; } >> "$NEST_COMMON_INSTALL_LOG"', `exit ${code}`, ''].join('\n'),
            'utf8',
        );
        fs.chmodSync(shim, 0o755);
    }

    const previousPath = process.env.PATH;
    const previousLog = process.env.NEST_COMMON_INSTALL_LOG;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.NEST_COMMON_INSTALL_LOG = logPath;

    t.after(() => {
        process.env.PATH = previousPath;
        if (previousLog === undefined) delete process.env.NEST_COMMON_INSTALL_LOG;
        else process.env.NEST_COMMON_INSTALL_LOG = previousLog;
    });

    return {
        read() {
            if (!fs.existsSync(logPath)) return [];
            return fs
                .readFileSync(logPath, 'utf8')
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => line.trim());
        },
    };
}

function workspaceCtx(root, overrides = {}) {
    return {
        install: true,
        dependencies: resolveDependencies(11, { swagger: false }),
        pkgJson: { dependencies: {}, devDependencies: {} },
        pm: getPackageManager('npm'),
        projectRoot: path.join(root, 'apps', 'api'),
        workspaceRoot: root,
        packageName: '@repo/api',
        appRel: 'apps/api',
        isWorkspaceMember: true,
        ...overrides,
    };
}

test('installDeps: catalog/workspace/file/git protocols count as declared', () => {
    const pkg = {
        dependencies: {
            '@nestjs/common': 'catalog:',
            '@nestjs/core': 'workspace:*',
            local: 'file:../../packages/local',
            linked: 'link:../shared',
            alias: 'npm:real-package@1.2.3',
            git: 'git+https://example.com/repo.git',
        },
    };

    for (const name of Object.keys(pkg.dependencies)) {
        assert.ok(isSatisfied(`${name}@7.10.0`, pkg, 'dependencies'), name);
    }
});

test('installDeps: minimal semver ranges match the requested target', () => {
    assert.ok(satisfiesRange('^4.0.2', '4.0.4'));
    assert.ok(!satisfiesRange('^4.0.2', '5.0.0'));
    assert.ok(satisfiesRange('~11.2.0', '11.2.9'));
    assert.ok(!satisfiesRange('~11.2.0', '11.3.0'));
    assert.ok(satisfiesRange('>=3.3.0', '4.0.2'));
    assert.ok(satisfiesRange('*', '99.0.0'));
});

test('installDeps: workspace commands target the member from the root', () => {
    for (const pm of ['npm', 'pnpm', 'yarn']) {
        const ctx = workspaceCtx(path.resolve('/repo'), { pm: getPackageManager(pm) });
        assert.equal(commandCwd(ctx), path.resolve('/repo'), pm);
    }

    assert.deepEqual(addArgs(workspaceCtx(path.resolve('/repo')), ['@nestjs/config']), [
        'install',
        '@nestjs/config',
        '--workspace',
        '@repo/api',
    ]);
    assert.deepEqual(devArgs(workspaceCtx(path.resolve('/repo')), ['joi']), [
        'install',
        '--save-dev',
        'joi',
        '--workspace',
        '@repo/api',
    ]);
    assert.deepEqual(scriptArgs(workspaceCtx(path.resolve('/repo')), 'lint'), [
        'run',
        'lint',
        '--workspace',
        '@repo/api',
    ]);

    const pnpm = workspaceCtx(path.resolve('/repo'), { pm: PACKAGE_MANAGERS.pnpm });
    assert.deepEqual(addArgs(pnpm, ['joi']), ['--filter', '@repo/api', 'add', 'joi']);
    assert.deepEqual(scriptArgs(pnpm, 'lint'), ['--filter', '@repo/api', 'run', 'lint']);

    const yarn = workspaceCtx(path.resolve('/repo'), { pm: PACKAGE_MANAGERS.yarn });
    assert.deepEqual(addArgs(yarn, ['joi']), ['workspace', '@repo/api', 'add', 'joi']);
    assert.deepEqual(scriptArgs(yarn, 'lint'), ['workspace', '@repo/api', 'run', 'lint']);
});

test('installDeps: bun installs from the app directory without a workspace flag', () => {
    const root = path.resolve('/repo');
    const ctx = workspaceCtx(root, { pm: PACKAGE_MANAGERS.bun });
    assert.equal(commandCwd(ctx), path.join(root, 'apps', 'api'));
    assert.deepEqual(addArgs(ctx, ['joi']), ['add', 'joi']);
    assert.deepEqual(scriptArgs(ctx, 'lint'), ['run', 'lint']);
});

test('installDeps: plan uses the detected Nest major and skips Swagger when disabled', async () => {
    const ctx = workspaceCtx(path.resolve('/repo'));
    const { entries } = await installStep.plan(ctx);

    assert.equal(entries.length, 1);
    assert.match(entries[0].label, /^npm install /);
    assert.match(entries[0].label, /--workspace @repo\/api/);
    assert.match(entries[0].label, /@nestjs\/config@\^4\.0\.2/);
    assert.doesNotMatch(entries[0].label, /@nestjs\/swagger/);
});

test('installDeps: npm workspace install runs from the root with --workspace', async (t) => {
    quiet(t);
    const root = fixture(t);
    const shim = fakeNpm(t, root);
    const ctx = workspaceCtx(root);

    const { data } = await installStep.plan(ctx);
    await installStep.run(ctx, data);

    const lines = shim.read();
    assert.ok(lines.some((line) => line === `cwd=${root}`), lines.join(' | '));
    const argsLine = lines.find((line) => line.startsWith('args=')) || '';
    assert.match(argsLine, /install/);
    assert.match(argsLine, /--workspace/);
    assert.match(argsLine, /@repo\/api/);
    assert.match(argsLine, /@nestjs\/config/);
    assert.doesNotMatch(argsLine, /@nestjs\/swagger/);
});

test('installDeps: single-repo install runs in the app directory', async (t) => {
    quiet(t);
    const root = fixture(t);
    const shim = fakeNpm(t, root);
    const appRoot = path.join(root, 'api');
    fs.mkdirSync(appRoot, { recursive: true });
    const ctx = workspaceCtx(root, {
        projectRoot: appRoot,
        workspaceRoot: null,
        packageName: 'api',
        isWorkspaceMember: false,
        dependencies: resolveDependencies(10, { swagger: true }),
    });

    const { data } = await installStep.plan(ctx);
    await installStep.run(ctx, data);

    const lines = shim.read();
    assert.ok(lines.some((line) => line === `cwd=${appRoot}`), lines.join(' | '));
    const argsLine = lines.find((line) => line.startsWith('args=')) || '';
    assert.doesNotMatch(argsLine, /--workspace/);
    assert.match(argsLine, /@nestjs\/config/);
    assert.match(argsLine, /@nestjs\/swagger/);
});

test('installDeps: npm peer-conflict retry appends --legacy-peer-deps', async (t) => {
    quiet(t);
    const root = fixture(t);
    const shim = fakeNpm(t, root, 1);
    const ctx = workspaceCtx(root);

    const { data } = await installStep.plan(ctx);
    await assert.rejects(() => installStep.run(ctx, data), (err) => /legacy-peer-deps/.test(err.message));

    const attempts = shim.read().filter((line) => line.startsWith('args='));
    assert.equal(attempts.length, 2, attempts.join(' | '));
    assert.match(attempts[0], /--workspace/);
    assert.match(attempts[1], /--legacy-peer-deps/);
});

test('installDeps: Yarn PnP fails during planning, before files change', (t) => {
    const root = fixture(t);
    const appRoot = path.join(root, 'apps', 'api');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(root, '.pnp.cjs'), 'module.exports = {};\n');

    assert.throws(
        () =>
            installStep.plan(
                workspaceCtx(root, {
                    pm: PACKAGE_MANAGERS.yarn,
                    dependencies: ['joi'],
                }),
            ),
        (err) => err.name === 'CliError' && /Yarn PnP/.test(err.message),
    );
});

test('installDeps: --no-install skips without running a command', () => {
    const entries = installStep.plan(workspaceCtx(path.resolve('/repo'), { install: false })).entries;
    assert.equal(entries[0].kind, 'skip');
    assert.match(entries[0].reason, /--no-install/);
});
