const { DescribeVoicesCommand } = require('@aws-sdk/client-polly');

// Polly's voice catalogue changes rarely and every lookup is a billable API
// call, so it is fetched once and held for a day.
//
// The important field is SupportedEngines: not every voice works on every
// engine, and asking for a generative-only voice on the standard engine is an
// error. The UI drives its engine picker from this list rather than hardcoding.

function createVoiceCatalogue({ polly, ttlMs = 24 * 60 * 60 * 1000 }) {
  let cached = null;
  let fetchedAt = 0;
  let inFlight = null;

  function toVoice(voice) {
    return {
      id: voice.Id,
      name: voice.Name,
      languageCode: voice.LanguageCode,
      languageName: voice.LanguageName,
      gender: voice.Gender,
      supportedEngines: voice.SupportedEngines ?? [],
    };
  }

  async function list() {
    const fresh = cached && Date.now() - fetchedAt < ttlMs;
    if (fresh) return cached;
    // Collapse concurrent misses into a single upstream call.
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const voices = [];
      let nextToken;
      do {
        const response = await polly.send(
          new DescribeVoicesCommand({
            IncludeAdditionalLanguageCodes: true,
            NextToken: nextToken,
          })
        );
        voices.push(...(response.Voices ?? []).map(toVoice));
        nextToken = response.NextToken;
      } while (nextToken);

      voices.sort(
        (a, b) =>
          a.languageName?.localeCompare(b.languageName ?? '') ||
          a.name?.localeCompare(b.name ?? '')
      );

      cached = voices;
      fetchedAt = Date.now();
      inFlight = null;
      return voices;
    })().catch((err) => {
      inFlight = null;
      throw err;
    });

    return inFlight;
  }

  async function find(voiceId) {
    const voices = await list();
    return voices.find((v) => v.id === voiceId);
  }

  async function engines() {
    const voices = await list();
    return [...new Set(voices.flatMap((v) => v.supportedEngines))].sort();
  }

  return { list, find, engines };
}

module.exports = { createVoiceCatalogue };
