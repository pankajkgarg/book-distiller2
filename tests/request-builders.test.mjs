import assert from 'node:assert/strict';
import { buildFirstRequest, buildNextRequest } from '../request-builders.js';

function fakeUploaded(uri='files/abc123', mimeType='application/pdf'){
  return { uri, mimeType };
}

function hasFilePart(userMsg, uri){
  const parts = userMsg?.parts || [];
  const fp = parts.find(p=>p && (p.fileData||p.file_data));
  const got = fp?.fileData?.fileUri || fp?.file_data?.file_uri;
  return got === uri;
}

// Test: first request contains file part and config.systemInstruction
{
  const uploaded = fakeUploaded('files/F1', 'application/pdf');
  const req = buildFirstRequest({ model:'gemini-2.5-pro', uploadedFile: uploaded, prompt: 'SYSTEM', useTemperature: true, temperature: 0.7, firstInstruction: 'Do it' });
  assert.equal(req.model, 'gemini-2.5-pro');
  assert.equal(req?.config?.systemInstruction, 'SYSTEM');
  assert.equal(req.tools.length, 0);
  assert.ok(req?.config && typeof req.config.temperature === 'number');
  assert.ok(Array.isArray(req.contents) && req.contents.length === 1);
  const user = req.contents[0];
  assert.equal(user.role, 'user');
  assert.ok(hasFilePart(user, 'files/F1'));
}

// Test: next request does NOT reattach file by default and appends 'Next'; config.systemInstruction present
{
  const uploaded = fakeUploaded('files/F2', 'application/epub+zip');
  const history = [ { role:'user', parts:[ { fileData:{ fileUri:'files/F2', mimeType:'application/epub+zip' } }, { text:'Start' } ] }, { role:'model', parts:[ { text:'ok' } ] } ];
  const req = buildNextRequest({ model:'gemini-2.5-pro', history, uploadedFile: uploaded, prompt: 'SYSTEM', useTemperature: false });
  assert.equal(req?.config?.systemInstruction, 'SYSTEM');
  assert.ok(!req?.config?.temperature); // default disabled
  assert.ok(Array.isArray(req.contents) && req.contents.length === history.length + 1);
  const nextUser = req.contents[req.contents.length - 1];
  assert.equal(nextUser.role, 'user');
  assert.ok(!hasFilePart(nextUser, 'files/F2'));
  const textPart = nextUser.parts.find(p=>p && p.text !== undefined);
  assert.equal(textPart?.text, 'Next');
}

// Test: next request CAN reattach file when explicitly requested
{
  const uploaded = fakeUploaded('files/F3', 'application/pdf');
  const history = [ { role:'user', parts:[ { fileData:{ fileUri:'files/F3', mimeType:'application/pdf' } }, { text:'Start' } ] }, { role:'model', parts:[ { text:'ok' } ] } ];
  const req = buildNextRequest({ model:'gemini-2.5-pro', history, uploadedFile: uploaded, prompt: 'SYSTEM', reattachFileEachTurn: true });
  const nextUser = req.contents[req.contents.length - 1];
  assert.ok(hasFilePart(nextUser, 'files/F3'));
}

console.log('request-builders tests passed');
