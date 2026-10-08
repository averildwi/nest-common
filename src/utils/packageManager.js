const fs = require('fs');
const path = require('path');

/**
 * How to drive each supported package manager. Commands are expressed as
 * argument arrays so they can be spawned without a shell.
 */
const PACKAGE_MANAGERS = {
    npm: {
        name: 'npm',
        lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'],
        add: (pkgs) => ['install', ...pkgs],
        addDev: (pkgs) => ['install', '--save-dev', ...pkgs],
        // Moves a package that is already a devDependency into dependencies.
        prodFlag: '--save-prod',
        exec: (bin, args) => ({ command: 'npx', args: [bin, ...args] }),
    },
    pnpm: {
        name: 'pnpm',
        lockfiles: ['pnpm-lock.yaml'],
        add: (pkgs) => ['add', ...pkgs],
        addDev: (pkgs) => ['add', '-D', ...pkgs],
        prodFlag: '--save-prod',
        exec: (bin, args) => ({ command: 'pnpm', args: ['exec', bin, ...args] }),
    },
    yarn: {
        name: 'yarn',
        lockfiles: ['yarn.lock'],
        add: (pkgs) => ['add', ...pkgs],
        addDev: (pkgs) => ['add', '-D', ...pkgs],
        exec: (bin, args) => ({ command: 'yarn', args: [bin, ...args] }),
    },
    bun: {
        name: 'bun',
        lockfiles: ['bun.lock', 'bun.lockb'],
        add: (pkgs) => ['add', ...pkgs],
        addDev: (pkgs) => ['add', '-d', ...pkgs],
        exec: (bin, args) => ({ command: 'bunx', args: [bin, ...args] }),
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

module.exports = { PACKAGE_MANAGERS, detectPackageManager, getPackageManager };
