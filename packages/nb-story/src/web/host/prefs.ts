/**
 * 与书无关的界面偏好（导航收起与否、抽屉宽度）：只在这一处读写 localStorage，组件不碰浏览器存储
 * （docs/specs/story/viewer.md 的“副作用与数据”）。读写都包 try/catch：隐私模式、存储被禁用时照常工作，只是记不住。
 */

const PREFIX = "nbstory:";

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(`${PREFIX}${key}`);
    } catch (error) {
        console.warn(`读不了偏好 ${key}，按缺省处理`, error);
        return null;
    }
}

function write(key: string, value: string): void {
    try {
        window.localStorage.setItem(`${PREFIX}${key}`, value);
    } catch (error) {
        console.warn(`存不了偏好 ${key}，这次改动只在本页有效`, error);
    }
}

export function readNavCollapsed(): boolean {
    return read("nav-collapsed") === "true";
}

export function writeNavCollapsed(value: boolean): void {
    write("nav-collapsed", String(value));
}

export function readDrawerWidth(): number {
    const value = Number(read("drawer-width"));
    return Number.isFinite(value) && value >= 280 && value <= 640 ? value : 400;
}

export function writeDrawerWidth(value: number): void {
    write("drawer-width", String(Math.round(value)));
}
