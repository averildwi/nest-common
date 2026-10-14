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
    decorators/     CurrentUser, Roles, ToBoolean
    dto/            PaginationDto
    filters/        GlobalExceptionFilter, PrismaExceptionFilter
    guards/         JwtAuthGuard, RolesGuard
    hashing/        HashingModule, HashingService
    helpers/        buildErrorResponse, paginate
    interceptors/   LoggerInterceptor, TransformInterceptor
    pipes/          createValidationPipe, ParseCuidPipe
    types/          AuthUser, JwtPayload, AuthenticatedRequest, RoleName
  app.module.ts     AppConfigModule.forProject() + HashingModule + ThrottlerModule,
                    global ThrottlerGuard (APP_GUARD)
  main.ts           trust proxy, api prefix, CORS, global pipes/interceptors/filters, Swagger
```

> Keep the `src/common` path. Template files import their siblings with an
> explicit `.js` extension so the code compiles under both CommonJS and ESM.
> Do not rename the folder.

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
| `FRONTEND_URL` | comma-separated allowed origins, defaults to empty (no cross-origin access, never `*`) |
| `JWT_SECRET` | required string, min 32 chars |
| `JWT_EXPIRES_IN` | string, defaults to `7d` |
| `TRUST_PROXY_HOPS` | integer >= 0, defaults to `0`: number of reverse proxies in front of the app |

If any required variable is missing or invalid, the app fails fast on boot with
a Joi error — you never start with a half-configured environment.

### Adding project-specific variables

Define the extra keys in a schema and pass it to the `forProject()` call the
CLI already added. Do not register `AppConfigModule` a second time:

```typescript
// src/config/env.schema.ts
import * as Joi from 'joi';

export const projectEnvSchema = Joi.object({
  CLOUDINARY_URL: Joi.string().uri().required(),
});
```

```typescript
// src/app.module.ts
imports: [
  AppConfigModule.forProject(projectEnvSchema),
  HashingModule,
  // ...
],
```

Add every new variable to `.env.example` too.

### Reading values

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  constructor(private readonly config: ConfigService) {}

  cloudinaryUrl(): string {
    return this.config.getOrThrow<string>('CLOUDINARY_URL');
  }
}
```

Read env with `ConfigService` everywhere except `main.ts` and `PrismaService`.

The CLI generates/patches `.env.example` (never your real `.env`) and warns you
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
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'correct-horse-battery' })
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
  "error": "Bad Request",
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

### Booleans in query strings

With `enableImplicitConversion`, `@IsBoolean()` alone (and
`@Transform(({ value }) => value === 'true')`) turns `?active=false` into
`true`. Use `@ToBoolean()`, which reads the raw value:

```typescript
import { ToBoolean } from '../../common/decorators/to-boolean.decorator.js';

@ApiPropertyOptional({ example: true })
@IsOptional()
@ToBoolean()
@IsBoolean()
isActive?: boolean;
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
| `new Paginated(result.data, result.meta)` | wrapped with an extra `meta` field |
| `new RawResponse(payload)` | no envelope, raw `payload` is sent. **Only** when a third party dictates the body (for example a payment webhook acknowledgement). Never for login, lists or normal endpoints |
| `StreamableFile` | automatically bypassed (file downloads) |

Services return plain data (or `paginate()` results); the controller picks the
wrapper. Services never return `{ message, data }`.

```typescript
import { MessageResponse } from '../common/interceptors/transform.interceptor.js';

