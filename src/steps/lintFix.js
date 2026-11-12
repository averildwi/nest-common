const { run, formatCommand } = require('../utils/exec');
const { commandCwd, scriptArgs } = require('../utils/packageManager');
const ui = require('../ui/output');

module.exports = {
    id: 'lint',
    title: 'Auto-format the injected code with the lint script',

    async plan(ctx) {
        const label = formatCommand(ctx.pm.name, scriptArgs(ctx, 'lint'));

        if (!ctx.pkgJson.scripts || !ctx.pkgJson.scripts.lint) {
            return { entries: [{ kind: 'skip', label, reason: 'no lint script configured' }], data: {} };
        }
        if (ctx.lint === false) {
            return { entries: [{ kind: 'skip', label, reason: '--no-lint' }], data: {} };
        }
        if (!ctx.install) {
            return { entries: [{ kind: 'skip', label, reason: '--no-install' }], data: {} };
        }
        return { entries: [{ kind: 'run', label }], data: {} };
    },

    async run(ctx) {
        try {
            await run(ctx.pm.name, scriptArgs(ctx, 'lint'), { cwd: commandCwd(ctx) });
            ui.success('Lint auto-fix applied');
        } catch (err) {
            ui.warn('The lint script failed or reported issues — this does NOT affect the scaffolding result, check your lint config manually.');
            return { status: 'warning' };
        }
        return {};
    },
};
