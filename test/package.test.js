// Published package metadata and release docs. Run: node --test test/package.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const pkg = require('../package.json');
const root = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('package identity and entrypoints are valid', () => {
    assert.equal(pkg.name, '@averildwi/nest-common');
    assert.equal(pkg.type, 'commonjs');
    assert.ok(pkg.engines && pkg.engines.node, 'engines.node is required');
    assert.equal(pkg.license, 'MIT');

    assert.ok(pkg.main, 'main is required');
    assert.ok(fs.existsSync(path.join(root, pkg.main)), `missing ${pkg.main}`);

    assert.ok(pkg.bin && pkg.bin['nest-common'], 'bin.nest-common is required');
    const binPath = path.join(root, pkg.bin['nest-common']);
    assert.ok(fs.existsSync(binPath), `missing ${pkg.bin['nest-common']}`);
    assert.match(fs.readFileSync(binPath, 'utf8'), /^#!\/usr\/bin\/env node/, 'bin needs a node shebang');
});

test('published files exist and exclude tests', () => {
    assert.ok(Array.isArray(pkg.files));
    for (const required of ['bin', 'src', 'templates', 'docs', 'CHANGELOG.md']) {
        assert.ok(pkg.files.includes(required), `files must include ${required}`);
    }
    for (const entry of pkg.files) {
        assert.ok(fs.existsSync(path.join(root, entry)), `files entry does not exist: ${entry}`);
    }
    assert.ok(!pkg.files.includes('test'), 'test/ must not be published');
});

test('release docs and changelog are present', () => {
    assert.ok(fs.existsSync(path.join(root, 'README.md')));
    assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
    assert.ok(fs.existsSync(path.join(root, 'CHANGELOG.md')));
    assert.ok(fs.existsSync(path.join(root, 'docs', 'monorepo.md')));
    assert.ok(fs.existsSync(path.join(root, 'docs', 'release.md')));

    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /## \[Unreleased\]/);
    assert.ok(changelog.includes(`## [${pkg.version}]`), 'CHANGELOG must contain the current version');
});

test('README and monorepo contract document the workspace flags', () => {
    const readme = read('README.md');
    const contract = read('docs/monorepo.md');

    for (const flag of ['--cwd', '--app', '--pm', '--no-install', '--no-lint', '--yes']) {
        assert.ok(readme.includes(flag), `README is missing ${flag}`);
        assert.ok(contract.includes(flag), `docs/monorepo.md is missing ${flag}`);
    }
    assert.ok(/Turborepo/i.test(readme));
    assert.ok(/turbo\.json/.test(contract));
    assert.ok(/Yarn PnP/i.test(readme));
});

test('test script runs the node test runner', () => {
    assert.match(pkg.scripts.test, /^node --test /);
    assert.match(pkg.scripts.test, /test\/package\.test\.js/);
});
