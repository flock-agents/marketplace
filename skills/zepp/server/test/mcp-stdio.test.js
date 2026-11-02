import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  coerceArguments,
  createMessageHandler,
} from '../src/mcp-stdio.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'zepp-mcp.js');

/** Write every message (string lines or objects), close stdin, collect output. */
function exchange(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN], {
      env: { ...process.env, ZEPP_EMAIL: '', ZEPP_PASSWORD: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const responses = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      resolve({ code, responses, stderr });
    });
    for (const message of messages) {
      child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
    }
    child.stdin.end();
  });
}

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params && { params }) });
const byId = (responses) => new Map(responses.map((response) => [response.id, response]));

describe('zepp-mcp over stdio', () => {
  it('answers the handshake, tools/list, ping and errors, then exits cleanly', async () => {
    const { code, responses, stderr } = await exchange([
      request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      }),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      request(2, 'tools/list'),
      request(3, 'ping'),
      request(4, 'resources/list'),
      '{not json',
      request(5, 'tools/call', { arguments: {} }),
      request(6, 'tools/call', { name: 'zepp_auth_status', arguments: {} }),
    ]);

    assert.equal(code, 0, stderr);
    assert.equal(responses.length, 7, 'notifications get no reply');
    const replies = byId(responses);

    const init = replies.get(1).result;
    assert.equal(init.protocolVersion, '2025-06-18');
    assert.deepEqual(init.capabilities, { tools: {} });
    assert.deepEqual(init.serverInfo, { name: 'zepp', version: '1.0.0' });
    assert.match(init.instructions, /no_data/);

    const names = replies.get(2).result.tools.map((tool) => tool.name);
    assert.equal(names.length, 10);
    assert.ok(names.includes('zepp_workout_detail'));

    assert.deepEqual(replies.get(3).result, {});
    assert.equal(replies.get(4).error.code, ErrorCode.METHOD_NOT_FOUND);
    assert.equal(replies.get(null).error.code, ErrorCode.PARSE_ERROR);
    assert.equal(replies.get(5).error.code, ErrorCode.INVALID_PARAMS);

    // No credentials in the environment: the tool reports it as a status
    // dict (the Python `_fail` shape), not a protocol error.
    const auth = replies.get(6).result;
    assert.equal(auth.isError, false);
    assert.equal(auth.structuredContent.status, 'error');
    assert.match(auth.structuredContent.error, /ZEPP_EMAIL and ZEPP_PASSWORD are not set/);
    assert.equal(auth.content[0].text, JSON.stringify(auth.structuredContent, null, 2));
  });

  it('falls back to its latest protocol version for an unknown one', async () => {
    const { responses } = await exchange([request(1, 'initialize', { protocolVersion: '1999-01-01' })]);
    assert.equal(responses[0].result.protocolVersion, LATEST_PROTOCOL_VERSION);
  });

  it('exits cleanly on immediate end of input', async () => {
    const { code, responses } = await exchange([]);
    assert.equal(code, 0);
    assert.deepEqual(responses, []);
  });
});

describe('createMessageHandler', () => {
  const echo = {
    name: 'echo',
    description: 'Echo',
    inputSchema: {
      properties: { n: { default: 1, title: 'N', type: 'integer' } },
      title: 'echoArguments',
      type: 'object',
    },
    handler: async ({ n }) => ({ n }),
  };
  const boom = {
    name: 'boom',
    description: 'Throws',
    inputSchema: { properties: {}, title: 'boomArguments', type: 'object' },
    handler: () => { throw new Error('kaput'); },
  };
  const handle = createMessageHandler({ info: { name: 't', version: '1' }, tools: [echo, boom] });
  const call = async (name, args) => (await handle(request(1, 'tools/call', { name, arguments: args }))).result;

  it('returns indent-2 JSON text plus structuredContent', async () => {
    assert.deepEqual(await call('echo', { n: '7' }), {
      content: [{ type: 'text', text: '{\n  "n": 7\n}' }],
      structuredContent: { n: 7 },
      isError: false,
    });
  });

  it('applies schema defaults', async () => {
    assert.deepEqual((await call('echo', {})).structuredContent, { n: 1 });
  });

  it('reports argument validation failures as tool errors', async () => {
    const result = await call('echo', { n: 'seven' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^Error executing tool echo: 1 validation error for echoArguments\nn\n/);
  });

  it('reports thrown tool errors and unknown tools as tool errors', async () => {
    assert.deepEqual(await call('boom', {}), {
      content: [{ type: 'text', text: 'Error executing tool boom: kaput' }],
      isError: true,
    });
    assert.equal((await call('nope', {})).content[0].text, 'Unknown tool: nope');
  });

  it('rejects non-object arguments with -32602', async () => {
    const response = await handle(request(9, 'tools/call', { name: 'echo', arguments: [1] }));
    assert.equal(response.error.code, ErrorCode.INVALID_PARAMS);
  });

  it('ignores notifications and stray responses', async () => {
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/cancelled' }), null);
    assert.equal(await handle({ jsonrpc: '2.0', id: 3, result: {} }), null);
  });

  it('rejects messages that are not JSON-RPC 2.0', async () => {
    const response = await handle({ id: 4, method: 'ping' });
    assert.equal(response.error.code, ErrorCode.INVALID_REQUEST);
  });
});

describe('coerceArguments', () => {
  const schema = {
    properties: {
      id: { title: 'Id', type: 'string' },
      flag: { default: false, title: 'Flag', type: 'boolean' },
      include: {
        anyOf: [{ items: { enum: ['a', 'b'], type: 'string' }, type: 'array' }, { type: 'null' }],
        default: null,
        title: 'Include',
      },
    },
    required: ['id'],
    title: 'xArguments',
    type: 'object',
  };

  it('coerces lax inputs the way pydantic does', () => {
    assert.deepEqual(coerceArguments(schema, { id: 'x', flag: 'yes', include: '["b"]', extra: 1 }, 'xArguments'), {
      id: 'x', flag: true, include: ['b'],
    });
  });

  it('accepts null for an optional field', () => {
    assert.equal(coerceArguments(schema, { id: 'x', include: null }, 'xArguments').include, null);
  });

  it('collects every error', () => {
    assert.throws(
      () => coerceArguments(schema, { flag: 'maybe', include: ['c'] }, 'xArguments'),
      (error) => error.message.startsWith('3 validation errors for xArguments\n'),
    );
  });

  it('does not coerce numbers into strings', () => {
    assert.throws(() => coerceArguments(schema, { id: 5 }, 'xArguments'), /Input should be a valid string/);
  });
});
