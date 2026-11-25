const { run, formatCommand } = require('../utils/exec');
const { scriptArgs } = require('../utils/packageManager');
const { resolvePackageBin } = require('../utils/project');
const ui = require('../ui/output');

/**
 * Formats the files this run wrote or edited.
 *
 * Prettier is called directly on those files only. The project's `lint` script
 * is not used for formatting any more:
 *   - on Nest 11 it is `eslint --fix` over the whole repo, which reformats
 *     files outside this run (and takes ~13s),
 *   - on Nest 12 it is `oxlint`, which reports but never formats, so the
 *     injected code stayed unformatted and failed `prettier --check`.
 * `--end-of-line auto` keeps a CRLF file CRLF.
 *
 * Prettier ships with every `nest new` template and is looked up in the
 * project (hoisted workspace root included), never downloaded. Without it the
 * step is skipped: formatting is cosmetic and must not fail the scaffold.
 */
const FILE_LIMIT = 50;

function formatArgs(files) {
    return ['--write', '--end-of-line', 'auto', ...files];
}

/** The files written by earlier steps, relative to the project root, deduplicated. */
function writtenFiles(ctx) {
    return [...new Set((ctx.writtenFiles || []).map((f) => f.path))].filter((p) => /\.(ts|mts|cts|js|mjs|cjs|json)$/.test(p)).sort();
}

module.exports = {
    id: 'lint',
    title: 'Format the written files with Prettier',
    formatArgs,
    writtenFiles,

    async plan(ctx) {
        if (ctx.lint === false) {
            return { entries: [{ kind: 'skip', label: 'prettier --write', reason: '--no-lint' }], data: {} };
        }
        // plan() runs before any file is written, so the file list is only
        // known at run time; the label stays generic here.
        const bin = resolvePackageBin(ctx.projectRoot, 'prettier');
        if (!bin) {
            return {
                entries: [{ kind: 'skip', label: 'prettier --write', reason: 'prettier is not installed in this project' }],
                data: {},
            };
        }
        return { entries: [{ kind: 'run', label: 'prettier --write <files written by this run>' }], data: { bin } };
    },

    async run(ctx, { bin }) {
        const files = writtenFiles(ctx);
        if (!files.length) {
            ui.skip('No files to format');
            return { status: 'skipped' };
        }
        if (files.length > FILE_LIMIT) {
            // A list this long means something else went wrong; do not build a
            // command line of unbounded length.
            ui.warn(`Skipped formatting: ${files.length} files is more than expected (${FILE_LIMIT}).`);
            return { status: 'warning' };
        }

        try {
            await run(process.execPath, [bin, ...formatArgs(files)], { cwd: ctx.projectRoot });
            ui.success(`Formatted ${files.length} file(s) with Prettier`);
        } catch {
            const hasFormat = Boolean(ctx.pkgJson && ctx.pkgJson.scripts && ctx.pkgJson.scripts.format);
            const how = hasFormat
                ? `Run "${formatCommand(ctx.pm.name, scriptArgs(ctx, 'format'))}" yourself if the formatting matters.`
                : `Run "npx prettier --write ${files.join(' ')}" yourself if the formatting matters.`;
            ui.warn(`Prettier could not format the written files — this does NOT affect the scaffolding result. ${how}`);
            return { status: 'warning' };
        }
        return {};
    },
};
