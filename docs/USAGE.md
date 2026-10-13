# Usage Guide

This guide shows how to get the most out of the files that
`@averildwi/nest-common` injects into your NestJS project. For installation
and CLI options see the [README](../README.md).

After running the scaffolder you get a `src/common` folder, `AppConfigModule`
and `HashingModule` registered in `app.module.ts`, and `main.ts` wired up. The
sections below explain how to use each piece — and the conventions you must
follow so the abstractions actually work.

## Table of contents

- [Project structure](#project-structure)
- [Configuration & environment](#configuration--environment)
- [Validation pipe](#validation-pipe)
- [Response shape (TransformInterceptor)](#response-shape-transforminterceptor)
- [Pagination](#pagination)
- [Logging (LoggerInterceptor)](#logging-loggerinterceptor)
- [Authentication & roles](#authentication--roles)
- [Password hashing](#password-hashing)
- [Error filters](#error-filters)
- [Helpers](#helpers)
- [Conventions checklist](#conventions-checklist)

## Project structure

```
src/
  common/
    config/         AppConfigModule, baseEnvSchema
    decorators/     CurrentUser, Roles
    dto/            PaginationDto
    filters/        GlobalExceptionFilter, PrismaExceptionFilter
    guards/         JwtAuthGuard, RolesGuard
    hashing/        HashingModule, HashingService
    helpers/        buildErrorResponse, paginate
    interceptors/   LoggerInterceptor, TransformInterceptor
    pipes/          createValidationPipe
  app.module.ts     AppConfigModule.forProject() + HashingModule registered
  main.ts           CORS, global pipes/interceptors/filters, Swagger
```

> Keep the `src/common` path and the explicit `.js` import extensions intact.
> Every generated file imports its siblings with `.js` so the code compiles
> and runs under both CommonJS and ESM. Do not rename the folder.

## Configuration & environment

`AppConfigModule` wraps `@nestjs/config` with Joi validation built in. It is
already registered in `app.module.ts`, so `ConfigService` is available
everywhere.

### Base schema

`baseEnvSchema` validates the variables every project needs:

| Variable | Rule |
|---|---|
| `DATABASE_URL` | required string |
| `PORT` | number, defaults to `3000` |
| `NODE_ENV` | `development` / `production` / `test`, defaults to `development` |
| `FRONTEND_URL` | string, defaults to `*` |
| `JWT_SECRET` | required string, min 16 chars |
| `JWT_EXPIRES_IN` | string, defaults to `7d` |

If any required variable is missing or invalid, the app fails fast on boot with
a Joi error — you never start with a half-configured environment.

### Adding project-specific variables

Create a module that extends the base schema with your own keys:

```typescript
// src/config/project-config.module.ts
import * as Joi from 'joi';
import { AppConfigModule } from '../common/config/app-config.module.js';

export const ProjectConfigModule = AppConfigModule.forProject(
  Joi.object({
    CLOUDINARY_CLOUD_NAME: Joi.string().required(),
    CLOUDINARY_API_KEY: Joi.string().required(),
    CLOUDINARY_API_SECRET: Joi.string().required(),
  }),
);
```

Then register **that** module in `app.module.ts` (the CLI only registers the
default, no-extra-schema version):

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ProjectConfigModule } from './config/project-config.module.js';
import { HashingModule } from './common/hashing/hashing.module.js';

@Module({
  imports: [ProjectConfigModule, HashingModule],
})
export class AppModule {}
```

### Reading values

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  constructor(private readonly config: ConfigService) {}

  cloudName() {
    return this.config.get<string>('CLOUDINARY_CLOUD_NAME');
  }
}
```

The CLI generates/paches `.env.example` (never your real `.env`) and warns you
if `.env` is not in `.gitignore`. Copy the values you need into your own
`.env`.

## Validation pipe

`createValidationPipe()` is wired globally in `main.ts`. It is configured to:

- `whitelist: true` — strip properties without decorators
- `forbidNonWhitelisted: true` — **reject** requests containing unknown fields
- `transform: true` + `enableImplicitConversion: true` — convert `"2"` to `2`
- `stopAtFirstError: true` and a custom `exceptionFactory` that flattens errors
  into `["field: message", ...]`

### Declaring a DTO

Use `class-validator` decorators. Because `whitelist` +
`forbidNonWhitelisted` are on, every incoming field must be declared:

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

```typescript
@Post()
create(@Body() dto: CreateUserDto) {
  return this.usersService.create(dto);
}
```

A bad request automatically produces:

```json
{
  "statusCode": 400,
  "message": ["email: email must be an email"],
  "data": null,
  "error": "BadRequestException",
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

### Overriding per route

`createValidationPipe` accepts overrides if one endpoint needs different rules:

```typescript
@UsePipes(createValidationPipe({ whitelist: false }))
```

## Response shape (TransformInterceptor)

`TransformInterceptor` is global and wraps every successful response so your
frontend only ever handles one shape:

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": { "...": "..." },
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

You usually just `return` your value. Three wrapper classes give you control
when needed — import them from
`../common/interceptors/transform.interceptor.js`:

| Return | Result |
|---|---|
| a plain value | wrapped with `message: "Success"` |
| `new MessageResponse(payload, 'User deleted')` | wrapped with a custom `message` |
| `new RawResponse(payload)` | bypasses wrapping entirely — raw `payload` is sent |
| `new Paginated(items, meta)` | wrapped with an extra `meta` field |
| `StreamableFile` | automatically bypassed (file downloads) |

```typescript
import {
  MessageResponse,
  RawResponse,
} from '../common/interceptors/transform.interceptor.js';

@Delete(':id')
remove(@Param('id') id: string) {
  return new MessageResponse(null, 'User deleted successfully');
}

@Get('health')
health() {
  return new RawResponse({ ok: true });
}
```

## Pagination

Two pieces work together: the `PaginationDto` query contract and the
`Paginated` wrapper.

`PaginationDto` exposes `page` (default 1), `limit` (default 20, max 100) and a
computed `skip` getter. It relies on the global validation pipe's
`enableImplicitConversion` to cast the query strings to numbers.

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { Paginated } from '../common/interceptors/transform.interceptor.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(@Query() pagination: PaginationDto) {
    const [data, total] = await this.usersService.findAll(pagination);
    return new Paginated(data, {
      page: pagination.page,
      limit: pagination.limit,
      total,
    });
  }
}
```

Request `GET /users?page=2&limit=10` returns:

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": [ "..." ],
  "meta": { "page": 2, "limit": 10, "total": 42 },
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

Use `pagination.skip` for the database offset (see
[Helpers](#helpers)).

## Logging (LoggerInterceptor)

`LoggerInterceptor` is global and needs no configuration. It logs:

```
--> GET /users
<-- GET /users 200 +12ms
<-x GET /users 404 +5ms — Not Found (ip: 127.0.0.1)
```

Nothing to wire up — it just works once `main.ts` is generated.

## Authentication & roles

The package ships two guards and two decorators. They assume you have a
Passport **`jwt`** strategy in your project (`@nestjs/passport` is installed
for you).

### Guards

- **`JwtAuthGuard`** extends `AuthGuard('jwt')` — rejects requests without a
  valid token and populates `request.user`.
- **`RolesGuard`** reads the roles metadata and compares them against
  `request.user.role` (a **single string**).

### Decorators

- **`@Roles('ADMIN')`** — marks the roles allowed to access a handler.
- **`@CurrentUser()`** — injects `request.user` (or a property when passed a
  key, e.g. `@CurrentUser('id')`).

### Usage

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('users')
export class UsersController {
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return user;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  findAll() {
    return this.usersService.findAll();
  }
}
```

> **Order matters.** Always put `JwtAuthGuard` **before** `RolesGuard` — the
> roles check needs `request.user`, which only exists after JWT auth runs.
>
> **Single role only.** `RolesGuard` checks `user.role` as a string. If your
> users hold multiple roles (an array), copy and extend the guard in your
> project.

### Providing the `'jwt'` strategy

The guards only work if you register a Passport strategy named `'jwt'` that
puts the user on `request.user`. A minimal one, wired to the variables that
`baseEnvSchema` already validates:

```typescript
// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { HashingService } from '../../common/hashing/hashing.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly hashing: HashingService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  // Whatever you return here becomes `request.user` — and `request.user.role`
  // is what RolesGuard reads, so keep a `role` property on it.
  async validate(payload: { sub: string; role: string }) {
    return { id: payload.sub, role: payload.role };
  }
}
```

Register it in `auth.module.ts` (`PassportModule.register({ defaultStrategy: 'jwt' })`,
providers: `[JwtStrategy]`). `JWT_EXPIRES_IN` from your env drives the expiry
when you sign the token, so `@CurrentUser()` and `@Roles()` both line up with
the strategy above.

## Password hashing

`HashingService` (from the global `HashingModule`) hashes passwords with
Node's native `scrypt` — no external hashing dependency. Inject it anywhere:

```typescript
import { Injectable } from '@nestjs/common';
import { HashingService } from '../common/hashing/hashing.service.js';

@Injectable()
export class AuthService {
  constructor(private readonly hashing: HashingService) {}

  async register(email: string, password: string) {
    const passwordHash = this.hashing.hash(password);
    // store passwordHash in the database
  }

  async validate(password: string, storedHash: string) {
    return this.hashing.verify(password, storedHash);
  }
}
```

`hash()` returns a self-contained `salt:derivedKey` string — the salt is
embedded, so you never store it in a separate column. `verify()` uses a
timing-safe comparison.

## Error filters

Two global filters standardize error responses.

### GlobalExceptionFilter

Catches everything. `HttpException`s become their real status code; any other
`Error` becomes `500` and is logged with its stack trace. The response shape
matches the success shape:

```json
{
  "statusCode": 404,
  "message": "Not Found",
  "data": null,
  "error": "NotFoundException",
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

Just throw Nest exceptions as usual:

```typescript
throw new NotFoundException('User not found');
```

### PrismaExceptionFilter

Only copied when Prisma is detected (`prisma/schema.prisma` or
`@prisma/client`). It maps common Prisma error codes to HTTP responses:

| Prisma code | HTTP | Message |
|---|---|---|
| `P2002` | 409 | Data already exists (duplicate) |
| `P2025` | 404 | Data not found |
| `P2003` | 400 | Invalid data relation |
| `P2014` | 400 | Data is still referenced by other records |

If you set up Prisma **after** scaffolding, re-run the CLI to get the filter.

> Error messages are hardcoded in English. To support another language,
> override the messages in these filters in your own project.

## Helpers

Pure functions — no dependency injection, import and call directly.

### `paginate`

Builds a paginated result object from a data array and a total count:

```typescript
import { paginate } from '../common/helpers/paginate.helper.js';

const [rows, total] = await this.prisma.user.findManyAndCount({
  skip: pagination.skip,
  take: pagination.limit,
});

return paginate(rows, total, pagination.page, pagination.limit);
```

### `buildErrorResponse`

Builds the standard error envelope — handy inside custom filters or middleware:

```typescript
import { buildErrorResponse } from '../common/helpers/error-response.helper.js';

response.status(403).json(
  buildErrorResponse(403, 'Access denied', 'ForbiddenException'),
);
```

## Conventions checklist

Follow these and everything above works out of the box:

- [ ] Keep `src/common/...` paths and the explicit `.js` import extensions.
- [ ] Keep `const app = await NestFactory.create(AppModule);` in `main.ts` and
      an `imports: [...]` array in `app.module.ts` (auto-wiring depends on
      them).
- [ ] Add project-specific env vars via `AppConfigModule.forProject(schema)`
      and register that module manually.
- [ ] Always order guards `@UseGuards(JwtAuthGuard, RolesGuard)`.
- [ ] Treat `user.role` as a single string (extend `RolesGuard` for arrays).
- [ ] Declare every DTO field — unknown fields are rejected.
- [ ] Use `new Paginated(...)` for lists and the wrapper classes for custom
      responses.
- [ ] Never commit `.env`; use `.env.example` as the template.