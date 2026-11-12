const fs = require('fs');
const path = require('path');

/**
 * How to drive each supported package manager. Commands are expressed as
 * argument arrays so they can be spawned without a shell.
 *
 * Workspace commands run from the workspace root and target a member by name,
 * except for bun which has no per-workspace add flag and runs in the app.
 */
const PACKAGE_MANAGERS = {
    npm: {
        name: 'npm',
        lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'],
        add: (pkgs) => ['install', ...pkgs],
        addDev: (pkgs) => ['install', '--save-dev', ...pkgs],
        // Moves a package that is already a devDependency into dependencies.
        prodFlag: '--save-prod',
        // npm is the only PM with a dedicated peer-conflict escape hatch.
        legacyPeerDeps: '--legacy-peer-deps',
        script: (script) => ['run', script],
        exec: (bin, args) => ({ command: 'npx', args: [bin, ...args] }),
        workspaceCwd: 'root',
        workspaceAdd: (name, pkgs) => ['install', ...pkgs, '--workspace', name],
        workspaceAddDev: (name, pkgs) => ['install', '--save-dev', ...pkgs, '--workspace', name],
        workspaceScript: (name, script) => ['run', script, '--workspace', name],
        workspaceExec: (name, bin, args) => ({ command: 'npm', args: ['exec', '--workspace', name, '--', bin, ...args] }),
    },
    pnpm: {
        name: 'pnpm',
        lockfiles: ['pnpm-lock.yaml'],
        add: (pkgs) => ['add', ...pkgs],
        addDev: (pkgs) => ['add', '-D', ...pkgs],
        prodFlag: '--save-prod',
        script: (script) => ['run', script],
        exec: (bin, args) => ({ command: 'pnpm', args: ['exec', bin, ...args] }),
        workspaceCwd: 'root',
        workspaceAdd: (name, pkgs) => ['--filter', name, 'add', ...pkgs],
        workspaceAddDev: (name, pkgs) => ['--filter', name, 'add', '-D', ...pkgs],
        workspaceScript: (name, script) => ['--filter', name, 'run', script],
        workspaceExec: (name, bin, args) => ({ command: 'pnpm', args: ['--filter', name, 'exec', bin, ...args] }),
    },
    yarn: {
        name: 'yarn',
        lockfiles: ['yarn.lock'],
        add: (pkgs) => ['add', ...pkgs],
        addDev: (pkgs) => ['add', '-D', ...pkgs],
        script: (script) => ['run', script],
        exec: (bin, args) => ({ command: 'yarn', args: [bin, ...args] }),
        workspaceCwd: 'root',
        workspaceAdd: (name, pkgs) => ['workspace', name, 'add', ...pkgs],
        workspaceAddDev: (name, pkgs) => ['workspace', name, 'add', '-D', ...pkgs],
        workspaceScript: (name, script) => ['workspace', name, 'run', script],
        workspaceExec: (name, bin, args) => ({ command: 'yarn', args: ['workspace', name, bin, ...args] }),
    },
    bun: {
        name: 'bun',
        lockfiles: ['bun.lock', 'bun.lockb'],
        add: (pkgs) => ['add', ...pkgs],
        addDev: (pkgs) => ['add', '-d', ...pkgs],
        script: (script) => ['run', script],
        exec: (bin, args) => ({ command: 'bunx', args: [bin, ...args] }),
        // Bun has no per-workspace add flag; run the plain command in the app.
        workspaceCwd: 'app',
        workspaceAdd: (_name, pkgs) => ['add', ...pkgs],
        workspaceAddDev: (_name, pkgs) => ['add', '-d', ...pkgs],
        workspaceScript: (_name, script) => ['run', script],
        workspaceExec: (_name, bin, args) => ({ command: 'bunx', args: [bin, ...args] }),
    },
};

/**
 * Picks the package manager in this order:
 *   1. explicit --pm flag
 *   2. lockfile in the project root
 *   3. the tool that launched us (npm_config_user_agent, e.g. "pnpm dlx")
 *   4. npm
 *
 * @returns {{ name: string, source: string }}
 */
function detectPackageManager(projectRoot, explicit) {
    if (explicit) {
        return { name: explicit, source: '--pm flag' };
    }

    for (const pm of Object.values(PACKAGE_MANAGERS)) {
        const lockfile = pm.lockfiles.find((file) => fs.existsSync(path.join(projectRoot, file)));
        if (lockfile) {
            return { name: pm.name, source: lockfile };
        }
    }

    const agent = process.env.npm_config_user_agent || '';
    const fromAgent = Object.keys(PACKAGE_MANAGERS).find((name) => agent.startsWith(`${name}/`));
    if (fromAgent) {
        return { name: fromAgent, source: 'invoking command' };
    }

    return { name: 'npm', source: 'default' };
}

function getPackageManager(name) {
    return PACKAGE_MANAGERS[name];
}

/** True when installs should go through the member-aware workspace command. */
function isWorkspaceTarget(ctx) {
    return Boolean(ctx.isWorkspaceMember && ctx.packageName && ctx.pm.workspaceAdd);
}

/** Installs run from the workspace root unless the PM uses the app directory. */
function commandCwd(ctx) {
    if (isWorkspaceTarget(ctx) && ctx.pm.workspaceCwd === 'root') return ctx.workspaceRoot;
    return ctx.projectRoot || ctx.appRoot;
}

function addArgs(ctx, packages) {
    return isWorkspaceTarget(ctx) ? ctx.pm.workspaceAdd(ctx.packageName, packages) : ctx.pm.add(packages);
}

function devArgs(ctx, packages) {
    return isWorkspaceTarget(ctx) ? ctx.pm.workspaceAddDev(ctx.packageName, packages) : ctx.pm.addDev(packages);
}

function scriptArgs(ctx, script) {
    return isWorkspaceTarget(ctx) && ctx.pm.workspaceScript
        ? ctx.pm.workspaceScript(ctx.packageName, script)
        : ctx.pm.script(script);
}

module.exports = {
    PACKAGE_MANAGERS,
    detectPackageManager,
    getPackageManager,
    isWorkspaceTarget,
    commandCwd,
    addArgs,
    devArgs,
    scriptArgs,
};
