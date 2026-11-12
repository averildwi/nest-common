// Workspace/monorepo resolution. Run: node --test test/workspace.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    resolveProject,
    detectPackageManagerForRoot,
    globToRegExp,
    readPnpmCatalog,
    readWorkspaceGlobs,
} = require('../src/utils/workspace');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-common-ws-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function write(root, rel, content) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

function writeJson(root, rel, value) {
    write(root, rel, `${JSON.stringify(value, null, 2)}\n`);
}

function addPackage(root, rel, { name, nest = true, src = true, dependencies = {}, devDependencies } = {}) {
    writeJson(root, path.join(rel, 'package.json'), {
        name: name || rel || 'root',
        version: '0.0.0',
        dependencies: nest ? { '@nestjs/common': '^11.0.0', ...dependencies } : dependencies,
        ...(devDependencies ? { devDependencies } : {}),
    });
    if (src) fs.mkdirSync(path.join(root, rel, 'src'), { recursive: true });
}

function workspaceRoot(root, { workspaces = ['apps/*'], packageManager, turbo } = {}) {
    writeJson(root, 'package.json', {
        name: 'monorepo',
        private: true,
        ...(workspaces ? { workspaces } : {}),
        ...(packageManager ? { packageManager } : {}),
    });
    if (turbo) write(root, 'turbo.json', '{ "tasks": {} }\n');
}

test('single repo: the current folder is the app', (t) => {
    const root = fixture(t);
    addPackage(root, '', { name: 'api' });
    write(root, 'package-lock.json', '');

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, root);
    assert.equal(project.baseDir, root);
    assert.equal(project.isWorkspace, false);
    assert.equal(project.isMember, false);
    assert.equal(project.pm.name, 'npm');
    assert.equal(project.pm.source, 'package-lock.json');
    assert.deepEqual(project.candidates, []);
});

test('npm workspace: root selects the only Nest app', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { packageManager: 'npm@11.20.0' });
    addPackage(root, 'apps/api', { name: '@repo/api' });
    addPackage(root, 'apps/web', { name: '@repo/web', nest: false });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, path.join(root, 'apps', 'api'));
    assert.equal(project.appRel, 'apps/api');
    assert.equal(project.packageName, '@repo/api');
    assert.equal(project.isWorkspace, true);
    assert.equal(project.isMember, true);
    assert.equal(project.pm.name, 'npm');
    assert.equal(project.pm.source, 'package.json packageManager');
    assert.equal(project.candidates.length, 1);
    assert.equal(project.turbo, false);
});

test('npm workspace: running inside the app still finds the workspace root', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { packageManager: 'npm@11.20.0' });
    addPackage(root, 'apps/api', { name: '@repo/api' });
    addPackage(root, 'apps/web', { name: '@repo/web', nest: false });

    const project = resolveProject({ cwd: path.join(root, 'apps', 'api') });

    assert.equal(project.appDir, path.join(root, 'apps', 'api'));
    assert.equal(project.workspaceRoot, root);
    assert.equal(project.pm.name, 'npm');
});

test('workspace: several Nest apps make the target ambiguous', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });
    addPackage(root, 'apps/backend', { name: '@repo/backend' });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, null);
    assert.equal(project.ambiguous, true);
    assert.deepEqual(
        project.candidates.map((candidate) => candidate.rel),
        ['apps/api', 'apps/backend'],
    );
});

test('workspace: --app selects by package name, relative path, or absolute path', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });
    addPackage(root, 'apps/backend', { name: '@repo/backend' });

    assert.equal(resolveProject({ cwd: root, appFlag: '@repo/backend' }).appDir, path.join(root, 'apps', 'backend'));
    assert.equal(resolveProject({ cwd: root, appFlag: 'apps/api' }).appDir, path.join(root, 'apps', 'api'));
    assert.equal(
        resolveProject({ cwd: root, appFlag: path.join(root, 'apps', 'api') }).appDir,
        path.join(root, 'apps', 'api'),
    );
});

