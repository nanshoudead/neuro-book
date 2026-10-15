import type {EntityKind} from "../../core/dataset";

/** 全部对象类别（与 core/dataset 的 ENTITY_KINDS 相同）。这里另写一份，免得网页为一个常量把 TypeBox 打进包里。 */
export const ALL_KINDS: EntityKind[] = ["person", "persona", "group", "place", "item", "concept", "task", "other"];
