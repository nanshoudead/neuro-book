/**
 * 独立服务的登录（docs/specs/story/queries.md 的“时序与寿命”最后一条与“边界与兼容”）。
 *
 * 口令随服务启动生成，只在这个进程的内存里；服务停止前可以反复用来登录（换浏览器也可以），每次登录建一个新会话。
 * 会话没有闲置超时，进程退出即全部作废。写法参照 dev-panel 的 auth.ts，不同的是口令可以重复使用、没有过期。
 * 浏览器的 Cookie 不按端口隔离，名字里带上端口，同一台机器上几个服务互不覆盖。
 */

import {randomBytes, timingSafeEqual} from "node:crypto";

export interface ServeAuth {
    readonly token: string;
    /** 口令对时建一个会话并返回它的 id；不对返回 null。 */
    login(token: string | null): string | null;
    /** 请求头里的会话 Cookie 是否有效。 */
    authorized(cookieHeader: string | null): boolean;
    cookie(sessionId: string): string;
}

export function createServeAuth(port: number): ServeAuth {
    const token = randomBytes(32).toString("base64url");
    const expected = Buffer.from(token);
    const sessions = new Set<string>();
    const cookieName = `nbstory_${port}`;
    return {
        token,
        login(given) {
            const candidate = Buffer.from(given ?? "");
            if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null;
            const session = randomBytes(24).toString("base64url");
            sessions.add(session);
            return session;
        },
        authorized(cookieHeader) {
            if (!cookieHeader) return false;
            for (const part of cookieHeader.split(";")) {
                const [name, ...rest] = part.trim().split("=");
                if (name === cookieName && sessions.has(rest.join("="))) return true;
            }
            return false;
        },
        cookie(session) {
            return `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`;
        },
    };
}
