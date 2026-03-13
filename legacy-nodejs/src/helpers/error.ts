import HttpErrors from "http-errors";

export function isHttpError(error: unknown): error is HttpErrors.HttpError {
  if (!error) return false;
  // @ts-expect-error
  return error instanceof HttpErrors.HttpError || !!error.status || !!error.headers;
}
