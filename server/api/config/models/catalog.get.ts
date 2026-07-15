import {neuroModelCatalog} from "nbook/server/models/catalog";
import type {NeuroModelCatalogDto} from "nbook/shared/dto/app-settings.dto";

/** 返回不读取凭据、不访问网络的 NeuroBook Provider Preset 与 Model Catalog。 */
export default defineEventHandler((): NeuroModelCatalogDto => neuroModelCatalog());
