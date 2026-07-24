const rateLimit = require('express-rate-limit');

// A speed bump, not authentication. /get-signed-url in particular hands out
// direct AWS access, so it gets the tightest budget.
//
// If this ever runs behind a proxy, set TRUST_PROXY=true or every caller will
// appear to share the proxy's IP and therefore one bucket.
function createLimiter({ config, max }) {
  if (!config.rateLimit.enabled) {
    return (req, res, next) => next();
  }

  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      const retryAfter = Math.ceil(config.rateLimit.windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests', retryAfter });
    },
  });
}

module.exports = { createLimiter };
