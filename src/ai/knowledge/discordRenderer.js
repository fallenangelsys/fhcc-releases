const DEFAULT_LIMIT = 2_000;
const DANGLING_END = /(?:\b(?:aber|und|oder|weil|dass|sowie|mit|für|von|zu|als)|[:;,]|(?:^|\n)\s*(?:[-*•]|\d+[.)])\s*)$/i;

const normalize = (value) => String(value || '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim();

const findSafeBoundary = (text, limit) => {
  const candidates = [
    text.lastIndexOf('\n\n', limit),
    text.lastIndexOf('\n', limit),
    text.lastIndexOf('. ', limit),
    text.lastIndexOf('! ', limit),
    text.lastIndexOf('? ', limit)
  ].filter((index) => index >= Math.floor(limit * 0.55));
  return candidates.length ? Math.max(...candidates) + 1 : -1;
};

export const renderDiscordContent = (value, { limit = DEFAULT_LIMIT } = {}) => {
  const max = Math.min(DEFAULT_LIMIT, Math.max(200, Number(limit) || DEFAULT_LIMIT));
  let text = normalize(value);
  if (!text) return '';
  if (text.length > max) {
    const boundary = findSafeBoundary(text, max - 1);
    text = normalize(text.slice(0, boundary > 0 ? boundary : max - 1));
    if (!/[.!?…]$/.test(text)) text = `${text.replace(/[,:;\-–—\s]+$/g, '')}…`;
  }
  if (DANGLING_END.test(text)) {
    const boundary = findSafeBoundary(text, Math.max(0, text.length - 2));
    if (boundary > 0) text = normalize(text.slice(0, boundary));
  }
  return text.slice(0, max);
};

export const buildDiscordReplyPayload = (payload = {}) => {
  const source = typeof payload === 'string' ? { content: payload } : payload;
  const content = renderDiscordContent(source.content, { limit: source.limit || DEFAULT_LIMIT });
  if (!content) throw new Error('Eine leere AI-Antwort darf nicht an Discord gesendet werden.');
  return {
    ...source,
    content,
    allowedMentions: source.allowedMentions || { parse: [], users: [], roles: [], repliedUser: false }
  };
};

export const sendDiscordReply = (message, payload) => message.reply(buildDiscordReplyPayload(payload));

