/**
 * 遮盖 provider 错误文字里回显的密钥（docs/specs/agent/harness.md 输出 18）。有的服务在 401 的错误正文里原样带上
 * 收到的认证头，不遮盖就会进运行结果与会话日志。
 */

import type {AssistantMessage} from "@oh-my-pi/pi-ai";

/** 遮盖时用的固定文字。 */
export const REDACTED_KEY = "[REDACTED]";
/** 短于这个长度的密钥不遮盖：替换普通的短词会把错误文字改得面目全非，而这么短的值也算不上秘密。 */
const MIN_REDACT_LENGTH = 8;

export function redactText(text: string, keys: Iterable<string>): string {
    let result = text;
    for (const key of keys) if (key.length >= MIN_REDACT_LENGTH) result = result.split(key).join(REDACTED_KEY);
    return result;
}

/** 就地改写助手消息的 `errorMessage`。 */
export function redactErrorMessage(message: AssistantMessage, keys: Iterable<string>): void {
    if (typeof message.errorMessage === "string") message.errorMessage = redactText(message.errorMessage, keys);
}
