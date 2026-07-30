import * as admin from "firebase-admin";
import type {
    UpdateRequest,
    UserProvider,
    UserRecord
} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import {
    requestGitHubUser,
    requestGitHubVerifiedEmail
} from "./githubClient";
import type { GitHubUser } from "./githubClient";

// Firebase Auth provider 판단에 필요한 GitHub 인증 결과를 나타냅니다.
export interface GitHubLoginData {
    // GitHub provider uid를 저장합니다.
    providerUID: string;
    // 검증된 GitHub 이메일을 저장합니다.
    email: string;
    // Firebase Auth에 연결할 provider payload를 저장합니다.
    providerToLink: UserProvider;
}

const EMAIL_UNAVAILABLE_REASON = "email_not_found";
const EMAIL_MISMATCH_REASON = "email_mismatch";
const PROVIDER_ID = "github.com";

// GitHub verified email과 일치하는 현재 Firebase Auth 사용자를 반환합니다.
async function githubUserWithMatchingEmail(
    uid: string,
    email: string
): Promise<UserRecord> {
    const user = await admin.auth().getUser(uid);
    if (user.email !== email) {
        throw new HttpsError(
            "invalid-argument",
            "이메일이 일치하지 않습니다.",
            { reason: EMAIL_MISMATCH_REASON }
        );
    }
    return user;
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
    const email = await requestGitHubVerifiedEmail(accessToken);

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
    return await firebaseUIDForGitHubUser(
        providerUID,
        accessToken,
        userData
    ) ??
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
    const user = await githubUserWithMatchingEmail(uid, email);
    const currentProvider = user.providerData.find((provider) =>
        provider.providerId === PROVIDER_ID
    );
    if (currentProvider && currentProvider.uid !== providerUID) {
        throw githubProviderLinkConflictError();
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
            await admin.auth().updateUser(uid, { providerToLink });
            return;
        }

        throw githubProviderLinkConflictError();
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") { throw error; }
    }

    await admin.auth().updateUser(uid, { providerToLink });
    logger.info(`현재 사용자(${uid})에 GitHub provider 연결을 추가했습니다.`);
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
    providerUID: string,
    accessToken: string,
    userData: GitHubUser
): Promise<string | undefined> {
    try {
        const userRecord = await admin.auth().getUserByProviderUid(
            PROVIDER_ID,
            providerUID
        );
        const email = await requestGitHubVerifiedEmail(accessToken);
        const update: UpdateRequest = {
            displayName: userData.name || userData.login,
            photoURL: userData.avatar_url ?? null
        };
        const githubOnly = userRecord.providerData.every((provider) =>
            provider.providerId === PROVIDER_ID
        );
        if (githubOnly) {
            if (email) {
                try {
                    const emailUser = await admin.auth().getUserByEmail(email);
                    if (emailUser.uid === userRecord.uid) {
                        update.email = email;
                    }
                } catch (error) {
                    if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
                        throw error;
                    }
                    update.email = email;
                }
            }
        }
        await admin.auth().updateUser(userRecord.uid, update);
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
        await admin.auth().updateUser(userRecord.uid, {
            displayName: userData.name || userData.login,
            photoURL: userData.avatar_url ?? null,
            providerToLink
        });
        logger.info(`이메일(${email}) 기존 사용자에 GitHub provider 연결을 추가했습니다.`);
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
    logger.info(`GitHub provider 연결 사용자가 생성됨: ${userRecord.uid}`);
    return userRecord.uid;
}

// GitHub user id 연결 정보를 Firebase Auth provider 형식으로 구성합니다.
function githubProviderForUser(
    providerUID: string,
    email: string | undefined,
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
