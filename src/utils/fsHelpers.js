const fs = require('fs-extra');
const path = require('path');

function existsSync(filePath) {
    return fs.existsSync(filePath);
}

async function exists(filePath) {
    return fs.pathExists(filePath);
}

async function readFile(filePath) {
    return fs.readFile(filePath, 'utf8');
}

async function writeFile(filePath, content) {
    return fs.writeFile(filePath, content, 'utf8');
}

async function ensureDir(dirPath) {
    return fs.ensureDir(dirPath);
}

async function copy(src, dest) {
    return fs.copy(src, dest, { overwrite: false, errorOnExist: false });
}

async function remove(target) {
    return fs.remove(target);
}

/** Recursively lists every file below a directory (absolute paths). */
async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else files.push(full);
    }
    return files;
}

module.exports = { existsSync, exists, readFile, writeFile, ensureDir, copy, remove, walk };
