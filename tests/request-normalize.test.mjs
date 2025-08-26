import assert from 'node:assert/strict';
import { normalizeGenerateContentArgs } from '../request-normalize.js';

// Ensures config fields are preserved and normalized
{
  const body = normalizeGenerateContentArgs({
    model: 'x',
    contents: [{ role:'user', parts:[{text:'hi'}]}],
    config: { systemInstruction: 'SYS', temperature: 0.9 }
  });
  assert.equal(body?.config?.systemInstruction, 'SYS');
  assert.equal(body?.config?.temperature, 0.9);
  assert.ok(Array.isArray(body.tools));
}

// Accepts snake_case inputs
{
  const body = normalizeGenerateContentArgs({
    model: 'x',
    contents: [{ role:'user', parts:[{text:'hi'}]}],
    system_instruction: 'SYS2',
    generation_config: { temperature: 0.1 }
  });
  assert.equal(body?.config?.systemInstruction, 'SYS2');
  assert.equal(body?.config?.temperature, 0.1);
}

console.log('request-normalize tests passed');
