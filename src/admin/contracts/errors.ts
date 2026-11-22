export interface AdminApiError {
  error: string;
  /** Validation issues for 400 responses: dotted path → message. */
  issues?: { path: string; message: string }[];
}
