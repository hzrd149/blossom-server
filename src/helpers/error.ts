import * as HttpErrors from "http-errors";

export function isHttpError(error: unknown): error is HttpErrors.HttpError {
  // @ts-expect-error
  return error instanceof HttpErrors.HttpError || (!!error && !!error.status);
}
