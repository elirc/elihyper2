// HttpError carries a status code and an `expose` flag. Only exposed messages
// reach the client; everything else becomes a generic 500 so we never leak
// AWS error detail or stack traces.

class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = options.expose ?? status < 500;
    if (options.cause) this.cause = options.cause;
    if (options.details) this.details = options.details;
  }
}

const badRequest = (message, details) =>
  new HttpError(400, message, { expose: true, details });

const tooLarge = (message) => new HttpError(413, message, { expose: true });

const upstream = (message, cause) =>
  new HttpError(502, message, { expose: false, cause });

module.exports = { HttpError, badRequest, tooLarge, upstream };
