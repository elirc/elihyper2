const express = require('express');
const { version } = require('../package.json');

// Deliberately makes no AWS calls, so it is safe as a load-balancer probe and
// cannot itself cost money or fail because of an upstream outage.
function createHealthRouter({ config, audioCache, pricing }) {
  const router = express.Router();
  const startedAt = Date.now();

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version,
      region: config.region,
      model: config.claudeModelId,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      cache: audioCache ? audioCache.stats() : { enabled: false },
      tokens: pricing ? pricing.cumulative() : null,
    });
  });

  return router;
}

module.exports = { createHealthRouter };
