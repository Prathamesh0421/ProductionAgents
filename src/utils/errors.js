export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigurationError extends AppError {
  constructor(message) {
    super(message, 500, 'CONFIG_ERROR');
  }
}

export class ExternalServiceError extends AppError {
  constructor(serviceName, message, originalError = null) {
    super(
      `${serviceName} error: ${message}`, 
      502, 
      'EXTERNAL_SERVICE_ERROR'
    );
    this.serviceName = serviceName;
    this.originalError = originalError;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}
