import type { RenderedContext } from '../rendering/types';

const IMAGE2_COMMAND_RE = /(?:^|[\s>])\/image2(?=$|[\s<])/u;
const REPLY_QUOTE_RE = /<in-reply-to\b[^>]*>[\s\S]*?<\/in-reply-to>/gu;

export const hasExplicitImage2Request = (
  rc: RenderedContext,
  afterMs: number,
): boolean => rc.some(segment => segment.receivedAtMs > afterMs
  && segment.mentionsMe
  && segment.content.some(piece => piece.type === 'text'
    && IMAGE2_COMMAND_RE.test(piece.text.replace(REPLY_QUOTE_RE, ''))));
