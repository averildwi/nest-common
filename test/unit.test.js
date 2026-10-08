// Fast unit checks for the pure logic. Run: npm test
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseCliArgs } = require('../src/cli');
const { resolveDependencies, readMajor, NEST_DEPENDENCY_MATRIX } = require('../src/config/registry');
const { register, isRegistered } = require('../src/transforms/appModule');
const {
    buildImportBlock,
    buildCorsBlock,
    buildSwaggerBlock,
    applyToMain,
    escapeForSingleQuoteString,
} = require('../src/transforms/mainTs');
const { buildEnvFile, missingKeys, mergeEnv } = require('../src/transforms/envExample');
const {
    resolveClientImport,
    rewriteFilterImport,
    wrapValidationOptions,
} = require('../src/transforms/prismaFilter');
const { parseSpec, isSatisfied } = require('../src/steps/installDeps');
const { envBlueprint } = require('../src/steps/updateEnv');

// -- CLI -----------------------------------------------------------------

test('argv: defaults leave choices undefined so they can be prompted', () => {
    const o = parseCliArgs([]);
    assert.equal(o.useSwagger, undefined);
    assert.equal(o.install, undefined);
    assert.equal(o.yes, false);
    assert.equal(o.dryRun, false);
});

test('argv: --no-swagger / --no-install / -y / --dry-run', () => {
    const o = parseCliArgs(['--no-swagger', '--no-install', '-y', '--dry-run']);
    assert.equal(o.useSwagger, false);
    assert.equal(o.install, false);
    assert.equal(o.yes, true);
    assert.equal(o.dryRun, true);
});

test('argv: --pm alias + invalid values fail with exit code 2', () => {
    assert.equal(parseCliArgs(['--pm', 'PNPM']).packageManager, 'pnpm');
    for (const args of [['--pm', 'pip'], ['--bogus']]) {
        assert.throws(() => parseCliArgs(args), (e) => e.name === 'CliError' && e.exitCode === 2, args.join(' '));
    }
});

// -- registry ------------------------------------------------------------

test('registry: dependency matrix pins the matching ecosystem major', () => {
    assert.deepEqual(resolveDependencies(11).slice(0, 3), [
        '@nestjs/config@^4.0.2',
        '@nestjs/passport@^11.0.5',
        '@nestjs/swagger@^11.2.0',
    ]);
    assert.deepEqual(resolveDependencies(12).slice(0, 3), [
        '@nestjs/config@^12.0.0',
        '@nestjs/passport@^12.0.0',
        '@nestjs/swagger@^12.0.0',
    ]);
    assert.deepEqual(resolveDependencies(10).slice(2, 3), ['@nestjs/swagger@^7.4.2']);
    // unknown major falls back to latest (with the retry safety net)
    assert.ok(resolveDependencies(13).every((s) => s.includes('latest') || !s.includes('@')));
    assert.deepEqual(NEST_DEPENDENCY_MATRIX.default, {
        config: 'latest',
        passport: 'latest',
        swagger: 'latest',
    });
});

test('registry: readMajor handles common range shapes', () => {
    assert.equal(readMajor('^11.0.1'), 11);
    assert.equal(readMajor('~10.4.1'), 10);
    assert.equal(readMajor('12.1.2'), 12);
    assert.equal(readMajor(undefined), null);
    assert.equal(readMajor('latest'), null);
});

// -- app.module transform ------------------------------------------------

const APP_MODULE = `import { Module } from '@nestjs/common';
import { AppController } from './app.controller';

@Module({
  imports: [],
  controllers: [AppController],
})
export class AppModule {}
`;

test('app.module: registers both modules and is idempotent', () => {
    const out = register(APP_MODULE).source;
    assert.ok(out.includes("AppConfigModule } from './common/config/app-config.module.js'"));
    assert.ok(out.includes("HashingModule } from './common/hashing/hashing.module.js'"));
    assert.ok(out.includes('AppConfigModule.forProject(),'));
    assert.ok(out.includes('    HashingModule,'));
    assert.ok(out.indexOf('AppConfigModule.forProject(),') < out.indexOf('controllers:'));

    assert.equal(register(out), null);
    assert.ok(isRegistered(out));
});

