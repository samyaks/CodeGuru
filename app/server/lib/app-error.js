class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
  }
}

AppError.badRequest = (message) => new AppError(message, 400, 'BAD_REQUEST');
AppError.unauthorized = (message) => new AppError(message, 401, 'UNAUTHORIZED');
AppError.forbidden = (message) => new AppError(message, 403, 'FORBIDDEN');
AppError.notFound = (message) => new AppError(message, 404, 'NOT_FOUND');
AppError.conflict = (message) => new AppError(message, 409, 'CONFLICT');
AppError.tooManyRequests = (message) => new AppError(message, 429, 'RATE_LIMITED');
AppError.internal = (message) => new AppError(message, 500, 'INTERNAL_ERROR');

module.exports = { AppError };
