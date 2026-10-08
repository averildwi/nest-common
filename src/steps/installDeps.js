const { run, formatCommand } = require('../utils/exec');
const ui = require('../ui/output');

/** Splits "name@version" while respecting scoped names like "@nestjs/common@11". */
function parseSpec(spec) {
    const at = spec.lastIndexOf('@');
    if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    return { name: spec, version: undefined };
}

/**
 * True when package.json already declares a compatible version of the spec.
 * Range specs (^x.y.z) are satisfied by any declared version of the same
 * major that is not older, e.g. required ^4.0.2 vs declared ^4.0.4 -> ok.
 */
function isSatisfied(spec, pkgJson, field) {
    const { name, version } = parseSpec(spec);
    const declared = (pkgJson[field] || {})[name];
    if (!declared) return false;
    if (!version || version === 'latest') return true;

    const strip = (s) => String(s).replace(/^[\^~=v\s]+/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const want = strip(version);
    const have = strip(declared);
    if (have[0] !== want[0]) return false;
    for (let i = 1; i < 3; i++) {
        const w = want[i] || 0;
        const h = have[i] || 0;
        if (h !== w) return h > w;
    }
    return true;
}

module.exports = {
    id: 'install',
    title: 'Install the ecosystem dependencies',

    plan(ctx) {
        if (!ctx.install) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: '--no-install' }] };
        }

        const deps = ctx.dependencies.filter((s) => !isSatisfied(s, ctx.pkgJson, 'dependencies'));
        if (deps.length === 0) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: 'already installed' }], data: { deps: [] } };
        }

        // npm keeps an existing devDependency in devDependencies even when
        // installed without --save-dev, so a runtime dep that sits there must
        // be moved explicitly with --save-prod.
        const misplaced = deps.filter((s) => isSatisfied(parseSpec(s).name, ctx.pkgJson, 'devDependencies'));

        return {
            entries: [{ kind: 'run', label: formatCommand(ctx.pm.name, addArgs(ctx, deps, misplaced)) }],
            data: { deps, misplaced },
        };
    },

    async run(ctx, { deps, misplaced }) {
        try {
            await run(ctx.pm.name, addArgs(ctx, deps, misplaced), { cwd: ctx.projectRoot });
        } catch (err) {
            // Peer conflicts (ERESOLVE) are the most common failure; older npm
            // resolutions still work, so retry once with --legacy-peer-deps.
            if (ctx.pm.name !== 'npm') throw err;
            ui.warn('npm reported a peer dependency conflict — retrying once with --legacy-peer-deps...');
            await run(ctx.pm.name, [...addArgs(ctx, deps, misplaced), '--legacy-peer-deps'], { cwd: ctx.projectRoot });
        }

        ui.success(`Installed ${deps.map((s) => parseSpec(s).name).join(', ')}`);
        return { files: [{ kind: 'modify', path: 'package.json' }] };
    },
};

function addArgs(ctx, deps, misplaced) {
    const args = ctx.pm.add(deps);
    return misplaced.length && ctx.pm.prodFlag ? [...args, ctx.pm.prodFlag] : args;
}

module.exports.parseSpec = parseSpec;
module.exports.isSatisfied = isSatisfied;
