import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTool, type CahciuaTool, type ToolResult } from './types';
import type { LlmEndpoint } from '../../llm/types';

interface ImageGenerationResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

const fail = (message: string): ToolResult => ({
  content: JSON.stringify({ ok: false, error: message }),
  requiresFollowUp: true,
});

export const createImage2Tool = (
  endpoint: LlmEndpoint,
  send: (text: string, attachments: [{ type: 'photo'; path: string; file_name?: string }]) => Promise<{ messageId: string }>,
): CahciuaTool => createTool({
  name: 'image2',
  description: 'Generate an image from a prompt with the configured image2 endpoint, then send it to the current chat.',
  execution: { lane: 'message' },
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 4000 },
      size: { type: 'string', enum: ['auto', '1024x1024', '1536x1024', '1024x1536'] },
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] },
    },
    required: ['prompt'],
  },
  execute: async input => {
    const { prompt, size, quality } = input as { prompt: string; size?: string; quality?: string };
    const url = `${endpoint.apiBaseUrl.replace(/\/+$/, '')}/images/generations`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({ ...(endpoint.extraBody ?? {}), model: endpoint.model, prompt, ...(size ? { size } : {}), ...(quality ? { quality } : {}) }),
    });
    if (!response.ok) return fail(`Image generation failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json() as ImageGenerationResponse;
    const image = payload.data?.[0];
    if (!image?.b64_json && !image?.url) return fail('Image generation returned no image');

    const directory = await mkdtemp(join(tmpdir(), 'edelweiss-image2-'));
    const path = join(directory, 'generated.png');
    try {
      const bytes = image.b64_json
        ? Buffer.from(image.b64_json, 'base64')
        : Buffer.from(await (await fetch(image.url!)).arrayBuffer());
      await writeFile(path, bytes);
      const sent = await send('', [{ type: 'photo', path, file_name: 'generated.png' }]);
      return { content: JSON.stringify({ ok: true, message_id: sent.messageId }), requiresFollowUp: true };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});
