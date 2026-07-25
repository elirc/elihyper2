// Token accounting and cost estimation.
//
// Rates are configuration, never constants in this file. Bedrock is
// partner-operated and AWS sets its own prices, which differ from Anthropic's
// first-party rate card and vary by region. Baking a number in here and
// presenting it as fact would be confidently wrong, which is worse than
// showing nothing - so rates default to 0, meaning "not configured", and the
// UI says the estimate is unavailable rather than showing $0.00.

const MILLION = 1_000_000;

function createPricing(rates = {}) {
  const inputPerMillion = Number(rates.inputPerMillion) || 0;
  const outputPerMillion = Number(rates.outputPerMillion) || 0;
  // Falls back to the input rate rather than to zero: a cached token still
  // costs something, and zero would understate every cached turn.
  const cachedInputPerMillion =
    Number(rates.cachedInputPerMillion) || inputPerMillion;

  const configured = inputPerMillion > 0 || outputPerMillion > 0;

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    requests: 0,
  };

  function normalise(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const cachedRead = Number(usage.cache_read_input_tokens) || 0;
    return {
      // cache_creation is billed as ordinary input on write, so it is counted
      // with input rather than at the cached-read rate.
      inputTokens:
        (Number(usage.input_tokens) || 0) +
        (Number(usage.cache_creation_input_tokens) || 0),
      outputTokens: Number(usage.output_tokens) || 0,
      cachedInputTokens: cachedRead,
    };
  }

  function estimate(usage) {
    const counts = normalise(usage);
    if (!counts) return null;
    if (!configured) return { ...counts, currency: 'USD', amount: null, configured: false };

    const amount =
      (counts.inputTokens * inputPerMillion +
        counts.outputTokens * outputPerMillion +
        counts.cachedInputTokens * cachedInputPerMillion) /
      MILLION;

    return {
      ...counts,
      currency: 'USD',
      // Rounded to six places: a single short turn can genuinely cost less
      // than a cent, and rounding to 2 would display every one of them as 0.
      amount: Math.round(amount * 1e6) / 1e6,
      configured: true,
    };
  }

  // Process-lifetime totals. In-memory and per-process by design: a restart
  // resets them, and a second instance keeps its own. Documented rather than
  // solved, because solving it means a datastore this app does not need.
  function record(usage) {
    const counts = normalise(usage);
    if (!counts) return;
    totals.inputTokens += counts.inputTokens;
    totals.outputTokens += counts.outputTokens;
    totals.cachedInputTokens += counts.cachedInputTokens;
    totals.requests += 1;
  }

  function cumulative() {
    return {
      ...totals,
      estimatedCost: configured
        ? estimate({
            input_tokens: totals.inputTokens,
            output_tokens: totals.outputTokens,
            cache_read_input_tokens: totals.cachedInputTokens,
          }).amount
        : null,
      ratesConfigured: configured,
    };
  }

  return { estimate, record, cumulative, configured };
}

module.exports = { createPricing };
