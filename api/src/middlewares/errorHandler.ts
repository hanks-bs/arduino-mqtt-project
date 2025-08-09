import { NextFunction, Request, Response } from 'express';

import { CustomError } from 'App/errors/CustomError';
// --------------------------------------------------------------

/**
 * Global error handling middleware for Express applications.
 * Captures errors thrown in routes and middleware, logs them,
 * and sends a standardized error response to the client.
 *
 * @param err - The error object thrown.
 * @param req - The Express Request object.
 * @param res - The Express Response object.
 * @param next - The next middleware function in the stack.
 */
function errorHandler(
  err: CustomError | Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  /**
   * Determine the HTTP status code, error code, message, and details.
   * If the error is an instance of CustomError, use its properties.
   * Otherwise, default to a 500 Internal Server Error.
   */
  const statusCode: number = err instanceof CustomError ? err.statusCode : 500;
  const code: string =
    err instanceof CustomError ? err.code : 'INTERNAL_SERVER_ERROR';
  const message: string =
    err instanceof CustomError ? err.message : 'An unexpected error occurred';
  const details: any = err instanceof CustomError ? err.details : undefined;

  /**
   * Log the error details using the configured logger.
   * Includes useful information for debugging and tracing issues.
   */
  console.error('Error occurred', {
    statusCode,
    code,
    message: err.message,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    stack: err.stack,
  });

  /**
   * Send a standardized error response to the client.
   * The response includes the error code, message, and optional details.
   */
  res.status(statusCode).json({
    code,
    message,
    details,
  });
}

export default errorHandler;
