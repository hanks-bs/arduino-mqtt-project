import { validationErrorType } from 'App/types/errorType';

export class CustomError extends Error {
  public code: string;
  public statusCode: number;
  public details?: validationErrorType[];

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: validationErrorType[],
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype); // Restore prototype chain
  }
}

export class NotFoundError extends CustomError {
  constructor(message: string = 'Resource not found') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends CustomError {
  constructor(
    message: string = 'Validation error',
    details?: validationErrorType[],
  ) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class UnauthorizedError extends CustomError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends CustomError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class ConflictError extends CustomError {
  constructor(message: string = 'Conflict') {
    super(message, 'CONFLICT', 409);
  }
}

export class BadRequestError extends CustomError {
  constructor(message: string = 'Bad request') {
    super(message, 'BAD_REQUEST', 400);
  }
}

export class InternalServerError extends CustomError {
  constructor(message: string = 'Internal server error') {
    super(message, 'INTERNAL_SERVER_ERROR', 500);
  }
}

export class DatabaseError extends CustomError {
  constructor(message: string = 'Database error') {
    super(message, 'DATABASE_ERROR', 500);
  }
}

/**
 * Creates a custom error with a specified code and message.
 * @param code - Error code.
 * @param message - Error message.
 * @param statusCode - HTTP status code.
 * @returns Custom error instance.
 */
export function createCustomError(
  code: string,
  message: string,
  statusCode: number,
): CustomError {
  return new CustomError(message, code, statusCode);
}
