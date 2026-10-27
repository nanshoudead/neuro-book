/**
 * 观察一次请求的 SSE：chat completions 形状的流（块里有 `choices`）一直没给出非空的 `finish_reason`。
 *
 * 为什么要看：pi-ai 在“既没有 finish_reason 也没有 `[DONE]`”时才报 incomplete-stream；有的网关耗尽预算后直接送
 * `[DONE]` 收尾而不送 finish_reason，pi-ai 把这种流记成正常的 `stop`，半句话就成了“正常结束”。这里把它认出来，
 * 由调用方改记成 `length`（被截断）。Anthropic、Responses 等流的块里没有 `choices`，不受影响。
 */

export interface FinishWatch {
    /** 传给 pi-ai 的 `onSseEvent`。 */
    observe(event: {readonly data: string}): void;
    /** 见到了 chat completions 的块，却一直没见到结束原因。 */
    readonly missing: boolean;
}

export function createFinishWatch(): FinishWatch {
    let sawChoices = false;
    let sawFinish = false;
    return {
        observe(event) {
            if (sawFinish || event.data === "" || event.data === "[DONE]") return;
            let parsed: unknown;
            try {
                parsed = JSON.parse(event.data);
            } catch {
                // 不是 JSON 的块（注释、心跳）与结束原因无关。
                return;
            }
            const choices = (parsed as {choices?: unknown} | null)?.choices;
            if (!Array.isArray(choices)) return;
            sawChoices = true;
            const reason = (choices[0] as {finish_reason?: unknown} | undefined)?.finish_reason;
            if (typeof reason === "string" && reason !== "") sawFinish = true;
        },
        get missing() {
            return sawChoices && !sawFinish;
        },
    };
}
