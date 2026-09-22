# @averildwi/nest-common

[![npm version](https://img.shields.io/npm/v/@averildwi/nest-common.svg)](https://www.npmjs.com/package/@averildwi/nest-common)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-v11-red)](https://nestjs.com)

An interactive CLI scaffolder that injects a collection of reusable modules
(filters, guards, interceptors, pipes, decorators, config, helpers) into a
[NestJS](https://nestjs.com/) project — plus automatic `main.ts` wiring
(CORS, global pipes/interceptors/filters, optional Swagger setup) and
`.env.example` generation. Built to avoid rewriting the same boilerplate for
every new backend: just run one command and you're ready to go.

## Installation

```bash
npx @averildwi/nest-common
```

### Peer dependencies

This package doesn't bundle its dependencies — the CLI installs them into
your project automatically:

```bash
# installed automatically by the CLI
npm install @nestjs/config @nestjs/passport @nestjs/swagger
npm install class-validator class-transformer joi
```

The CLI reads the `@nestjs/common` version already present in your project and
pins each package to the matching major (Nest 10, 11, or 12), so a new
ecosystem major never breaks your install with `ERESOLVE`. If the version
can't be detected, it falls back to `latest`, and any remaining peer conflict
is retried once with `--legacy-peer-deps`.

You still need `@nestjs/common`, `@nestjs/core`, and `@prisma/client`
(only if you use `PrismaExceptionFilter`) set up in your project beforehand.

> If your ORM isn't Prisma, just skip `PrismaExceptionFilter` — everything
> else works fine.

## What the CLI Does

```
npx @averildwi/nest-common
   │
   ▼
[1/5] Copy common modules into src/common (existing files are never overwritten)
   │
   ▼
[2/5] Register AppConfigModule + HashingModule into src/app.module.ts
   │
   ▼
[3/5] Wire src/main.ts — CORS, global pipes/interceptors/filters,
      and (optional, asked interactively) Swagger docs
   │
   ▼
[4/5] Generate/patch .env.example with required Joi variables
      (JWT_SECRET is randomly generated per project)
   │
   ▼
[5/5] Install dependencies + auto-run lint fix if configured
```

The CLI is **idempotent** — running it again on a project that already has
these files won't overwrite your changes; it only fills in what's missing
and warns you about what it skipped.

### Interactive prompts

| Prompt | When it appears |
|---|---|
| Setup Swagger API Documentation? | Always |
| Swagger title / description / version / docs path | Only if Swagger is enabled |

## Package Contents

| Folder | Contents | Purpose |
|---|---|---|
| `config/` | `AppConfigModule`, `baseEnvSchema` | Environment variable validation using Joi, extendable per project |
| `decorators/` | `CurrentUser`, `Roles` | Extract user from request, specify roles allowed to access endpoints |
| `dto/` | `PaginationDto` | Standard pagination query DTO (page, limit, skip) |
| `filters/` | `GlobalExceptionFilter`, `PrismaExceptionFilter` | Standardize error response shape |
| `guards/` | `JwtAuthGuard`, `RolesGuard` | JWT authentication + role-based access control |
| `helpers/` | `buildErrorResponse`, `paginate` | Pure helpers, no dependency injection |
| `hashing/` | `HashingModule`, `HashingService` | Hash & verify passwords using native scrypt |
| `interceptors/` | `LoggerInterceptor`, `TransformInterceptor` | Log requests/responses, wrap successful responses in standard shape |
| `pipes/` | `createValidationPipe` | Standard `ValidationPipe` configuration + per-field error messages |

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
// src/config/app-config.module.ts
import * as Joi from 'joi';
import { AppConfigModule } from '../common/config/app-config.module';

export const ProjectConfigModule = AppConfigModule.forProject(
  Joi.object({
    // add project-specific env vars here
    CLOUDINARY_CLOUD_NAME: Joi.string().required(),
    CLOUDINARY_API_KEY: Joi.string().required(),
    CLOUDINARY_API_SECRET: Joi.string().required(),
  }),
);
```

```typescript
// src/app.module.ts — ProjectConfigModule needs to be added manually
// if you defined extra env vars; AppConfigModule.forProject() (default,
// no extra schema) is already registered by the CLI.
import { Module } from '@nestjs/common';
import { ProjectConfigModule } from './config/app-config.module';

@Module({
  imports: [ProjectConfigModule /* other modules */],
})
export class AppModule {}
```

### 3. Copy values from `.env.example` into your `.env`

The CLI generates `.env.example` with the variables required by
`baseEnvSchema`, using a randomly generated `JWT_SECRET`. Copy what you
need into your own `.env` (which should stay out of git — the CLI warns
you if `.env` isn't in `.gitignore`).

### 4. Use in a controller

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Paginated } from '../common/helpers/paginate.helper';

@Controller('users')
export class UsersController {
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  async findAll(@Query() pagination: PaginationDto) {
    const [data, total] = await this.usersService.findAll(pagination);
    return new Paginated(data, {
      page: pagination.page,
      limit: pagination.limit,
      total,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return user;
  }
}
```

## What Gets Generated in `main.ts`

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Injected by @averildwi/nest-common ──
  const allowedOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*';
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new LoggerInterceptor(), new TransformInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());

  // Only if Swagger is enabled during setup
  const config = new DocumentBuilder()
    .setTitle('My API')
    .setDescription('API documentation')
    .setVersion('1.0')
    .addBearerAuth(/* ... */, 'access-token')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ?? 3000);
}
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

**Error:**
```json
{
  "statusCode": 400,
  "message": ["email: email must be an email"],
  "data": null,
  "error": "BadRequestException",
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
- **`RolesGuard`** assumes `user.role` is a single string. If your project
  needs multi-role per user (array), extend/override it yourself.
- **`JwtAuthGuard`** must run before `RolesGuard` in the
  `@UseGuards(...)` order, because `RolesGuard` requires `request.user` to be set.
- Error messages in `PrismaExceptionFilter` are still hardcoded in Indonesian.
  If you need multi-language support, override the messages in your project.
- `baseEnvSchema` only covers universal env vars (DATABASE_URL, PORT,
  NODE_ENV, FRONTEND_URL, JWT_SECRET, JWT_EXPIRES_IN). Project-specific env vars
  are added via `AppConfigModule.forProject(extraSchema)`.
- Not yet tested with `pnpm`/`yarn` — NPM is assumed.

## License

MIT License