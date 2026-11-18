export interface AdminApiError {
  error: string;
  /** Validation issues for 400 responses: dotted path → message. */
  issues?: { path: string; message: string }[];
  /** Current version for 409 optimistic-concurrency conflicts. */
  version?: number;
}
