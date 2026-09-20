/** Initialize-based, bounded JSON-lines MCP transport shared by both tool surfaces. */
export function mcpRpc({ name, version, instructions, tools, call, failure }) {
  let initialized = false, ready = false;
  return async message => {
    const validId = typeof message?.id === 'string' || Number.isSafeInteger(message?.id);
    const id = validId ? message.id : null;
    const fail = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
      || (Object.hasOwn(message, 'id') && !validId)) return fail(-32600, 'Invalid request');
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/initialized' && initialized) ready = true;
      return null;
    }
    const success = result => ({ jsonrpc: '2.0', id, result });
    if (message.method === 'initialize') {
      if (initialized || typeof message.params?.protocolVersion !== 'string') return fail(-32602, 'Invalid initialization');
      initialized = true;
      const protocolVersion = ['2025-03-26', '2025-06-18', '2025-11-25'].includes(message.params.protocolVersion)
        ? message.params.protocolVersion : '2025-11-25';
      return success({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version }, instructions });
    }
    if (!ready) return fail(-32000, 'Initialize the connection first');
    if (message.method === 'ping') return success({});
    if (message.method === 'tools/list') return success({ tools });
    if (message.method === 'tools/call') {
      if (!tools.some(tool => tool.name === message.params?.name)) return fail(-32602, 'Unknown tool');
      try {
        const result = await call(message.params.name, message.params.arguments ?? {});
        return success({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (error) {
        const result = failure(error);
        return success({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true });
      }
    }
    return fail(-32601, 'Method not found');
  };
}

// Review input is bounded separately to 256 KB. Leave room for the JSON-RPC
// envelope and whitespace, and bound each frame rather than a read chunk.
export const MCP_FRAME_BYTES = 512_000;
export async function serveMcp(rpc, { input = process.stdin, output = process.stdout } = {}) {
  input.setEncoding('utf8');
  let pending = '', bytes = 0, discarding = false;
  const send = async result => {
    if (result && !output.write(JSON.stringify(result) + '\n')) await new Promise((resolve, reject) => {
      const cleanup = () => { output.off('drain', drained); output.off('error', failed); };
      const drained = () => { cleanup(); resolve(); };
      const failed = error => { cleanup(); reject(error); };
      output.once('drain', drained); output.once('error', failed);
    });
  };
  const failure = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } });
  for await (const chunk of input) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf('\n', start), end = newline === -1 ? chunk.length : newline;
      const piece = chunk.slice(start, end);
      if (!discarding) {
        bytes += Buffer.byteLength(piece);
        if (bytes > MCP_FRAME_BYTES) { pending = ''; bytes = 0; discarding = true; }
        else pending += piece;
      }
      if (newline !== -1) {
        if (discarding) await send(failure(-32600, 'Request exceeds the 512 KB frame limit. Reduce the request and retry.'));
        else {
          let result;
          try { result = await rpc(JSON.parse(pending)); }
          catch { result = failure(-32700, 'Invalid JSON'); }
          await send(result);
        }
        pending = ''; bytes = 0; discarding = false;
      }
      start = newline === -1 ? chunk.length : newline + 1;
    }
  }
  if (discarding) await send(failure(-32600, 'Request exceeds the 512 KB frame limit. Reduce the request and retry.'));
  else if (pending.length) await send(failure(-32700, 'Incomplete JSON frame'));
}
