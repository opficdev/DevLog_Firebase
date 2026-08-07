import axios from "axios";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";

const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "DevLog-Firebase";
const NOT_FOUND_STATUS = 404;
const VALIDATION_FAILED_STATUS = 422;

// GitHub OAuth App grant를 폐기하고 이미 무효화된 토큰은 성공으로 처리합니다.
export async function revokeGitHubOAuthGrant(
    uid: string,
    accessToken: string,
    clientId: string,
    clientSecret: string
): Promise<void> {
    try {
        const status = await requestGrantRevocation(
            clientId,
            clientSecret,
            accessToken
        );
        if (status === 204) {
            return;
        }
    } catch (error) {
        if (await isAccessTokenAlreadyInvalid(
            error,
            clientId,
            clientSecret,
            accessToken
        )) {
            logger.warn("GitHub OAuth App grant를 제거할 수 없지만 토큰이 이미 무효화되어 성공으로 처리합니다.", {
                uid, github: errorMetadata(error)
            });
            return;
        }

        throw grantRevocationError(error);
    }

    throw new HttpsError(
        "internal",
        "GitHub OAuth App grant 제거에 실패했습니다.",
        { reason: "github_revoke_failed" }
    );
}

// GitHub OAuth App의 다른 token은 유지하고 지정한 access token만 폐기합니다.
export async function revokeGitHubOAuthToken(
    uid: string,
    accessToken: string,
    clientId: string,
    clientSecret: string
): Promise<void> {
    try {
        const response = await axios.request({
            method: "delete",
            url: applicationTokenURL(clientId),
            ...appRequestConfig(
                clientId,
                clientSecret
            ),
            data: {
                access_token: accessToken
            }
        });
        if (response.status === 204) {
            return;
        }
    } catch (error) {
        if (await isAccessTokenAlreadyInvalid(
            error,
            clientId,
            clientSecret,
            accessToken
        )) {
            logger.warn("GitHub OAuth token이 이미 무효화되어 성공으로 처리합니다.", {
                uid, github: errorMetadata(error)
            });
            return;
        }
        throw grantRevocationError(error);
    }
    throw new HttpsError(
        "internal",
        "GitHub OAuth token 폐기에 실패했습니다.",
        { reason: "github_revoke_failed" }
    );
}

// GitHub OAuth App grant 제거 요청을 보내고 HTTP 응답 상태를 반환합니다.
async function requestGrantRevocation(
    clientId: string,
    clientSecret: string,
    accessToken: string
): Promise<number> {
    const response = await axios.request({
        method: "delete",
        url: applicationGrantURL(clientId),
        ...appRequestConfig(
            clientId,
            clientSecret
        ),
        data: {
            access_token: accessToken,
        },
    });

    return response.status;
}

// GitHub 토큰 조회 결과로 삭제 실패가 이미 무효화된 토큰 때문인지 판별합니다.
async function isAccessTokenAlreadyInvalid(
    error: unknown,
    clientId: string,
    clientSecret: string,
    accessToken: string
): Promise<boolean> {
    const status = responseStatus(error);

    if (
        status !== NOT_FOUND_STATUS &&
        status !== VALIDATION_FAILED_STATUS
    ) { return false; }

    try {
        await axios.request({
            method: "post",
            url: applicationTokenURL(clientId),
            ...appRequestConfig(
                clientId,
                clientSecret
            ),
            data: {
                access_token: accessToken,
            },
        });
        return false;
    } catch (checkError) {
        if (responseStatus(checkError) === NOT_FOUND_STATUS) { return true; }

        logger.error("GitHub 토큰 상태 확인에 실패했습니다.", errorMetadata(checkError));
        return false;
    }
}

// GitHub OAuth 애플리케이션 토큰 관리 API 주소를 구성합니다.
function applicationTokenURL(clientId: string): string {
    return `https://api.github.com/applications/${clientId}/token`;
}

// GitHub OAuth 애플리케이션 grant 관리 API 주소를 구성합니다.
function applicationGrantURL(clientId: string): string {
    return `https://api.github.com/applications/${clientId}/grant`;
}

// GitHub OAuth 애플리케이션 인증과 공통 요청 헤더를 구성합니다.
function appRequestConfig(
    clientId: string,
    clientSecret: string
) {
    return {
        auth: {
            username: clientId,
            password: clientSecret,
        },
        headers: {
            Accept: ACCEPT,
            "User-Agent": USER_AGENT,
        },
    };
}

// GitHub API 예외에서 HTTP 응답 상태를 추출합니다.
function responseStatus(error: unknown): number | undefined {
    if (!axios.isAxiosError(error)) {
        return undefined;
    }

    return error.response?.status;
}

// 외부 grant 제거 실패를 REST 계층에서 처리할 수 있는 오류로 변환합니다.
function grantRevocationError(error: unknown): HttpsError {
    logger.error("GitHub OAuth App grant 제거에 실패했습니다.", errorMetadata(error));
    return new HttpsError(
        "internal",
        "GitHub OAuth App grant 제거에 실패했습니다.",
        { reason: "github_revoke_failed" }
    );
}

// 로그에 남길 수 있는 외부 API 실패 정보를 구성합니다.
function errorMetadata(error: unknown) {
    if (axios.isAxiosError(error)) {
        return {
            status: error.response?.status,
            errorMessage: error.message,
            data: error.response?.data
        };
    }

    if (error instanceof Error) {
        return {
            errorMessage: error.message
        };
    }

    return {
        errorMessage: "Unknown error"
    };
}
