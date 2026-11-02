import { mkdtemp, writeFile } from 'node:fs/promises';
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
  endpoint: LlmEndpoint | undefined,
  downloadAttachment: (fileId: string) => Promise<Buffer>,
): CahciuaTool => createTool({
  name: 'image2',
  description: 'Generate an image and return a local attachment path. For edits using multiple references, pass file_ids in the exact image-order mapped in chat context (for example, [图一的 file-id, 图二的 file-id]); the image API receives them in that order. Never choose by display position or filename. After generation, decide when to send it with send_message using attachments: [{"type":"photo","path":"<returned path>"}].',
  execution: { lane: 'message' },
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 4000 },
      file_id: { type: 'string', description: 'Optional single source image file_id from the matching image-order mapping, including OneBot ob:... IDs. Use file_ids for multiple references.' },
      file_ids: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', minLength: 1 }, description: 'Optional source image file_ids in exact image-order (for example, [图一, 图二]); use this for multi-image edits.' },
      size: { type: 'string', enum: ['auto', '1024x1024', '1536x1024', '1024x1536'] },
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] },
    },
    required: ['prompt'],
  },
  execute: async input => {
    const { prompt, file_id, file_ids: rawFileIds, size, quality } = input as { prompt: string; file_id?: string; file_ids?: string[]; size?: string; quality?: string };
    if (file_id && rawFileIds?.length) return fail('Provide either file_id or file_ids, not both');
    const fileIds = rawFileIds?.length ? rawFileIds : (file_id ? [file_id] : []);
    if (!endpoint) return fail('image2 is not configured for this chat; set tools.image2.model');
    const baseUrl = endpoint.apiBaseUrl.replace(/\/+$/, '');
    const response = fileIds.length > 0
      ? await (async () => {
        const form = new FormData();
        form.append('model', endpoint.model);
        form.append('prompt', prompt);
        if (size) form.append('size', size);
        if (quality) form.append('quality', quality);
        for (let i = 0; i < fileIds.length; i++) {
          const source = await downloadAttachment(fileIds[i]!);
          form.append('image', new Blob([source], { type: 'image/png' }), `input-${i + 1}.png`);
        }
        return await fetch(`${baseUrl}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.apiKey}` }, body: form });
      })()
      : await fetch(`${baseUrl}/images/generations`, {
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
    const bytes = image.b64_json
      ? Buffer.from(image.b64_json, 'base64')
      : Buffer.from(await (await fetch(image.url!)).arrayBuffer());
    await writeFile(path, bytes);
    // Keep the file available for the main model's later send_message call.
    return { content: JSON.stringify({ ok: true, attachment_path: path, file_name: 'generated.png' }), requiresFollowUp: true };
  },
});
