#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const COLORS = {
  red: '\x1b[31m%s\x1b[0m',
  green: '\x1b[32m%s\x1b[0m',
  yellow: '\x1b[33m%s\x1b[0m',
  cyan: '\x1b[36m%s\x1b[0m',
  magenta: '\x1b[35m%s\x1b[0m',
};

function log(color, msg) {
  console.log(COLORS[color] || '%s', msg);
}

function fail(msg, err) {
  log('red', `❌ ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function escapeForSingleQuoteString(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Peer-compatible ecosystem versions per NestJS major.
// Installing bare "latest" breaks whenever the ecosystem ships a new major
// (e.g. @nestjs/swagger@12 requires @nestjs/common@^12) while the target
// project is still on an older Nest major.
const NEST_DEPENDENCY_MATRIX = {
  10: { config: '^3.3.0', passport: '^10.0.3', swagger: '^7.4.2' },
  11: { config: '^4.0.2', passport: '^11.0.5', swagger: '^11.2.0' },
  12: { config: '^12.0.0', passport: '^12.0.0', swagger: '^12.0.0' },
  default: { config: 'latest', passport: 'latest', swagger: 'latest' },
};

async function detectNestMajor() {
  const readMajor = (range) => {
    const match = String(range || '').match(/(\d+)\s*\./);
    return match ? Number(match[1]) : null;
  };

  // 1) Most reliable: the version actually installed in node_modules.
  try {
    const installedPkgPath = path.join(
      process.cwd(),
      'node_modules',
      '@nestjs',
      'common',
      'package.json',
    );
    if (fs.existsSync(installedPkgPath)) {
      const installedPkg = await fs.readJson(installedPkgPath);
      const major = readMajor(installedPkg.version);
      if (major) return major;
    }
  } catch (err) {
    // fall through to package.json declaration
  }

  // 2) Fallback: the declared range inside the project's package.json.
  try {
    const pkgJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = await fs.readJson(pkgJsonPath);
      const declared =
        (pkgJson.dependencies && pkgJson.dependencies['@nestjs/common']) ||
        (pkgJson.devDependencies && pkgJson.devDependencies['@nestjs/common']) ||
        (pkgJson.peerDependencies && pkgJson.peerDependencies['@nestjs/common']);
      const major = readMajor(declared);
      if (major) return major;
    }
  } catch (err) {
    // fall through to null
  }

  return null;
}

async function generateCommon() {
  const sourceDir = path.join(__dirname, 'templates', 'common');
  const targetDir = path.join(process.cwd(), 'src', 'common');
  const appModulePath = path.join(process.cwd(), 'src', 'app.module.ts');
  const mainTsPath = path.join(process.cwd(), 'src', 'main.ts');

  // ── Early Validation ────────────────────────────────────────────
  if (!fs.existsSync(path.join(process.cwd(), 'src'))) {
    fail('Error: "src" folder not found! Please run this command inside the root of your NestJS project.');
  }

  if (!fs.existsSync(sourceDir)) {
    fail(`Template source not found at ${sourceDir}. Reinstall the package or check your installation.`);
  }

  log('magenta', '💎 Welcome to @averildwi/nest-common Scaffolder 💎\n');

  const { default: inquirer } = await import('inquirer');

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useSwagger',
      message: 'Do you want to automatically setup and configure Swagger API Documentation?',
      default: true,
    },
    {
      type: 'input',
      name: 'swaggerTitle',
      message: 'Enter Swagger API Title:',
      default: 'My API',
      when: (hash) => hash.useSwagger,
    },
    {
      type: 'input',
      name: 'swaggerDesc',
      message: 'Enter Swagger API Description:',
      default: 'API documentation',
      when: (hash) => hash.useSwagger,
    },
    {
      type: 'input',
      name: 'swaggerVersion',
      message: 'Enter API Version:',
      default: '1.0',
      when: (hash) => hash.useSwagger,
    },
    {
      type: 'input',
      name: 'swaggerPath',
      message: 'Enter Swagger Docs Path URL (e.g., docs, api-docs):',
      default: 'docs',
      when: (hash) => hash.useSwagger,
    },
  ]);


  // ── [1/5] Copy common folder ──
  let skippedFiles = [];
  try {
    log('cyan', '📂 [1/5] Injecting universal common modules into src/common...');

    if (fs.existsSync(targetDir)) {
      log('yellow', '⚠️ [Warning] src/common already exists — only missing files will be added, existing files are left untouched.');
    }

    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      let files = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(await walk(full));
        } else {
          files.push(full);
        }
      }
      return files;
    }

    const allTemplateFiles = await walk(sourceDir);
    for (const filePath of allTemplateFiles) {
      const rel = path.relative(sourceDir, filePath);
      const dest = path.join(targetDir, rel);
      if (fs.existsSync(dest)) skippedFiles.push(rel);
    }

    await fs.copy(sourceDir, targetDir, {
      overwrite: false,
      errorOnExist: false,
    });

    if (skippedFiles.length > 0) {
      log('yellow', `⚠️ [Skip] ${skippedFiles.length} existing file(s) were not overwritten:`);
      skippedFiles.forEach((f) => console.log(`    - src/common/${f}`));
    }

    log('green', '✅ [Success] Common boilerplate folder successfully copied!');
  } catch (err) {
    fail('Failed to copy common folder structure.', err);
  }

  // ── [2/5] Auto-register to app.module.ts ────────────────────────
  try {
    if (fs.existsSync(appModulePath)) {
      log('cyan', '✍️ [2/5] Auto-registering AppConfigModule and HashingModule into src/app.module.ts...');
      let appModuleContent = await fs.readFile(appModulePath, 'utf8');
      const original = appModuleContent;

      const hasImportLine = /from\s+['"]\.\/common\/config\/app-config\.module['"]/.test(appModuleContent);
      const hasModuleUsage = /AppConfigModule\.forProject\s*\(/.test(appModuleContent);

      if (hasImportLine && hasModuleUsage) {
        log('yellow', '⚠️ [Skip] Modules are already registered inside app.module.ts.');
      } else {
        if (!hasImportLine) {
          const importLines =
            `import { AppConfigModule } from './common/config/app-config.module';\n` +
            `import { HashingModule } from './common/hashing/hashing.module';\n`;

          const lastImportMatch = [...appModuleContent.matchAll(/^import .+;$/gm)].pop();
          if (lastImportMatch) {
            const insertAt = lastImportMatch.index + lastImportMatch[0].length;
            appModuleContent =
              appModuleContent.slice(0, insertAt) + '\n' + importLines.trimEnd() + appModuleContent.slice(insertAt);
          } else {
            appModuleContent = importLines + appModuleContent;
          }
        }

        // regist to imports: [...] array
        if (!hasModuleUsage) {
          const importsRegex = /(imports\s*:\s*\[)/;
          if (importsRegex.test(appModuleContent)) {
            appModuleContent = appModuleContent.replace(
              importsRegex,
              `$1\n    AppConfigModule.forProject(),\n    HashingModule,`,
            );
          } else {
            log('yellow', '⚠️ [Warning] Could not find an "imports: [" array in app.module.ts. Please add these manually:');
            console.log('    AppConfigModule.forProject(),\n    HashingModule,');
          }
        }

        if (appModuleContent !== original) {
          await fs.writeFile(appModulePath, appModuleContent, 'utf8');
          log('green', '✅ [Success] Injected AppConfigModule.forProject() and HashingModule into AppModule graph.');
        }
      }
    } else {
      log('yellow', '⚠️ [Skip] src/app.module.ts not found — skipping auto-module injection. Please register the modules manually.');
    }
  } catch (err) {
    fail('Failed to inject code into app.module.ts automatically.', err);
  }

  // ── [3/5] Auto-inject CORS/Pipes/Interceptors/Swagger to src/main.ts ──
  try {
    if (fs.existsSync(mainTsPath)) {
      log('cyan', '⚙️ [3/5] Injecting CORS, Interceptors, Pipes, and Swagger into src/main.ts...');
      let mainContent = await fs.readFile(mainTsPath, 'utf8');
      const original = mainContent;

      const hasCommonImport = mainContent.includes('createValidationPipe');
      const hasCors = mainContent.includes('app.enableCors');
      const hasSwaggerSetup =
        mainContent.includes('SwaggerModule.createDocument') || mainContent.includes('SwaggerModule.setup(');

      if (!hasCommonImport) {
        let importBlock =
          `import { createValidationPipe } from './common/pipes/validation.pipe.config';\n` +
          `import { TransformInterceptor } from './common/interceptors/transform.interceptor';\n` +
          `import { LoggerInterceptor } from './common/interceptors/logger.interceptor';\n` +
          `import { GlobalExceptionFilter } from './common/filters/global-exception.filter';\n` +
          `import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';\n`;

        if (answers.useSwagger && !mainContent.includes("from '@nestjs/swagger'")) {
          importBlock += `import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';\n`;
        }

        const lastImportMatch = [...mainContent.matchAll(/^import .+;$/gm)].pop();
        if (lastImportMatch) {
          const insertAt = lastImportMatch.index + lastImportMatch[0].length;
          mainContent = mainContent.slice(0, insertAt) + '\n' + importBlock.trimEnd() + mainContent.slice(insertAt);
        } else {
          mainContent = importBlock + mainContent;
        }
      }

      // ── CORS + global pipes/interceptors/filters ──
      let injectionCode = '';
      if (!hasCors) {
        injectionCode += `\n  // ── Injected by @averildwi/nest-common ──\n`;
        injectionCode += `  const allowedOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*';\n`;
        injectionCode += `  app.enableCors({\n`;
        injectionCode += `    origin: allowedOrigins,\n`;
        injectionCode += `    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],\n`;
        injectionCode += `  });\n`;
        injectionCode += `  app.useGlobalPipes(createValidationPipe());\n`;
        injectionCode += `  app.useGlobalInterceptors(new LoggerInterceptor(), new TransformInterceptor());\n`;
        injectionCode += `  app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());\n`;
      } else {
        log('yellow', '⚠️ [Skip] CORS/pipes/interceptors/filters already configured in main.ts.');
      }

      if (answers.useSwagger && hasSwaggerSetup) {
        log('yellow', '⚠️ [Skip] Swagger is already configured in main.ts — leaving your existing setup untouched.');
      } else if (answers.useSwagger && !hasSwaggerSetup) {
        const title = escapeForSingleQuoteString(answers.swaggerTitle);
        const desc = escapeForSingleQuoteString(answers.swaggerDesc);
        const version = escapeForSingleQuoteString(answers.swaggerVersion);
        const docsPath = escapeForSingleQuoteString(answers.swaggerPath);

        injectionCode += `\n  const config = new DocumentBuilder()\n`;
        injectionCode += `    .setTitle('${title}')\n`;
        injectionCode += `    .setDescription('${desc}')\n`;
        injectionCode += `    .setVersion('${version}')\n`;
        injectionCode += `    .addBearerAuth(\n`;
        injectionCode += `      {\n`;
        injectionCode += `        type: 'http',\n`;
        injectionCode += `        scheme: 'bearer',\n`;
        injectionCode += `        bearerFormat: 'JWT',\n`;
        injectionCode += `        description: 'Enter the JWT token from the login response',\n`;
        injectionCode += `      },\n`;
        injectionCode += `      'access-token',\n`;
        injectionCode += `    )\n`;
        injectionCode += `    .build();\n`;
        injectionCode += `  const document = SwaggerModule.createDocument(app, config);\n`;
        injectionCode += `  SwaggerModule.setup('${docsPath}', app, document, {\n`;
        injectionCode += `    swaggerOptions: { persistAuthorization: true },\n`;
        injectionCode += `  });\n`;
      }

      const appCreationRegex = /(const\s+app\s*=\s*await\s+NestFactory\.create(?:<[^>]*>)?\(AppModule\);)/;

      if (injectionCode.length === 0) {
      } else if (appCreationRegex.test(mainContent)) {
        mainContent = mainContent.replace(appCreationRegex, `$1\n${injectionCode}`);
        if (mainContent !== original) {
          await fs.writeFile(mainTsPath, mainContent, 'utf8');
          log('green', '✅ [Success] src/main.ts successfully configured!');
        }
      } else {
        log(
          'yellow',
          '⚠️ [Warning] Could not find "const app = await NestFactory.create(AppModule);" in main.ts — please add the following manually:',
        );
        console.log(injectionCode);
      }
    } else {
      log('yellow', '⚠️ [Skip] src/main.ts not found — skipping auto-configuration. Please wire it up manually.');
    }
  } catch (err) {
    fail('Failed to modify src/main.ts file.', err);
  }

  // ── [4/5] Setup .env.example ───────────
  try {
    const envExamplePath = path.join(process.cwd(), '.env.example');
    const gitignorePath = path.join(process.cwd(), '.gitignore');

    log('cyan', '📝 [4/5] Checking and configuring variables inside .env.example...');

    const envBlueprint = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/mydb?schema=public',
      PORT: '3000',
      NODE_ENV: 'development',
      FRONTEND_URL: '*',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      JWT_EXPIRES_IN: '7d',
    };

    if (!fs.existsSync(envExamplePath)) {
      let envContent = '';
      for (const [key, value] of Object.entries(envBlueprint)) {
        envContent += `${key}="${value}"\n`;
      }
      await fs.writeFile(envExamplePath, envContent, 'utf8');
      log('green', '✅ [Success] .env.example created with default Joi requirements!');
    } else {
      let currentEnvContent = await fs.readFile(envExamplePath, 'utf8');
      let patchedLines = '';
      for (const [key, value] of Object.entries(envBlueprint)) {
        const hasVariable = new RegExp(`^${key}\\s*=`, 'm').test(currentEnvContent);
        if (!hasVariable) {
          patchedLines += `${key}="${value}"\n`;
        }
      }
      if (patchedLines.length > 0) {
        currentEnvContent =
          currentEnvContent.trimEnd() + '\n\n# Added by @averildwi/nest-common\n' + patchedLines;
        await fs.writeFile(envExamplePath, currentEnvContent, 'utf8');
        log('green', '✅ [Success] Patched missing Joi variables into your existing .env.example!');
      } else {
        log('yellow', '⚠️ [Skip] Your existing .env.example already contains all required Joi variables.');
      }
    }

    log('cyan', '   → Copy the values you need from .env.example into your own .env file.');

    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
      if (!/^\.env$/m.test(gitignoreContent)) {
        log('yellow', '⚠️ [Warning] ".env" is not listed in .gitignore — add it to avoid committing real secrets.');
      }
    } else {
      log('yellow', '⚠️ [Warning] No .gitignore found — make sure your real .env file is never committed.');
    }
  } catch (err) {
    log('yellow', '⚠️ [Warning] Failed to safely patch .env.example — please review your environment variables manually.');
  }

  // ── [5/5] Install dependencies ───────────────────────────────
  try {
    const nestMajor = await detectNestMajor();
    const matrix = NEST_DEPENDENCY_MATRIX[nestMajor] || NEST_DEPENDENCY_MATRIX.default;

    if (nestMajor) {
      log('cyan', `\n📦 [5/5] Installing dependencies compatible with @nestjs/common v${nestMajor}...`);
    } else {
      log('cyan', '\n📦 [5/5] Installing core framework and ecosystem dependencies...');
      log('yellow', '⚠️ [Warning] Could not detect your @nestjs/common version — falling back to the latest ecosystem versions.');
    }

    const dependencies = [
      `@nestjs/config@${matrix.config}`,
      `@nestjs/passport@${matrix.passport}`,
      `@nestjs/swagger@${matrix.swagger}`,
      'class-validator',
      'class-transformer',
      'joi',
    ].join(' ');

    try {
      execSync(`npm install ${dependencies}`, { stdio: 'inherit' });
    } catch (installErr) {
      log('yellow', '⚠️ [Warning] npm reported a peer dependency conflict — retrying once with --legacy-peer-deps...');
      execSync(`npm install ${dependencies} --legacy-peer-deps`, { stdio: 'inherit' });
    }

    log('green', '✅ [Success] All required dependencies successfully installed via npm.');
  } catch (err) {
    fail('npm dependency installation failed. Please check your network or package.json.', err);
  }

  // ── Optional: lint ──
  try {
    const pkgJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = await fs.readJson(pkgJsonPath);
      if (pkgJson.scripts && pkgJson.scripts.lint) {
        log('cyan', '🧹 Running "npm run lint" to auto-format the injected code...');
        execSync('npm run lint', { stdio: 'ignore' });
        log('green', '✅ [Success] Lint auto-fix applied.');
      }
    }
  } catch (err) {
    log('yellow', '⚠️ [Warning] "npm run lint" failed or reported issues — this does NOT affect the scaffolding result, please check your lint config manually.');
  }

  log('magenta', '\n🎉 [Scaffolding Completed] Your project architecture is ready!');
  log('cyan', '📖 Full documentation: https://github.com/Everilll/nest-common\n');
}

generateCommon().catch((err) => {
  fail('Unexpected error during scaffolding.', err);
});