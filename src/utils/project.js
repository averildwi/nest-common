const fs = require('fs');
const path = require('path');

/**
 * Walks up from `startDir` until it finds `node_modules/<packageName>`.
 * npm and pnpm hoist dependencies to the workspace root, so the package is not
 * always directly below the app.
 */
function findPackageFile(startDir, packageName) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, 'node_modules', packageName, 'package.json');
        if (fs.existsSync(candidate)) return candidate;

        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Resolves the JS entrypoint declared in a package's `bin` field. */
function resolvePackageBin(startDir, packageName, binName = packageName) {
    const pkgPath = findPackageFile(startDir, packageName);
    if (!pkgPath) return null;

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
        return null;
    }

    let entry;
    if (typeof pkg.bin === 'string') entry = pkg.bin;
    else if (pkg.bin && typeof pkg.bin === 'object') entry = pkg.bin[binName] || Object.values(pkg.bin)[0];
    if (!entry) return null;

    const binPath = path.resolve(path.dirname(pkgPath), entry);
    return fs.existsSync(binPath) ? binPath : null;
}

/** Walks up from `startDir` looking for a single file. */
function findUp(startDir, fileName) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, fileName);
        if (fs.existsSync(candidate)) return candidate;

        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Yarn PnP has no node_modules, so local package lookup cannot work. */
function findPnpMarker(startDir) {
    return findUp(startDir, '.pnp.cjs') || findUp(startDir, '.pnp.js');
}

/** Reads a package.json and returns the parsed object, or null. */
function readPackageJson(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
        return null;
    }
}

module.exports = { findPackageFile, resolvePackageBin, findUp, findPnpMarker, readPackageJson };
