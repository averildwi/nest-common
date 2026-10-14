/** Escapes a value for safe embedding in a single-quoted TS string literal. */
function escapeForSingleQuoteString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * True when the file already writes relative imports with a `.js` extension
 * (ESM / nodenext style). Injected imports follow the file's own style so a
 * Nest 11 CommonJS project does not end up with mixed `./x` and `./x.js`.
 */
function usesJsExtension(source) {
    return /from\s+['"]\.{1,2}\/[^'"]+\.js['"]/.test(source);
}

function relImport(path, js) {
    return js ? `${path}.js` : path;
}

/**
 * Builds the import block that is inserted after the last import in main.ts.
 * PrismaExceptionFilter is only referenced when the project actually has
 * Prisma, and the Swagger import only when it isn't imported yet.
 */
function buildImportBlock({ useSwagger, hasPrisma, needsSwaggerLib, js = true, source = '' }) {
    const lines = [];
    if (!/\bConfigService\b/.test(source)) {
        lines.push("import { ConfigService } from '@nestjs/config';");
    }
    if (!/\bNestExpressApplication\b/.test(source)) {
        lines.push("import { NestExpressApplication } from '@nestjs/platform-express';");
    }
    if (useSwagger && needsSwaggerLib) {
        lines.push("import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';");
    }
    lines.push(
        `import { createValidationPipe } from '${relImport('./common/pipes/validation.pipe.config', js)}';`,
        `import { TransformInterceptor } from '${relImport('./common/interceptors/transform.interceptor', js)}';`,
        `import { LoggerInterceptor } from '${relImport('./common/interceptors/logger.interceptor', js)}';`,
        `import { GlobalExceptionFilter } from '${relImport('./common/filters/global-exception.filter', js)}';`,
    );
    if (hasPrisma) {
        lines.push(`import { PrismaExceptionFilter } from '${relImport('./common/filters/prisma-exception.filter', js)}';`);
    }
    return lines.join('\n');
}

/**
 * Builds the block injected right after the app is created, in the order of
 * the standard (nest-architecture rule 10): trust proxy, prefix, CORS, pipes,
 * interceptors, filters.
 */
function buildCorsBlock({ hasPrisma = false } = {}) {
    const filters = hasPrisma
        ? 'new GlobalExceptionFilter(), new PrismaExceptionFilter()'
        : 'new GlobalExceptionFilter()';
    return [
        `  // Injected by @averildwi/nest-common`,
        `  const config = app.get(ConfigService);`,
        ``,
        `  // Behind a proxy, req.ip is the proxy unless we trust it. Trust the exact`,
        `  // hop count (TRUST_PROXY_HOPS), never \`true\`.`,
        `  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));`,
        `  app.setGlobalPrefix('api');`,
        ``,
        `  // Empty FRONTEND_URL means no cross-origin access (never a wildcard).`,
        `  const allowedOrigins = config`,
        `    .getOrThrow<string>('FRONTEND_URL')`,
        `    .split(',')`,
        `    .map((origin) => origin.trim())`,
        `    .filter(Boolean);`,
        `  app.enableCors({`,
        `    origin: allowedOrigins,`,
        `    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],`,
        `  });`,
        ``,
        `  app.useGlobalPipes(createValidationPipe());`,
        `  app.useGlobalInterceptors(`,
        `    new LoggerInterceptor(),`,
        `    new TransformInterceptor(),`,
        `  );`,
        `  // Nest tries the LAST registered filter first, so the catch-all goes first.`,
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
        `  const swaggerConfig = new DocumentBuilder()`,
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
        `  const document = SwaggerModule.createDocument(app, swaggerConfig);`,
        `  SwaggerModule.setup('${p}', app, document, {`,
        `    swaggerOptions: { persistAuthorization: true },`,
        `  });`,
    ].join('\n');
}

const APP_CREATION = /(const\s+app\s*=\s*await\s+NestFactory\.create(?:<[^>]*>)?\(AppModule\);)/;
const PLAIN_CREATION = /NestFactory\.create\(AppModule\)/;
const FLOATING_BOOTSTRAP = /^bootstrap\(\);?[ \t]*$/m;

/**
 * Applies the prepared pieces to a main.ts source. Returns null when there
 * is nothing to do (everything already present / nothing applicable).
 * Works on LF internally and restores the file's own line endings.
 */
function applyToMain(source, { importBlock, injectionCode }) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const original = source.replace(/\r\n/g, '\n');
    let out = original;

    if (importBlock && !/validation\.pipe\.config/.test(out)) {
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

    let needsManualInjection;
    if (injectionCode) {
        if (APP_CREATION.test(out)) {
            // app.set('trust proxy') is only typed on the Express adapter.
            out = out.replace(PLAIN_CREATION, 'NestFactory.create<NestExpressApplication>(AppModule)');
            out = out.replace(APP_CREATION, `$1\n${injectionCode}`);
        } else {
            needsManualInjection = injectionCode;
        }
    }

    // `bootstrap();` at the top level is a floating promise (no-floating-promises).
    out = out.replace(FLOATING_BOOTSTRAP, 'void bootstrap();');

    if (out === original && !needsManualInjection) return null;
    const result = { source: out.replace(/\n/g, eol) };
    if (needsManualInjection) result.needsManualInjection = needsManualInjection;
    return result;
}

module.exports = {
    escapeForSingleQuoteString,
    usesJsExtension,
    buildImportBlock,
    buildCorsBlock,
    buildSwaggerBlock,
    applyToMain,
    APP_CREATION,
};
