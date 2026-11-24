import type { RenderedContext } from '../rendering/types';

const IMAGE2_COMMAND_RE = /^(?:@[^\r\n/]+\s+)?\/image2(?=$|[\s<])/u;
const MESSAGE_OPEN_RE = /^\s*<message\b[^>]*>/u;
const REPLY_QUOTE_RE = /<in-reply-to\b[^>]*>[\s\S]*?<\/in-reply-to>/gu;
const IMAGE2_RETRY_RE = /^(?:(?:请|麻烦)?(?:再(?:生成|生|画|出)|再来|重新(?:生成|生图|画|出图)|重试)(?:一(?:次|张(?:图(?:片)?)?|遍)|一下)?(?:[吧呀呗啊呢]|[\s，。！？,.!?<]|$)|(?:please\s+)?(?:try again|retry|regenerate)(?:\s|[.!?<]|$))/iu;

const userText = (rc: RenderedContext): Array<{ receivedAtMs: number; text: string }> => rc
  .filter(segment => !segment.isMyself && !segment.isSelfSent && !segment.isRuntimeEvent)
  .flatMap(segment => segment.content.flatMap(piece => piece.type === 'text'
    ? [{ receivedAtMs: segment.receivedAtMs, text: piece.text.replace(REPLY_QUOTE_RE, '').replace(MESSAGE_OPEN_RE, '').trimStart() }]
    : []));

export const hasExplicitImage2Request = (
  rc: RenderedContext,
  afterMs: number,
): boolean => userText(rc).some(piece => piece.receivedAtMs > afterMs && IMAGE2_COMMAND_RE.test(piece.text));

export const hasAuthorizedImage2Request = (rc: RenderedContext, afterMs: number): boolean => {
  const pieces = userText(rc);
  return pieces.some(piece => piece.receivedAtMs > afterMs && (IMAGE2_COMMAND_RE.test(piece.text)
    || (IMAGE2_RETRY_RE.test(piece.text.replace(/^@[^\r\n/]+?\s+/u, ''))
      && pieces.some(previous => previous.receivedAtMs < piece.receivedAtMs && IMAGE2_COMMAND_RE.test(previous.text)))));
};
