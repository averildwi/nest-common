const { spawn } = require('child_process');

const { CliError } = require('../errors');

/**
 * Runs a command with inherited stdio and resolves when it exits cleanly.
 *
 * On Windows, package-manager binaries are `.cmd` shims, which Node can only
 * launch through a shell (CVE-2024-27980 hardening). We therefore enable the
 * shell there and quote every argument ourselves.
 */
function run(command, args, { cwd } = {}) {
    const isWindows = process.platform === 'win32';
    const quote = (arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
    const options = { cwd, stdio: 'inherit', env: process.env };

    return new Promise((resolve, reject) => {
        let child;
        if (isWindows && !/\.(exe|com)$/i.test(command)) {
            // npm/pnpm/yarn are .cmd shims, which Node can only launch through a
            // shell. Pass one command string (not an args array) to avoid
            // Node's DEP0190 warning about unescaped arguments. An .exe (for
            // example process.execPath) is spawned directly, so a path with a
            // space in it is not split by the shell.
            const line = [command, ...args].map(quote).join(' ');
            child = spawn(line, { ...options, shell: true });
        } else {
            child = spawn(command, args, options);
        }

        child.on('error', (err) => {
            reject(
                new CliError(`Could not run "${command}".`, {
                    hints: [
                        err.code === 'ENOENT'
                            ? `"${command}" is not installed or not on your PATH.`
                            : err.message,
                    ],
                    cause: err,
                }),
            );
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new CliError(`"${[command, ...args].join(' ')}" exited with code ${code}.`, {
                        hints: ['Scroll up to see the full output from the command.'],
                    }),
                );
            }
        });
    });
}

function formatCommand(command, args) {
    return [command, ...args].join(' ');
}

module.exports = { run, formatCommand };
