const path = require('path');

const ui = require('./ui/output');
const { colors: c } = require('./ui/colors');
const { getPackageManager } = require('./utils/packageManager');
const { resolveDependencies } = require('./config/registry');
const steps = require('./steps');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'common');

function buildContext({ projectRoot, pkgJson, answers, facts, packageManager, install }) {
    const paths = {
        targetDir: path.join(projectRoot, 'src', 'common'),
        appModule: path.join(projectRoot, 'src', 'app.module.ts'),
        mainTs: path.join(projectRoot, 'src', 'main.ts'),
        envExample: path.join(projectRoot, '.env.example'),
        gitignore: path.join(projectRoot, '.gitignore'),
        pkgJsonPath: path.join(projectRoot, 'package.json'),
    };

    return {
        projectRoot,
        pkgJson,
        answers,
        install,
        nestMajor: facts.nestMajor,
        configMajor: facts.configMajor,
        hasPrisma: facts.hasPrisma,
        prismaClientOutput: facts.prismaClientOutput,
        dependencies: resolveDependencies(facts.nestMajor),
        pm: getPackageManager(packageManager.name),
        pmSource: packageManager.source,
        templatesDir: TEMPLATES_DIR,
        paths,
        ...paths,
    };
}

/** Asks every step what it would do. Never mutates the project. */
async function buildPlan(ctx) {
    const plan = [];
    for (const step of steps) {
        const { entries, data } = await step.plan(ctx);
        const actionable = entries.some((e) => e.kind !== 'skip');
        plan.push({ step, entries, data, actionable });
    }
    return plan;
}

const KIND_STYLE = {
    create: (t) => `${c.green('+')} ${t}`,
    modify: (t) => `${c.yellow('~')} ${t}`,
    run: (t) => `${c.cyan('$')} ${t}`,
    warn: (t) => `${c.yellow('!')} ${t}`,
    skip: (t) => `${c.gray('-')} ${c.gray(t)}`,
};

function printPlan(ctx, plan, { dryRun }) {
    ui.section('Configuration');
    ui.keyValues([
        ['Project', path.basename(ctx.projectRoot)],
        ['Nest', ctx.nestMajor ? `v${ctx.nestMajor} detected` : c.gray('version not detected')],
        [
            'Swagger',
            ctx.answers.useSwagger
                ? `${ctx.answers.swagger.title} at /${ctx.answers.swagger.docsPath}`
                : 'disabled',
        ],
        ['Package manager', `${ctx.pm.name} ${c.gray(`(${ctx.pmSource})`)}`],
    ]);

    ui.section(dryRun ? 'Planned changes (dry run, nothing will be modified)' : 'Planned changes');
    for (const { entries } of plan) {
        for (const entry of entries) {
            const reason = entry.reason ? c.gray(` (${entry.reason})`) : '';
            ui.out(`    ${KIND_STYLE[entry.kind](entry.label)}${reason}`);
        }
    }
}

/**
 * Executes the actionable steps in order and returns a summary.
 * If a step throws, the error is annotated with what had already been changed
 * so the user knows exactly what state their project is in.
 */
async function executePlan(ctx, plan) {
    const actionable = plan.filter((p) => p.actionable);
    const files = [];
    const warnings = [];
    const completed = [];

    for (const [index, item] of actionable.entries()) {
        ui.step(index + 1, actionable.length, item.step.title);
        try {
            const result = (await item.step.run(ctx, item.data || {})) || {};
            if (result.files) files.push(...result.files);
            if (result.status === 'warning') warnings.push(item.step.title);
            completed.push(item.step.title);
        } catch (err) {
            const failure = err instanceof Error ? err : new Error(String(err));
            failure.hints = [
                ...(failure.hints || []),
                ...(completed.length ? ['', `Completed before the failure: ${completed.join(', ')}.`] : []),
                ...(files.length ? [`Files already changed: ${unique(files.map((f) => f.path)).join(', ')}.`] : []),
                'It is safe to fix the problem and run the command again; finished steps will be skipped.',
            ];
            failure.failedStep = item.step.title;
            throw failure;
        }
    }

    return { files, warnings, ran: actionable.length };
}

function unique(list) {
    return [...new Set(list)];
}

function printSummary(ctx, summary) {
    const files = new Map();
    for (const f of summary.files) {
        // "create" wins over "modify" for the same path.
        if (!files.has(f.path) || f.kind === 'create') files.set(f.path, f.kind);
    }

    ui.out();
    if (summary.warnings.length) {
        ui.out(`  ${c.yellow(c.bold('Done, with warnings.'))} ${c.gray('Review the messages marked ⚠ above.')}`);
    } else {
        ui.out(`  ${c.green(c.bold('Your project architecture is ready!'))}`);
    }

    if (files.size) {
        ui.section('Changed files');
        for (const [file, kind] of files) {
            ui.out(`    ${KIND_STYLE[kind] ? KIND_STYLE[kind](file) : file}`);
        }
    }

    printNextSteps(ctx);
}

function printNextSteps(ctx) {
    const steps = [];
    steps.push([
        `Copy the values you need from ${c.bold('.env.example')} into your own ${c.bold('.env')}:`,
        buildEnvFilePreview(),
    ]);
    if (ctx.answers.useSwagger) {
        steps.push([
            `Open the Swagger docs once the app runs:`,
            `http://localhost:3000/${ctx.answers.swagger.docsPath}`,
        ]);
    }
    steps.push([
        `Full documentation:`,
        'https://github.com/Everilll/nest-common',
    ]);

    ui.section('Next steps');
    steps.forEach(([text, command], i) => {
        ui.out(`    ${c.cyan(`${i + 1}.`)} ${text}`);
        ui.out(`       ${c.cyan(command)}`);
    });
    ui.out();
}

function buildEnvFilePreview() {
    // Only hint at the file — never print the generated JWT_SECRET.
    return 'cp .env.example .env  # then fill in DATABASE_URL and JWT_SECRET';
}

module.exports = {
    buildContext,
    buildPlan,
    printPlan,
    executePlan,
    printSummary,
    templatesDir: TEMPLATES_DIR,
};

