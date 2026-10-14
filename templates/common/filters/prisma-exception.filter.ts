import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../../generated/prisma/client.js';
import { buildErrorResponse } from '../helpers/error-response.helper.js';

const PRISMA_ERROR_MAP: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  // Unique constraint violation
  P2002: { status: HttpStatus.CONFLICT, message: 'Data already exists' },
  // Record not found
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Data not found' },
  // Foreign key constraint violation
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Invalid data relation' },
  // Required relation violation
  P2014: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Data is still referenced by other records',
  },
};

/** `error` in the body is the Prisma code (for example 'P2002'). */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = PRISMA_ERROR_MAP[exception.code];

    if (!mapped) {
      this.logger.error(
        `Unhandled Prisma error: ${exception.code}`,
        exception.message,
      );
    }

    const status = mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    response
      .status(status)
      .json(
        buildErrorResponse(
          status,
          mapped?.message ?? 'Database error',
          exception.code,
        ),
      );
  }
}
