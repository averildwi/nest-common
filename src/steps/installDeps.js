const { run, formatCommand } = require('../utils/exec');
const { commandCwd, addArgs } = require('../utils/packageManager');
const { assertNoPnp } = require('./helpers');
const ui = require('../ui/output');

/** Splits "name@version" while respecting scoped names like "@nestjs/common@11". */
function parseSpec(spec) {
    const at = spec.lastIndexOf('@');
    if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    return { name: spec, version: undefined };
}

/**
 * Dependency specs that do not describe an npm semver range. A workspace
 * already owns these through pnpm/npm/yarn, so they count as declared.
 */
const PROTOCOL_PREFIXES = [
    'catalog:',
    'workspace:',
    'file:',
    'link:',
    'portal:',
    'git+',
    'git:',
    'github:',
    'https:',
    'http:',
    'npm:',
];

const ANY_VERSION = new Set(['*', 'x', 'X', 'latest']);

function isProtocolSpec(value) {
    return PROTOCOL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function parseVersion(value) {
    const match = String(value)
        .trim()
        .match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/i);
    if (!match) return null;

    const part = (raw) => {
        if (raw === undefined || /^[x*]$/i.test(raw)) return null;
        return Number(raw);
    };

    return { major: part(match[1]), minor: part(match[2]), patch: part(match[3]) };
}

function compareVersions(a, b) {
    for (const key of ['major', 'minor', 'patch']) {
        const left = a[key] ?? 0;
        const right = b[key] ?? 0;
        if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
}

/** Minimal semver comparison for the exact versions this CLI installs. */
function satisfiesRange(declared, target) {
    const range = declared.trim();
    if (ANY_VERSION.has(range) || isProtocolSpec(range)) return true;
    if (range.includes('||')) {
        return range.split('||').some((part) => satisfiesRange(part, target));
    }

    const targetVersion = parseVersion(target);
    if (!targetVersion) return false;

    const match = range.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/);
    if (!match) return false;

    const operator = match[1] || '=';
    const rangeVersion = parseVersion(match[2]);
    if (!rangeVersion) return false;

    const delta = compareVersions(targetVersion, rangeVersion);
    switch (operator) {
        case '>=':
            return delta >= 0;
        case '>':
            return delta > 0;
        case '<=':
            return delta <= 0;
        case '<':
            return delta < 0;
        case '^':
            if (delta < 0) return false;
            if (rangeVersion.major > 0) return targetVersion.major === rangeVersion.major;
            if (rangeVersion.minor === null) return targetVersion.major === 0;
            if (rangeVersion.minor > 0) {
                return targetVersion.major === 0 && targetVersion.minor === rangeVersion.minor;
            }
            if (rangeVersion.patch === null) {
                return targetVersion.major === 0 && targetVersion.minor === 0;
            }
            return (
                targetVersion.major === 0 &&
                targetVersion.minor === 0 &&
                targetVersion.patch === rangeVersion.patch
            );
        case '~':
            if (delta < 0 || targetVersion.major !== rangeVersion.major) return false;
            return rangeVersion.minor === null || targetVersion.minor === rangeVersion.minor;
        default:
            if (rangeVersion.major !== targetVersion.major) return false;
            if (rangeVersion.minor !== null && rangeVersion.minor !== targetVersion.minor) return false;
            if (rangeVersion.patch !== null && rangeVersion.patch !== targetVersion.patch) return false;
            return true;
    }
}

/**
 * True when package.json already declares a version compatible with the spec.
 * The requested spec is usually a pinned matrix range (e.g. ^4.0.2); a project
 * that already declares a newer same-major version counts as satisfied.
 */
function isSatisfied(spec, pkgJson, field) {
    const { name, version } = parseSpec(spec);
    const declared = (pkgJson[field] || {})[name];
    if (!declared) return false;

    const declaredStr = String(declared).trim();
    // Workspace protocols (catalog:, workspace:, ...) and wildcards are owned
    // by the workspace itself, so they always count as declared.
    if (isProtocolSpec(declaredStr) || ANY_VERSION.has(declaredStr)) return true;
    if (!version || ANY_VERSION.has(version)) return true;

    const floor = parseVersion(declaredStr.replace(/^[\^~<>=v\s]+/, ''));
    if (!floor) return false;

    const floorStr = `${floor.major ?? 0}.${floor.minor ?? 0}.${floor.patch ?? 0}`;
    return satisfiesRange(String(version), floorStr);
}

module.exports = {
    id: 'install',
    title: 'Install the ecosystem dependencies',

    plan(ctx) {
        if (!ctx.install) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: '--no-install' }] };
        }

        // Fail before any file is written: PnP has no node_modules for the
        // version detection or the local binaries the later steps need.
        assertNoPnp(ctx);

        const deps = ctx.dependencies.filter((s) => !isSatisfied(s, ctx.pkgJson, 'dependencies'));
        if (deps.length === 0) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: 'already installed' }], data: { deps: [] } };
        }

        // npm keeps an existing devDependency in devDependencies even when
        // installed without --save-dev, so a runtime dep that sits there must
        // be moved explicitly with --save-prod.
        const misplaced = deps.filter((s) => isSatisfied(parseSpec(s).name, ctx.pkgJson, 'devDependencies'));

        return {
            entries: [{ kind: 'run', label: formatCommand(ctx.pm.name, addArgsFor(ctx, deps, misplaced)) }],
            data: { deps, misplaced },
        };
    },

    async run(ctx, { deps = [], misplaced = [] } = {}) {
        if (deps.length === 0) return {};

        const cwd = commandCwd(ctx);
        try {
            await run(ctx.pm.name, addArgsFor(ctx, deps, misplaced), { cwd });
        } catch (err) {
            // Peer conflicts (ERESOLVE) are the most common failure; older npm
            // resolutions still work, so retry once with --legacy-peer-deps.
            if (ctx.pm.name !== 'npm' || !ctx.pm.legacyPeerDeps) throw err;
            ui.warn('npm reported a peer dependency conflict — retrying once with --legacy-peer-deps...');
            await run(ctx.pm.name, [...addArgsFor(ctx, deps, misplaced), ctx.pm.legacyPeerDeps], { cwd });
        }

        ui.success(`Installed ${deps.map((s) => parseSpec(s).name).join(', ')}`);
        return { files: [{ kind: 'modify', path: 'package.json' }] };
    },
};

function addArgsFor(ctx, deps, misplaced) {
    const args = addArgs(ctx, deps);
    return misplaced.length && ctx.pm.prodFlag ? [...args, ctx.pm.prodFlag] : args;
}

module.exports.parseSpec = parseSpec;
module.exports.isSatisfied = isSatisfied;
module.exports.satisfiesRange = satisfiesRange;
module.exports.addArgsFor = addArgsFor;
