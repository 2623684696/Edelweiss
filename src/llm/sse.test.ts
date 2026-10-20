import { expect, it, vi } from 'vitest';

import { parseSSEStream } from './sse';

it('stops consuming the same chunk immediately on callback rejection and cancels/releases the reader', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"start":true}\n\ndata: {"later":true}\n\n'));
    },
    cancel,
  });
  const failure = new Error('policy rejection');
  const onEvent = vi.fn(() => { throw failure; });
  await expect(parseSSEStream(stream, onEvent)).rejects.toBe(failure);
  expect(onEvent).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it('does not swallow a real stream read error', async () => {
  const failure = new Error('network read failure');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } });
  await expect(parseSSEStream(stream, vi.fn())).rejects.toBe(failure);
  expect(stream.locked).toBe(false);
});
