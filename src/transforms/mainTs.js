/** Escapes a value for safe embedding in a single-quoted TS string literal. */
function escapeForSingleQuoteString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const COMMON_IMPORTS = [
    "import { createValidationPipe } from './common/pipes/validation.pipe.config.js';",
    "import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';",
    "import { LoggerInterceptor } from './common/interceptors/logger.interceptor.js';",
    "import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';",
];

/**
 * Builds the import block that is inserted after the last import in main.ts.
 * PrismaExceptionFilter is only referenced when the project actually has
 * Prisma, and the Swagger import only when it isn't imported yet.
 */
function buildImportBlock({ useSwagger, hasPrisma, needsSwaggerLib }) {
    const lines = [...COMMON_IMPORTS];
    if (hasPrisma) {
        lines.push("import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';");
    }
    if (useSwagger && needsSwaggerLib) {
        lines.push("import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';");
    }
    return lines.join('\n');
}

/** Builds the CORS/pipes/interceptors/filters block injected into bootstrap(). */
function buildCorsBlock({ hasPrisma = false } = {}) {
    const filters = hasPrisma
        ? 'new GlobalExceptionFilter(), new PrismaExceptionFilter()'
        : 'new GlobalExceptionFilter()';
    return [
        `  // ── Injected by @averildwi/nest-common ──`,
        `  const allowedOrigins = process.env.FRONTEND_URL`,
        `    ? process.env.FRONTEND_URL.split(',')`,
        `    : '*';`,
        `  app.enableCors({`,
        `    origin: allowedOrigins,`,
        `    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],`,
        `  });`,
        `  app.useGlobalPipes(createValidationPipe());`,
        `  app.useGlobalInterceptors(new LoggerInterceptor(), new TransformInterceptor());`,
        `  app.useGlobalFilters(${filters});`,
    ].join('\n');
}

/** Builds the Swagger setup block injected into bootstrap(). */
function buildSwaggerBlock({ title, description, version, docsPath }) {
    const t = escapeForSingleQuoteString(title);
    const d = escapeForSingleQuoteString(description);
    const v = escapeForSingleQuoteString(version);
    const p = escapeForSingleQuoteString(docsPath);
    return [
        ``,
        `  const config = new DocumentBuilder()`,
        `    .setTitle('${t}')`,
        `    .setDescription('${d}')`,
        `    .setVersion('${v}')`,
        `    .addBearerAuth(`,
        `      {`,
        `        type: 'http',`,
        `        scheme: 'bearer',`,
        `        bearerFormat: 'JWT',`,
        `        description: 'Enter the JWT token from the login response',`,
        `      },`,
        `      'access-token',`,
        `    )`,
        `    .build();`,
        `  const document = SwaggerModule.createDocument(app, config);`,
        `  SwaggerModule.setup('${p}', app, document, {`,
        `    swaggerOptions: { persistAuthorization: true },`,
        `  });`,
    ].join('\n');
}

const APP_CREATION = /(const\s+app\s*=\s*await\s+NestFactory\.create(?:<[^>]*>)?\(AppModule\);)/;

/**
 * Applies the prepared pieces to a main.ts source. Returns null when there
 * is nothing to do (everything already present / nothing applicable).
 */
function applyToMain(source, { importBlock, injectionCode }) {
    let out = source;

    if (importBlock && !out.includes("from './common/pipes/validation.pipe.config'")) {
        const importRegex = /^import\s[^;]*;/gm;
        let lastMatch = null;
        let match;
        while ((match = importRegex.exec(out)) !== null) {
            lastMatch = match;
        }
        const block = importBlock + '\n';
        out = lastMatch
            ? `${out.slice(0, lastMatch.index + lastMatch[0].length)}\n${block}${out.slice(lastMatch.index + lastMatch[0].length)}`
            : `${block}${out}`;
    }

    if (injectionCode) {
        if (!APP_CREATION.test(out)) return { source: out, needsManualInjection: injectionCode };
        out = out.replace(APP_CREATION, `$1\n${injectionCode}`);
    }

    if (out === source) return null;
    return { source: out };
}

module.exports = {
    escapeForSingleQuoteString,
    buildImportBlock,
    buildCorsBlock,
    buildSwaggerBlock,
    applyToMain,
    APP_CREATION,
};
