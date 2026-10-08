const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');
const { register } = require('../transforms/appModule');

module.exports = {
    id: 'register',
    title: 'Register AppConfigModule and HashingModule in AppModule',

    async plan(ctx) {
        const file = rel(ctx, ctx.paths.appModule);

        if (!(await fsHelpers.exists(ctx.paths.appModule))) {
            return {
                entries: [{ kind: 'skip', label: file, reason: 'file not found, register the modules manually' }],
                data: { missing: true },
            };
        }
        const source = await fsHelpers.readFile(ctx.paths.appModule);
        if (register(source) === null) {
            return { entries: [{ kind: 'skip', label: file, reason: 'modules already registered' }], data: { missing: false } };
        }
        return { entries: [{ kind: 'modify', label: `${file} (add AppConfigModule + HashingModule)` }], data: { missing: false } };
    },

    async run(ctx, { missing }) {
        const file = rel(ctx, ctx.paths.appModule);

        if (missing) {
            ui.warn(`src/app.module.ts not found — register these manually:`);
            ui.code([
                "import { AppConfigModule } from './common/config/app-config.module.js';",
                "import { HashingModule } from './common/hashing/hashing.module.js';",
                '@Module({ imports: [AppConfigModule.forProject(), HashingModule] })',
            ]);
            return { status: 'warning' };
        }

        const source = await fsHelpers.readFile(ctx.paths.appModule);
        const result = register(source);
        if (!result) {
            ui.skip('AppModule already registers both modules');
            return { status: 'skipped' };
        }

        await fsHelpers.writeFile(ctx.paths.appModule, result.source);
        if (result.needsManualEdit) {
            ui.warn(`Could not find an "imports: [" array in ${file}. Add these manually:`);
            ui.code(['AppConfigModule.forProject(),', 'HashingModule,']);
            return { status: 'warning' };
        }

        ui.success(`Injected AppConfigModule.forProject() and HashingModule into ${file}`);
        return { files: [{ kind: 'modify', path: file }] };
    },
};
