#!/usr/bin/env node

const pkg = require('../package.json');
const { parseCliArgs, helpText } = require('../src/cli');
const { CliError, CancelledError } = require('../src/errors');
const { setColorEnabled } = require('../src/ui/colors');
const ui = require('../src/ui/output');
const { runPreflight } = require('../src/preflight');
const { resolveAnswers, confirmPlan } = require('../src/prompts');
const { detectPackageManager } = require('../src/utils/packageManager');
const registry = require('../src/config/registry');
const runner = require('../src/runner');

async function main(argv) {
    const options = parseCliArgs(argv);
    if (options.color !== undefined) setColorEnabled(options.color);

    if (options.help) {
        process.stdout.write(helpText(pkg));
        return;
    }
    if (options.version) {
        process.stdout.write(`${pkg.version}\n`);
        return;
    }

    const projectRoot = process.cwd();
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !options.yes;

    ui.header('nest-common', `v${pkg.version}`);

    const { pkgJson } = runPreflight(projectRoot, runner.templatesDir);
    const facts = await registry.detectFacts(projectRoot, pkgJson);

    // Answers first: swagger prompts only make sense once preflight passed.
    const answers = await resolveAnswers(options, { interactive });

    const ctx = runner.buildContext({
        projectRoot,
        pkgJson,
        answers,
        facts,
        packageManager: detectPackageManager(projectRoot, options.packageManager),
        install: options.install ?? true,
    });

    const plan = await runner.buildPlan(ctx);
    runner.printPlan(ctx, plan, { dryRun: options.dryRun });

    if (!plan.some((p) => p.actionable)) {
        ui.out();
        ui.success('Everything is already set up. Nothing to do.');
        ui.out();
        return;
    }

    if (options.dryRun) {
        ui.out();
        ui.info('Dry run complete. Re-run without --dry-run to apply these changes.');
        ui.out();
        return;
    }

    ui.out();
    if (interactive) await confirmPlan();

    const summary = await runner.executePlan(ctx, plan);
    runner.printSummary(ctx, summary);
}

main(process.argv.slice(2)).catch((err) => {
    if (err instanceof CancelledError) {
        ui.out();
        ui.warn(err.message);
        process.exit(err.exitCode);
    }
    if (err instanceof CliError) {
        ui.error(err.failedStep ? `${err.failedStep} failed: ${err.message}` : err.message);
        for (const h of err.hints || []) ui.hint(h);
        process.stderr.write('\n');
        process.exit(err.exitCode);
    }
    ui.error('Unexpected error. This is likely a bug in nest-common.');
    process.stderr.write(`${err && err.stack ? err.stack : err}\n\n`);
    ui.hint('Please report it at https://github.com/Everilll/nest-common/issues');
    process.exit(1);
});
