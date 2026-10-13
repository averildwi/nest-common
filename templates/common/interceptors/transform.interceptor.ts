import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { PaginationMeta } from '../helpers/paginate.helper.js';

export type { PaginationMeta } from '../helpers/paginate.helper.js';

export interface StandardResponse<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

export interface PaginatedResponse<T> extends StandardResponse<T[]> {
  meta: PaginationMeta;
}

/**
 * Return this from a controller for a list with `meta`.
 * The service returns paginate(...); the controller wraps it:
 *   return new Paginated(result.data, result.meta);
 */
export class Paginated<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMeta,
  ) {}
}

/**
 * Return this to skip the envelope entirely. Only for bodies a third party
 * dictates (for example a payment webhook acknowledgement), never for normal
 * endpoints. StreamableFile is passed through automatically.
 */
export class RawResponse<T> {
  constructor(public readonly payload: T) {}
}

/**
 * Return this for a custom success message while keeping the envelope:
 *   return new MessageResponse(team, 'Team created');
 */
export class MessageResponse<T> {
  constructor(
    public readonly payload: T,
    public readonly message: string,
  ) {}
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result: unknown) => {
        // File downloads and explicit opt-outs are not wrapped.
        if (result instanceof StreamableFile) return result;
        if (result instanceof RawResponse) return result.payload as unknown;

        const statusCode = context
          .switchToHttp()
          .getResponse<Response>().statusCode;
        const timestamp = new Date().toISOString();

        if (result instanceof Paginated) {
          const body: PaginatedResponse<unknown> = {
            statusCode,
            message: 'Success',
            data: result.data as unknown[],
            meta: result.meta,
            timestamp,
          };
          return body;
        }

        if (result instanceof MessageResponse) {
          const body: StandardResponse<unknown> = {
            statusCode,
            message: result.message,
            data: result.payload as unknown,
            timestamp,
          };
          return body;
        }

        const body: StandardResponse<unknown> = {
          statusCode,
          message: 'Success',
          data: result,
          timestamp,
        };
        return body;
      }),
    );
  }
}
