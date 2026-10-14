# @averildwi/nest-common

[![npm version](https://img.shields.io/npm/v/@averildwi/nest-common.svg)](https://www.npmjs.com/package/@averildwi/nest-common)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-v11-red)](https://nestjs.com)

An interactive CLI scaffolder that injects a collection of reusable modules
(filters, guards, interceptors, pipes, decorators, config, helpers, types) into a
[NestJS](https://nestjs.com/) project — plus automatic `main.ts` wiring
(trust proxy, `api` prefix, CORS from `FRONTEND_URL`, global
pipes/interceptors/filters, optional Swagger setup), a global rate limiter in
`app.module.ts`, and `.env.example` generation. Built to avoid rewriting the
same boilerplate for every new backend: just run one command and you're ready to go.

> See the [Usage Guide](docs/USAGE.md) for how to use each injected module
> (config, validation, pagination, guards, hashing, filters) once it's set up.

## Installation

```bash
npx @averildwi/nest-common
```

### CLI options

| Option | Description |
|---|---|
| `--no-swagger` | Skip the Swagger API documentation setup |
| `--pm <name>` | `npm`, `pnpm`, `yarn` or `bun` (default: auto-detect) |
| `--no-install` | Only write files, don't install packages |
| `-y, --yes` | Accept defaults and skip all prompts |
| `--dry-run` | Show what would change without touching anything |
| `--no-color` | Disable coloured output (`NO_COLOR` is respected too) |
| `-v, --version` / `-h, --help` | Version / help |

The CLI previews every planned change before touching your project:

```
  Planned changes
    + src/common/config/app-config.module.ts
    ~ src/app.module.ts (add AppConfigModule + HashingModule)
    ~ src/main.ts (set up Swagger docs at /docs)
    $ npm install @nestjs/config@^4.0.2 ...
    - src/common/filters/prisma-exception.filter.ts (No Prisma detected)
```

Non-interactive use (CI, scripts):

```bash
npx @averildwi/nest-common --yes
npx @averildwi/nest-common --yes --dry-run
```

Without a TTY the CLI never waits for input; `--yes` applies the defaults
(Swagger on, title "My API", docs at `/docs`), `--no-swagger` opts out.

### Peer dependencies

This package doesn't bundle its dependencies — the CLI installs them into
your project automatically:

```bash
# installed automatically by the CLI
npm install @nestjs/config @nestjs/passport @nestjs/swagger @nestjs/throttler
npm install class-validator class-transformer joi
```

The CLI reads the `@nestjs/common` version already present in your project and
pins each package to the matching major (Nest 10, 11, or 12), so a new
ecosystem major never breaks your install with `ERESOLVE`. If the version
can't be detected, it falls back to `latest`, and any remaining peer conflict
is retried once with `--legacy-peer-deps`.

You still need `@nestjs/common`, `@nestjs/core`, and a generated Prisma
client (only if you use `PrismaExceptionFilter`) set up in your project beforehand.

> If your ORM isn't Prisma, the CLI detects it automatically and skips
> `PrismaExceptionFilter` entirely (no broken imports) — everything
> else works fine.

### Recommended order on a new project

```bash
npx @nestjs/cli@11 new my-app --strict
cd my-app
npx @averildwi/nest-prisma --db postgres     # client in generated/prisma (root)
npx @averildwi/nest-common
```

Commit after each tool, on its own.

### Compatibility notes

- **Nest 11 (CommonJS) is the tested target.** Nest 10 and 12 get matching
  dependency versions, but the generated code is verified on Nest 11 only.
- **Import style follows your project.** Template files use explicit `.js`
  extensions (valid under CommonJS and ESM); the lines injected into
  `main.ts`/`app.module.ts` copy the style the file already uses.
- **Prisma client location.** The filter template imports `Prisma` from
  `generated/prisma/client` at the project root, the `@averildwi/nest-prisma`
  default. When `prisma/schema.prisma` points somewhere else, the CLI rewrites
  the import to match; with the legacy `prisma-client-js` generator it uses
  `@prisma/client`.
- **`@nestjs/config@12`** switched env validation to Standard Schema V1, so
  the CLI nests Joi's `abortEarly`/`allowUnknown` inside
  `validationOptions.libraryOptions` when it detects config v12.

## What the CLI Does

The pipeline mirrors the steps it prints, and each step is idempotent. Steps
that have nothing to do are dropped from the plan, so the `[n/total]` counter
reflects only the steps that actually run:

```
[1/*] Copy the common boilerplate into src/common
      (existing files are never overwritten; Prisma filter skipped without Prisma)
   │
   ▼
[2/*] Register AppConfigModule, HashingModule, ThrottlerModule and the
      global ThrottlerGuard (APP_GUARD) in src/app.module.ts
   │
   ▼
[3/*] Wire src/main.ts — trust proxy, api prefix, CORS, global
      pipes/interceptors/filters and (optional) Swagger docs
   │
   ▼
[4/*] Generate/patch .env.example with the required Joi variables
      (JWT_SECRET is randomly generated per project)
   │
   ▼
[5/*] Install the ecosystem dependencies (version-pinned to your Nest major)
   │
   ▼
[6/*] Auto-format the injected code with "npm run lint" (when configured)
```

The CLI is **idempotent** — running it again on a project that already has
these files reports "Everything is already set up. Nothing to do."; it only
fills in what's missing and warns you about what it skipped.

## Package Contents

| Folder | Contents | Purpose |
|---|---|---|
| `config/` | `AppConfigModule`, `baseEnvSchema` | Environment variable validation using Joi, extendable per project |
| `decorators/` | `CurrentUser`, `Roles`, `ToBoolean` | Extract the user, restrict roles, parse query-string booleans correctly |
| `dto/` | `PaginationDto` | Standard pagination query DTO (page, limit, skip) |
| `filters/` | `GlobalExceptionFilter`, `PrismaExceptionFilter` | Standardize error response shape |
| `guards/` | `JwtAuthGuard`, `RolesGuard` | JWT authentication + role-based access control |
| `helpers/` | `buildErrorResponse`, `paginate` | Pure helpers, no dependency injection |
| `hashing/` | `HashingModule`, `HashingService` | Async scrypt hashing for passwords and OTP codes |
| `interceptors/` | `LoggerInterceptor`, `TransformInterceptor` | Log requests/responses, wrap successful responses in standard shape |
| `pipes/` | `createValidationPipe`, `ParseCuidPipe` | Standard `ValidationPipe` configuration; `:id` validation for cuid ids |
| `types/` | `AuthUser`, `JwtPayload`, `AuthenticatedRequest`, `RoleName` | One shared type for `request.user` |

## Quick Start

### 1. Run the scaffolder

```bash
npx @averildwi/nest-common
```

Answer the Swagger prompt (and the follow-up questions if you enable it).
Everything else — copying modules, registering `AppModule`, wiring
`main.ts`, generating `.env.example`, installing dependencies — is handled
automatically.

### 2. Fill in project-specific env vars (optional)

```typescript
// src/config/env.schema.ts
import * as Joi from 'joi';

export const projectEnvSchema = Joi.object({
  CLOUDINARY_URL: Joi.string().uri().required(),
});
```

```typescript
// src/app.module.ts: pass the schema to the call the CLI already added.
// Do not register AppConfigModule a second time.
imports: [
  AppConfigModule.forProject(projectEnvSchema),
  // ...
],
```

### 3. Copy values from `.env.example` into your `.env`

The CLI generates `.env.example` with the variables required by
`baseEnvSchema`, using a randomly generated `JWT_SECRET`. Copy what you
need into your own `.env` (which should stay out of git — the CLI warns
you if `.env` isn't in `.gitignore`). Set `FRONTEND_URL` to your frontend
origin(s); left empty, no cross-origin request is allowed.

### 4. Make the role type match your schema

`src/common/types/auth-user.ts` ships a placeholder `RoleName = 'ADMIN' | 'USER'`
and `UserId = string`. Once your schema has a role enum, derive the union from
it (and use `number` for `UserId` with autoincrement ids):

```typescript
import type { Role } from '../../../generated/prisma/client.js';
export type RoleName = Role;
```

### 5. Use in a controller

```typescript
import { Controller, Get, ParseUUIDPipe, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Paginated } from '../common/interceptors/transform.interceptor.js';
import type { AuthUser } from '../common/types/auth-user.js';
import { QueryUserDto } from './dto/query-user.dto.js'; // extends PaginationDto
import { UsersService } from './users.service.js';

@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('ADMIN')
  async findAll(@Query() query: QueryUserDto) {
    // The service returns paginate(rows, total, query.page, query.limit).
    const result = await this.usersService.findAll(query);
    return new Paginated(result.data, result.meta);
  }

  @Get('me')
  getProfile(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get(':id')
  @Roles('ADMIN')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }
}
```

## What Gets Generated

`src/main.ts`:

```typescript
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Injected by @averildwi/nest-common
  const config = app.get(ConfigService);

  // Behind a proxy, req.ip is the proxy unless we trust it. Trust the exact
  // hop count (TRUST_PROXY_HOPS), never `true`.
  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.setGlobalPrefix('api');

  // Empty FRONTEND_URL means no cross-origin access (never a wildcard).
  const allowedOrigins = config
    .getOrThrow<string>('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new LoggerInterceptor(), new TransformInterceptor());
  // Nest tries the LAST registered filter first, so the catch-all goes first.
  app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());

  // Only if Swagger is enabled during setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('My API')
    .setDescription('API documentation')
    .setVersion('1.0')
    .addBearerAuth(/* ... */, 'access-token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

`src/app.module.ts`:

```typescript
@Module({
  imports: [
    AppConfigModule.forProject(),
    HashingModule,
    // 100 requests per minute per client; add @Throttle() on auth endpoints.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // ...your modules
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```
bootstrap();
```

## Response Shape

All responses (success or error) follow a consistent shape, so the
frontend doesn't need to handle different formats:

**Success:**
```json
{
  "statusCode": 200,
  "message": "Success",
  "data": { "...": "..." },
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

**Error** (`error` is the HTTP reason phrase, or the Prisma code such as `P2002` for database errors):
```json
{
  "statusCode": 400,
  "message": ["email: email must be an email"],
  "data": null,
  "error": "Bad Request",
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

## Request Flow

```
Request
   │
   ▼
LoggerInterceptor (log "-->")
   │
   ▼
Guards (JwtAuthGuard → RolesGuard)
   │
   ▼
ValidationPipe (createValidationPipe)
   │
   ▼
Controller/Service
   │
   ├── Success ──► TransformInterceptor ──► Response
   │
   └── Throw ───► GlobalExceptionFilter / PrismaExceptionFilter ──► Response
```

## Important Notes

- **The CLI never overwrites existing files.** If `src/common`,
  `app.module.ts` registration, or `main.ts` wiring already exist, those
  steps are skipped with a warning instead of silently replacing your code.
- **`.env.example`, not `.env`, is generated/patched** — the CLI never
  touches your real `.env`, so your actual credentials are never at risk.
  `JWT_SECRET` is randomly generated per run, never hardcoded.
- **`RolesGuard`** compares a single `user.role` against the `@Roles(...)`
  list: no `@Roles` allows everyone, no user is `401`, a wrong role is `403`.
  If your project needs multiple roles per user (array), extend it yourself.
- **`JwtAuthGuard`** must run before `RolesGuard` in the
  `@UseGuards(...)` order, because `RolesGuard` requires `request.user` to be set.
- **`HashingService` is async**: always `await hash()` and `verify()`.
- Error messages in `GlobalExceptionFilter` and `PrismaExceptionFilter` are
  hardcoded in English. If you need multi-language support, override the
  messages in your project.
- `baseEnvSchema` only covers universal env vars (DATABASE_URL, PORT,
  NODE_ENV, FRONTEND_URL, JWT_SECRET, JWT_EXPIRES_IN, TRUST_PROXY_HOPS).
  Project-specific env vars are added via `AppConfigModule.forProject(extraSchema)`.
- **`TRUST_PROXY_HOPS`** is the number of reverse proxies in front of the app
  (`1` behind one Nginx). Leave it `0` when the app is exposed directly. The
  throttler keys on `req.ip`, so a wrong value either puts every client in
  one bucket or lets clients spoof their IP.
- `npm`, `pnpm`, `yarn` and `bun` are supported. The package manager is
  auto-detected from the lockfile (or the invoking command) and can be forced
  with `--pm`.

## License

MIT License