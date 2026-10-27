/**
 * 应力排版（docs/specs/story/viewer.md 输出 22 的排版方式）：连着的点比不连的靠得近、不重合、同样的起点排出同样的位置。
 */

import {describe, expect, test} from "bun:test";

import Graph from "graphology";

import {layoutStress, seedSpiral} from "./sigma-kit";

/** 两个三角形用一条线连起来，外加一个不连通的点。 */
function build(): Graph {
    const graph = new Graph({type: "undirected", multi: false});
    for (const id of ["a", "b", "c", "d", "e", "f", "lone"]) graph.addNode(id, {size: 6, weight: 1, label: id});
    for (const [x, y] of [["a", "b"], ["b", "c"], ["a", "c"], ["d", "e"], ["e", "f"], ["d", "f"], ["c", "d"]] as const) graph.addEdge(x, y, {weight: 1});
    seedSpiral(graph, () => 1);
    return graph;
}

const distance = (graph: Graph, p: string, q: string) => Math.hypot(Number(graph.getNodeAttribute(p, "x")) - Number(graph.getNodeAttribute(q, "x")), Number(graph.getNodeAttribute(p, "y")) - Number(graph.getNodeAttribute(q, "y")));

describe("应力排版", () => {
    test("同一个三角形里的点比隔着一条线的点近，不连通的点离得最远，没有两个点重合", () => {
        const graph = build();
        layoutStress(graph, {viewportWidth: 800});
        expect(distance(graph, "a", "b")).toBeLessThan(distance(graph, "a", "d"));
        expect(distance(graph, "d", "e")).toBeLessThan(distance(graph, "a", "e"));
        for (const other of ["a", "b", "c", "d", "e", "f"]) expect(distance(graph, "lone", other)).toBeGreaterThan(distance(graph, "a", "b"));
        const ids = graph.nodes();
        for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) expect(distance(graph, ids[i]!, ids[j]!)).toBeGreaterThan(0);
    });

    test("同样的起点排出同样的位置", () => {
        const first = build();
        const second = build();
        layoutStress(first, {viewportWidth: 800});
        layoutStress(second, {viewportWidth: 800});
        for (const id of first.nodes()) expect(first.getNodeAttributes(id)).toMatchObject({x: second.getNodeAttribute(id, "x"), y: second.getNodeAttribute(id, "y")});
    });
});
