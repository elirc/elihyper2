const express = require('express');

const { normaliseMessages, normaliseSystemPrompt } = require('../lib/validate');
const { badRequest } = require('../lib/errors');

// Server-Sent Events framing. Every message must end with a blank line or the
// browser buffers it indefinitely.
function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createClaudeRouter({ claude, config, pricing }) {
  const router = express.Router();

  function readRequest(req) {
    const body = req.body ?? {};

    // Accept a single `message` string as shorthand for a one-turn chat, which
    // keeps the simplest client honest without a second endpoint.
    const raw = Array.isArray(body.messages)
      ? body.messages
      : typeof body.message === 'string'
        ? [{ role: 'user', content: body.message }]
        : body.messages;

    if (raw === undefined) {
      throw badRequest('messages (array) or message (string) is required');
    }

    return {
      messages: normaliseMessages(raw, config.chat),
      system: normaliseSystemPrompt(body.tone, config.chat),
    };
  }

  function wantsStream(req) {
    if (req.query.stream === '1' || req.body?.stream === true) return true;
    return (req.headers.accept ?? '').includes('text/event-stream');
  }

  router.post('/ask-claude', async (req, res) => {
    const { messages, system } = readRequest(req);

    if (!wantsStream(req)) {
      const response = await claude.messages.create({
        model: config.claudeModelId,
        max_tokens: config.claudeMaxTokens,
        output_config: { effort: config.claudeEffort },
        ...(system ? { system } : {}),
        messages,
      });

      // content is an array of blocks; find the text rather than assuming [0].
      const completion = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      pricing?.record(response.usage);

      return res.json({
        completion,
        stopReason: response.stop_reason,
        model: response.model,
        usage: response.usage,
        // Computed server-side because the rates are configuration and have
        // no business being shipped to the browser.
        cost: pricing?.estimate(response.usage) ?? null,
      });
    }

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const controller = new AbortController();
    // If the tab closes mid-answer, stop paying for tokens nobody will read.
    res.on('close', () => controller.abort());

    try {
      const stream = claude.messages.stream(
        {
          model: config.claudeModelId,
          max_tokens: config.claudeMaxTokensStreaming,
          output_config: { effort: config.claudeEffort },
          ...(system ? { system } : {}),
          messages,
        },
        { signal: controller.signal }
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          sse(res, { type: 'delta', text: event.delta.text });
        }
      }

      const final = await stream.finalMessage();
      pricing?.record(final.usage);
      sse(res, {
        type: 'done',
        stopReason: final.stop_reason,
        model: final.model,
        usage: final.usage,
        cost: pricing?.estimate(final.usage) ?? null,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        req.log?.info('client aborted the stream');
      } else {
        req.log?.error({ err }, 'Claude streaming failed');
        sse(res, { type: 'error', message: 'The assistant could not finish that response.' });
      }
    } finally {
      res.end();
    }
  });

  return router;
}

module.exports = { createClaudeRouter };
