const path = require('path');

const fsHelpers = require('./utils/fsHelpers');
const { CliError } = require('./errors');

function readPackageJson(projectRoot) {
    const file = path.join(projectRoot, 'package.json');
    if (!fsHelpers.existsSync(file)) {
        throw new CliError('No package.json found in the current directory.', {
            hints: [`Current directory: ${projectRoot}`, 'Run this command from the root of your NestJS project.'],
        });
    }
    try {
        return require(file);
    } catch (err) {
        throw new CliError('package.json is not valid JSON.', { hints: [err.message], cause: err });
    }
}

/**
 * Validates that we are inside a NestJS project. Throws a CliError describing
 * exactly what is wrong; returns facts otherwise.
 *
 * @param {string} projectRoot
 * @param {string} templatesDir absolute path to the bundled templates/common
 */
function runPreflight(projectRoot, templatesDir) {
    const pkgJson = readPackageJson(projectRoot);
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    if (!allDeps['@nestjs/core'] && !allDeps['@nestjs/common']) {
        throw new CliError("This doesn't look like a NestJS project.", {
            hints: [
                'package.json does not list @nestjs/core or @nestjs/common.',
                'Create one first with: npx @nestjs/cli new my-app',
            ],
        });
    }

    if (!fsHelpers.existsSync(path.join(projectRoot, 'src'))) {
        throw new CliError('No "src" folder found.', {
            hints: ['Run this command from the root of your NestJS project.'],
        });
    }

    if (!fsHelpers.existsSync(templatesDir)) {
        throw new CliError(`Template source not found at ${templatesDir}.`, {
            hints: ['Reinstall the package or check your installation.'],
        });
    }

    return { pkgJson };
}

module.exports = { runPreflight, readPackageJson };
