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

export async function serveMcp(rpc) {
  process.stdin.setEncoding('utf8');
  let pending = '';
  for await (const chunk of process.stdin) {
    pending += chunk;
    if (Buffer.byteLength(pending) > 256_000) { process.exitCode = 2; break; }
    let index;
    while ((index = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, index); pending = pending.slice(index + 1);
      let result;
      try { result = await rpc(JSON.parse(line)); }
      catch { result = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }; }
      if (result) process.stdout.write(JSON.stringify(result) + '\n');
    }
  }
}
