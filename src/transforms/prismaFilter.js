const path = require('path');

/**
 * Resolves the generated Prisma client directory (from the generator `output`
 * value, which is relative to prisma/) to the import path prisma-exception.filter.ts
 * must use. The client entry is emitted as `.../client.js` so the import is
 * valid under both CommonJS and ESM ("nodenext") resolution.
 *
 * @param {string} projectRoot
 * @param {string} output raw `output` value from prisma/schema.prisma
 * @returns {string|null} import specifier for the client, or null when the
 *   client has not been generated yet
 */
function resolveClientImport(projectRoot, output) {
    const outDir = path.resolve(path.join(projectRoot, 'prisma'), output);
    const clientEntry = path.join(outDir, 'client');
    const fs = require('fs');
    if (!fs.existsSync(`${clientEntry}.ts`) && !fs.existsSync(`${clientEntry}.js`)) {
        return null;
    }

    const filterDir = path.join(projectRoot, 'src', 'common', 'filters');
    let rel = path.relative(filterDir, outDir).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `${rel}/client.js`;
}

/** Rewrites the filter's `Prisma` import to the generated client. Null when unchanged. */
function rewriteFilterImport(source, importPath) {
    const next = source.replace(
        /import\s*\{\s*Prisma\s*\}\s*from\s*['"]@prisma\/client['"];?/,
        `import { Prisma } from '${importPath}';`,
    );
    return next === source ? null : next;
}

/** Nests Joi's validationOptions inside `libraryOptions` (@nestjs/config v12+). */
function wrapValidationOptions(source) {
    const next = source.replace(
        /validationOptions:\s*\{\s*abortEarly:\s*false,\s*allowUnknown:\s*true,\s*\}/,
        `validationOptions: {\n              libraryOptions: {\n                abortEarly: false,\n                allowUnknown: true,\n              },\n            }`,
    );
    return next === source ? null : next;
}

module.exports = { resolveClientImport, rewriteFilterImport, wrapValidationOptions };
