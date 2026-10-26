import {describe, expect, it} from "vitest";

import {dragScrollTop, MIN_THUMB_PX, pageScrollTop, thumbGeometry, trackLength} from "./scrollbar-geometry";

describe("自绘滚动条的滑块几何（轨道取整个可见高度）", () => {
    it("内容不溢出（或只多出不到 1px）时不画滑块", () => {
        expect(thumbGeometry({scrollTop: 0, clientHeight: 300, scrollHeight: 300})).toBeNull();
        expect(thumbGeometry({scrollTop: 0, clientHeight: 300, scrollHeight: 300.6})).toBeNull();
        expect(thumbGeometry({scrollTop: 0, clientHeight: 0, scrollHeight: 500})).toBeNull();
    });

    it("滑块高度按可见比例，位置按滚动比例走完整条轨道", () => {
        expect(thumbGeometry({scrollTop: 0, clientHeight: 300, scrollHeight: 600})).toEqual({offset: 0, size: 150});
        expect(thumbGeometry({scrollTop: 300, clientHeight: 300, scrollHeight: 600})).toEqual({offset: 150, size: 150});
        expect(thumbGeometry({scrollTop: 150, clientHeight: 300, scrollHeight: 600})).toEqual({offset: 75, size: 150});
    });

    it("内容很长时滑块不短于下限，仍能走到轨道底；越界的滚动位置夹回范围内", () => {
        const long = {clientHeight: 300, scrollHeight: 300 * 100};
        expect(thumbGeometry({...long, scrollTop: 0})?.size).toBe(MIN_THUMB_PX);
        expect(thumbGeometry({...long, scrollTop: long.scrollHeight - long.clientHeight})?.offset).toBe(300 - MIN_THUMB_PX);
        expect(thumbGeometry({...long, scrollTop: -40})?.offset).toBe(0);
    });

    it("拖动：滑块走完剩余轨道等于内容滚完，不越过两端", () => {
        const start = {scrollTop: 0, clientHeight: 300, scrollHeight: 600};
        expect(dragScrollTop(start, 75)).toBe(150);
        expect(dragScrollTop(start, 150)).toBe(300);
        expect(dragScrollTop(start, 400)).toBe(300);
        expect(dragScrollTop({...start, scrollTop: 100}, -400)).toBe(0);
        expect(dragScrollTop({scrollTop: 0, clientHeight: 300, scrollHeight: 300}, 50)).toBe(0);
    });

    it("点轨道：滑块上方滚上一页、下方滚下一页、点在滑块上不动，不越界", () => {
        const metrics = {scrollTop: 300, clientHeight: 300, scrollHeight: 1200};
        // 滑块 size 75；滚动 300/900，offset 是剩余轨道 225 的三分之一：75。
        expect(pageScrollTop(metrics, 10)).toBe(0);
        expect(pageScrollTop(metrics, 200)).toBe(600);
        expect(pageScrollTop(metrics, 100)).toBe(300);
        expect(pageScrollTop({...metrics, scrollTop: 800}, 299)).toBe(900);
    });
});

describe("自绘滚动条的滑块几何（轨道上下各让出 inset，弹出列表的用法）", () => {
    const inset = 6;
    // 可见 200、内容 600：轨道 188，滑块 188 * 200 / 600。
    const popup = {clientHeight: 200, scrollHeight: 600};
    const thumbSize = (188 * 200) / 600;
    const travel = 188 - thumbSize;

    it("轨道比可见高度短 2 * inset，位置从轨道顶量起，走完剩余轨道等于内容滚完", () => {
        expect(trackLength(200, inset)).toBe(188);
        const top = thumbGeometry({...popup, scrollTop: 0}, {inset});
        expect(top?.offset).toBe(0);
        expect(top?.size).toBeCloseTo(thumbSize);
        expect(thumbGeometry({...popup, scrollTop: 400}, {inset})?.offset).toBeCloseTo(travel);
        expect(thumbGeometry({...popup, scrollTop: 200}, {inset})?.offset).toBeCloseTo(travel / 2);
    });

    it("内容很长时滑块取下限 20px，不是弹出列表原来的 24px", () => {
        expect(thumbGeometry({clientHeight: 200, scrollHeight: 20000, scrollTop: 0}, {inset})?.size).toBe(MIN_THUMB_PX);
    });

    it("轨道短到放不下下限时滑块就是整条轨道，拖动不动", () => {
        const tiny = {clientHeight: 30, scrollHeight: 300, scrollTop: 0};
        expect(thumbGeometry(tiny, {inset})).toEqual({offset: 0, size: 18});
        expect(dragScrollTop(tiny, 40, {inset})).toBe(0);
    });

    it("拖动：指针移动 delta 换算回滚动位置，走完剩余轨道滚到底，不越过两端", () => {
        const start = {...popup, scrollTop: 0};
        expect(dragScrollTop(start, travel / 2, {inset})).toBeCloseTo(200);
        expect(dragScrollTop(start, travel, {inset})).toBeCloseTo(400);
        expect(dragScrollTop(start, travel * 3, {inset})).toBe(400);
        expect(dragScrollTop({...start, scrollTop: 100}, -travel * 3, {inset})).toBe(0);
    });

    it("内容只多出不到 1px 时不算溢出，没有滑块", () => {
        expect(thumbGeometry({clientHeight: 200, scrollHeight: 200.5, scrollTop: 0}, {inset})).toBeNull();
    });
});
