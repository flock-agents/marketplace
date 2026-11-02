// Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0.
//
// stdout carries protocol messages only. Anything diagnostic goes to stderr.
// Tool results are serialised the way the Python `mcp` SDK (FastMCP /
// MCPServer) does for a dict-returning tool: the dict as indent-2 JSON text
// content, the same dict as structuredContent, and isError false. A tool that
// throws becomes an isError result rather than a protocol error.

import { createInterface } from 'node:readline';

export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  LATEST_PROTOCOL_VERSION,
]);

export const ErrorCode = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

const JSON_INDENT = 2;
const TRUE_STRINGS = new Set(['1', 'true', 't', 'yes', 'y', 'on']);
const FALSE_STRINGS = new Set(['0', 'false', 'f', 'no', 'n', 'off']);
const INTEGER_STRING = /^\s*[+-]?\d+\s*$/;

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class ArgumentError extends Error {}

export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// --------------------------------------------------------------------------
// Argument coercion -- a small subset of pydantic's lax-mode validation,
// enough for the JSON schemas this package declares.
// --------------------------------------------------------------------------

const NO_MATCH = Symbol('no match');

const typeCoercers = {
  null: (value) => (value === null ? value : NO_MATCH),
  string: (value) => (typeof value === 'string' ? value : NO_MATCH),
  integer(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && INTEGER_STRING.test(value)) return Number.parseInt(value, 10);
    return NO_MATCH;
  },
  boolean(value) {
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === 1) return value === 1;
    if (typeof value !== 'string') return NO_MATCH;
    const lowered = value.trim().toLowerCase();
    if (TRUE_STRINGS.has(lowered)) return true;
    if (FALSE_STRINGS.has(lowered)) return false;
    return NO_MATCH;
  },
  object: (value) => (isPlainObject(value) ? value : NO_MATCH),
  array: (value) => (Array.isArray(value) ? value : NO_MATCH),
};

function coerceToSchema(schema, value) {
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      const coerced = coerceToSchema(option, value);
      if (coerced !== NO_MATCH) return coerced;
    }
    return NO_MATCH;
  }
  const coerce = typeCoercers[schema.type];
  const coerced = coerce ? coerce(value) : value;
  if (coerced === NO_MATCH) return NO_MATCH;
  if (schema.enum && !schema.enum.includes(coerced)) return NO_MATCH;
  if (schema.type === 'array' && schema.items) {
    const items = coerced.map((item) => coerceToSchema(schema.items, item));
    return items.includes(NO_MATCH) ? NO_MATCH : items;
  }
  return coerced;
}

const acceptsString = (schema) =>
  schema.anyOf ? schema.anyOf.some(acceptsString) : schema.type === 'string';

// FastMCP decodes a JSON-encoded string argument for a non-string field
// (clients sometimes send `"[\"gps\"]"` for a list), unless it decodes to a
// bare scalar.
function preParseJson(schema, value) {
  if (typeof value !== 'string' || acceptsString(schema)) return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' || typeof parsed === 'number' ? value : parsed;
  } catch {
    return value;
  }
}

function describeExpected(schema) {
  const options = schema.anyOf ?? [schema];
  return options
    .map((option) => (option.type === 'array' && option.items?.enum
      ? `a list of ${option.items.enum.map((e) => `'${e}'`).join(', ')}`
      : `a valid ${option.type === 'object' ? 'dictionary' : option.type}`))
    .join(' or ');
}

export function coerceArguments(inputSchema, args, modelName) {
  const properties = inputSchema.properties ?? {};
  const required = new Set(inputSchema.required ?? []);
  const errors = [];
  const out = {};
  for (const [name, schema] of Object.entries(properties)) {
    if (!(name in args)) {
      if (required.has(name)) errors.push([name, 'Field required']);
      else out[name] = structuredClone(schema.default);
      continue;
    }
    const coerced = coerceToSchema(schema, preParseJson(schema, args[name]));
    if (coerced === NO_MATCH) errors.push([name, `Input should be ${describeExpected(schema)}`]);
    else out[name] = coerced;
  }
  if (errors.length) {
    const plural = errors.length === 1 ? 'error' : 'errors';
    const lines = errors.map(([field, message]) => `${field}\n  ${message}`);
    throw new ArgumentError(`${errors.length} validation ${plural} for ${modelName}\n${lines.join('\n')}`);
  }
  return out;
}

