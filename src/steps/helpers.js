const path = require('path');

const { CliError } = require('../errors');
const { findPnpMarker } = require('../utils/project');

/** Display a path relative to the project root with forward slashes. */
function rel(ctx, absolutePath) {
    return path.relative(ctx.projectRoot, absolutePath).split(path.sep).join('/');
}

/**
 * Fails before any file is written when the project is a Yarn PnP workspace.
 * PnP intentionally has no node_modules, so hoisted version detection cannot
 * work and the CLI would otherwise guess the wrong ecosystem major.
 */
function assertNoPnp(ctx) {
    const marker = findPnpMarker(ctx.projectRoot) || (ctx.workspaceRoot ? findPnpMarker(ctx.workspaceRoot) : null);
    if (!marker) return;

    throw new CliError('Yarn PnP projects are not supported yet.', {
        hints: [
            `Found ${marker}, but this CLI needs node_modules to detect the installed NestJS version.`,
            'Switch the project to nodeLinker: "node-modules" (.yarnrc.yml), or re-run with --no-install and wire the modules manually.',
        ],
    });
}

module.exports = { rel, assertNoPnp };
