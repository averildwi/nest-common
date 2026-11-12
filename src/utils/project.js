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

module.exports = { findPackageFile, findUp, findPnpMarker, readPackageJson };