test('workspace: --app with an unknown name lists the available packages', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });

    assert.throws(
        () => resolveProject({ cwd: root, appFlag: '@repo/nope' }),
        (err) => err.name === 'CliError' && err.exitCode === 2 && /@repo\/api/.test(err.hints.join(' ')),
    );
});

test('workspace: --cwd can point at the app from another directory', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });

    const project = resolveProject({ cwd: root, cwdFlag: 'apps/api' });

    assert.equal(project.appDir, path.join(root, 'apps', 'api'));
    assert.equal(project.workspaceRoot, root);
});

test('pnpm workspace: packageManager and catalog dependencies are understood', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: null, packageManager: 'pnpm@9.15.0' });
    write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
    addPackage(root, 'apps/api', {
        name: '@repo/api',
        dependencies: { '@nestjs/common': 'catalog:', '@nestjs/core': 'catalog:' },
    });

    const project = resolveProject({ cwd: path.join(root, 'apps', 'api') });

    assert.equal(project.appDir, path.join(root, 'apps', 'api'));
    assert.equal(project.pm.name, 'pnpm');
    assert.equal(project.pm.source, 'package.json packageManager');
    assert.deepEqual(project.globs, ['apps/*']);
});

test('glob: packages/** matches nested workspace packages', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['packages/**'] });
    addPackage(root, 'packages/backend/api', { name: '@repo/backend-api' });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, path.join(root, 'packages', 'backend', 'api'));
    assert.equal(project.candidates.length, 1);
});

test('workspace: a non-Nest member never silently jumps to another app', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*', 'packages/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });
    addPackage(root, 'packages/ui', { name: '@repo/ui', nest: false });

    assert.throws(
        () => resolveProject({ cwd: path.join(root, 'packages', 'ui') }),
        (err) => err.name === 'CliError' && err.exitCode === 2 && /@repo\/api/.test(err.hints.join(' ')),
    );
});

test('workspace without a Nest app reports no target instead of guessing', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/web', { name: '@repo/web', nest: false });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, null);
    assert.equal(project.ambiguous, false);
    assert.equal(project.isWorkspace, true);
    assert.equal(project.candidates.length, 0);
});

test('workspace: running inside src/ walks up to the app package', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });

    const project = resolveProject({ cwd: path.join(root, 'apps', 'api', 'src') });

    assert.equal(project.appDir, path.join(root, 'apps', 'api'));
});

test('workspace root: tooling-only Nest deps do not shadow the real app', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { packageManager: 'npm@11.20.0' });
    // Some monorepos declare Nest in the root for shared tooling but have no src/.
    writeJson(root, 'package.json', {
        name: 'monorepo',
        private: true,
        workspaces: ['apps/*'],
        packageManager: 'npm@11.20.0',
        devDependencies: { '@nestjs/core': '^11.0.0' },
    });
    addPackage(root, 'apps/api', { name: '@repo/api' });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, path.join(root, 'apps', 'api'));
});

test('workspace scan ignores node_modules, dist, and build output', (t) => {
    const root = fixture(t);
    workspaceRoot(root, { workspaces: ['apps/*'] });
    addPackage(root, 'apps/api', { name: '@repo/api' });
    addPackage(root, 'node_modules/fake', { name: 'fake' });
    addPackage(root, 'dist/fake', { name: 'fake-dist' });
    addPackage(root, 'apps/api/dist/fake', { name: 'fake-local' });

    const project = resolveProject({ cwd: root });

    assert.equal(project.candidates.length, 1);
    assert.equal(project.candidates[0].name, '@repo/api');
});

test('single repo: a Nest package without src/ is still the target for preflight', (t) => {
    const root = fixture(t);
    addPackage(root, '', { name: 'api', src: false });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, root);
    assert.equal(project.isWorkspace, false);
});

