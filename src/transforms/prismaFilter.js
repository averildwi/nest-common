const path = require('path');

/**
 * Resolves the generated Prisma client directory (from the generator `output`
 * value, which is relative to prisma/) to the import path prisma-exception.filter.ts
 * must use. The client entry is emitted as `.../client.ts`; the import uses
 * `.js` so it is valid under both CommonJS and ESM ("nodenext") resolution.
 *
 * @param {string} projectRoot
 * @param {string} output raw `output` value from prisma/schema.prisma
 * @returns {{ importPath: string, generated: boolean }} `generated` is false
 *   when "prisma generate" has not run yet (the path is still correct)
 */
function resolveClientImport(projectRoot, output) {
    const outDir = path.resolve(path.join(projectRoot, 'prisma'), output);
    const clientEntry = path.join(outDir, 'client');
    const fs = require('fs');
    const generated = fs.existsSync(`${clientEntry}.ts`) || fs.existsSync(`${clientEntry}.js`);

    const filterDir = path.join(projectRoot, 'src', 'common', 'filters');
    let rel = path.relative(filterDir, outDir).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return { importPath: `${rel}/client.js`, generated };
}

/** Import the filter template ships with (decision I16: client in generated/ at the project root). */
const TEMPLATE_CLIENT_IMPORT = '../../../generated/prisma/client.js';
/** Legacy `prisma-client-js` generator: the Prisma namespace comes from the package. */
const LEGACY_CLIENT_IMPORT = '@prisma/client';

/** Rewrites the filter's `Prisma` import to importPath. Null when unchanged. */
function rewriteFilterImport(source, importPath) {
    const next = source.replace(
        /import\s*\{\s*Prisma\s*\}\s*from\s*['"][^'"]+['"];?/,
        `import { Prisma } from '${importPath}';`,
    );
    return next === source ? null : next;
}

/**
 * Nests Joi's validationOptions inside `libraryOptions` (@nestjs/config v12+),
 * keeping the indentation of the block it replaces so the result is already
 * formatted (the lint step only formats when Prettier is installed).
 */
function wrapValidationOptions(source) {
    // Keep the file's own line ending: the template ships LF, but a project
    // may have checked it out (or rewritten it) with CRLF.
    const eol = /\r\n/.test(source) ? '\r\n' : '\n';
    const next = source.replace(
        /([ \t]*)validationOptions:\s*\{\s*abortEarly:\s*false,\s*allowUnknown:\s*true,\s*\}/,
        (_match, indent) =>
            [
                `${indent}validationOptions: {`,
                `${indent}  libraryOptions: {`,
                `${indent}    abortEarly: false,`,
                `${indent}    allowUnknown: true,`,
                `${indent}  },`,
                `${indent}}`,
            ].join(eol),
    );
    return next === source ? null : next;
}

module.exports = {
    resolveClientImport,
    rewriteFilterImport,
    wrapValidationOptions,
    TEMPLATE_CLIENT_IMPORT,
    LEGACY_CLIENT_IMPORT,
};
