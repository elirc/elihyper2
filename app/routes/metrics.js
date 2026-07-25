const express = require('express');

// Not rate limited: throttling a monitor is how you lose visibility exactly
// when you need it. It does reveal usage patterns, so it needs protecting
// before any public deployment - see the security note in app/README.md.
function createMetricsRouter({ metrics, audioCache, pricing }) {
  const router = express.Router();

  router.get('/metrics', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ...metrics.snapshot(),
      cache: audioCache ? audioCache.stats() : null,
      tokens: pricing ? pricing.cumulative() : null,
    });
  });

  return router;
}

module.exports = { createMetricsRouter };
