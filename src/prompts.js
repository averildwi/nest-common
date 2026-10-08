const { CancelledError } = require('./errors');
const { escapeForSingleQuoteString } = require('./transforms/mainTs');

async function loadInquirer() {
    // inquirer 9 is ESM-only, so it has to be loaded with a dynamic import.
    const { default: inquirer } = await import('inquirer');
    return inquirer;
}

/** inquirer rejects with this when the user presses Ctrl+C. */
function isPromptAbort(err) {
    return err && (err.name === 'ExitPromptError' || err.isTtyError === false || /force closed/i.test(err.message || ''));
}

async function prompt(questions) {
    const inquirer = await loadInquirer();
    try {
        return await inquirer.prompt(questions);
    } catch (err) {
        if (isPromptAbort(err)) throw new CancelledError();
        throw err;
    }
}

const SWAGGER_DEFAULTS = {
    title: 'My API',
    description: 'API documentation',
    version: '1.0',
    docsPath: 'docs',
};

/**
 * Fills in the scaffold options the user did not pass as flags.
 * With --yes (or without a TTY) defaults are used instead of prompting.
 */
async function resolveAnswers(options, { interactive }) {
    const useSwagger = options.useSwagger ?? true;

    if (!interactive || !useSwagger) {
        return {
            useSwagger,
            swagger: useSwagger ? { ...SWAGGER_DEFAULTS } : null,
        };
    }

    const prompted = await prompt([
        { type: 'input', name: 'title', message: 'Swagger API title:', default: SWAGGER_DEFAULTS.title },
        { type: 'input', name: 'description', message: 'Swagger API description:', default: SWAGGER_DEFAULTS.description },
        { type: 'input', name: 'version', message: 'API version:', default: SWAGGER_DEFAULTS.version },
        { type: 'input', name: 'docsPath', message: 'Swagger docs path URL (e.g. docs, api-docs):', default: SWAGGER_DEFAULTS.docsPath },
    ]);

    return {
        useSwagger: true,
        swagger: {
            title: escapeForSingleQuoteString(prompted.title || SWAGGER_DEFAULTS.title),
            description: escapeForSingleQuoteString(prompted.description || SWAGGER_DEFAULTS.description),
            version: escapeForSingleQuoteString(prompted.version || SWAGGER_DEFAULTS.version),
            docsPath: escapeForSingleQuoteString(prompted.docsPath || SWAGGER_DEFAULTS.docsPath),
        },
    };
}

async function confirmPlan() {
    const inquirer = await loadInquirer();
    try {
        const { proceed } = await inquirer.prompt([
            { type: 'confirm', name: 'proceed', message: 'Apply these changes?', default: true },
        ]);
        if (!proceed) throw new CancelledError();
    } catch (err) {
        if (err instanceof CancelledError) throw err;
        if (isPromptAbort(err)) throw new CancelledError();
        throw err;
    }
}

module.exports = { resolveAnswers, confirmPlan, SWAGGER_DEFAULTS };
