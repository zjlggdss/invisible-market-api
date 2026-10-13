import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI, AIUnavailableError } from '../src/ai.js';

test('Alibaba Cloud client sends images and JSON response settings', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { choices: [{ message: { content: '{"edited":false}' } }] }; } };
  };
  const ai = createAI({ dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    dashscopeKey: 'test-key', visionModel: 'qwen3-vl-plus', textModel: 'qwen-plus' }, fakeFetch);
  assert.deepEqual(await ai.checkImages([{ mime_type: 'image/jpeg', data_base64: 'abcd' }]), { edited: false });
  assert.equal(request.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'qwen3-vl-plus');
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,abcd');
});

test('Alibaba Cloud client fails closed on a malformed model response', async () => {
  const ai = createAI({ dashscopeBaseUrl: 'https://example.com/v1', dashscopeKey: 'x', visionModel: 'm', textModel: 'm' },
    async () => ({ ok: true, async json() { return { choices: [{ message: { content: 'not json' } }] }; } }));
  await assert.rejects(ai.extractProfile('hello'), AIUnavailableError);
});