@Delete(':id')
async remove(@Param('id', ParseUUIDPipe) id: string) {
  await this.usersService.remove(id);
  return new MessageResponse(null, 'User deleted');
}
```

## Pagination

Three pieces work together: the `PaginationDto` query contract, the
`paginate()` helper in the service, and the `Paginated` wrapper in the
controller.

`PaginationDto` exposes `page` (default 1), `limit` (default 20, max 100) and a
computed `skip` getter. Both fields are always numbers (never `undefined`), so
you can pass them straight on. List DTOs extend it and declare every filter:

```typescript
// src/users/dto/query-user.dto.ts
export class QueryUserDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'ann' })
  @IsOptional()
  @IsString()
  search?: string;
}
```

Service: count and rows in one `$transaction`, explicit `select`:

```typescript
async findAll(query: QueryUserDto): Promise<PaginatedResult<UserListItem>> {
  const where = query.search
    ? { name: { contains: query.search, mode: 'insensitive' as const } }
    : {};
  const [rows, total] = await this.prisma.$transaction([
    this.prisma.user.findMany({
      where,
      select: userListSelect,
      skip: query.skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.user.count({ where }),
  ]);
  return paginate(rows, total, query.page, query.limit);
}
```

Controller:

```typescript
@Get()
async findAll(@Query() query: QueryUserDto) {
  const result = await this.usersService.findAll(query);
  return new Paginated(result.data, result.meta);
}
```

Request `GET /api/users?page=2&limit=10` returns:

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": [ "..." ],
  "meta": { "total": 42, "page": 2, "limit": 10, "totalPages": 5 },
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

Never return the `paginate()` result directly from the controller: the
interceptor would wrap it again into `data: { data, meta }`.

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

- **`JwtAuthGuard`** extends `AuthGuard('jwt')`. It rejects requests without a
  valid token (401) and populates `request.user`.
- **`RolesGuard`** reads the `@Roles(...)` metadata and compares it against
  `request.user.role`:
  - no `@Roles` on the handler or controller: allowed
  - no `request.user` (JWT guard missing or failed): **401** `Authentication required`
  - role not in the list: **403** `You are not allowed to perform this action`

There is no global auth guard. Put the guards on each controller or route.

### Types

`src/common/types/auth-user.ts` holds the one shared shape of `request.user`:

```typescript
export type RoleName = 'ADMIN' | 'USER'; // placeholder, see below
export type UserId = string;             // number for autoincrement ids

export interface AuthUser { id: UserId; email: string; role: RoleName }
export interface JwtPayload { sub: UserId; email: string }
export interface AuthenticatedRequest extends Request { user?: AuthUser }
```

Once your Prisma schema has a role enum, derive `RoleName` from it so a typo in
`@Roles(...)` no longer compiles:

```typescript
import type { Role } from '../../../generated/prisma/client.js';
export type RoleName = Role; // 'ADMIN' | 'STAFF'
```

### Decorators

- **`@Roles('ADMIN')`**: the roles allowed to access a handler, typed as `RoleName[]`.
- **`@CurrentUser()`**: injects `request.user` as `AuthUser`, or one field
  (`@CurrentUser('id') userId: string`).

### Usage

```typescript
import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '[AUTH] Get my profile' })
  getProfile(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: '[ADMIN] Get a user' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }
}
```

> **Order matters.** Always put `JwtAuthGuard` **before** `RolesGuard`: the
> roles check needs `request.user`, which only exists after JWT auth runs.
>
> **Single role only.** `RolesGuard` checks one `user.role`. If your users hold
> multiple roles (an array), copy and extend the guard in your project.

### Route parameters

Every `:id` gets a pipe that matches the id type of your schema:

| Id type | Pipe |
|---|---|
| `uuid()` | `ParseUUIDPipe` (from `@nestjs/common`) |
| `autoincrement()` | `ParseIntPipe` (from `@nestjs/common`) |
| `cuid()` | `ParseCuidPipe` (from `src/common/pipes/parse-cuid.pipe.ts`) |

Without a pipe, a malformed id reaches Prisma and becomes a 500.

### Providing the `'jwt'` strategy

The guards only work if you register a Passport strategy named `'jwt'` that
puts an `AuthUser` on `request.user`. Install `passport-jwt` and
`@nestjs/jwt`, then:

```typescript
// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser, JwtPayload } from '../../common/types/auth-user.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // The return value becomes request.user. Re-load the user so a deleted or
  // deactivated account loses access immediately.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
```

Register it in `auth.module.ts` (`PassportModule`, `JwtModule.registerAsync`
reading `JWT_SECRET` and `JWT_EXPIRES_IN` from `ConfigService`, providers:
`[JwtStrategy]`).

## Rate limiting

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` and a global
`ThrottlerGuard` (`APP_GUARD`) are registered in `app.module.ts`: 100 requests
per minute per client. Tighten auth and OTP endpoints:

```typescript
import { Throttle } from '@nestjs/throttler';

@Post('login')
@HttpCode(HttpStatus.OK)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
async login(@Body() dto: LoginDto) {
  return new MessageResponse(await this.authService.login(dto), 'Login successful');
}
```

The throttler keys on `req.ip`. Behind a reverse proxy set `TRUST_PROXY_HOPS`
to the number of proxies (`1` behind one Nginx), which `main.ts` passes to
`app.set('trust proxy', ...)`:

