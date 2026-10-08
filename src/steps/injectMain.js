const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');
const { buildImportBlock, buildCorsBlock, buildSwaggerBlock, applyToMain } = require('../transforms/mainTs');

const COMMON_MARKER = "from './common/pipes/validation.pipe.config'";

module.exports = {
    id: 'main',
    title: 'Wire CORS, pipes, interceptors, filters and Swagger in main.ts',

    async plan(ctx) {
        const file = rel(ctx, ctx.paths.mainTs);

        if (!(await fsHelpers.exists(ctx.paths.mainTs))) {
            return {
                entries: [{ kind: 'skip', label: file, reason: 'file not found, wire it up manually' }],
                data: { missing: true },
            };
        }

        const source = await fsHelpers.readFile(ctx.paths.mainTs);
        const data = analyze(source, ctx);
        const entries = [];

        if (data.hasCommonImports) {
            entries.push({ kind: 'skip', label: file, reason: 'common imports already present' });
        } else {
            entries.push({ kind: 'modify', label: `${file} (add common imports)` });
        }

        if (data.hasCors) {
            entries.push({ kind: 'skip', label: file, reason: 'CORS/pipes/interceptors/filters already configured' });
        } else {
            entries.push({ kind: 'modify', label: `${file} (enable CORS + global pipes/interceptors/filters)` });
        }

        if (!ctx.answers.useSwagger) {
            entries.push({ kind: 'skip', label: file, reason: 'Swagger setup skipped (--no-swagger)' });
        } else if (data.hasSwaggerSetup) {
            entries.push({ kind: 'skip', label: file, reason: 'Swagger already configured, left untouched' });
        } else {
            entries.push({ kind: 'modify', label: `${file} (set up Swagger docs at /${ctx.answers.swagger.docsPath})` });
        }

        return { entries, data: { ...data, missing: false } };
    },

    async run(ctx, data) {
        const file = rel(ctx, ctx.paths.mainTs);

        if (data.missing) {
            ui.warn('src/main.ts not found — wire CORS, pipes and interceptors manually.');
            return { status: 'warning' };
        }

        const source = await fsHelpers.readFile(ctx.paths.mainTs);
        const fresh = analyze(source, ctx);

        const needsImports = !fresh.hasCommonImports;
        const injectionParts = [];
        if (!fresh.hasCors) injectionParts.push(buildCorsBlock({ hasPrisma: ctx.hasPrisma }));
        if (ctx.answers.useSwagger && !fresh.hasSwaggerSetup) {
            injectionParts.push(buildSwaggerBlock(ctx.answers.swagger));
        }
        const injectionCode = injectionParts.length ? injectionParts.join('\n') : null;

        const importBlock = needsImports
            ? buildImportBlock({
                  useSwagger: ctx.answers.useSwagger,
                  hasPrisma: ctx.hasPrisma,
                  needsSwaggerLib: !source.includes("from '@nestjs/swagger'"),
              })
            : null;

        const result = applyToMain(source, { importBlock, injectionCode });
        if (!result) {
            ui.skip('main.ts already configured the way this CLI would leave it');
            return { status: 'skipped' };
        }

        await fsHelpers.writeFile(ctx.paths.mainTs, result.source);
        if (result.needsManualInjection) {
            ui.warn(`Could not find the NestFactory.create(AppModule) line in ${file}. Paste this into bootstrap():`);
            ui.code(result.needsManualInjection);
            return { status: 'warning' };
        }

        ui.success(`Configured ${file}`);
        return { files: [{ kind: 'modify', path: file }] };
    },
};

function analyze(source, ctx) {
    const hasCommonImports = source.includes(COMMON_MARKER) || source.includes('createValidationPipe');
    return {
        hasCommonImports,
        hasCors: source.includes('app.enableCors'),
        hasSwaggerSetup: source.includes('SwaggerModule.createDocument') || source.includes('SwaggerModule.setup('),
        useSwagger: ctx.answers.useSwagger,
    };
}
