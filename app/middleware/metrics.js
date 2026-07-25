// Records on 'finish' rather than inline, so the status code and duration are
// final by the time they are read. Registered early enough to see every
// request, including ones a later middleware rejects.

function createMetricsMiddleware(metrics) {
  return function collect(req, res, next) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

      // req.route is only populated for matched routes, so unmatched paths
      // are grouped rather than creating an unbounded label set - the classic
      // way metrics collection turns into a memory leak.
      const route = req.route?.path ?? (res.statusCode === 404 ? '(unmatched)' : req.path);

      metrics.record({
        route: `${req.method} ${route}`,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });

    next();
  };
}

module.exports = { createMetricsMiddleware };