// --------------------------------------------------------------------------
// Request handling
// --------------------------------------------------------------------------

const textContent = (text) => [{ type: 'text', text }];

function toolErrorResult(text) {
  return { content: textContent(text), isError: true };
}

function toolSuccessResult(value) {
  const result = { content: textContent(JSON.stringify(value, null, JSON_INDENT)) };
  if (isPlainObject(value)) result.structuredContent = value;
  result.isError = false;
  return result;
}

function describeTool({ name, description, inputSchema, outputSchema }) {
  const listed = { name, description, inputSchema };
  if (outputSchema) listed.outputSchema = outputSchema;
  return listed;
}

function negotiateVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

/**
 * Build a JSON-RPC message handler for a server definition
 * `{ info: {name, version}, instructions?, tools: [{name, description,
 * inputSchema, outputSchema?, handler(args)}] }`.
 * Returns `async (message) => response | null` (null for notifications).
 */
export function createMessageHandler({ info, instructions, tools }) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  async function callTool(params) {
    if (!isPlainObject(params) || typeof params.name !== 'string') {
      throw new RpcError(ErrorCode.INVALID_PARAMS, 'Invalid params: tools/call requires a string "name"');
    }
    const args = params.arguments ?? {};
    if (!isPlainObject(args)) {
      throw new RpcError(ErrorCode.INVALID_PARAMS, 'Invalid params: "arguments" must be an object');
    }
    const tool = toolsByName.get(params.name);
    if (!tool) return toolErrorResult(`Unknown tool: ${params.name}`);
    try {
      const coerced = coerceArguments(tool.inputSchema, args, `${tool.name}Arguments`);
      return toolSuccessResult(await tool.handler(coerced));
    } catch (error) {
      return toolErrorResult(`Error executing tool ${tool.name}: ${error?.message ?? error}`);
    }
  }

  const methods = {
    initialize(params) {
      if (!isPlainObject(params)) {
        throw new RpcError(ErrorCode.INVALID_PARAMS, 'Invalid params: initialize requires an object');
      }
      const result = {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: info,
      };
      if (instructions) result.instructions = instructions;
      return result;
    },
    ping: () => ({}),
    'tools/list': () => ({ tools: tools.map(describeTool) }),
    'tools/call': callTool,
  };

  return async function handleMessage(message) {
    if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
      return errorResponse(message?.id ?? null, ErrorCode.INVALID_REQUEST, 'Invalid Request');
    }
    const isRequest = 'id' in message;
    if (typeof message.method !== 'string') {
      // A response to something we never sent, or garbage without an id.
      return isRequest && !('result' in message || 'error' in message)
        ? errorResponse(message.id, ErrorCode.INVALID_REQUEST, 'Invalid Request')
        : null;
    }
    if (!isRequest) return null; // notifications/initialized, cancelled, ...

    const method = Object.hasOwn(methods, message.method) ? methods[message.method] : null;
    if (!method) {
      return errorResponse(message.id, ErrorCode.METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
    try {
      return { jsonrpc: '2.0', id: message.id, result: await method(message.params) };
    } catch (error) {
      const code = error instanceof RpcError ? error.code : ErrorCode.INTERNAL_ERROR;
      return errorResponse(message.id, code, error?.message ?? String(error));
    }
  };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// --------------------------------------------------------------------------
// Transport
// --------------------------------------------------------------------------

function parseLine(line) {
  try {
    return { message: JSON.parse(line) };
  } catch {
    return { response: errorResponse(null, ErrorCode.PARSE_ERROR, 'Parse error') };
  }
}

/**
 * Serve `server` over newline-delimited JSON-RPC. Resolves once `input` ends
 * and every in-flight request has been answered and flushed.
 */
export function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const handleMessage = createMessageHandler(server);
  const pending = new Set();
  let lastWrite = Promise.resolve();

  const send = (response) => {
    if (!response) return;
    lastWrite = new Promise((resolve) => {
      output.write(`${JSON.stringify(response)}\n`, () => resolve());
    });
  };

  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  };

  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return;
    const { message, response } = parseLine(line);
    if (response) return send(response);
    track(handleMessage(message).then(send, (error) => {
      process.stderr.write(`zepp-mcp: unhandled error: ${error?.stack ?? error}\n`);
    }));
  });

  return new Promise((resolve) => {
    lines.on('close', async () => {
      while (pending.size) await Promise.allSettled([...pending]);
      await lastWrite;
      resolve();
    });
  });
}
