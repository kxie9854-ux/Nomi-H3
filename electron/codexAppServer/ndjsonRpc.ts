export type JsonRpcIncoming = {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export function encodeNdjson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

export function createNdjsonParser(onMessage: (message: JsonRpcIncoming) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onMessage(JSON.parse(line) as JsonRpcIncoming);
      newline = buffer.indexOf("\n");
    }
  };
}

export function requestFrame(id: number, method: string, params?: unknown): Record<string, unknown> {
  return params === undefined ? { id, method } : { id, method, params };
}

export function resultFrame(id: string | number, result: unknown): Record<string, unknown> {
  return { id, result };
}
