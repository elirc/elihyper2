// In-process request metrics.
//
// Counters and a bounded latency reservoir per route. Deliberately not
// Prometheus, OpenTelemetry, or a time-series database: a JSON endpoint and a
// page that polls it is the right size for this app, and the story that
// outgrows it can bring the dependency with it.
//
// Everything here is per-process and resets on restart. That limitation is
// real and is reported in the payload rather than hidden.

const DEFAULT_RESERVOIR = 1000;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  // Nearest-rank. The clamp is what stops p100 indexing past the end - the
  // classic off-by-one in this function.
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

function createMetrics({ reservoirSize = DEFAULT_RESERVOIR, now = () => Date.now() } = {}) {
  const startedAt = now();
  const routes = new Map();

  function bucket(route) {
    if (!routes.has(route)) {
      routes.set(route, {
        requests: 0,
        errors: 0,
        byStatus: {},
        // Ring buffer: keeping every duration since boot is a memory leak
        // with extra steps, and 1000 numbers sort in microseconds on read.
        durations: new Array(reservoirSize),
        count: 0,
        cursor: 0,
      });
    }
    return routes.get(route);
  }

  function record({ route, statusCode, durationMs }) {
    const entry = bucket(route);
    entry.requests += 1;
    if (statusCode >= 400) entry.errors += 1;
    entry.byStatus[statusCode] = (entry.byStatus[statusCode] ?? 0) + 1;

    entry.durations[entry.cursor] = durationMs;
    entry.cursor = (entry.cursor + 1) % reservoirSize;
    entry.count = Math.min(entry.count + 1, reservoirSize);
  }

  function summarise(entry) {
    const sorted = entry.durations.slice(0, entry.count).sort((a, b) => a - b);
    return {
      requests: entry.requests,
      errors: entry.errors,
      errorRate: entry.requests === 0 ? 0 : Math.round((entry.errors / entry.requests) * 1000) / 1000,
      byStatus: { ...entry.byStatus },
      latencyMs: {
        sampled: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.length ? sorted[sorted.length - 1] : 0,
      },
    };
  }

  function snapshot() {
    const byRoute = {};
    let totalRequests = 0;
    let totalErrors = 0;

    for (const [route, entry] of routes) {
      byRoute[route] = summarise(entry);
      totalRequests += entry.requests;
      totalErrors += entry.errors;
    }

    return {
      scope: 'process',
      note: 'In-memory and per-process: these reset on restart, and a second instance keeps its own.',
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      totals: {
        requests: totalRequests,
        errors: totalErrors,
        errorRate: totalRequests === 0 ? 0 : Math.round((totalErrors / totalRequests) * 1000) / 1000,
      },
      routes: byRoute,
    };
  }

  function reset() {
    routes.clear();
  }

  return { record, snapshot, reset, percentile };
}

module.exports = { createMetrics, percentile };
