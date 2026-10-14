const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');
const { register, IMPORT_LINES, THROTTLER_USAGE, GUARD_PROVIDER } = require('../transforms/appModule');

const LABEL = 'AppConfigModule, HashingModule, ThrottlerModule + global ThrottlerGuard';

module.exports = {
    id: 'register',
    title: 'Register config, hashing and the global throttler in AppModule',

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
        return { entries: [{ kind: 'modify', label: `${file} (add ${LABEL})` }], data: { missing: false } };
    },

    async run(ctx, { missing }) {
        const file = rel(ctx, ctx.paths.appModule);
        const manual = [
            ...IMPORT_LINES,
            "import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';",
            "import { APP_GUARD } from '@nestjs/core';",
            `imports: [AppConfigModule.forProject(), HashingModule, ${THROTTLER_USAGE.replace(/,$/, '')}]`,
            `providers: [${GUARD_PROVIDER.replace(/,$/, '')}]`,
        ];

        if (missing) {
            ui.warn('src/app.module.ts not found. Register these manually:');
            ui.code(manual);
            return { status: 'warning' };
        }

        const source = await fsHelpers.readFile(ctx.paths.appModule);
        const result = register(source);
        if (!result) {
            ui.skip('AppModule already registers everything');
            return { status: 'skipped' };
        }

        await fsHelpers.writeFile(ctx.paths.appModule, result.source);
        if (result.needsManualEdit) {
            ui.warn(`Could not find an "imports: [" array in ${file}. Add these manually:`);
            ui.code(manual.slice(-2));
            return { status: 'warning' };
        }

        ui.success(`Registered ${LABEL} in ${file}`);
        return { files: [{ kind: 'modify', path: file }] };
    },
};
