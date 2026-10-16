/**
 * 遮盖 provider 错误文字里回显的密钥（docs/specs/agent/harness.md 输出 18）。有的服务在 401 的错误正文里原样带上
 * 收到的认证头，不遮盖就会进运行结果与会话日志。
 */

import type {AssistantMessage} from "@oh-my-pi/pi-ai";
import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/providers/openai-shared";

/** 遮盖时用的固定文字。 */
export const REDACTED_KEY = "[REDACTED]";

/** 把文字里出现的每个密钥换成遮盖文字。密钥不论长短都遮盖；“端点不要认证”的占位值不是密钥，不动。 */
export function redactText(text: string, keys: Iterable<string>): string {
    let result = text;
    for (const key of keys) if (key !== "" && key !== NO_AUTH_SENTINEL) result = result.split(key).join(REDACTED_KEY);
    return result;
}

/** 就地改写助手消息的 `errorMessage`。 */
export function redactErrorMessage(message: AssistantMessage, keys: Iterable<string>): void {
    if (typeof message.errorMessage === "string") message.errorMessage = redactText(message.errorMessage, keys);
}
