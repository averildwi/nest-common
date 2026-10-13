/** `meta` of every paginated response. */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * What a service returns for a list. The controller wraps it:
 *   const result = await this.teamsService.findAll(query);
 *   return new Paginated(result.data, result.meta);
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
