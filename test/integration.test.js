// End-to-end checks: scaffold a fake NestJS project and inspect the result.
// Run: node --test test/integration.test.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const BIN = path.join(__dirname, '..', 'bin', 'scaffold.js');

function makeProject(name, pkg = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `nest-common-${name}-`));
    fs.ensureDirSync(path.join(root, 'src'));
    fs.writeJsonSync(path.join(root, 'package.json'), {
        name: 'fake-app',
        dependencies: { '@nestjs/core': '^11.0.0', '@nestjs/common': '^11.0.0' },
        ...pkg,
    });
    fs.writeFileSync(
        path.join(root, 'src', 'app.module.ts'),
        `import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [],\n})\nexport class AppModule {}\n`,
    );
    fs.writeFileSync(
        path.join(root, 'src', 'main.ts'),
        `import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n`,
    );
    return root;
}

function scaffold(root, extraArgs = []) {
    return spawnSync(
        process.execPath,
        [BIN, '--no-install', '--no-color', '--yes', ...extraArgs],
        { cwd: root, encoding: 'utf8' },
    );
}

test('integration: full scaffold wires files, main.ts and .env.example', (t) => {
    const root = makeProject('full');
    t.after(() => fs.removeSync(root));

    const res = scaffold(root);
    assert.equal(res.status, 0, res.stderr);

    const common = path.join(root, 'src', 'common');
    assert.ok(fs.existsSync(path.join(common, 'config', 'app-config.module.ts')));
    assert.ok(fs.existsSync(path.join(common, 'pipes', 'validation.pipe.config.ts')));
    assert.ok(fs.existsSync(path.join(common, 'hashing', 'hashing.service.ts')));
    // No Prisma detected -> the filter must not be copied.
    assert.ok(!fs.existsSync(path.join(common, 'filters', 'prisma-exception.filter.ts')));

    const main = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
    assert.ok(main.includes('app.enableCors('));
    assert.ok(main.includes('useGlobalPipes(createValidationPipe())'));
    assert.ok(main.includes('SwaggerModule.setup('));
    assert.ok(main.includes("import { GlobalExceptionFilter } from './common/filters/global-exception.filter';"));

    const appModule = fs.readFileSync(path.join(root, 'src', 'app.module.ts'), 'utf8');
    assert.ok(appModule.includes('AppConfigModule.forProject(),'));
    assert.ok(appModule.includes('HashingModule,'));

    const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    for (const key of ['DATABASE_URL', 'PORT', 'NODE_ENV', 'FRONTEND_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'TRUST_PROXY_HOPS']) {
        assert.ok(new RegExp(`^${key}=`, 'm').test(env), `missing ${key}`);
    }
});

test('integration: re-running is a no-op (idempotent)', (t) => {
    const root = makeProject('idem');
    t.after(() => fs.removeSync(root));

    assert.equal(scaffold(root).status, 0);
    const before = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');

    const second = scaffold(root);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /Everything is already set up/);
    assert.equal(fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8'), before);
});

test('integration: --no-swagger leaves Swagger out but still wires CORS', (t) => {
    const root = makeProject('noswagger');
    t.after(() => fs.removeSync(root));

    assert.equal(scaffold(root, ['--no-swagger']).status, 0);
    const main = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
    assert.ok(main.includes('app.enableCors('));
    assert.ok(!main.includes('SwaggerModule'));
    assert.ok(!main.includes('@nestjs/swagger'));
});

test('integration: --dry-run changes nothing', (t) => {
    const root = makeProject('dry');
    t.after(() => fs.removeSync(root));

    const before = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
    const res = scaffold(root, ['--dry-run']);
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(path.join(root, 'src', 'common')));
    assert.equal(fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8'), before);
});

test('integration: the format step runs prettier on exactly the files it wrote', (t) => {
    const root = makeProject('format');
    t.after(() => fs.removeSync(root));

    // A fake local prettier: records its argv instead of formatting.
    const bin = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
    fs.ensureDirSync(path.dirname(bin));
    fs.writeJsonSync(path.join(root, 'node_modules', 'prettier', 'package.json'), {
        name: 'prettier',
        version: '3.10.1',
        bin: { prettier: './bin/prettier.cjs' },
    });
    fs.writeFileSync(
        bin,
        [
            "const fs = require('fs');",
            "const path = require('path');",
            "fs.writeFileSync(path.join(process.cwd(), 'prettier-argv.json'), JSON.stringify(process.argv.slice(2)));",
        ].join('\n'),
    );

    const res = scaffold(root);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Formatted \d+ file\(s\) with Prettier/);
    // The whole-repo `eslint --fix` gate is gone: nothing runs the lint script.
    assert.doesNotMatch(res.stdout, /npm run lint/);

    const argv = fs.readJsonSync(path.join(root, 'prettier-argv.json'));
    assert.deepEqual(argv.slice(0, 3), ['--write', '--end-of-line', 'auto']);

    const files = argv.slice(3);
    assert.ok(files.includes('src/main.ts'));
    assert.ok(files.includes('src/app.module.ts'));
    assert.ok(files.includes('src/common/config/app-config.module.ts'));
    // Only files this run wrote, and no non-code file.
    assert.ok(!files.includes('src/app.controller.ts'), 'untouched project files are not reformatted');
    assert.ok(!files.some((f) => f.endsWith('.env.example')), 'prettier cannot parse .env.example');
    assert.deepEqual(files, [...new Set(files)], 'no duplicates');
});

test('integration: without prettier the run still succeeds and says why it skipped', (t) => {
    const root = makeProject('noprettier');
    t.after(() => fs.removeSync(root));

    const res = scaffold(root);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /prettier is not installed in this project/);
    assert.ok(fs.existsSync(path.join(root, 'src', 'common', 'config', 'app-config.module.ts')));
});

test('integration: rejects a non-Nest project', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-common-nonest-'));
    t.after(() => fs.removeSync(root));
    fs.ensureDirSync(path.join(root, 'src'));
    fs.writeJsonSync(path.join(root, 'package.json'), { name: 'plain' });

    const res = spawnSync(process.execPath, [BIN, '--no-color', '--yes'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /doesn't look like a NestJS project/);
});