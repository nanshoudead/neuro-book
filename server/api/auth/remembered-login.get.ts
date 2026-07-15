import type {RememberedLoginDto} from "nbook/shared/dto/auth.dto";
import {readRememberedLogin} from "nbook/server/utils/remembered-login";

/**
 * 读取本机记住的登录凭据。该接口在登录前可用，只面向本地桌面应用。
 */
export default defineEventHandler(async (): Promise<RememberedLoginDto> => {
    return readRememberedLogin();
});
