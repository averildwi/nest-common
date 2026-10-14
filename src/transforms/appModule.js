const MODULES = [
    { name: 'AppConfigModule', path: './common/config/app-config.module', usage: 'AppConfigModule.forProject(),' },
    { name: 'HashingModule', path: './common/hashing/hashing.module', usage: 'HashingModule,' },
];

const THROTTLER_IMPORT = "import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';";
const APP_GUARD_IMPORT = "import { APP_GUARD } from '@nestjs/core';";
/** Global default (decision I12); auth endpoints add a stricter @Throttle(). */
const THROTTLER_USAGE = 'ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),';
const GUARD_PROVIDER = '{ provide: APP_GUARD, useClass: ThrottlerGuard },';

const IMPORT_PATH_PATTERNS = MODULES.map(
    (m) => new RegExp(`from\\s+['"]${m.path.replace(/[./]/g, (c) => `\\${c}`)}(\\.js)?['"]`),
);

const MODULE_USAGE = /AppConfigModule\.forProject\s*\(/;
const THROTTLER_MODULE_USAGE = /ThrottlerModule\.forRoot\s*\(/;
const GUARD_USAGE = /useClass\s*:\s*ThrottlerGuard/;

/** Follow the file's own style for relative imports (`./x` vs `./x.js`). */
function usesJsExtension(source) {
    return /from\s+['"]\.{1,2}\/[^'"]+\.js['"]/.test(source);
}

function importLines(source) {
    const js = usesJsExtension(source);
    return MODULES.map((m) => `import { ${m.name} } from '${m.path}${js ? '.js' : ''}';`);
}

/** Kept for callers that print the lines for a manual edit. */
const IMPORT_LINES = MODULES.map((m) => `import { ${m.name} } from '${m.path}.js';`);

/** True when app.module.ts already wires everything up. */
function isRegistered(source) {
    return (
        IMPORT_PATH_PATTERNS.every((p) => p.test(source)) &&
        MODULE_USAGE.test(source) &&
        THROTTLER_MODULE_USAGE.test(source) &&
        GUARD_USAGE.test(source)
    );
}

/** Inserts lines after the last top-level import statement. */
function insertImports(source, lines) {
    if (!lines.length) return source;
    const importRegex = /^import\s[^;]*;/gm;
    let lastMatch = null;
    let match;
    while ((match = importRegex.exec(source)) !== null) {
        lastMatch = match;
    }
    if (!lastMatch) return `${lines.join('\n')}\n${source}`;
    const at = lastMatch.index + lastMatch[0].length;
    return `${source.slice(0, at)}\n${lines.join('\n')}${source.slice(at)}`;
}

/** Adds entries at the top of the `<key>: [...]` array of @Module. */
function injectIntoArray(source, key, entries) {
    if (!entries.length) return source;
    const body = entries.map((e) => `    ${e}`).join('\n');
    const emptyArray = new RegExp(`(${key}\\s*:\\s*)\\[(\\s*)\\]`);
    if (emptyArray.test(source)) {
        return source.replace(emptyArray, `$1[\n${body}\n  ]`);
    }
    return source.replace(new RegExp(`(${key}\\s*:\\s*\\[)`), `$1\n${body}`);
}

/** Adds a `providers: [...]` array after `imports: [...]` when the module has none. */
function ensureProvidersArray(source) {
    if (/providers\s*:\s*\[/.test(source)) return source;
    return source.replace(/(@Module\(\{\s*\n?)/, '$1  providers: [],\n');
}

/**
 * Wires AppConfigModule.forProject(), HashingModule and the global
 * ThrottlerGuard into an AppModule source. Returns null when there is nothing
 * to do, otherwise `{ source, needsManualEdit? }`. needsManualEdit is set when
 * the module has no `imports: [...]` array.
 * Works on LF internally and restores the file's own line endings.
 */
function register(source) {
    if (isRegistered(source)) return null;

    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    let out = source.replace(/\r\n/g, '\n');

    const missingImports = importLines(out).filter((_, i) => !IMPORT_PATH_PATTERNS[i].test(out));
    if (!/from\s+['"]@nestjs\/throttler['"]/.test(out)) missingImports.push(THROTTLER_IMPORT);
    if (!/\bAPP_GUARD\b/.test(out)) missingImports.push(APP_GUARD_IMPORT);
    out = insertImports(out, missingImports);

    if (!/(imports\s*:\s*\[)/.test(out)) {
        return { source: out.replace(/\n/g, eol), needsManualEdit: true };
    }

    const imports = [];
    if (!MODULE_USAGE.test(out)) imports.push(MODULES[0].usage);
    if (!/\bHashingModule\s*[,\]]/.test(out.slice(out.search(/imports\s*:\s*\[/)))) imports.push(MODULES[1].usage);
    if (!THROTTLER_MODULE_USAGE.test(out)) imports.push(THROTTLER_USAGE);
    out = injectIntoArray(out, 'imports', imports);

    if (!GUARD_USAGE.test(out)) {
        out = ensureProvidersArray(out);
        out = injectIntoArray(out, 'providers', [GUARD_PROVIDER]);
    }

    return { source: out.replace(/\n/g, eol) };
}

module.exports = {
    register,
    isRegistered,
    usesJsExtension,
    IMPORT_LINES,
    IMPORT_PATH_PATTERNS,
    MODULE_USAGE,
    THROTTLER_USAGE,
    GUARD_PROVIDER,
};