test('app.module: tolerates imports with .js extensions (ESM projects)', () => {
    const esmStyle = APP_MODULE.replace(
        "from './app.controller'",
        "from './app.controller.js'",
    );
    const out = register(esmStyle).source;
    assert.ok(isRegistered(out));
});

test('app.module: inserts imports before the class even without prior imports', () => {
    const src = "@Module({ imports: [] })\nexport class AppModule {}\n";
    const out = register(src).source;
    assert.ok(out.startsWith('import { AppConfigModule }'));
    assert.ok(out.includes('AppConfigModule.forProject(),'));
});

// -- main.ts transform ---------------------------------------------------

const MAIN = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
`;

test('main.ts: import block reflects swagger + prisma options', () => {
    const full = buildImportBlock({ useSwagger: true, hasPrisma: true, needsSwaggerLib: true });
    assert.ok(full.includes('prisma-exception.filter.js'));
    assert.ok(full.includes("@nestjs/swagger'"));

    const noSwagger = buildImportBlock({ useSwagger: false, hasPrisma: true, needsSwaggerLib: true });
    assert.ok(!noSwagger.includes('@nestjs/swagger'));

    const noPrisma = buildImportBlock({ useSwagger: true, hasPrisma: false, needsSwaggerLib: false });
    assert.ok(!noPrisma.includes('PrismaExceptionFilter'));
    assert.ok(!noPrisma.includes('@nestjs/swagger'));
});

test('main.ts: cors block reflects prisma presence', () => {
    const withPrisma = buildCorsBlock({ hasPrisma: true });
    assert.ok(withPrisma.includes('app.enableCors('));
    assert.ok(withPrisma.includes('useGlobalPipes(createValidationPipe())'));
    assert.ok(withPrisma.includes('useGlobalInterceptors('));
    assert.ok(withPrisma.includes('new GlobalExceptionFilter(), new PrismaExceptionFilter()'));

    const withoutPrisma = buildCorsBlock({ hasPrisma: false });
    assert.ok(withoutPrisma.includes('app.useGlobalFilters(new GlobalExceptionFilter());'));
    assert.ok(!withoutPrisma.includes('PrismaExceptionFilter'));
});

test('main.ts: swagger block escapes single quotes and honors the docs path', () => {
    const block = buildSwaggerBlock({ title: "Kelasku's API", description: 'API docs', version: '1.0', docsPath: 'api-docs' });
    assert.ok(block.includes(".setTitle('Kelasku\\'s API')"));
    assert.ok(block.includes("SwaggerModule.setup('api-docs'"));
    assert.ok(block.includes('persistAuthorization: true'));
});

test('main.ts: applyToMain inserts imports after the last import and code after app creation', () => {
    const result = applyToMain(MAIN, {
        importBlock: buildImportBlock({ useSwagger: true, hasPrisma: true, needsSwaggerLib: true }),
        injectionCode: buildCorsBlock(),
    });
    assert.ok(result);
    assert.ok(result.source.indexOf("from '@nestjs/swagger'") > result.source.indexOf("from './app.module'"));
    assert.ok(result.source.indexOf('app.enableCors(') > result.source.indexOf('NestFactory.create(AppModule);'));
    assert.ok(result.source.includes('await app.listen'));

    // The STEP re-analyzes before calling: with everything already present it
    // passes no import block and no injection code, so the transform is a no-op.
    const second = applyToMain(result.source, { importBlock: null, injectionCode: null });
    assert.equal(second, null);
});

test('main.ts: applyToMain without an app-creation line reports manual injection', () => {
    const result = applyToMain('import { AppModule } from "./app.module";\n', {
        importBlock: null,
        injectionCode: buildCorsBlock(),
    });
    assert.ok(result.needsManualInjection);
});

test('main.ts: escapeForSingleQuoteString escapes backslashes and quotes', () => {
    assert.equal(escapeForSingleQuoteString("it's \\n"), "it\\'s \\\\n");
});

// -- env transform -------------------------------------------------------

const BLUEPRINT = { PORT: '3000', JWT_SECRET: 'abc', JWT_EXPIRES_IN: '7d' };

test('env: buildEnvFile writes key="value" lines', () => {
    const out = buildEnvFile(BLUEPRINT);
    assert.equal(out, 'PORT="3000"\nJWT_SECRET="abc"\nJWT_EXPIRES_IN="7d"\n');
});

test('env: missingKeys + mergeEnv append only what is missing', () => {
    const existing = 'PORT="8080"\n';
    assert.deepEqual(missingKeys(existing, BLUEPRINT), ['JWT_SECRET', 'JWT_EXPIRES_IN']);

    const merged = mergeEnv(existing, BLUEPRINT);
    assert.deepEqual(merged.added, ['JWT_SECRET', 'JWT_EXPIRES_IN']);
    assert.ok(merged.source.startsWith('PORT="8080"'));
    assert.ok(merged.source.includes('# Added by @averildwi/nest-common'));
    assert.ok(merged.source.includes('JWT_SECRET="abc"'));

    // idempotent
    const again = mergeEnv(merged.source, BLUEPRINT);
    assert.deepEqual(again.added, []);
    assert.equal(again.source, merged.source);
});

// -- prisma filter transforms --------------------------------------------

test('prismaFilter: rewriteFilterImport only rewrites the @prisma/client import', () => {
    const original = "import { Prisma } from '@prisma/client';\nimport { Response } from 'express';\n";
    const out = rewriteFilterImport(original, '../../generated/prisma/client.js');
    assert.ok(out.includes("import { Prisma } from '../../generated/prisma/client.js';"));
    assert.ok(out.includes("from 'express'"));

    // already rewritten -> no change
    assert.equal(rewriteFilterImport(out, '../../generated/prisma/client.js'), null);
});

test('prismaFilter: wrapValidationOptions nests joi options into libraryOptions', () => {
    const source = "ConfigModule.forRoot({\n  validationOptions: {\n    abortEarly: false,\n    allowUnknown: true,\n  },\n})";
    const out = wrapValidationOptions(source);
    assert.ok(out.includes('libraryOptions: {'));
    assert.ok(out.includes('abortEarly: false'));
    // idempotent
    assert.equal(wrapValidationOptions(out), null);
});

// -- install deps --------------------------------------------------------

test('installDeps: parseSpec respects scoped package names', () => {
    assert.deepEqual(parseSpec('@nestjs/config@^4.0.2'), { name: '@nestjs/config', version: '^4.0.2' });
    assert.deepEqual(parseSpec('joi'), { name: 'joi', version: undefined });
});

test('installDeps: isSatisfied matches matrix versions and unpinned names', () => {
    const pkg = { dependencies: { '@nestjs/config': '^4.0.4', joi: '^18.2.9' } };
    assert.ok(isSatisfied('@nestjs/config@^4.0.2', pkg, 'dependencies'));
    assert.ok(isSatisfied('joi', pkg, 'dependencies'));
    assert.ok(isSatisfied('@nestjs/swagger@latest', pkg, 'dependencies') === false);
    assert.ok(!isSatisfied('@nestjs/passport@^11.0.5', pkg, 'dependencies'));
    assert.ok(!isSatisfied('@nestjs/config@^4.0.2', pkg, 'devDependencies'));
});

// -- updateEnv blueprint -------------------------------------------------

test('updateEnv: envBlueprint generates a random hex JWT_SECRET', () => {
    const blueprint = envBlueprint({ randomBytes: () => ({ toString: () => 'a'.repeat(64) }) });
    assert.equal(blueprint.JWT_SECRET, 'a'.repeat(64));
    assert.equal(blueprint.PORT, '3000');
    assert.equal(blueprint.JWT_EXPIRES_IN, '7d');
});
