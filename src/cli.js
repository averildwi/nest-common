const { parseArgs } = require('util');

const { CliError } = require('./errors');

const OPTIONS = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    yes: { type: 'boolean', short: 'y' },
    'dry-run': { type: 'boolean' },
    pm: { type: 'string' },
    swagger: { type: 'boolean' },
    'no-swagger': { type: 'boolean' },
    'no-install': { type: 'boolean' },
    color: { type: 'boolean' },
    'no-color': { type: 'boolean' },
};

/** Accepts common spellings so `--pm pnpm` just works. */
const PM_ALIASES = { npm: 'npm', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun' };

function pickBoolean(values, name) {
    if (values[`no-${name}`]) return false;
    if (values[name]) return true;
    return undefined;
}

/**
 * Parses process arguments into a normalised options object.
 * Unspecified options are left `undefined` so the caller can decide whether to
 * prompt for them or fall back to defaults.
 */
function parseCliArgs(argv = process.argv.slice(2)) {
    let parsed;
    try {
        parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true });
    } catch (err) {
        throw new CliError(err.message.replace(/\. To specify.*$/s, '.'), {
            hints: ['Run "nest-common --help" to see all available options.'],
            exitCode: 2,
        });
    }

    const v = parsed.values;
    const options = {
        help: Boolean(v.help),
        version: Boolean(v.version),
        yes: Boolean(v.yes),
        dryRun: Boolean(v['dry-run']),
        packageManager: undefined,
        useSwagger: pickBoolean(v, 'swagger'),
        install: pickBoolean(v, 'install'),
        color: pickBoolean(v, 'color'),
    };

    if (v.pm !== undefined) {
        const pm = v.pm.toLowerCase();
        if (!PM_ALIASES[pm]) {
            throw new CliError(`Unknown package manager "${v.pm}".`, {
                hints: [`Supported values: ${Object.keys(PM_ALIASES).join(', ')}.`],
                exitCode: 2,
            });
        }
        options.packageManager = PM_ALIASES[pm];
    }

    return options;
}

function helpText(pkg) {
    return `
  ${pkg.name} v${pkg.version}
  Inject a production-ready common architecture into an existing NestJS project:
  config, hashing, guards, interceptors, filters, pagination, Swagger wiring.

  Usage
    $ npx ${pkg.name} [options]

  Options
    --no-swagger       Skip the Swagger API documentation setup
    --pm <name>        Package manager: npm | pnpm | yarn | bun (default: auto-detect)
    --no-install       Skip installing dependencies (only write files)
    -y, --yes          Accept defaults and skip all prompts
    --dry-run          Show what would change without touching anything
    --no-color         Disable coloured output
    -v, --version      Print the version
    -h, --help         Show this help

  Examples
    $ npx ${pkg.name}
    $ npx ${pkg.name} --no-swagger
    $ npx ${pkg.name} --yes --dry-run
`;
}

module.exports = { parseCliArgs, helpText };
