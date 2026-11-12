const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const { findPackageFile } = require('../utils/project');
const { readPnpmCatalog } = require('../utils/workspace');

/**
 * Peer-compatible ecosystem versions per NestJS major.
 * Installing bare "latest" breaks whenever the ecosystem ships a new major
 * (e.g. @nestjs/swagger@12 requires @nestjs/common@^12) while the target
 * project is still on an older Nest major.
 */
const NEST_DEPENDENCY_MATRIX = {
    10: { config: '^3.3.0', passport: '^10.0.3', swagger: '^7.4.2', throttler: '^6.4.0' },
    11: { config: '^4.0.2', passport: '^11.0.5', swagger: '^11.2.0', throttler: '^6.4.0' },
    12: { config: '^12.0.0', passport: '^12.0.0', swagger: '^12.0.0', throttler: '^6.7.0' },
    default: { config: 'latest', passport: 'latest', swagger: 'latest', throttler: 'latest' },
};

/**
 * Runtime deps installed by the install step, derived from the detected Nest
 * major. @nestjs/swagger is only installed when Swagger setup is enabled.
 */
function resolveDependencies(nestMajor, { swagger = true } = {}) {
    const matrix = NEST_DEPENDENCY_MATRIX[nestMajor] || NEST_DEPENDENCY_MATRIX.default;
    const deps = [
        `@nestjs/config@${matrix.config}`,
        `@nestjs/passport@${matrix.passport}`,
    ];
    if (swagger) deps.push(`@nestjs/swagger@${matrix.swagger}`);
    deps.push(`@nestjs/throttler@${matrix.throttler}`, 'class-validator', 'class-transformer', 'joi');
    return deps;
}

function readMajor(range) {
    const match = String(range || '').match(/(\d+)\s*\./);
    return match ? Number(match[1]) : null;
}

/**
 * Reads the major of an installed package by walking up from `startDir`, so
 * packages hoisted to the workspace root by npm or pnpm are still found.
 */
async function readInstalledMajor(startDir, name) {
    const pkgPath = findPackageFile(startDir, name);
    if (!pkgPath) return null;
    try {
        return readMajor(require(pkgPath).version);
    } catch (err) {
        return null;
    }
}

function declaredRange(pkgJson, name) {
    return (
        (pkgJson.dependencies && pkgJson.dependencies[name]) ||
        (pkgJson.devDependencies && pkgJson.devDependencies[name]) ||
        (pkgJson.peerDependencies && pkgJson.peerDependencies[name])
    );
}

async function readDeclaredMajor(pkgJson, name) {
    return readMajor(declaredRange(pkgJson, name));
}

/** Reads the major from the workspace-root package.json, if it declares it. */
async function readWorkspaceDeclaredMajor(workspaceRoot, name) {
    if (!workspaceRoot) return null;
    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (!fsHelpers.existsSync(pkgPath)) return null;
    try {
        return readMajor(declaredRange(require(pkgPath), name));
    } catch (err) {
        return null;
    }
}

/**
 * Resolves a pnpm `catalog:` / `catalog:<name>` range from
 * pnpm-workspace.yaml, so the Nest major is known even before install.
 */
function readCatalogRange(pkgJson, workspaceRoot, name) {
    if (!workspaceRoot) return null;
    const declared = declaredRange(pkgJson || {}, name);
    if (!declared) return null;

    const match = String(declared).match(/^catalog:(.*)$/);
    if (!match) return null;

    const catalogs = readPnpmCatalog(workspaceRoot);
    const table = match[1].trim() ? catalogs[match[1].trim()] : catalogs.default;
    return (table && table[name]) || null;
}

async function detectNestMajor(projectRoot, pkgJson, workspaceRoot) {
    return (
        (await readInstalledMajor(projectRoot, '@nestjs/common')) ??
        (await readDeclaredMajor(pkgJson, '@nestjs/common')) ??
        readMajor(readCatalogRange(pkgJson, workspaceRoot, '@nestjs/common')) ??
        (await readWorkspaceDeclaredMajor(workspaceRoot, '@nestjs/common'))
    );
}

/**
 * The @nestjs/config major decides how validationOptions must be shaped:
 * v12 switched env validation to Standard Schema V1, where vendor-specific
 * options (Joi's abortEarly/allowUnknown) must be nested inside
 * `libraryOptions`. Older majors (3/4) accept them directly.
 */
async function detectConfigMajor(projectRoot, pkgJson, nestMajor, workspaceRoot) {
    return (
        (await readInstalledMajor(projectRoot, '@nestjs/config')) ??
        (await readDeclaredMajor(pkgJson, '@nestjs/config')) ??
        readMajor(readCatalogRange(pkgJson, workspaceRoot, '@nestjs/config')) ??
        (await readWorkspaceDeclaredMajor(workspaceRoot, '@nestjs/config')) ??
        readMajor(NEST_DEPENDENCY_MATRIX[nestMajor]?.config)
    );
}

/**
 * Prisma is considered present when a schema exists in the app or when
 * @prisma/client is installed (possibly hoisted to the workspace root).
 */
async function detectPrisma(projectRoot) {
    if (await fsHelpers.exists(path.join(projectRoot, 'prisma', 'schema.prisma'))) return true;
    return Boolean(findPackageFile(projectRoot, '@prisma/client'));
}

/**
 * Reads the `prisma-client` generator output from prisma/schema.prisma.
 * The new generator (used by @averildwi/nest-prisma) does NOT export the
 * `Prisma` namespace from "@prisma/client" — it only exists inside the
 * generated client directory, whose location varies per project.
 * Returns the raw `output` value (relative to prisma/) or null.
 */
async function detectPrismaClientOutput(projectRoot) {
    const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
    if (!(await fsHelpers.exists(schemaPath))) return null;

    let schema;
    try {
        schema = await fsHelpers.readFile(schemaPath);
    } catch (err) {
        return null;
    }

    const generator = schema.match(/generator\s+\w+\s*\{([\s\S]*?)\}/);
    if (!generator) return null;

    const provider = (generator[1].match(/provider\s*=\s*"([^"]+)"/) || [])[1];
    if (provider !== 'prisma-client') return null;

    return (generator[1].match(/output\s*=\s*"([^"]+)"/) || [])[1] || null;
}

/** Aggregates everything the steps need to know about the target project. */
async function detectFacts(projectRoot, pkgJson, { workspaceRoot } = {}) {
    const nestMajor = await detectNestMajor(projectRoot, pkgJson, workspaceRoot);
    const configMajor = await detectConfigMajor(projectRoot, pkgJson, nestMajor, workspaceRoot);
    const hasPrisma = await detectPrisma(projectRoot);
    const prismaClientOutput = hasPrisma ? await detectPrismaClientOutput(projectRoot) : null;

    return { nestMajor, configMajor, hasPrisma, prismaClientOutput };
}

module.exports = {
    NEST_DEPENDENCY_MATRIX,
    resolveDependencies,
    detectFacts,
    readMajor,
    readInstalledMajor,
    readDeclaredMajor,
    detectNestMajor,
    detectConfigMajor,
    detectPrisma,
    detectPrismaClientOutput,
    readCatalogRange,
};
