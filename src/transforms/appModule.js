const IMPORT_LINES = [
    "import { AppConfigModule } from './common/config/app-config.module.js';",
    "import { HashingModule } from './common/hashing/hashing.module.js';",
];

const IMPORT_PATH_PATTERNS = [
    /from\s+['"]\.\/common\/config\/app-config\.module(\.js)?['"]/,
    /from\s+['"]\.\/common\/hashing\/hashing\.module(\.js)?['"]/,
];

const MODULE_USAGE = /AppConfigModule\.forProject\s*\(/;

/** True when app.module.ts already wires both modules up. */
function isRegistered(source) {
    return (
        IMPORT_PATH_PATTERNS[0].test(source) &&
        IMPORT_PATH_PATTERNS[1].test(source) &&
        MODULE_USAGE.test(source)
    );
}

/** Inserts the import lines after the last top-level import statement. */
function insertImports(source) {
    const importRegex = /^import\s[^;]*;/gm;
    let lastMatch = null;
    let match;
    while ((match = importRegex.exec(source)) !== null) {
        lastMatch = match;
    }
    if (!lastMatch) return `${IMPORT_LINES.join('\n')}\n${source}`;
    const at = lastMatch.index + lastMatch[0].length;
    return `${source.slice(0, at)}\n${IMPORT_LINES.join('\n')}${source.slice(at)}`;
}

/** Adds both modules at the top of the `imports: [...]` array. */
function injectIntoImportsArray(source) {
    return source.replace(
        /(imports\s*:\s*\[)/,
        `$1\n    AppConfigModule.forProject(),\n    HashingModule,`,
    );
}

/**
 * Wires AppConfigModule.forProject() + HashingModule into an AppModule source.
 * Returns null when there is nothing to do (already registered), otherwise
 * `{ source, needsManualEdit? }` — needsManualEdit is set when the module
 * graph has no `imports: [...]` array (the imports are still inserted, but
 * the caller should tell the user to register the modules by hand).
 */
function register(source) {
    if (isRegistered(source)) return null;

    let out = source;
    if (!IMPORT_PATH_PATTERNS[0].test(out) || !IMPORT_PATH_PATTERNS[1].test(out)) {
        out = insertImports(out);
    }
    if (!MODULE_USAGE.test(out)) {
        if (!/(imports\s*:\s*\[)/.test(out)) return { source: out, needsManualEdit: true };
        out = injectIntoImportsArray(out);
    }
    return { source: out };
}

module.exports = {
    register,
    isRegistered,
    IMPORT_LINES,
    IMPORT_PATH_PATTERNS,
    MODULE_USAGE,
};
