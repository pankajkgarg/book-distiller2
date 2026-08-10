import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICING,
  calculateCodexCost,
  parseCodexUsageJsonl,
} from '../scripts/codex-adaptive-map.mjs';

describe('Codex map usage accounting', () => {
  it('parses completed turns and preserves the thread id', () => {
    const events = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-generic' }),
      'non-json warning',
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 200,
          cache_write_input_tokens: 100,
          output_tokens: 50,
          reasoning_output_tokens: 20,
        },
      }),
    ].join('\n');

    expect(parseCodexUsageJsonl(events)).toEqual({
      thread_id: 'thread-generic',
      turns: [{
        input_tokens: 1000,
        cached_input_tokens: 200,
        cache_write_input_tokens: 100,
        output_tokens: 50,
        reasoning_output_tokens: 20,
      }],
    });
  });

  it('prices normal and long-context turns without double-charging reasoning', () => {
    const result = calculateCodexCost([
      {
        input_tokens: 1000,
        cached_input_tokens: 200,
        cache_write_input_tokens: 100,
        output_tokens: 50,
        reasoning_output_tokens: 20,
      },
      {
        input_tokens: 300_000,
        cached_input_tokens: 100_000,
        cache_write_input_tokens: 0,
        output_tokens: 10_000,
        reasoning_output_tokens: 4_000,
      },
    ], DEFAULT_PRICING);

    expect(result.totals).toEqual({
      input_tokens: 301_000,
      cached_input_tokens: 100_200,
      cache_write_input_tokens: 100,
      uncached_input_tokens: 200_700,
      output_tokens: 10_050,
      reasoning_output_tokens: 4_020,
    });
    expect(result.turns[0].long_context_pricing).toBe(false);
    expect(result.turns[1].long_context_pricing).toBe(true);
    expect(result.api_equivalent_usd).toBeCloseTo(2.555725, 8);
  });
});
