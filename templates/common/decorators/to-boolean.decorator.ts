import { Transform } from 'class-transformer';

/**
 * Query-string boolean: use @ToBoolean() + @IsBoolean().
 *
 * With enableImplicitConversion, `value` is already Boolean("false") === true
 * when a transform runs, so it reads the raw `obj[key]` instead.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
      const raw = obj[key];
      if (raw === 'true' || raw === true) return true;
      if (raw === 'false' || raw === false) return false;
      // Anything else is left for @IsBoolean() to reject.
      return raw;
    },
  );
}
