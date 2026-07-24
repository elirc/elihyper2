const pino = require('pino');
const pinoHttp = require('pino-http');
const { randomUUID } = require('node:crypto');

function createLogger({ level = 'info', pretty = false } = {}) {
  return pino({
    level,
    transport: pretty
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  });
}

// Assigns a request id (honouring an inbound X-Request-Id), echoes it on the
// response, and logs one line per completed request.
function createRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const existing = req.headers['x-request-id'];
      const id = typeof existing === 'string' && existing.length <= 200
        ? existing
        : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // originalUrl, not url: mounting middleware on a path strips that prefix
    // from req.url, so a rate-limited /get-signed-url would log as "GET /".
    customSuccessMessage(req, res) {
      return `${req.method} ${req.originalUrl ?? req.url} ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `${req.method} ${req.originalUrl ?? req.url} ${res.statusCode} ${err.message}`;
    },
    // Health checks would otherwise dominate the log in any deployed setting.
    autoLogging: { ignore: (req) => (req.originalUrl ?? req.url) === '/health' },
  });
}

module.exports = { createLogger, createRequestLogger };
