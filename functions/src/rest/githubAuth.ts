import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import axios from "axios";
import type { UserProvider } from "firebase-admin/auth";

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

// Firebase Auth provider 판단에 필요한 GitHub 인증 결과를 나타냅니다.
export interface GitHubLoginData {
    // GitHub provider uid를 저장합니다.
    providerUID: string;
    // 검증된 GitHub 이메일을 저장합니다.
    email: string;
    // Firebase Auth에 연결할 provider payload를 저장합니다.
    providerToLink: UserProvider;
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

const EMAIL_UNAVAILABLE_REASON = "email_not_found";
const EMAIL_MISMATCH_REASON = "email_mismatch";
const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "DevLog-Firebase";
const PROVIDER_ID = "github.com";
const NOT_FOUND_STATUS = 404;
const VALIDATION_FAILED_STATUS = 422;

// 현재 사용자의 이메일과 GitHub verified email의 일치 여부를 반환합니다.
async function githubEmailMatchesUser(
    uid: string,
    email: string
): Promise<boolean> {
    const userRecord = await admin.auth().getUser(uid);
    return userRecord.email === email;
}

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

// GitHub user id를 Firebase provider uid 문자열로 변환합니다.
function githubProviderUID(userData: GitHubUser): string {
    if (!userData.id) {
        throw new HttpsError(
            "internal",
            "GitHub 사용자 데이터를 가져오지 못했습니다.",
            { reason: EMAIL_UNAVAILABLE_REASON }
        );
    }

    return String(userData.id);
}

// Firebase Auth 라우팅에 필요한 GitHub user id, verified email, provider payload를 구성합니다.
export async function githubLoginData(
    accessToken: string,
    userData: GitHubUser
): Promise<GitHubLoginData> {
    const providerUID = githubProviderUID(userData);
    const email = await resolveEmail(accessToken);

    if (!email) {
        throw new HttpsError(
            "internal",
            "GitHub 사용자 데이터를 가져오지 못했습니다.",
            { reason: EMAIL_UNAVAILABLE_REASON }
        );
    }

    const providerToLink = githubProviderForUser(
        providerUID,
        email,
        userData
    );

    return {
        providerUID,
        email,
        providerToLink
    };
}

// 미연결 GitHub provider를 verified email 기준 Firebase uid에 연결합니다.
async function firebaseUIDForUnlinkedGitHubLogin(
    accessToken: string,
    userData: GitHubUser
): Promise<string> {
    const {
        email,
        providerToLink
    } = await githubLoginData(
        accessToken,
        userData
    );
    return firebaseUIDForGitHubEmail(
        email,
        providerToLink,
        userData
    );
}

// GitHub access token으로 provider UID 우선 Firebase uid를 결정합니다.
export async function resolveGithubFirebaseUID(
    accessToken: string
): Promise<string> {
    const userData = await requestGitHubUser(accessToken);
    const providerUID = githubProviderUID(userData);
    return await firebaseUIDForGitHubUser(providerUID) ??
        firebaseUIDForUnlinkedGitHubLogin(
            accessToken,
            userData
        );
}

// GitHub access token의 provider를 현재 Firebase 사용자에 연결합니다.
export async function linkGithubProviderWithAccessToken(
    uid: string,
    accessToken: string
): Promise<void> {
    const userData = await requestGitHubUser(accessToken);
    const {
        providerUID,
        email,
        providerToLink
    } = await githubLoginData(
        accessToken,
        userData
    );
    if (!await githubEmailMatchesUser(uid, email)) {
        throw new HttpsError(
            "invalid-argument",
            "이메일이 일치하지 않습니다.",
            { reason: EMAIL_MISMATCH_REASON }
        );
    }
    await linkGitHubProvider(
        uid,
        providerUID,
        providerToLink
    );
}

// GitHub provider가 다른 사용자에 묶여 있지 않을 때만 현재 사용자에 연결합니다.
async function linkGitHubProvider(
    uid: string,
    providerUID: string,
    providerToLink: UserProvider
): Promise<void> {
    try {
        const userRecord = await admin.auth().getUserByProviderUid(
            PROVIDER_ID,
            providerUID
        );

        if (userRecord.uid === uid) {
            return;
        }

        throw githubProviderLinkConflictError();
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") { throw error; }
    }

    await admin.auth().updateUser(uid, { providerToLink });
    console.log(`현재 사용자(${uid})에 GitHub provider 연결을 추가했습니다.`);
}

// 다른 사용자에 연결된 GitHub provider 충돌을 클라이언트가 구분할 수 있는 오류로 구성합니다.
function githubProviderLinkConflictError(): HttpsError {
    return new HttpsError(
        "failed-precondition",
        "GitHub provider가 다른 계정에 연결되어 있습니다.",
        { reason: "github_email_changed_account_conflict" }
    );
}

// 기존 GitHub provider에 연결된 Firebase uid를 반환합니다.
async function firebaseUIDForGitHubUser(
    providerUID: string
): Promise<string | undefined> {
    try {
        const userRecord = await admin.auth().getUserByProviderUid(
            PROVIDER_ID,
            providerUID
        );
        return userRecord.uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") { throw error; }
        return undefined;
    }
}

// 현재 GitHub verified email 기준으로 기존 계정 연결 또는 신규 생성을 수행합니다.
async function firebaseUIDForGitHubEmail(
    email: string,
    providerToLink: UserProvider,
    userData: GitHubUser
): Promise<string> {
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(userRecord.uid, { providerToLink });
        console.log(`이메일(${email}) 기존 사용자에 GitHub provider 연결을 추가했습니다.`);
        return userRecord.uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") { throw error; }
    }

    const userRecord = await admin.auth().createUser({
        displayName: userData.name || userData.login,
        email,
        photoURL: userData.avatar_url,
        providerToLink
    });
    console.log(`GitHub provider 연결 사용자가 생성됨: ${userRecord.uid}`);
    return userRecord.uid;
}

// GitHub user id 연결 정보를 Firebase Auth provider 형식으로 구성합니다.
function githubProviderForUser(
    providerUID: string,
    email: string,
    userData: GitHubUser
): UserProvider {
    return {
        providerId: PROVIDER_ID,
        uid: providerUID,
        displayName: userData.name || userData.login,
        email,
        photoURL: userData.avatar_url
    };
}

// Firebase Auth 예외에서 오류 코드를 추출합니다.
function firebaseAuthErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") { return undefined; }

    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : undefined;
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
            console.warn("GitHub OAuth App grant를 제거할 수 없지만 토큰이 이미 무효화되어 성공으로 처리합니다.", {
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
            console.warn("GitHub OAuth token이 이미 무효화되어 성공으로 처리합니다.", {
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

        console.error("GitHub 토큰 상태 확인에 실패했습니다.", errorMetadata(checkError));
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
    console.error("GitHub OAuth App grant 제거에 실패했습니다.", errorMetadata(error));
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
            message: error.message,
            data: error.response?.data
        };
    }

    if (error instanceof Error) {
        return {
            message: error.message
        };
    }

    return {
        message: "Unknown error"
    };
}

// GitHub email 목록에서 검증된 이메일을 조회합니다.
async function resolveEmail(accessToken: string): Promise<string | undefined> {
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

// GitHub 인증 서버 요청 실패를 REST 계층에서 구분할 수 있는 오류로 변환합니다.
async function requestGitHubAPI<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        console.error("GitHub 인증 서버 요청에 실패했습니다.", errorMetadata(error));
        throw new HttpsError(
            "internal",
            "GitHub 인증 서버 요청에 실패했습니다.",
            { reason: "github_provider_failed" }
        );
    }
}
