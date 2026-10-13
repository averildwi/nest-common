import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// Same check Prisma uses for @default(cuid()).
const CUID_REGEX = /^c[a-z0-9]{20,32}$/;

/** For projects whose ids are cuid: @Param('id', ParseCuidPipe) id: string */
@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!CUID_REGEX.test(value)) {
      throw new BadRequestException('Validation failed (cuid is expected)');
    }
    return value;
  }
}
