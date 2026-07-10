import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import axios from "axios";
import type { UserProvider } from "firebase-admin/auth";
import { FirestorePath } from "../common/firestorePath";

interface GitHubOAuthResponse {
    access_token: string;
    token_type: string;
    scope: string;
    error?: string;
}

interface GitHubUser {
    id: number;
    login: string;
    name?: string;
    email?: string;
    avatar_url?: string;
}

interface GitHubEmail {
    email: string;
    primary: boolean;
    verified: boolean;
}

const EMAIL_UNAVAILABLE_REASON = "email_not_found";
const EMAIL_MISMATCH_REASON = "email_mismatch";
const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "DevLog-Firebase";
const PROVIDER_ID = "github.com";
const NOT_FOUND_STATUS = 404;
const VALIDATION_FAILED_STATUS = 422;

// GitHub OAuth 로그인 요청을 처리해 access token과 Firebase custom token을 발급합니다.
export async function requestGithubTokensWithCode(
    code: string
): Promise<{ accessToken: string; customToken: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new HttpsError("internal", "GitHub 환경 설정이 누락되었습니다.");
    }

    const accessToken = await requestGitHubAccessToken(
        code,
        clientId,
        clientSecret
    );
    const userData = await requestGitHubUser(accessToken);
    const providerUID = githubProviderUID(userData);
    const linkedUID = await firebaseUIDForGitHubUser(providerUID);
    const uid = linkedUID ?? await firebaseUIDForUnlinkedGitHubLogin(
        accessToken,
        userData
    );
    const customToken = await admin.auth().createCustomToken(uid);

    console.log(`GitHub 사용자(${userData.login})에 대한 커스텀 토큰이 생성되었습니다. UID: ${uid}`);
    return { accessToken, customToken };
}

// 현재 Firebase 사용자에 GitHub provider를 연결하고 access token을 반환합니다.
export async function linkGithubProviderWithCode(
    uid: string,
    code: string
): Promise<{ accessToken: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new HttpsError("internal", "GitHub 환경 설정이 누락되었습니다.");
    }

    const accessToken = await requestGitHubAccessToken(
        code,
        clientId,
        clientSecret
    );
    const userData = await requestGitHubUser(accessToken);
    const {
        providerUID,
        email,
        providerToLink
    } = await githubLoginData(
        accessToken,
        userData
    );

    const emailMatches = await githubEmailMatchesUser(
        uid,
        email
    );
    if (!emailMatches) {
        await revokeGitHubOAuthGrant(
            uid,
            accessToken,
            clientId,
            clientSecret
        );
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
    console.log(`현재 사용자(${uid})에 GitHub provider 연결 처리가 완료되었습니다.`);

    return { accessToken };
}

// 현재 사용자의 이메일과 GitHub verified email의 일치 여부를 반환합니다.
async function githubEmailMatchesUser(
    uid: string,
    email: string
): Promise<boolean> {
    const userRecord = await admin.auth().getUser(uid);
    return userRecord.email === email;
}

// GitHub OAuth code를 access token으로 교환합니다.
async function requestGitHubAccessToken(
    code: string,
    clientId: string,
    clientSecret: string
): Promise<string> {
    const tokenResponse = await axios.post<GitHubOAuthResponse>
    ("https://github.com/login/oauth/access_token", {
        client_id: clientId,
        client_secret: clientSecret,
        code: code
    }, {
        headers: { "Accept": "application/json" }
    });

    const tokenData = tokenResponse.data;
    if (tokenData.error) {
        throw new HttpsError("invalid-argument", `GitHub OAuth 오류: ${tokenData.error}`);
    }

    return tokenData.access_token;
}

// GitHub API에서 로그인 계정의 프로필을 조회합니다.
async function requestGitHubUser(accessToken: string): Promise<GitHubUser> {
    const response = await axios.get<GitHubUser>("https://api.github.com/user", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": ACCEPT,
            "User-Agent": USER_AGENT
        }
    });

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
async function githubLoginData(
    accessToken: string,
    userData: GitHubUser
) {
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

// GitHub OAuth App grant를 제거하고 이미 무효화된 토큰은 성공 상태로 정리합니다.
export async function revokeGithubAccessTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string,
    requestedAccessToken?: unknown
): Promise<{ success: true }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new HttpsError("internal", "GitHub 클라이언트 설정이 누락되었습니다.");
    }

    let accessToken = typeof requestedAccessToken === "string" ? requestedAccessToken : "";
    if (!accessToken) {
        const tokenDoc = await db
            .doc(FirestorePath.userData(uid, FirestorePath.UserDataDocument.tokens))
            .get();
        accessToken = tokenDoc.exists ? tokenDoc.data()?.githubAccessToken : "";
    }

    if (!accessToken) {
        throw new HttpsError("not-found", "GitHub 토큰이 존재하지 않습니다.");
    }

    await revokeGitHubOAuthGrant(
        uid,
        accessToken,
        clientId,
        clientSecret
    );
    return { success: true };
}

// GitHub OAuth App grant를 폐기하고 이미 무효화된 토큰은 성공으로 처리합니다.
async function revokeGitHubOAuthGrant(
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

    throw new HttpsError("internal", "GitHub OAuth App grant 제거에 실패했습니다.");
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
    return new HttpsError("internal", "GitHub OAuth App grant 제거에 실패했습니다.");
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
    const emailResponse = await axios.get<GitHubEmail[]>("https://api.github.com/user/emails", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": ACCEPT,
            "User-Agent": USER_AGENT
        }
    });

    const primaryVerifiedEmail = emailResponse.data.find((item) =>
        item.primary && item.verified
    )?.email

    if (primaryVerifiedEmail) {
        return primaryVerifiedEmail;
    }

    return emailResponse.data.find((item) => item.verified)?.email;
}
