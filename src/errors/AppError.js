class AppError extends Error {
  constructor(message, { code, statusCode, isOperational = true, context = {} } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
  }
}

class ValidationError extends AppError {
  constructor(message, context) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, context });
  }
}

class MemberNotFoundError extends AppError {
  constructor(name, availableMembers) {
    super(`Member '${name}' not found`, {
      code: 'MEMBER_NOT_FOUND',
      statusCode: 404,
      context: { name, availableMembers },
    });
  }
}

class QueryParseError extends AppError {
  constructor(message, context) {
    super(message, { code: 'QUERY_PARSE_ERROR', statusCode: 422, context });
  }
}

class ProviderAuthError extends AppError {
  constructor(provider, context) {
    super(`${provider} authentication failed`, {
      code: `${provider.toUpperCase()}_AUTH_FAILED`,
      statusCode: 502,
      context,
    });
  }
}

class ProviderNotFoundError extends AppError {
  constructor(provider, identity, context) {
    super(`${provider}: user '${identity}' not found`, {
      code: `${provider.toUpperCase()}_USER_NOT_FOUND`,
      statusCode: 502,
      context,
    });
  }
}

class ProviderRateLimitError extends AppError {
  constructor(provider, retryAfter, context) {
    super(`${provider} rate limit exceeded`, {
      code: `${provider.toUpperCase()}_RATE_LIMIT`,
      statusCode: 429,
      context,
    });
    this.retryAfter = retryAfter;
  }
}

class ProviderNetworkError extends AppError {
  constructor(provider, context) {
    super(`${provider} network error`, {
      code: `${provider.toUpperCase()}_NETWORK_ERROR`,
      statusCode: 503,
      context,
    });
  }
}

module.exports = {
  AppError,
  ValidationError,
  MemberNotFoundError,
  QueryParseError,
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderNetworkError,
};
