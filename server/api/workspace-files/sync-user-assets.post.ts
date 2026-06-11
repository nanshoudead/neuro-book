import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";

/**
 * 准备最新系统 assets 后同步到用户 assets。
 */
export default defineEventHandler(async () => {
    const result = await prepareSystemAssets({syncUserAssets: true});
    return result.userAssetsSync;
});
