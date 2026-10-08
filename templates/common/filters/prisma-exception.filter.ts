import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { buildErrorResponse } from '../helpers/error-response.helper.js';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error';

    switch (exception.code) {
      case 'P2002':
        // Unique constraint violation
        status = HttpStatus.CONFLICT;
        message = 'Data already exists (duplicate)';
        break;

      case 'P2025':
        // Record not found
        status = HttpStatus.NOT_FOUND;
        message = 'Data not found';
        break;

      case 'P2003':
        // Foreign key constraint violation
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid data relation';
        break;

      case 'P2014':
        // Relation violation
        status = HttpStatus.BAD_REQUEST;
        message = 'Data is still referenced by other records';
        break;

      default:
        this.logger.error(
          `Unhandled Prisma error: ${exception.code}`,
          exception.message,
        );
    }

    response
      .status(status)
      .json(buildErrorResponse(status, message, exception.code));
  }
}
