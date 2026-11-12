const fs = require('fs');
const path = require('path');

const { CliError } = require('../errors');

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

/** Lockfiles are checked in this order; the field `packageManager` wins over all of them. */
const PM_LOCKFILES = [
    { name: 'pnpm', files: ['pnpm-lock.yaml'] },
    { name: 'yarn', files: ['yarn.lock'] },
    { name: 'bun', files: ['bun.lock', 'bun.lockb'] },
    { name: 'npm', files: ['package-lock.json', 'npm-shrinkwrap.json'] },
];

const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.turbo',
    '.next',
    '.nuxt',
    '.cache',
    '.output',
    'dist',
    'build',
    'coverage',
    'out',
]);

const MAX_SCAN_DEPTH = 8;

function isDirectory(dirPath) {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch {
        return false;
    }
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function readText(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function normalizeRel(value) {
    return String(value)
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/+$/, '');
}

function relDir(root, dir) {
    const rel = path.relative(root, dir).split(path.sep).join('/');
    return rel || '.';
}

function repoRoot(startDir) {
    let dir = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(path.join(dir, '.git'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function hasWorkspaceMarker(dir) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return true;
    if (fs.existsSync(path.join(dir, 'lerna.json'))) return true;
    const pkg = readJson(path.join(dir, 'package.json'));
    return Boolean(pkg && pkg.workspaces);
}

/**
 * Nearest workspace root at or above `startDir`. When the repository has a
 * `turbo.json` but no workspace manifest, that directory is still useful as the
 * root for PM and lockfile discovery.
 */
function findWorkspaceRoot(startDir) {
    const boundary = repoRoot(startDir);
    const stop = boundary || path.parse(path.resolve(startDir)).root;

    let dir = path.resolve(startDir);
    let turboFallback = null;
    while (true) {
        if (hasWorkspaceMarker(dir)) return dir;
        if (!turboFallback && fs.existsSync(path.join(dir, 'turbo.json'))) turboFallback = dir;
        if (dir === stop) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return turboFallback;
}

function readWorkspaceGlobs(root) {
    const globs = [];
    const pkg = readJson(path.join(root, 'package.json'));
    if (pkg && Array.isArray(pkg.workspaces)) {
        globs.push(...pkg.workspaces);
    } else if (pkg && pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
        globs.push(...pkg.workspaces.packages);
    }

    const yaml = readText(path.join(root, 'pnpm-workspace.yaml'));
    if (yaml) {
        let inPackages = false;
        for (const raw of yaml.split(/\r?\n/)) {
            const line = raw.replace(/\s+#.*$/, '').trimEnd();
            if (!line.trim()) continue;

            const inline = line.match(/^packages\s*:\s*\[(.*)\]\s*$/);
            if (inline) {
                for (const item of inline[1].split(',')) {
                    const value = item.trim().replace(/^['"]|['"]$/g, '');
                    if (value) globs.push(value);
                }
                inPackages = false;
                continue;
            }

            if (/^packages\s*:/.test(line)) {
                inPackages = true;
                continue;
            }
            if (!inPackages) continue;

            const item = line.match(/^\s*-\s+(.+)$/);
            if (item) {
                const value = item[1].trim().replace(/^['"]|['"]$/g, '');
                if (value) globs.push(value);
            } else if (!/^\s/.test(raw)) {
                inPackages = false;
            }
        }
    }

    return [...new Set(globs.filter(Boolean))];
}

/**
 * Reads pnpm catalogs from pnpm-workspace.yaml. Returns an object keyed by
 * catalog name (`default` for the top-level `catalog:` block). pnpm only
 * allows bare `catalog:` for the default catalog and `catalog:<name>` for the
 * named ones.
 */
function readPnpmCatalog(root) {
    const text = readText(path.join(root, 'pnpm-workspace.yaml'));
    if (!text) return {};

    const catalogs = {};
    const entry = (line) => {
        const match = line.match(/^\s*(['"]?)([^'":]+?)\1\s*:\s*(.+?)\s*$/);
        if (!match) return null;
        return [match[2].trim(), match[3].trim().replace(/^['"]|['"]$/g, '')];
    };

    let mode = null;
    let named = null;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\s+#.*$/, '').trimEnd();
        if (!line.trim()) continue;
        const indent = (raw.match(/^\s*/) || [''])[0].length;

        if (indent === 0) {
            if (/^catalog\s*:/.test(line)) {
                mode = 'default';
                named = null;
                if (!catalogs.default) catalogs.default = {};
            } else if (/^catalogs\s*:/.test(line)) {
                mode = 'named';
                named = null;
            } else {
                mode = null;
                named = null;
            }
            continue;
        }

        if (mode === 'default') {
            const parsed = entry(line);
            if (parsed) catalogs.default[parsed[0]] = parsed[1];
        } else if (mode === 'named' && indent <= 2) {
            const header = line.match(/^\s*(['"]?)([^'":]+?)\1\s*:\s*$/);
            if (header) {
                named = header[2].trim();
                if (!catalogs[named]) catalogs[named] = {};
            }
        } else if (mode === 'named' && named) {
            const parsed = entry(line);
            if (parsed) catalogs[named][parsed[0]] = parsed[1];
        }
    }

    return catalogs;
}

function escapeRegExp(ch) {
    return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Small glob -> RegExp conversion for workspace patterns (`*`, `**`, `?`). */
function globToRegExp(glob) {
    const normalized = normalizeRel(glob);
    let source = '^';

    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (ch === '*') {
            if (normalized[i + 1] === '*') {
                i++;
                if (normalized[i + 1] === '/') {
                    i++;
                    source += '(?:[^/]+/)*';
                } else {
                    source += '.*';
                }
            } else {
                source += '[^/]*';
            }
        } else if (ch === '?') {
            source += '[^/]';
        } else {
            source += escapeRegExp(ch);
        }
    }

    return new RegExp(`${source}$`);
}

function walkPackageDirs(root, maxDepth = MAX_SCAN_DEPTH) {
    const found = [];

    function visit(dir, depth) {
        if (depth > maxDepth) return;
        if (fs.existsSync(path.join(dir, 'package.json'))) found.push(dir);

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (SKIP_DIRS.has(entry.name)) continue;
            visit(path.join(dir, entry.name), depth + 1);
        }
    }

    visit(path.resolve(root), 0);
    return found;
}

function expandMemberDirs(root, globs) {
    const positives = globs.filter((glob) => !glob.startsWith('!'));
    const negatives = globs
        .filter((glob) => glob.startsWith('!'))
        .map((glob) => globToRegExp(glob.slice(1)));
    if (!positives.length) return [];

    const matchers = positives.map(globToRegExp);
    const members = walkPackageDirs(root);

    return members.filter((dir) => {
        const rel = relDir(root, dir);
        if (rel === '.') return false;
        if (!matchers.some((matcher) => matcher.test(rel))) return false;
        return !negatives.some((matcher) => matcher.test(rel));
    });
}

function packageInfo(dir) {
    const pkg = readJson(path.join(dir, 'package.json'));
    return {
        dir,
        name: (pkg && pkg.name) || path.basename(dir),
        rel: '',
    };
}

function packageName(dir) {
    return packageInfo(dir).name;
}

function allDependencies(pkg) {
    if (!pkg) return {};
    return {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {}),
    };
}

function hasNestDependency(pkg) {
    const deps = allDependencies(pkg);
    return (
        Object.prototype.hasOwnProperty.call(deps, '@nestjs/core') ||
        Object.prototype.hasOwnProperty.call(deps, '@nestjs/common')
    );
}

function isNestPackage(dir) {
    return hasNestDependency(readJson(path.join(dir, 'package.json')));
}

function isNestApp(dir) {
    if (!isNestPackage(dir)) return false;
    return isDirectory(path.join(dir, 'src'));
}

function nearestPackageDir(startDir, stopDir) {
    let dir = path.resolve(startDir);
    const boundary = stopDir ? path.resolve(stopDir) : null;

    while (true) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
        if (boundary && dir === boundary) return null;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function packageManagerFromField(root) {
    const pkg = readJson(path.join(root, 'package.json'));
    const raw = pkg && pkg.packageManager;
    if (typeof raw !== 'string') return null;

    const name = raw.split('@')[0].trim().toLowerCase();
    if (!PACKAGE_MANAGERS.includes(name)) return null;
    return { name, source: 'package.json packageManager' };
}

function detectPackageManagerForRoot(root, explicit, agent = process.env.npm_config_user_agent || '') {
    if (explicit) return { name: explicit, source: '--pm flag' };

    const fromField = packageManagerFromField(root);
    if (fromField) return fromField;

    for (const pm of PM_LOCKFILES) {
        const lockfile = pm.files.find((file) => fs.existsSync(path.join(root, file)));
        if (lockfile) return { name: pm.name, source: lockfile };
    }

    const fromAgent = PACKAGE_MANAGERS.find((name) => agent.startsWith(`${name}/`));
    if (fromAgent) return { name: fromAgent, source: 'invoking command' };

    return { name: 'npm', source: 'default' };
}

/**
 * Resolves which directory the CLI should configure, how the workspace is laid
 * out, and which package manager owns the lockfile.
 *
 * The return value never contains side effects. `appDir` is null when the
 * caller has to prompt (several candidates) or report an error (no candidate).
 */
function resolveProject({ cwd = process.cwd(), cwdFlag, appFlag, pmFlag } = {}) {
    const baseDir = path.resolve(cwd, cwdFlag || '.');

    if (!isDirectory(baseDir)) {
        throw new CliError(`Directory not found: ${baseDir}`, {
            hints: ['Check the --cwd value.'],
            exitCode: 2,
        });
    }

    if (cwdFlag && !fs.existsSync(path.join(baseDir, 'package.json'))) {
        throw new CliError(`No package.json found in ${baseDir}.`, {
            hints: ['--cwd must point at a package directory, not a parent folder.'],
            exitCode: 2,
        });
    }

    const workspaceRoot = findWorkspaceRoot(baseDir);
    const globs = workspaceRoot ? readWorkspaceGlobs(workspaceRoot) : [];
    const memberDirs = workspaceRoot
        ? globs.length
            ? expandMemberDirs(workspaceRoot, globs)
            : walkPackageDirs(workspaceRoot, 3).filter(
                  (dir) => path.resolve(dir) !== path.resolve(workspaceRoot),
              )
        : [];

    const members = memberDirs
        .map((dir) => ({ ...packageInfo(dir), rel: relDir(workspaceRoot, dir) }))
        .sort((a, b) => a.rel.localeCompare(b.rel));
    const candidates = members.filter((member) => isNestApp(member.dir));

    const pkgDir = nearestPackageDir(baseDir, workspaceRoot) || baseDir;
    let appDir = null;
    let ambiguous = false;

    if (appFlag) {
        const asPath = path.resolve(workspaceRoot || baseDir, appFlag);
        const byPath = fs.existsSync(path.join(asPath, 'package.json')) ? asPath : null;
        const byName = members.find(
            (member) =>
                member.name === appFlag ||
                member.rel === normalizeRel(appFlag) ||
                path.resolve(member.dir) === asPath,
        );
        const match = byPath || (byName && byName.dir);
        if (!match) {
            throw new CliError(`Workspace package "${appFlag}" not found.`, {
                hints: [
                    members.length
                        ? `Available packages: ${members.map((member) => member.name).join(', ')}`
                        : 'No workspace packages were found.',
                    'Use --app <package name> or --cwd <path>.',
                ],
                exitCode: 2,
            });
        }
        appDir = match;
    } else if (workspaceRoot && path.resolve(pkgDir) === path.resolve(workspaceRoot)) {
        // At the workspace root, workspace packages win over tooling-only Nest
        // dependencies declared in the root package.json.
        if (candidates.length === 1) appDir = candidates[0].dir;
        else if (candidates.length > 1) ambiguous = true;
        else if (isNestPackage(pkgDir)) appDir = pkgDir;
    } else if (isNestPackage(pkgDir)) {
        // Let preflight report a missing src/ folder with its existing message.
        appDir = pkgDir;
    } else if (workspaceRoot && candidates.length) {
        throw new CliError('The current package is not a NestJS application.', {
            hints: [
                `NestJS packages: ${candidates.map((candidate) => `${candidate.name} (${candidate.rel})`).join(', ')}`,
                'Use --app <package name> or --cwd <path> to choose one.',
            ],
            exitCode: 2,
        });
    }

    const pmRoot = workspaceRoot || pkgDir || baseDir;
    const pm = detectPackageManagerForRoot(pmRoot, pmFlag);

    return {
        baseDir,
        appDir,
        appRel: appDir && workspaceRoot ? relDir(workspaceRoot, appDir) : null,
        packageName: appDir ? packageName(appDir) : null,
        workspaceRoot,
        isWorkspace: Boolean(workspaceRoot),
        isMember: Boolean(
            appDir &&
                workspaceRoot &&
                members.some((member) => path.resolve(member.dir) === path.resolve(appDir)),
        ),
        pm,
        turbo: Boolean(workspaceRoot && fs.existsSync(path.join(workspaceRoot, 'turbo.json'))),
        candidates,
        ambiguous,
        globs,
    };
}

module.exports = {
    resolveProject,
    findWorkspaceRoot,
    readWorkspaceGlobs,
    readPnpmCatalog,
    globToRegExp,
    expandMemberDirs,
    isNestApp,
    isNestPackage,
    detectPackageManagerForRoot,
};