| `TRUST_PROXY_HOPS` behind one proxy | Result |
|---|---|
| `0` | `req.ip` is the proxy: **all clients share one bucket** |
| `1` | real client IP, correct |
| (`true`, never used) | `X-Forwarded-For` is trusted blindly: clients spoof a new IP per request |

## Password hashing

`HashingService` (from the global `HashingModule`) hashes passwords and OTP
codes with Node's native `scrypt`, asynchronously, so a login never blocks the
event loop. Always `await` it:

```typescript
import { Injectable } from '@nestjs/common';
import { HashingService } from '../common/hashing/hashing.service.js';

@Injectable()
export class AuthService {
  constructor(private readonly hashing: HashingService) {}

  async register(email: string, password: string) {
    const passwordHash = await this.hashing.hash(password);
    // store passwordHash in the database
  }

  async checkPassword(password: string, storedHash: string): Promise<boolean> {
    return this.hashing.verify(password, storedHash);
  }
}
```

`hash()` returns a self-contained `salt:derivedKey` string: the salt is
embedded, so you never store it in a separate column. `verify()` rejects
malformed hashes and compares with `timingSafeEqual`.

## Error filters

Two global filters standardize error responses. `main.ts` registers them in
this order, which matters (Nest tries the **last** registered filter first):

```typescript
app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());
```

### GlobalExceptionFilter

Catches everything. `HttpException`s keep their status code; any other
`Error` becomes `500 Internal server error` and is logged with its stack trace.
`error` is the HTTP reason phrase of the status, never the class name:

```json
{
  "statusCode": 404,
  "message": "User not found",
  "data": null,
  "error": "Not Found",
  "timestamp": "2026-07-15T10:00:00.000Z"
}
```

Just throw Nest exceptions as usual:

```typescript
throw new NotFoundException('User not found');
```

### PrismaExceptionFilter

Only copied when Prisma is detected (`prisma/schema.prisma` or
`@prisma/client`). It imports `Prisma` from `generated/prisma/client` at the
project root (the CLI adjusts the path if your client lives elsewhere) and maps
common error codes. `error` is the Prisma code:

| Prisma code | HTTP | Message |
|---|---|---|
| `P2002` | 409 | Data already exists |
| `P2025` | 404 | Data not found |
| `P2003` | 400 | Invalid data relation |
| `P2014` | 400 | Data is still referenced by other records |

Any other code returns `500 Database error` and is logged.

If you set up Prisma **after** scaffolding, re-run the CLI to get the filter.

> Error messages are hardcoded in English. To support another language,
> override the messages in these filters in your own project.

## Helpers

Pure functions: no dependency injection, import and call directly.

### `paginate`

Builds `{ data, meta: { total, page, limit, totalPages } }` from rows and a
total count. Use it in services (see [Pagination](#pagination)):

```typescript
import { paginate } from '../common/helpers/paginate.helper.js';

const [rows, total] = await this.prisma.$transaction([
  this.prisma.user.findMany({ select: userListSelect, skip: query.skip, take: query.limit }),
  this.prisma.user.count(),
]);

return paginate(rows, total, query.page, query.limit);
```

### `buildErrorResponse`

Builds the standard error envelope, handy inside custom filters or middleware:

```typescript
import { buildErrorResponse } from '../common/helpers/error-response.helper.js';

response.status(403).json(
  buildErrorResponse(403, 'You are not allowed to perform this action', 'Forbidden'),
);
```

## Conventions checklist

Follow these and everything above works out of the box:

- [ ] Keep the `src/common/...` paths.
- [ ] Keep `const app = await NestFactory.create(...)(AppModule);` in `main.ts` and
      an `imports: [...]` array in `app.module.ts` (auto-wiring depends on
      them).
- [ ] Add project-specific env vars by passing a schema to the existing
      `AppConfigModule.forProject(...)` call, and add them to `.env.example`.
- [ ] Always order guards `@UseGuards(JwtAuthGuard, RolesGuard)`, and type the
      user as `AuthUser`.
- [ ] Derive `RoleName` from your Prisma role enum.
- [ ] Every `:id` has `ParseUUIDPipe`, `ParseIntPipe` or `ParseCuidPipe`.
- [ ] Declare every DTO field (unknown fields are rejected). Query booleans use
      `@ToBoolean()`.
- [ ] Services return `paginate(...)`; controllers return `new Paginated(result.data, result.meta)`.
- [ ] `await` every `HashingService` call.
- [ ] Never commit `.env`; use `.env.example` as the template.
