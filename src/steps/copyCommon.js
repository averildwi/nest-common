const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');
const {
    resolveClientImport,
    rewriteFilterImport,
    wrapValidationOptions,
    TEMPLATE_CLIENT_IMPORT,
    LEGACY_CLIENT_IMPORT,
} = require('../transforms/prismaFilter');

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

        // The template imports Prisma from generated/prisma at the project root
        // (decision I16). Point it at wherever this project's client lives.
        if (ctx.hasPrisma && data.created.includes(FILTER_REL)) {
            const filterPath = path.join(ctx.targetDir, FILTER_REL);
            const filterSource = await fsHelpers.readFile(filterPath);
            let importPath = LEGACY_CLIENT_IMPORT;
            if (ctx.prismaClientOutput) {
                const resolved = resolveClientImport(ctx.projectRoot, ctx.prismaClientOutput);
                importPath = resolved.importPath;
                if (!resolved.generated) {
                    ui.warn('Prisma client not generated yet. Run "npx prisma generate" before building.');
                }
            }

            if (importPath !== TEMPLATE_CLIENT_IMPORT) {
                const patched = rewriteFilterImport(filterSource, importPath);
                if (patched) {
                    await fsHelpers.writeFile(filterPath, patched);
                    ui.success(`PrismaExceptionFilter imports Prisma from "${importPath}".`);
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
