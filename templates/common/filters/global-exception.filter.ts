import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { buildErrorResponse } from '../helpers/error-response.helper.js';

/** Shape Nest uses for the object form of HttpException#getResponse(). */
interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
}

/**
 * Catch-all filter. Register it BEFORE PrismaExceptionFilter:
 *   app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());
 * Nest tries the last registered filter first.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = STATUS_CODES[statusCode] ?? 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      // `error` is the reason phrase ('Unauthorized'), never the class name.
      const reason = STATUS_CODES[statusCode] ?? exception.name;
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        error = reason;
      } else {
        const body = res as HttpExceptionBody;
        message = body.message ?? exception.message;
        error = body.error ?? reason;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error(`Unknown exception thrown: ${String(exception)}`);
    }

    response
      .status(statusCode)
      .json(buildErrorResponse(statusCode, message, error));
  }
}
