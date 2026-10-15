/**
 * 强调类符号的侧翼判断（docs/specs/workspace/markdown-dialect.md 输出 6、24）：CommonMark 的左右侧翼规则，按 CJK 友好的放宽把
 * 中日韩文字与全角标点都当成标点。`==` 的分词规则与写出时的转义用同一份，两边判断一致。
 */

const SPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

/** 空白，或者没有字符（行首行尾）。 */
export const isSpace = (char: string): boolean => char === "" || SPACE.test(char);
export const isPunctuation = (char: string): boolean => PUNCTUATION.test(char);
/** 左侧翼（能开）：后面不是空白，并且后面不是标点或前面是空白、标点。 */
export const leftFlanking = (before: string, after: string): boolean => !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
/** 右侧翼（能闭）：前面不是空白，并且前面不是标点或后面是空白、标点。 */
export const rightFlanking = (before: string, after: string): boolean => !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
