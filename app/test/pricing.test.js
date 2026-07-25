const { test } = require('node:test');
const assert = require('node:assert');

const { createPricing } = require('../lib/pricing');

const RATES = { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5 };

test('an unconfigured price list reports cost as unavailable, not zero', () => {
  // Showing $0.00 would be a confidently wrong number. null means "we do not
  // know", and the UI says so.
  const pricing = createPricing({});
  const result = pricing.estimate({ input_tokens: 1000, output_tokens: 500 });

  assert.strictEqual(pricing.configured, false);
  assert.strictEqual(result.amount, null);
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.inputTokens, 1000);
});

test('cost is computed per million tokens', () => {
  const pricing = createPricing(RATES);
  const result = pricing.estimate({ input_tokens: 1_000_000, output_tokens: 1_000_000 });

  assert.strictEqual(result.amount, 30); // 5 + 25
});

test('cached input is charged at the cached rate', () => {
  const pricing = createPricing(RATES);
  const result = pricing.estimate({
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 1_000_000,
  });

  assert.strictEqual(result.amount, 0.5);
  assert.strictEqual(result.cachedInputTokens, 1_000_000);
});

test('cache creation is billed as ordinary input', () => {
  const pricing = createPricing(RATES);
  const result = pricing.estimate({
    input_tokens: 500_000,
    cache_creation_input_tokens: 500_000,
    output_tokens: 0,
  });

  assert.strictEqual(result.inputTokens, 1_000_000);
  assert.strictEqual(result.amount, 5);
});

test('the cached rate falls back to the input rate when unset', () => {
  // Falling back to zero would silently understate every cached turn.
  const pricing = createPricing({ inputPerMillion: 5, outputPerMillion: 25 });
  const result = pricing.estimate({ cache_read_input_tokens: 1_000_000 });

  assert.strictEqual(result.amount, 5);
});

test('zero tokens cost zero rather than throwing', () => {
  const pricing = createPricing(RATES);
  const result = pricing.estimate({ input_tokens: 0, output_tokens: 0 });

  assert.strictEqual(result.amount, 0);
});

test('a missing usage object yields null rather than a crash', () => {
  const pricing = createPricing(RATES);
  assert.strictEqual(pricing.estimate(undefined), null);
  assert.strictEqual(pricing.estimate(null), null);
});

test('unexpected usage fields are treated as zero, not NaN', () => {
  const pricing = createPricing(RATES);
  const result = pricing.estimate({ input_tokens: 'lots', output_tokens: undefined });

  assert.strictEqual(result.inputTokens, 0);
  assert.strictEqual(result.outputTokens, 0);
  assert.strictEqual(result.amount, 0);
});

test('small amounts keep enough precision to be visible', () => {
  const pricing = createPricing(RATES);
  const result = pricing.estimate({ input_tokens: 100, output_tokens: 50 });

  assert.ok(result.amount > 0, 'a real cost must not round away to zero');
  assert.ok(result.amount < 0.01);
});

test('cumulative totals accumulate across requests', () => {
  const pricing = createPricing(RATES);
  pricing.record({ input_tokens: 100, output_tokens: 50 });
  pricing.record({ input_tokens: 200, output_tokens: 25, cache_read_input_tokens: 10 });

  const totals = pricing.cumulative();
  assert.strictEqual(totals.requests, 2);
  assert.strictEqual(totals.inputTokens, 300);
  assert.strictEqual(totals.outputTokens, 75);
  assert.strictEqual(totals.cachedInputTokens, 10);
  assert.ok(totals.estimatedCost > 0);
});

test('cumulative reports no cost when rates are unconfigured', () => {
  const pricing = createPricing({});
  pricing.record({ input_tokens: 100, output_tokens: 50 });

  const totals = pricing.cumulative();
  assert.strictEqual(totals.estimatedCost, null);
  assert.strictEqual(totals.ratesConfigured, false);
  assert.strictEqual(totals.inputTokens, 100);
});

test('recording a missing usage object does not increment the request count', () => {
  const pricing = createPricing(RATES);
  pricing.record(null);
  assert.strictEqual(pricing.cumulative().requests, 0);
});
