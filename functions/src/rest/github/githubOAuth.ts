import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import {
    requestGitHubAccessToken,
    revokeGitHubOAuthToken
} from "./githubClient";
import {
    linkGithubProviderWithAccessToken,
    resolveGithubFirebaseUID
} from "./githubProvider";
import type { GitHubConfiguration } from "./githubConfiguration";
import {
    githubRevocationConfiguration
} from "./githubConfiguration";
import {
    githubCredentialForUser,
    revokePendingGithubCredentials,
    revokeGithubCredential,
    saveGithubCredential
} from "./githubCredential";
import type { GitHubCredential } from "./githubCredential";
import {
    claimOAuthSession,
    claimOAuthTicket,
    completeOAuthSession,
    consumeOAuthTicket,
    createOAuthSession,
    createOAuthVerifier,
    releaseOAuthSession,
    releaseOAuthTicket,
    storeOAuthSessionCleanupPayload
} from "../oauth/session";
import type {
    ClaimedOAuthTicket,
    OAuthPurpose
} from "../oauth/session";

const PROVIDER = "github";
const PROVIDER_ID = "github.com";
const APP_CALLBACK_URL = "DevLog://oauth-callback";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

// GitHub OAuth session 생성 응답을 나타냅니다.
export interface GitHubOAuthSessionResponse {
    // 앱이 열 GitHub authorization 주소를 저장합니다.
    authorizationURL: string;
}

// GitHub callback 실패를 앱이 종료할 수 있는 안전한 redirect 주소로 반환합니다.
export function githubCallbackFailureURL(): string {
    return callbackURL({ error: "oauth-failed" });
}

// GitHub 로그인 OAuth session을 생성합니다.
export async function createGithubSignInSession(
    db: FirebaseFirestore.Firestore,
    configuration: GitHubConfiguration,
    appChallenge: string
): Promise<GitHubOAuthSessionResponse> {
    return createGithubSession(
        db,
        configuration,
        "signIn",
        appChallenge
    );
}

// 현재 Firebase uid에 결합된 GitHub 계정 연결 session을 생성합니다.
export async function createGithubAccountLinkSession(
    db: FirebaseFirestore.Firestore,
    configuration: GitHubConfiguration,
    uid: string,
    appChallenge: string
): Promise<GitHubOAuthSessionResponse> {
    return createGithubSession(
        db,
        configuration,
        "link",
        appChallenge,
        uid
    );
}

// GitHub callback code를 교환하고 앱에 ticket만 포함한 redirect 주소를 반환합니다.
export async function githubCallbackURL(
    db: FirebaseFirestore.Firestore,
    configuration: GitHubConfiguration,
    state?: string,
    code?: string
): Promise<string> {
    let session;
    let accessToken: string | undefined;
    try {
        if (!state || !code) {
            throw new HttpsError(
                "invalid-argument",
                "GitHub callback state와 code가 필요합니다."
            );
        }
        session = await claimOAuthSession(
            db,
            state,
            PROVIDER
        );
        accessToken = await requestGitHubAccessToken(
            code,
            configuration.clientId,
            configuration.clientSecret,
            configuration.callbackURL,
            session.providerPKCEVerifier
        );
        const ticket = await completeOAuthSession(db, {
            session,
            payload: {
                accessToken,
                clientId: configuration.clientId
            }
        });
        return callbackURL({ ticket });
    } catch (error) {
        if (accessToken) {
            try {
                await revokeGitHubOAuthToken(
                    session?.uid ?? "oauth-session",
                    accessToken,
                    configuration.clientId,
                    configuration.clientSecret
                );
            } catch (revokeError) {
                logger.error(
                    "GitHub OAuth callback 보상 폐기 실패",
                    callbackErrorMetadata(revokeError)
                );
                if (session) {
                    try {
                        await storeOAuthSessionCleanupPayload(db, session, {
                            accessToken,
                            clientId: configuration.clientId
                        });
                    } catch (storageError) {
                        logger.error(
                            "GitHub OAuth callback 보상 정보 저장 실패",
                            callbackErrorMetadata(storageError)
                        );
                    }
                }
            }
        }
        if (session) {
            try {
                await releaseOAuthSession(db, session);
            } catch (releaseError) {
                logger.error(
                    "GitHub OAuth callback session 해제 실패",
                    callbackErrorMetadata(releaseError)
                );
            }
        }
        logger.error("GitHub OAuth callback 처리 실패", callbackErrorMetadata(error));
        return githubCallbackFailureURL();
    }
}

// 비밀값 없이 callback 오류의 종류와 문구만 로그 데이터로 구성합니다.
function callbackErrorMetadata(error: unknown): { name: string; message: string } {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message
        };
    }
    return {
        name: "UnknownError",
        message: "알 수 없는 GitHub OAuth callback 오류"
    };
}

// GitHub 로그인 ticket을 검증하고 Firebase custom token만 반환합니다.
export async function requestGithubCustomToken(
    db: FirebaseFirestore.Firestore,
    ticket: string,
    appVerifier: string
): Promise<{ customToken: string }> {
    const claimed = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        PROVIDER,
        "signIn"
    );
    try {
        const credential = credentialFrom(claimed);
        const uid = await resolveGithubFirebaseUID(credential.accessToken);
        await saveGithubCredential(
            db,
            uid,
            credential
        );
        await revokePendingGithubCredentials(db, uid);
        const customToken = await admin.auth().createCustomToken(uid);
        await consumeOAuthTicket(db, claimed);
        return { customToken };
    } catch (error) {
        await releaseOAuthTicket(db, claimed);
        throw error;
    }
}

