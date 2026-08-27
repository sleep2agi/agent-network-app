/**
 * `/btw` is a first-token command. Parsing lives outside React so the main
 * workspace, detached chat window and mobile composer cannot drift.
 *
 * A leading backslash escapes the command (`\/btw ...`) and is removed before
 * an ordinary message is sent. The parser never treats `/btwfoo`, quoted text,
 * or a later `/btw` token as a command.
 */
export type BtwCommandParse =
  | { kind: 'ordinary'; content: string; escaped: boolean }
  | { kind: 'btw'; prompt: string }
  | { kind: 'invalid'; code: 'BTW_EMPTY_PROMPT'; message: string };

const LEADING_SPACE = /^(\s*)/;
const BTW_TOKEN = /^\/btw(?=\s|$)/;
const ESCAPED_BTW_TOKEN = /^\\\/btw(?=\s|$)/;

export const parseBtwFirstToken = (input: string): BtwCommandParse => {
  const prefix = input.match(LEADING_SPACE)?.[0] ?? '';
  const rest = input.slice(prefix.length);

  if (ESCAPED_BTW_TOKEN.test(rest)) {
    return {
      kind: 'ordinary',
      content: `${prefix}${rest.slice(1)}`,
      escaped: true,
    };
  }

  if (!BTW_TOKEN.test(rest)) {
    return { kind: 'ordinary', content: input, escaped: false };
  }

  const prompt = rest.slice('/btw'.length).trim();
  if (!prompt) {
    return {
      kind: 'invalid',
      code: 'BTW_EMPTY_PROMPT',
      message: '请输入旁路问题，例如：/btw 如何查看当前构建日志？',
    };
  }
  return { kind: 'btw', prompt };
};

export const isBtwCommand = (input: string): boolean =>
  parseBtwFirstToken(input).kind === 'btw';

export const shouldSubmitBtwOnEnter = (event: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}): boolean => event.key === 'Enter'
  && !event.ctrlKey
  && !event.metaKey
  && !event.shiftKey
  && !event.isComposing
  && event.keyCode !== 229
  && event.which !== 229;
