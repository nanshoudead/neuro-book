import type {EntityKind} from "../../core/dataset";

/** 全部对象类别（与 core/dataset 的 ENTITY_KINDS 相同）。这里另写一份，免得网页为一个常量把 TypeBox 打进包里。 */
export const ALL_KINDS: EntityKind[] = ["person", "persona", "group", "place", "item", "concept", "task", "other"];

/** 对象类别的中文名。 */
export const KIND_LABEL: Record<EntityKind, string> = {person: "人物", persona: "身份", group: "组织", item: "物品", concept: "概念", place: "地点", task: "任务", other: "其他"};
