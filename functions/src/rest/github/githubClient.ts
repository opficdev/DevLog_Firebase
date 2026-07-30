import axios from "axios";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";

// GitHub authorization code 교환 응답을 나타냅니다.
interface GitHubOAuthResponse {
    // 발급된 사용자 access token을 저장합니다.
    access_token: string;
    // 발급 token 종류를 저장합니다.
    token_type: string;
    // 승인된 OAuth scope를 저장합니다.
    scope: string;
    // GitHub token 교환 오류 코드를 저장합니다.
    error?: string;
}

// GitHub 사용자 API에서 인증 판단에 사용하는 프로필을 나타냅니다.
export interface GitHubUser {
    // GitHub 계정의 숫자 식별자를 저장합니다.
    id: number;
    // GitHub 로그인 이름을 저장합니다.
    login: string;
    // 공개 표시 이름을 저장합니다.
    name?: string;
    // 공개 이메일을 저장합니다.
    email?: string;
    // 공개 프로필 이미지 주소를 저장합니다.
    avatar_url?: string;
}

// GitHub email API가 반환한 이메일 검증 상태를 나타냅니다.
interface GitHubEmail {
    // GitHub 계정 이메일을 저장합니다.
    email: string;
    // 대표 이메일 여부를 저장합니다.
    primary: boolean;
    // GitHub 검증 완료 여부를 저장합니다.
    verified: boolean;
}

const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "DevLog-Firebase";
const NOT_FOUND_STATUS = 404;
const VALIDATION_FAILED_STATUS = 422;

// GitHub OAuth code를 access token으로 교환합니다.
export async function requestGitHubAccessToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectURL?: string,
    codeVerifier?: string
): Promise<string> {
    const tokenRequest: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code
    };
    if (redirectURL) {
        tokenRequest.redirect_uri = redirectURL;
    }
    if (codeVerifier) {
        tokenRequest.code_verifier = codeVerifier;
    }
    const tokenResponse = await requestGitHubAPI(() =>
        axios.post<GitHubOAuthResponse>
        ("https://github.com/login/oauth/access_token", tokenRequest, {
            headers: { "Accept": "application/json" }
        })
    );

    const tokenData = tokenResponse.data;
    if (tokenData.error) {
        throw new HttpsError("invalid-argument", `GitHub OAuth 오류: ${tokenData.error}`);
    }

    return tokenData.access_token;
}

// GitHub API에서 로그인 계정의 프로필을 조회합니다.
export async function requestGitHubUser(accessToken: string): Promise<GitHubUser> {
    const response = await requestGitHubAPI(() =>
        axios.get<GitHubUser>("https://api.github.com/user", {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": ACCEPT,
                "User-Agent": USER_AGENT
            }
        })
    );

    return response.data;
}

// GitHub email 목록에서 검증된 이메일을 조회합니다.
export async function requestGitHubVerifiedEmail(
    accessToken: string
): Promise<string | undefined> {
    const emailResponse = await requestGitHubAPI(() =>
        axios.get<GitHubEmail[]>("https://api.github.com/user/emails", {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": ACCEPT,
                "User-Agent": USER_AGENT
            }
        })
    );

    const primaryVerifiedEmail = emailResponse.data.find((item) =>
        item.primary && item.verified
    )?.email

    if (primaryVerifiedEmail) {
        return primaryVerifiedEmail;
    }

    return emailResponse.data.find((item) => item.verified)?.email;
}

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

// GitHub 인증 서버 요청 실패를 REST 계층에서 구분할 수 있는 오류로 변환합니다.
async function requestGitHubAPI<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        logger.error("GitHub 인증 서버 요청에 실패했습니다.", errorMetadata(error));
        throw new HttpsError(
            "internal",
            "GitHub 인증 서버 요청에 실패했습니다.",
            { reason: "github_provider_failed" }
        );
    }
}
