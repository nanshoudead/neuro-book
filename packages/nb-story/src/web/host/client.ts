/**
 * 查看器取数的唯一入口（docs/specs/story/viewer.md 的“边界与兼容”第 2 条）：页面与零件只经注入的 StoryClient
 * 调用查询方法，不直接发请求。单独使用时注入 HTTP 实现；以后嵌进 NeuroBook 插件时换成插件通道的实现，页面不改。
 */

import {inject, type InjectionKey} from "vue";

import {createParser} from "eventsource-parser";

import type {QaFrame, StoryMethod, ViewerMethod, ViewerParams, ViewerResult} from "../../contract/contract";

/** 推送结束的原因：`closed` 是服务端正常结束了这条流，`dropped` 是连不上、断开或被拒。 */
export type SubscriptionEnd = "closed" | "dropped";

export interface QaSubscriber {
    frame(frame: QaFrame): void;
    /** 只调一次；调用方自己 `close()` 的不调。 */
    end(reason: SubscriptionEnd): void;
}

/** 查询、抽取（`ingest.*`）、问答与设置（`qa.*`、`config.*`）的方法，以及问答运行中的推送；后三类只在独立服务里有。 */
export interface StoryClient {
    call<M extends ViewerMethod>(method: M, params: ViewerParams<M>, options?: {signal?: AbortSignal}): Promise<ViewerResult<M>>;
    /** 订阅一个对话的运行（帧见 contract.ts 的 `QaFrame`）。 */
    subscribe(book: string, conversation: string, subscriber: QaSubscriber): {close(): void};
}

/** 查询失败：`code` 是 docs/specs/story/queries.md 的失败码；服务内部出错时为 "internal"。 */
export class StoryCallError extends Error {
    readonly code: string;
    readonly candidates: {id: string; label: string; note: string}[];

    constructor(code: string, message: string, candidates: {id: string; label: string; note: string}[] = []) {
        super(message);
        this.name = "StoryCallError";
        this.code = code;
        this.candidates = candidates;
    }
}

export const STORY_CLIENT: InjectionKey<StoryClient> = Symbol("nb-story client");

export function useStoryClient(): StoryClient {
    const client = inject(STORY_CLIENT);
    if (!client) throw new Error("没有提供 StoryClient：查看器的页面要放在提供它的外壳里");
    return client;
}

/**
 * 独立服务的 HTTP 实现：`POST /api/rpc/<方法名>`。会话失效（401）时先调 onUnauthorized 再抛错，由外壳换成
 * “登录已失效”的提示。
 */
export function createHttpClient(onUnauthorized: () => void): StoryClient {
    return {
        // 用 fetch 读 SSE，不用 EventSource：EventSource 拿不到状态码（分不出会话失效），出错时还会自己重连，而重连要
        // 由数据源先按 qa.get 对齐再决定（qa/source.ts）。
        subscribe(book, conversation, subscriber) {
            const controller = new AbortController();
            let ended = false;
            const end = (reason: SubscriptionEnd) => {
                if (ended || controller.signal.aborted) return;
                ended = true;
                subscriber.end(reason);
            };
            void (async () => {
                const response = await fetch(`/api/qa/events?book=${encodeURIComponent(book)}&conversation=${encodeURIComponent(conversation)}`, {signal: controller.signal});
                if (response.status === 401) onUnauthorized();
                if (!response.ok || response.body === null) return end("dropped");
                const parser = createParser({
                    onEvent: event => {
                        if (!ended && !controller.signal.aborted) subscriber.frame(JSON.parse(event.data) as QaFrame);
                    },
                });
                const decoder = new TextDecoder();
                for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) parser.feed(decoder.decode(chunk, {stream: true}));
                end("closed");
            })().catch((error: unknown) => {
                if (!controller.signal.aborted) console.warn({error, conversation}, "问答推送断开");
                end("dropped");
            });
            return {close: () => controller.abort()};
        },
        async call(method, params, options = {}) {
            let response: Response;
            try {
                response = await fetch(`/api/rpc/${method}`, {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify(params),
                    ...(options.signal ? {signal: options.signal} : {}),
                });
            } catch (error) {
                // 中止照原样抛给调用方（它据此丢弃结果）；其余网络失败统一成失败码 network，页面按查询失败显示。
                if (options.signal?.aborted) throw error;
                throw new StoryCallError("network", "连不上查看器的服务，确认 nbstory serve 还在运行");
            }
            const body = (await response.json().catch(() => null)) as {code?: string; message?: string; candidates?: []} | null;
            if (response.ok) return body as never;
            if (response.status === 401) onUnauthorized();
            throw new StoryCallError(body?.code ?? "internal", body?.message ?? `请求失败（${response.status}）`, body?.candidates ?? []);
        },
    };
}

/** 页面隐藏或关闭时保存阅读状态：fetch 的 keepalive 让请求在页面卸载后继续发出。 */
export function sendKeepalive(method: StoryMethod, params: unknown): boolean {
    const body = JSON.stringify(params);
    // keepalive 请求体与同组在途的合计不能超过 64 KiB；查看器的界面状态只有几个字段，远低于这个数。万一超过就放弃
    // 这一次（下次变化或打开时会再存），不让浏览器直接报网络错误。
    if (body.length > 60 * 1024) {
        console.warn({bytes: body.length}, "阅读状态太大，页面隐藏时没有保存");
        return false;
    }
    void fetch(`/api/rpc/${method}`, {method: "POST", headers: {"content-type": "application/json"}, body, keepalive: true}).catch((error: unknown) => {
        console.warn({error}, "页面隐藏时保存阅读状态失败");
    });
    return true;
}
