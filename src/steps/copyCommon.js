const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');
const { resolveClientImport, rewriteFilterImport, wrapValidationOptions } = require('../transforms/prismaFilter');

const FILTER_REL = path.join('filters', 'prisma-exception.filter.ts');
const CONFIG_MODULE_REL = path.join('config', 'app-config.module.ts');

module.exports = {
    id: 'common',
    title: 'Copy the common boilerplate into src/common',

    async plan(ctx) {
        let files = await fsHelpers.walk(ctx.templatesDir);
        const entries = [];
        const data = { created: [], skipped: [] };

        // Without Prisma the filter would reference a package that isn't
        // installed — exclude it from the copy entirely.
        if (!ctx.hasPrisma) {
            files = files.filter(
                (filePath) => path.relative(ctx.templatesDir, filePath) !== FILTER_REL,
            );
        }

        for (const filePath of files) {
            const relPath = path.relative(ctx.templatesDir, filePath);
            const dest = path.join(ctx.targetDir, relPath);
            if (await fsHelpers.exists(dest)) {
                entries.push({ kind: 'skip', label: rel(ctx, dest), reason: 'already exists' });
                data.skipped.push(relPath);
            } else {
                entries.push({ kind: 'create', label: rel(ctx, dest) });
                data.created.push(relPath);
            }
        }

        if (!ctx.hasPrisma) {
            entries.push({
                kind: 'skip',
                label: 'src/common/filters/prisma-exception.filter.ts',
                reason: 'No Prisma detected — re-run this CLI after setting up Prisma if you want it',
            });
        }

        return { entries, data };
    },

    async run(ctx, data) {
        await fsHelpers.ensureDir(ctx.targetDir);
        await fsHelpers.copy(ctx.templatesDir, ctx.targetDir);

        const files = data.created.map((p) => ({ kind: 'create', path: rel(ctx, path.join(ctx.targetDir, p)) }));

        if (!ctx.hasPrisma) {
            const filterPath = path.join(ctx.targetDir, FILTER_REL);
            if (await fsHelpers.exists(filterPath)) {
                await fsHelpers.remove(filterPath);
                ui.warn('No Prisma detected — prisma-exception.filter.ts was NOT created. Re-run this CLI after setting up Prisma if you want it.');
            }
        }

        // New `prisma-client` generator: the Prisma namespace lives in the
        // generated client, not in @prisma/client. Point the filter at it.
        if (ctx.hasPrisma && ctx.prismaClientOutput) {
            const filterPath = path.join(ctx.targetDir, FILTER_REL);
            const filterSource = await fsHelpers.readFile(filterPath);
            const importPath = resolveClientImport(ctx.projectRoot, ctx.prismaClientOutput);

            if (importPath === null) {
                ui.warn('Prisma client not generated yet — run "npx prisma generate", then fix the import in prisma-exception.filter.ts manually.');
            } else {
                const patched = rewriteFilterImport(filterSource, importPath);
                if (patched) {
                    await fsHelpers.writeFile(filterPath, patched);
                    ui.success(`PrismaExceptionFilter import rewritten to "${importPath}" (new prisma-client generator detected).`);
                    files.push({ kind: 'modify', path: rel(ctx, filterPath) });
                }
            }
        }

        // @nestjs/config v12 moved vendor-specific options into libraryOptions.
        if ((ctx.configMajor ?? 0) >= 12) {
            const configPath = path.join(ctx.targetDir, CONFIG_MODULE_REL);
            const configSource = await fsHelpers.readFile(configPath);
            const patched = wrapValidationOptions(configSource);
            if (patched) {
                await fsHelpers.writeFile(configPath, patched);
                ui.success('AppConfigModule validationOptions adapted for @nestjs/config v12 (Standard Schema libraryOptions).');
                if (!files.some((f) => f.path === rel(ctx, configPath))) {
                    files.push({ kind: 'modify', path: rel(ctx, configPath) });
                }
            }
        }

        if (files.length) {
            ui.success(`${files.length} file(s) copied into src/common`);
        }
        if (data.skipped.length) {
            ui.skip(`${data.skipped.length} existing file(s) were not overwritten`);
        }

        return { files };
    },
};
