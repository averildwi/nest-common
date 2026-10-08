const path = require('path');

const fsHelpers = require('../utils/fsHelpers');

/**
 * Peer-compatible ecosystem versions per NestJS major.
 * Installing bare "latest" breaks whenever the ecosystem ships a new major
 * (e.g. @nestjs/swagger@12 requires @nestjs/common@^12) while the target
 * project is still on an older Nest major.
 */
const NEST_DEPENDENCY_MATRIX = {
    10: { config: '^3.3.0', passport: '^10.0.3', swagger: '^7.4.2' },
    11: { config: '^4.0.2', passport: '^11.0.5', swagger: '^11.2.0' },
    12: { config: '^12.0.0', passport: '^12.0.0', swagger: '^12.0.0' },
    default: { config: 'latest', passport: 'latest', swagger: 'latest' },
};

/** Runtime deps installed by the install step, derived from the detected Nest major. */
function resolveDependencies(nestMajor) {
    const matrix = NEST_DEPENDENCY_MATRIX[nestMajor] || NEST_DEPENDENCY_MATRIX.default;
    return [
        `@nestjs/config@${matrix.config}`,
        `@nestjs/passport@${matrix.passport}`,
        `@nestjs/swagger@${matrix.swagger}`,
        'class-validator',
        'class-transformer',
        'joi',
    ];
}

function readMajor(range) {
    const match = String(range || '').match(/(\d+)\s*\./);
    return match ? Number(match[1]) : null;
}

async function readInstalledMajor(projectRoot, name) {
    try {
        const installedPath = path.join(projectRoot, 'node_modules', ...name.split('/'), 'package.json');
        if (await fsHelpers.exists(installedPath)) {
            return readMajor(require(installedPath).version);
        }
    } catch (err) {
        // fall through to the declared range
    }
    return null;
}

async function readDeclaredMajor(pkgJson, name) {
    const declared =
        (pkgJson.dependencies && pkgJson.dependencies[name]) ||
        (pkgJson.devDependencies && pkgJson.devDependencies[name]) ||
        (pkgJson.peerDependencies && pkgJson.peerDependencies[name]);
    return readMajor(declared);
}

/**
 * The @nestjs/config major decides how validationOptions must be shaped:
 * v12 switched env validation to Standard Schema V1, where vendor-specific
 * options (Joi's abortEarly/allowUnknown) must be nested inside
 * `libraryOptions`. Older majors (3/4) accept them directly.
 */
async function detectConfigMajor(projectRoot, pkgJson, nestMajor) {
    return (
        (await readInstalledMajor(projectRoot, '@nestjs/config')) ??
        (await readDeclaredMajor(pkgJson, '@nestjs/config')) ??
        readMajor(NEST_DEPENDENCY_MATRIX[nestMajor]?.config)
    );
}

/** Prisma is considered present when a schema exists or @prisma/client is installed. */
async function detectPrisma(projectRoot) {
    if (await fsHelpers.exists(path.join(projectRoot, 'prisma', 'schema.prisma'))) return true;
    return fsHelpers.exists(path.join(projectRoot, 'node_modules', '@prisma', 'client'));
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
async function detectFacts(projectRoot, pkgJson) {
    const nestMajor =
        (await readInstalledMajor(projectRoot, '@nestjs/common')) ??
        (await readDeclaredMajor(pkgJson, '@nestjs/common'));

    const configMajor = await detectConfigMajor(projectRoot, pkgJson, nestMajor);
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
    detectConfigMajor,
    detectPrisma,
    detectPrismaClientOutput,
};
