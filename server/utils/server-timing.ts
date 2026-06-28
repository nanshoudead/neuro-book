import {getResponseHeader, setResponseHeader, type H3Event} from "h3";

type ServerTimingMark = {
    name: string;
    durationMs: number;
};

type ServerTimingContext = {
    __nbookServerTimingMarks?: ServerTimingMark[];
    __nbookServerTimingCommitted?: boolean;
};

export type ServerTimingSink = {
    mark(name: string, durationMs: number): void;
};

/**
 * 收集 Server-Timing mark。mark 挂在 H3 event.context 上，最终由 Nitro beforeResponse 统一写出。
 */
export function createServerTiming(event: H3Event) {
    const marks = serverTimingMarks(event);

    const mark = (name: string, durationMs: number): void => {
        marks.push({name, durationMs});
    };

    const measure = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
        const startedAt = performance.now();
        try {
            return await task();
        } finally {
            mark(name, performance.now() - startedAt);
        }
    };

    const commit = (): void => {
        flushServerTiming(event);
    };

    return {
        mark,
        measure,
        commit,
    };
}

/**
 * 在响应发送前写出 Server-Timing。多次调用只会提交一次。
 */
export function flushServerTiming(event: H3Event): void {
    const context = event.context as ServerTimingContext;
    const marks = context.__nbookServerTimingMarks ?? [];
    if (context.__nbookServerTimingCommitted || marks.length === 0) {
        return;
    }
    context.__nbookServerTimingCommitted = true;
    const current = getResponseHeader(event, "Server-Timing");
    const next = formatServerTiming(marks);
    setResponseHeader(event, "Server-Timing", current ? `${current}, ${next}` : next);
}

/**
 * 读取当前请求上的 Server-Timing mark 列表，测试和插件共用。
 */
export function readServerTimingMarks(event: H3Event): readonly ServerTimingMark[] {
    return serverTimingMarks(event);
}

function serverTimingMarks(event: H3Event): ServerTimingMark[] {
    const context = event.context as ServerTimingContext;
    if (!context.__nbookServerTimingMarks) {
        context.__nbookServerTimingMarks = [];
    }
    return context.__nbookServerTimingMarks;
}

function formatServerTiming(marks: readonly ServerTimingMark[]): string {
    return marks
        .map((mark) => `${mark.name};dur=${mark.durationMs.toFixed(1)}`)
        .join(", ");
}