// GitHub 계정 연결 ticket을 검증하고 provider와 credential을 현재 사용자에 연결합니다.
export async function linkGithubAccount(
    db: FirebaseFirestore.Firestore,
    uid: string,
    ticket: string,
    appVerifier: string
): Promise<void> {
    const claimed = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        PROVIDER,
        "link",
        uid
    );
    try {
        const credential = credentialFrom(claimed);
        await linkGithubProviderWithAccessToken(
            uid,
            credential.accessToken
        );
        await saveGithubCredential(
            db,
            uid,
            credential
        );
        await revokePendingGithubCredentials(db, uid);
        await consumeOAuthTicket(db, claimed);
    } catch (error) {
        await releaseOAuthTicket(db, claimed);
        throw error;
    }
}

// GitHub grant와 credential을 정리한 뒤 현재 사용자의 provider 연결을 해제합니다.
export async function unlinkGithubAccount(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const auth = admin.auth();
    const user = await auth.getUser(uid);
    const providers = user.providerData ?? [];
    const hasGithubProvider = providers.some((provider) =>
        provider.providerId === PROVIDER_ID
    );
    if (!hasGithubProvider) {
        const context = await revocationContext(db, uid);
        await revokePendingGithubCredentials(db, uid);
        await revokeGithubCredential(
            db,
            uid,
            context.configuration,
            context.credential
        );
        return;
    }
    if (providers.length <= 1) {
        throw new HttpsError(
            "failed-precondition",
            "마지막 로그인 provider는 해제할 수 없습니다.",
            { reason: "last_provider" }
        );
    }

    const context = await revocationContext(db, uid);
    await revokePendingGithubCredentials(db, uid);
    await revokeGithubCredential(
        db,
        uid,
        context.configuration,
        context.credential
    );
    await auth.updateUser(uid, {
        providersToUnlink: [PROVIDER_ID]
    });
}

// 일반 로그아웃과 별개로 GitHub grant와 서버 credential만 폐기합니다.
export async function revokeGithubAccessToken(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const credential = await githubCredentialForUser(
        db,
        uid
    );
    await revokePendingGithubCredentials(db, uid);
    await revokeGithubCredential(
        db,
        uid,
        githubRevocationConfiguration(credential?.clientId),
        credential
    );
}

// 목적과 uid에 결합된 GitHub OAuth session과 authorization 주소를 생성합니다.
async function createGithubSession(
    db: FirebaseFirestore.Firestore,
    configuration: GitHubConfiguration,
    purpose: OAuthPurpose,
    appChallenge: string,
    uid?: string
): Promise<GitHubOAuthSessionResponse> {
    const providerPKCEVerifier = createOAuthVerifier();
    const session = await createOAuthSession(db, {
        provider: PROVIDER,
        purpose,
        appChallenge,
        providerPKCEVerifier,
        uid
    });
    const authorizationURL = new URL(GITHUB_AUTHORIZE_URL);
    authorizationURL.searchParams.set("client_id", configuration.clientId);
    authorizationURL.searchParams.set("redirect_uri", configuration.callbackURL);
    authorizationURL.searchParams.set("scope", "read:user user:email");
    authorizationURL.searchParams.set("prompt", "select_account");
    authorizationURL.searchParams.set("state", session.state);
    authorizationURL.searchParams.set("code_challenge", session.providerPKCEChallenge);
    authorizationURL.searchParams.set("code_challenge_method", "S256");
    return { authorizationURL: authorizationURL.toString() };
}

// ticket의 서버 전용 payload에서 GitHub access token을 반환합니다.
function credentialFrom(ticket: ClaimedOAuthTicket): GitHubCredential {
    const accessToken = ticket.payload.accessToken;
    const clientId = ticket.payload.clientId;
    if (typeof accessToken !== "string" || !accessToken) {
        throw new HttpsError(
            "invalid-argument",
            "OAuth ticket에 GitHub access token이 없습니다.",
            { reason: "invalid_oauth_ticket" }
        );
    }
    if (typeof clientId !== "string" || !clientId) {
        throw new HttpsError(
            "invalid-argument",
            "OAuth ticket에 GitHub OAuth App 정보가 없습니다.",
            { reason: "invalid_oauth_ticket" }
        );
    }
    return { accessToken, clientId };
}

// 저장된 credential의 발급 App과 일치하는 grant 폐기 설정을 반환합니다.
// 한 번 읽은 현재 credential과 발급 App 설정을 함께 전달합니다.
interface GitHubRevocationContext {
    // 폐기할 현재 credential을 저장합니다.
    credential?: GitHubCredential;
    // credential 발급 App에 대응하는 설정을 저장합니다.
    configuration: GitHubConfiguration;
}

// 현재 credential과 같은 snapshot에서 결정한 grant 폐기 설정을 반환합니다.
async function revocationContext(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<GitHubRevocationContext> {
    const credential = await githubCredentialForUser(
        db,
        uid
    );
    return {
        credential,
        configuration: githubRevocationConfiguration(credential?.clientId)
    };
}

// 앱 callback 주소에 ticket 또는 안전한 오류 값만 추가합니다.
function callbackURL(query: { ticket?: string; error?: string }): string {
    const url = new URL(APP_CALLBACK_URL);
    if (query.ticket) {
        url.searchParams.set("ticket", query.ticket);
    } else if (query.error) {
        url.searchParams.set("error", query.error);
    }
    return url.toString();
}
