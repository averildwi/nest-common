const { run } = require('../utils/exec');
const ui = require('../ui/output');

module.exports = {
    id: 'lint',
    title: 'Auto-format the injected code with "npm run lint"',

    async plan(ctx) {
        if (!ctx.pkgJson.scripts || !ctx.pkgJson.scripts.lint) {
            return { entries: [{ kind: 'skip', label: 'npm run lint', reason: 'no lint script configured' }], data: {} };
        }
        if (!ctx.install) {
            return { entries: [{ kind: 'skip', label: 'npm run lint', reason: '--no-install' }], data: {} };
        }
        return { entries: [{ kind: 'run', label: `${ctx.pm.name} run lint` }], data: {} };
    },

    async run(ctx) {
        try {
            await run(ctx.pm.name, ['run', 'lint'], { cwd: ctx.projectRoot });
            ui.success('Lint auto-fix applied');
        } catch (err) {
            ui.warn('"npm run lint" failed or reported issues — this does NOT affect the scaffolding result, check your lint config manually.');
            return { status: 'warning' };
        }
        return {};
    },
};
