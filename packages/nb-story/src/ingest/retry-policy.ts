/**
 * 同一章失败后整章重做的等待（docs/specs/story/ingest.md 输出 10）。单独成文件：发起抽取的主线程只要这个函数，
 * 不必把整个抽取任务的模块拉进来。
 */

/** 5、10、15 分钟，次数多于三次时之后都等 15 分钟；`retries` 为 0 表示不重做。 */
export function chapterWaits(retries: number): number[] {
    const minutes = [5, 10, 15];
    return Array.from({length: retries}, (_, index) => minutes[Math.min(index, minutes.length - 1)]! * 60_000);
}
