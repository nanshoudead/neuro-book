import {RememberedLoginDtoSchema, type RememberedLoginDto} from "nbook/shared/dto/auth.dto";
import {writeRememberedLogin} from "nbook/server/utils/remembered-login";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 登录成功后保存本机登录凭据。该接口在登录前可用，只面向本地桌面应用。
 */
export default defineEventHandler(async (event): Promise<RememberedLoginDto> => {
    const body = await validateBody(event, RememberedLoginDtoSchema);
    return writeRememberedLogin(body);
});
