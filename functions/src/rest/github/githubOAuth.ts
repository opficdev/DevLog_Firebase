import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { linkGithubProviderWithAccessToken } from "./githubProvider";
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
    claimOAuthTicket,
    consumeOAuthTicket,
    releaseOAuthTicket
} from "../oauth/session";
import type { ClaimedOAuthTicket } from "../oauth/session";

const PROVIDER = "github";
const PROVIDER_ID = "github.com";

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
