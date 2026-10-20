export const parseSSEStream = async <T>(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let lineBuf = '';

  const processLine = (line: string) => {
    if (!line.startsWith('data: ')) return;

    const data = line.slice(6).trim();
    if (data === '[DONE]') return;

    onEvent(JSON.parse(data) as T);
  };

  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      lineBuf += decoder.decode(value, { stream: true });
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop()!;
      for (const line of lines) {
        signal?.throwIfAborted();
        processLine(line);
      }
    }
    if (lineBuf) processLine(lineBuf);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // Cancel unread bytes on callback/parse failures as well as policy rejection.
    try { await reader.cancel(); } catch { /* Do not mask the original error. */ }
    reader.releaseLock();
  }
};
