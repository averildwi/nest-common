# Changelog

All notable changes to `@averildwi/nest-common` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.1.1] - 2026-11-13

### Changed

- README: add `@averildwi/nest-cloudinary` to the recommended setup order.

## [3.1.0] - 2026-11-12

### Added

- Monorepo and Turborepo support: workspace detection, automatic app
  selection, and an explicit error instead of guessing when several NestJS
  apps exist.
- CLI flags `--cwd` and `--app` to select a workspace package, plus
  `--swagger`/`--no-swagger`, `--no-lint`, and explicit `--install`.
- Workspace-aware dependency installation:
  `npm install --workspace`, `pnpm --filter add`, `yarn workspace add`, and
  plain `bun add` in the app directory.
- Workspace-aware lint runs through the detected package manager.
- Hoisted `@nestjs/common` / `@nestjs/config` detection and pnpm `catalog:` /
  `catalog:<name>` resolution from `pnpm-workspace.yaml`.
- Turbo hint at the end of the run; `turbo.json` is never modified.
- `docs/monorepo.md` (workspace contract) and `docs/release.md`
  (release checklist).
- Tests for workspace resolution, CLI parsing, package-manager commands,
  install ordering, version detection, and published package metadata.

### Changed

- Dependencies are installed **before** any project file is written. A failed
  install now leaves the project untouched and reports the exact command.
- `@nestjs/swagger` is installed only when Swagger is enabled.
- Yarn PnP is rejected with an explicit message instead of failing later.
- Version detection walks up from the app directory so hoisted packages are
  found in a workspace.

### Fixed

- A workspace root that is itself the NestJS app is no longer treated as a
  workspace member, so it gets a plain root install instead of
  `--workspace <root-package>`.

## [3.0.0]

### Added

- Typed roles, pagination helpers, CORS and throttler wiring in `main.ts` and
  `app.module.ts`.

### Changed

- Modular CLI architecture (`src/cli.js`, `src/runner.js`, `src/steps/*`,
  `src/transforms/*`) with a plan preview before any change is applied.

## [1.0.7]

### Fixed

- Support the `prisma-client` generator output when rewriting the
  `PrismaExceptionFilter` import.
- Skip the Prisma filter when no Prisma project is detected.
- Adapt `validationOptions` for `@nestjs/config` v12 (Standard Schema).
- Use ESM-safe `.js` import extensions in generated files.
