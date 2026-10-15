/**
 * 查看器取数的唯一入口（docs/specs/story/viewer.md 的“边界与兼容”第 2 条）：页面与零件只经注入的 StoryClient
 * 调用查询方法，不直接发请求。单独使用时注入 HTTP 实现；以后嵌进 NeuroBook 插件时换成插件通道的实现，页面不改。
 */

import {inject, type InjectionKey} from "vue";

import type {StoryMethod, StoryParams, StoryResult} from "../../contract/contract";

export interface StoryClient {
    call<M extends StoryMethod>(method: M, params: StoryParams<M>, options?: {signal?: AbortSignal}): Promise<StoryResult<M>>;
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
        async call(method, params, options = {}) {
            const response = await fetch(`/api/rpc/${method}`, {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify(params),
                ...(options.signal ? {signal: options.signal} : {}),
            });
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
