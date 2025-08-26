import assert from 'node:assert/strict';
import { normalizeGenerateContentArgs } from '../request-normalize.js';

// Lifts config fields
{
  const body = normalizeGenerateContentArgs({
    model: 'x',
    contents: [{ role:'user', parts:[{text:'hi'}]}],
    config: { systemInstruction: 'SYS', generationConfig: { temperature: 0.9 } }
  });
  assert.equal(body.systemInstruction, 'SYS');
  assert.equal(body.system_instruction, 'SYS');
  assert.equal(body.generationConfig.temperature, 0.9);
  assert.equal(body.generation_config.temperature, 0.9);
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.config, undefined);
}

// Accepts snake_case inputs
{
  const body = normalizeGenerateContentArgs({
    model: 'x',
    contents: [{ role:'user', parts:[{text:'hi'}]}],
    system_instruction: 'SYS2',
    generation_config: { temperature: 0.1 }
  });
  assert.equal(body.systemInstruction, 'SYS2');
  assert.equal(body.system_instruction, 'SYS2');
  assert.equal(body.generationConfig.temperature, 0.1);
  assert.equal(body.generation_config.temperature, 0.1);
}

console.log('request-normalize tests passed');

