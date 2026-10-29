export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details, "BAD_REQUEST");
export const unauthorized = (msg = "Please sign in to continue") => new HttpError(401, msg, undefined, "UNAUTHORIZED");
export const forbidden = (msg = "You do not have permission to perform this action") => new HttpError(403, msg, undefined, "FORBIDDEN");
export const notFound = (msg = "Record not found") => new HttpError(404, msg, undefined, "NOT_FOUND");
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details, "CONFLICT");
