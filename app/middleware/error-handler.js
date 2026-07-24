const { HttpError } = require('../lib/errors');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found', path: req.path });
}

// The single place any error becomes a response. Handlers throw; nothing else
// calls res.status(500).
//
// Must take four arguments or Express will not treat it as an error handler,
// and must be registered after every route.
function errorHandler(err, req, res, next) {
  const status = err instanceof HttpError ? err.status : 500;
  const expose = err instanceof HttpError ? err.expose : false;

  req.log?.[status >= 500 ? 'error' : 'warn']?.({ err }, err.message);

  // Once /speak has started writing audio the headers are already out, so
  // there is no response left to shape - just drop the connection.
  if (res.headersSent) {
    return res.destroy();
  }

  res.status(status).json({
    error: expose ? err.message : 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
    requestId: req.id,
  });
}

module.exports = { notFound, errorHandler };
