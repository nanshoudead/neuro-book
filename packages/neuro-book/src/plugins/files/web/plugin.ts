/**
 * `nbook.files` 的浏览器入口：按调用方提供文件客户端 `filesKey`（docs/specs/workspace/resources.md）。不启动即激活：
 * 第一个依赖它的入口（资源管理器、编辑器）激活时才激活。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {filesKey, projectFilesContract, userFilesContract} from "../shared/contracts";
import type {FilesService} from "../shared/contracts";
import {createFilesClient, createWatchRegistry} from "./client";
import type {FilesFacade} from "./client";

export const filesBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        provides: [filesKey],
        // 以原调用方的身份调用两份合同：提供者看到的是用文件客户端的插件，据此确定写入来源。
        remoteDelegates: [projectFilesContract, userFilesContract],
        dependencies: [{key: diagnosticsKey}, {key: windowProjectKey}],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const watches = createWatchRegistry(context.remote, (error) => diagnostics.record({level: "warn", event: "files.watch.listener-failed", message: "文件变更的监听者抛错", error, source: {plugin: descriptor.id}}));
            context.scope.register({kind: "files-watches", label: `${descriptor.id} browser`, value: watches, release: (value) => value.close()});
            const facades = new WeakMap<FilesService, FilesFacade>();
            // 窗口一生只绑定一个项目代次（browser-host 启动序列第 5 步），字节地址按它拼。
            const bound = context.services.require(windowProjectKey).project;
            const project = bound === null ? null : {id: bound.id, generation: bound.generation};
            return {services: [providePerConsumer(filesKey, (consumer) => {
                const facade = createFilesClient(context.remote, consumer, watches, project);
                facades.set(facade.service, facade);
                return facade.service;
            }, {release: (service) => facades.get(service)?.release()})]};
        },
    })],
};
