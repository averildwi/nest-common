import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const { method, originalUrl, ip } = http.getRequest<Request>();
    const start = Date.now();

    this.logger.log(`--> ${method} ${originalUrl}`);

    return next.handle().pipe(
      tap(() => {
        const { statusCode } = http.getResponse<Response>();
        this.logger.log(
          `<-- ${method} ${originalUrl} ${statusCode} +${Date.now() - start}ms`,
        );
      }),
      catchError((err: unknown) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        const reason = err instanceof Error ? err.message : 'Unknown error';
        this.logger.warn(
          `<-x ${method} ${originalUrl} ${status} +${Date.now() - start}ms - ${reason} (ip: ${ip ?? 'unknown'})`,
        );
        return throwError(() => err);
      }),
    );
  }
}