test('package manager priority: --pm > packageManager > lockfile > user agent', (t) => {
    const root = fixture(t);

    writeJson(root, 'package.json', { name: 'repo', packageManager: 'yarn@4.1.0+sha512.abc' });
    write(root, 'pnpm-lock.yaml', '');
    write(root, 'package-lock.json', '');
    assert.deepEqual(detectPackageManagerForRoot(root), {
        name: 'yarn',
        source: 'package.json packageManager',
    });

    writeJson(root, 'package.json', { name: 'repo' });
    assert.deepEqual(detectPackageManagerForRoot(root), { name: 'pnpm', source: 'pnpm-lock.yaml' });
    assert.deepEqual(detectPackageManagerForRoot(root, undefined, 'yarn/4.1.0 npm/? node/v22'), {
        name: 'pnpm',
        source: 'pnpm-lock.yaml',
    });

    fs.rmSync(path.join(root, 'pnpm-lock.yaml'));
    assert.deepEqual(detectPackageManagerForRoot(root, undefined, 'yarn/4.1.0 npm/? node/v22'), {
        name: 'npm',
        source: 'package-lock.json',
    });
    assert.deepEqual(detectPackageManagerForRoot(root, 'bun'), { name: 'bun', source: '--pm flag' });
});

test('workspace globs are read from package.json and pnpm-workspace.yaml', (t) => {
    const root = fixture(t);
    writeJson(root, 'package.json', { name: 'repo', workspaces: ['apps/*'] });
    write(root, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/private/*'\n");

    assert.deepEqual(readWorkspaceGlobs(root), ['apps/*', 'packages/*', '!packages/private/*']);

    writeJson(root, 'package.json', { name: 'repo' });
    write(root, 'pnpm-workspace.yaml', 'packages: ["apps/*", "packages/*"]\n');
    assert.deepEqual(readWorkspaceGlobs(root), ['apps/*', 'packages/*']);
});

test('globToRegExp supports the workspace shapes we document', () => {
    assert.ok(globToRegExp('apps/*').test('apps/api'));
    assert.ok(!globToRegExp('apps/*').test('apps/api/nested'));
    assert.ok(globToRegExp('packages/**').test('packages/backend/api'));
    assert.ok(globToRegExp('apps/api').test('apps/api'));
});

test('pnpm catalogs are parsed for default and named entries', (t) => {
    const root = fixture(t);
    write(
        root,
        'pnpm-workspace.yaml',
        [
            "packages:",
            "  - 'apps/*'",
            "catalog:",
            "  '@nestjs/common': ^11.0.0",
            "  react: ^19.0.0",
            "catalogs:",
            "  nest10:",
            "    '@nestjs/common': '~10.4.0'",
            '',
        ].join('\n'),
    );

    assert.deepEqual(readPnpmCatalog(root), {
        default: { '@nestjs/common': '^11.0.0', react: '^19.0.0' },
        nest10: { '@nestjs/common': '~10.4.0' },
    });
});

test('workspace root that is itself the Nest app is not treated as a member', (t) => {
    const root = fixture(t);
    writeJson(root, 'package.json', {
        name: 'root-api',
        private: true,
        workspaces: ['apps/*'],
        packageManager: 'npm@11.20.0',
        dependencies: { '@nestjs/common': '^11.0.0' },
    });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const project = resolveProject({ cwd: root });

    assert.equal(project.appDir, root);
    assert.equal(project.isWorkspace, true);
    assert.equal(project.isMember, false);
});

test('turbo.json without a workspace manifest is used as the PM root hint', (t) => {
    const root = fixture(t);
    write(root, 'turbo.json', '{ "tasks": {} }\n');
    write(root, 'pnpm-lock.yaml', '');
    addPackage(root, 'apps/api', { name: '@repo/api' });

    const project = resolveProject({ cwd: path.join(root, 'apps', 'api') });

    assert.equal(project.workspaceRoot, root);
    assert.equal(project.turbo, true);
    assert.equal(project.pm.name, 'pnpm');
});
