class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

AppError.badRequest = (message) => new AppError(message, 400, 'BAD_REQUEST');
AppError.notFound = (message) => new AppError(message, 404, 'NOT_FOUND');
AppError.tooManyRequests = (message) => new AppError(message, 429, 'RATE_LIMITED');
AppError.internal = (message) => new AppError(message, 500, 'INTERNAL_ERROR');

module.exports = { AppError };
