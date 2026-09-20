import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { serveMcp, MCP_FRAME_BYTES } from './mcp-transport.js';

async function exchange(chunks) {
  const calls = [], replies = [];
  const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { replies.push(JSON.parse(chunk)); setImmediate(done); } });
  await serveMcp(async message => { calls.push(message); return { jsonrpc: '2.0', id: message.id, result: {} }; }, {
    input: Readable.from(chunks.map(chunk => Buffer.from(chunk))), output,
  });
  return { calls, replies };
}
const frame = (id, data = '') => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { data } }) + '\n';
test('review-sized frames and several frames in one read retain every request', async () => {
  const data = 'x'.repeat(256_000), input = frame(1, data) + frame(2, data) + frame(3);
  const result = await exchange([input]);
  assert.deepEqual(result.calls.map(call => call.id), [1, 2, 3]);
  assert.deepEqual(result.replies.map(reply => reply.id), [1, 2, 3]);
});
test('an oversized frame returns one bounded error and leaves the connection usable', async () => {
  for (const chunks of [[frame(1, 'x'.repeat(MCP_FRAME_BYTES)) + frame(2)],
    [frame(1).slice(0, -1), 'x'.repeat(MCP_FRAME_BYTES), '\n', frame(2)]]) {
    const result = await exchange(chunks);
    assert.equal(result.replies[0].error.code, -32600);
    assert.deepEqual(result.calls.map(call => call.id), [2]);
    assert.equal(result.replies[1].id, 2);
  }
});
test('UTF-8 byte bounds, malformed JSON and incomplete EOF receive structured errors', async () => {
  const result = await exchange([frame(1, 'ก'.repeat(MCP_FRAME_BYTES / 2)), 'bad\n', frame(2), '{']);
  assert.deepEqual(result.replies.map(reply => reply.error?.code ?? reply.id), [-32600, -32700, 2, -32700]);
  const ended = await exchange(['x'.repeat(MCP_FRAME_BYTES + 1)]);
  assert.equal(ended.replies.length, 1); assert.equal(ended.replies[0].error.code, -32600);
});
