import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import axios from "axios";
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
const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "DevLog-Firebase";
const NOT_FOUND_STATUS = 404;
const VALIDATION_FAILED_STATUS = 422;

// GitHub OAuth 코드로 Firebase 커스텀 토큰 발급에 필요한 사용자 정보를 조회합니다.
export async function requestGithubTokensWithCode(
    code: string
): Promise<{ accessToken: string; customToken: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new HttpsError("internal", "GitHub 환경 설정이 누락되었습니다.");
    }

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

    const accessToken = tokenData.access_token;

    const userResponse = await axios.get<GitHubUser>("https://api.github.com/user", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": ACCEPT,
            "User-Agent": USER_AGENT
        }
    });

    const userData = userResponse.data;
    const email = await resolveEmail(accessToken, userData.email);

    if (!userData.id || !email) {
        throw new HttpsError(
            "internal",
            "GitHub 사용자 데이터를 가져오지 못했습니다.",
            { reason: EMAIL_UNAVAILABLE_REASON }
        );
    }

    let uid;

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        uid = userRecord.uid;
        console.log(`이메일(${email})로 기존 사용자를 찾았습니다.`);
    } catch (error) {
        const userRecord = await admin.auth().createUser({
            displayName: userData.name || userData.login,
            email,
            photoURL: userData.avatar_url,
        });
        uid = userRecord.uid;
        console.log(`이메일 있는 새 사용자가 생성됨: ${uid}`);
    }

    const customToken = await admin.auth().createCustomToken(uid);

    console.log(`GitHub 사용자(${userData.login})에 대한 커스텀 토큰이 생성되었습니다. UID: ${uid}`);
    return {
        accessToken,
        customToken
    };
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

    try {
        const status = await requestGrantRevocation(
            clientId,
            clientSecret,
            accessToken
        );
        if (status === 204) {
            return { success: true };
        }
    } catch (error) {
        if (await isAccessTokenAlreadyInvalid(
            error,
            clientId,
            clientSecret,
            accessToken
        )) {
            console.warn("GitHub 토큰이 이미 무효화되어 폐기 성공으로 처리합니다.", { uid });
            return { success: true };
        }

        throw accessTokenRevocationError(error);
    }

    throw new HttpsError("internal", "토큰 폐기에 실패했습니다.");
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

// 외부 토큰 폐기 실패를 REST 계층에서 처리할 수 있는 오류로 변환합니다.
function accessTokenRevocationError(error: unknown): HttpsError {
    console.error("GitHub 토큰 폐기에 실패했습니다.", errorMetadata(error));
    return new HttpsError("internal", "GitHub 토큰 폐기에 실패했습니다.");
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

// 프로필에 공개 이메일이 없을 때 검증된 기본 이메일을 조회합니다.
async function resolveEmail(
    accessToken: string,
    profileEmail?: string
): Promise<string | undefined> {
    if (profileEmail) {
        return profileEmail;
    }

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
