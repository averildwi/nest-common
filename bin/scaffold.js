#!/usr/bin/env node

const pkg = require('../package.json');
const { parseCliArgs, helpText } = require('../src/cli');
const { CliError, CancelledError } = require('../src/errors');
const { setColorEnabled } = require('../src/ui/colors');
const ui = require('../src/ui/output');
const { runPreflight } = require('../src/preflight');
const { resolveAnswers, confirmPlan, pickApp } = require('../src/prompts');
const { resolveProject } = require('../src/utils/workspace');
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

    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !options.yes;

    ui.header('nest-common', `v${pkg.version}`);

    // Resolve the app before anything else: in a workspace the current folder
    // may be the repository root, not the NestJS package.
    const project = resolveProject({
        cwd: process.cwd(),
        cwdFlag: options.cwd,
        appFlag: options.app,
        pmFlag: options.packageManager,
    });

    if (project.ambiguous) {
        if (interactive) {
            project.appDir = await pickApp(project.candidates);
            const chosen = project.candidates.find((candidate) => candidate.dir === project.appDir);
            project.packageName = chosen ? chosen.name : project.packageName;
            project.appRel = chosen ? chosen.rel : project.appRel;
            project.isMember = true;
            project.ambiguous = false;
        } else {
            throw new CliError('Multiple NestJS applications found in this workspace.', {
                hints: [
                    `Candidates: ${project.candidates.map((c) => `${c.name} (${c.rel})`).join(', ')}`,
                    'Choose one with --app <package name> or --cwd <path>.',
                ],
                exitCode: 2,
            });
        }
    } else if (project.isWorkspace && !project.appDir) {
        throw new CliError('No NestJS application found in this workspace.', {
            hints: [
                project.globs.length
                    ? `Workspace packages: ${project.globs.join(', ')}`
                    : `Workspace root: ${project.workspaceRoot}`,
                'Point --cwd at the app directory, or add @nestjs/core + src/ to the package you want to configure.',
            ],
            exitCode: 2,
        });
    }

    const projectRoot = project.appDir || project.baseDir;

    const { pkgJson } = runPreflight(projectRoot, runner.templatesDir);
    const facts = await registry.detectFacts(projectRoot, pkgJson, { workspaceRoot: project.workspaceRoot });

    // Answers first: swagger prompts only make sense once preflight passed.
    const answers = await resolveAnswers(options, { interactive });

    const ctx = runner.buildContext({
        projectRoot,
        pkgJson,
        answers,
        facts,
        packageManager: project.pm,
        install: options.install ?? true,
        lint: options.lint,
        workspace: project,
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
