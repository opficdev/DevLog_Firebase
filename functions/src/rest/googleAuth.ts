import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { verifyGoogleIdToken } from "../auth/googleIdToken";
import type { GoogleTokenPayload } from "../auth/googleIdToken";
import { requestGoogleOAuthToken } from "./googleClient";
import type { GoogleOAuthToken } from "./googleClient";
import type { GoogleConfiguration } from "./googleConfiguration";
import {
    googleCredentialForUser,
    revokeGoogleCredential,
    saveGoogleCredential
} from "./googleCredential";
import type { GoogleCredential } from "./googleCredential";
import {
    linkGoogleProvider,
    resolveGoogleFirebaseUID
} from "./googleProvider";
import {
    claimOAuthSession,
    claimOAuthTicket,
    completeOAuthSession,
    consumeOAuthTicket,
    createOAuthSession,
    createOAuthVerifier,
    releaseOAuthSession,
    releaseOAuthTicket
} from "./oauth/session";
import type {
    ClaimedOAuthTicket,
    OAuthPurpose
} from "./oauth/session";

const PROVIDER = "google";
const PROVIDER_ID = "google.com";
const APP_CALLBACK_URL = "DevLog://oauth-callback";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// Google OAuth session 생성 응답을 나타냅니다.
export interface GoogleOAuthSessionResponse {
    // 앱이 열 Google authorization 주소를 저장합니다.
    authorizationURL: string;
}

// Google ticket에 저장된 credential과 검증된 사용자 payload를 나타냅니다.
interface GoogleTicketData {
    // 서버에 저장할 Google credential을 저장합니다.
    credential: GoogleCredential;
    // Firebase Auth 라우팅에 사용할 검증된 사용자 payload를 저장합니다.
    payload: GoogleTokenPayload;
}

// Google callback 실패를 앱이 종료할 수 있는 안전한 redirect 주소로 반환합니다.
export function googleCallbackFailureURL() {
    return callbackURL({ error: "oauth-failed" });
}

// Google 로그인 OAuth session을 생성합니다.
export async function createGoogleSignInSession(
    db: FirebaseFirestore.Firestore,
    configuration: GoogleConfiguration,
    appChallenge: string
): Promise<GoogleOAuthSessionResponse> {
    return createGoogleSession(
        db,
        configuration,
        "signIn",
        appChallenge
    );
}

// 현재 Firebase uid에 결합된 Google 계정 연결 session을 생성합니다.
export async function createGoogleAccountLinkSession(
    db: FirebaseFirestore.Firestore,
    configuration: GoogleConfiguration,
    uid: string,
    appChallenge: string
): Promise<GoogleOAuthSessionResponse> {
    return createGoogleSession(
        db,
        configuration,
        "link",
        appChallenge,
        uid
    );
}

// Google callback code와 ID token을 검증하고 앱에 ticket만 포함한 redirect 주소를 반환합니다.
export async function googleCallbackURL(
    db: FirebaseFirestore.Firestore,
    configuration: GoogleConfiguration,
    state?: string,
    code?: string
): Promise<string> {
    let session;
    try {
        if (!state || !code) {
            throw new HttpsError(
                "invalid-argument",
                "Google callback state와 code가 필요합니다."
            );
        }
        session = await claimOAuthSession(db, state, PROVIDER);
        const token = await requestGoogleOAuthToken(
            code,
            configuration.clientId,
            configuration.clientSecret,
            configuration.callbackURL,
            session.providerPKCEVerifier
        );
        const payload = await verifyGoogleIdToken(
            token.idToken,
            configuration.clientId
        );
        const ticket = await completeOAuthSession(db, {
            session,
            payload: ticketPayload(
                token,
                payload,
                configuration.clientId
            )
        });
        return callbackURL({ ticket });
    } catch (error) {
        if (session) {
            try {
                await releaseOAuthSession(db, session);
            } catch (releaseError) {
                console.error(
                    "Google OAuth callback session 해제 실패",
                    callbackErrorMetadata(releaseError)
                );
            }
        }
        console.error("Google OAuth callback 처리 실패", callbackErrorMetadata(error));
        return googleCallbackFailureURL();
    }
}

// Google 로그인 ticket을 검증하고 Firebase custom token만 반환합니다.
export async function requestGoogleCustomToken(
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
        const data = ticketDataFrom(claimed);
        const uid = await resolveGoogleFirebaseUID(data.payload);
        await saveGoogleCredential(db, uid, data.credential);
        const customToken = await admin.auth().createCustomToken(uid);
        await consumeOAuthTicket(db, claimed);
        return { customToken };
    } catch (error) {
        await releaseOAuthTicket(db, claimed);
        throw error;
    }
}

// Google 계정 연결 ticket을 검증하고 provider와 credential을 현재 사용자에 연결합니다.
export async function linkGoogleAccount(
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
        const data = ticketDataFrom(claimed);
        await linkGoogleProvider(uid, data.payload);
        await saveGoogleCredential(db, uid, data.credential);
        await consumeOAuthTicket(db, claimed);
    } catch (error) {
        await releaseOAuthTicket(db, claimed);
        throw error;
    }
}

// Google grant와 credential을 정리한 뒤 현재 사용자의 provider 연결을 해제합니다.
export async function unlinkGoogleAccount(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const auth = admin.auth();
    const user = await auth.getUser(uid);
    const providers = user.providerData ?? [];
    const hasGoogleProvider = providers.some((provider) =>
        provider.providerId === PROVIDER_ID
    );
    if (hasGoogleProvider && providers.length <= 1) {
        throw new HttpsError(
            "failed-precondition",
            "마지막 로그인 provider는 해제할 수 없습니다.",
            { reason: "last_provider" }
        );
    }

    const credential = await googleCredentialForUser(db, uid);
    await revokeGoogleCredential(db, uid, credential);
    if (hasGoogleProvider) {
        await auth.updateUser(uid, {
            providersToUnlink: [PROVIDER_ID]
        });
    }
}

// 일반 로그아웃과 별개로 Google grant와 서버 credential만 폐기합니다.
export async function revokeGoogleAccessToken(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const credential = await googleCredentialForUser(db, uid);
    await revokeGoogleCredential(db, uid, credential);
}

// 목적과 uid에 결합된 Google OAuth session과 authorization 주소를 생성합니다.
async function createGoogleSession(
    db: FirebaseFirestore.Firestore,
    configuration: GoogleConfiguration,
    purpose: OAuthPurpose,
    appChallenge: string,
    uid?: string
): Promise<GoogleOAuthSessionResponse> {
    const providerPKCEVerifier = createOAuthVerifier();
    const session = await createOAuthSession(db, {
        provider: PROVIDER,
        purpose,
        appChallenge,
        providerPKCEVerifier,
        uid
    });
    const authorizationURL = new URL(GOOGLE_AUTHORIZE_URL);
    authorizationURL.searchParams.set("client_id", configuration.clientId);
    authorizationURL.searchParams.set("redirect_uri", configuration.callbackURL);
    authorizationURL.searchParams.set("response_type", "code");
    authorizationURL.searchParams.set("scope", "openid email profile");
    authorizationURL.searchParams.set("access_type", "offline");
    authorizationURL.searchParams.set("prompt", "select_account");
    authorizationURL.searchParams.set("state", session.state);
    authorizationURL.searchParams.set("code_challenge", session.providerPKCEChallenge);
    authorizationURL.searchParams.set("code_challenge_method", "S256");
    return { authorizationURL: authorizationURL.toString() };
}

// 검증된 Google token과 사용자 claim을 Firestore ticket payload로 구성합니다.
function ticketPayload(
    token: GoogleOAuthToken,
    payload: GoogleTokenPayload,
    clientId: string
): Record<string, unknown> {
    const value: Record<string, unknown> = {
        accessToken: token.accessToken,
        clientId,
        issuer: payload.iss,
        subject: payload.sub,
        audience: payload.aud,
        issuedAt: payload.iat,
        expiresAt: payload.exp
    };
    addOptionalTicketValue(value, "refreshToken", token.refreshToken);
    addOptionalTicketValue(value, "email", payload.email);
    if (typeof payload.email_verified === "boolean") {
        value.emailVerified = payload.email_verified;
    }
    addOptionalTicketValue(value, "name", payload.name);
    addOptionalTicketValue(value, "picture", payload.picture);
    return value;
}

// 선택적인 문자열 claim이 있을 때만 ticket payload에 추가합니다.
function addOptionalTicketValue(
    payload: Record<string, unknown>,
    key: string,
    value: string | undefined
): void {
    if (value) {
        payload[key] = value;
    }
}

// OAuth ticket의 서버 전용 payload를 Google credential과 사용자 claim으로 변환합니다.
function ticketDataFrom(
    ticket: ClaimedOAuthTicket
): GoogleTicketData {
    const value = ticket.payload;
    const accessToken = requiredTicketString(value, "accessToken");
    const clientId = requiredTicketString(value, "clientId");
    const payload: GoogleTokenPayload = {
        iss: requiredTicketString(value, "issuer"),
        sub: requiredTicketString(value, "subject"),
        aud: requiredTicketString(value, "audience"),
        iat: requiredTicketNumber(value, "issuedAt"),
        exp: requiredTicketNumber(value, "expiresAt"),
        email: optionalTicketString(value, "email"),
        email_verified: optionalTicketBoolean(value, "emailVerified"),
        name: optionalTicketString(value, "name"),
        picture: optionalTicketString(value, "picture")
    };
    if (payload.aud !== clientId) {
        throw invalidGoogleTicketError();
    }
    return {
        credential: {
            accessToken,
            clientId,
            refreshToken: optionalTicketString(value, "refreshToken")
        },
        payload
    };
}

// Google ticket에서 필수 문자열을 반환합니다.
function requiredTicketString(
    payload: Record<string, unknown>,
    key: string
): string {
    const value = payload[key];
    if (typeof value !== "string" || !value) {
        throw invalidGoogleTicketError();
    }
    return value;
}

// Google ticket에서 선택적인 문자열을 반환합니다.
function optionalTicketString(
    payload: Record<string, unknown>,
    key: string
): string | undefined {
    const value = payload[key];
    return typeof value === "string" && value ? value : undefined;
}

// Google ticket에서 필수 숫자를 반환합니다.
function requiredTicketNumber(
    payload: Record<string, unknown>,
    key: string
): number {
    const value = payload[key];
    if (typeof value !== "number") {
        throw invalidGoogleTicketError();
    }
    return value;
}

// Google ticket에서 선택적인 boolean을 반환합니다.
function optionalTicketBoolean(
    payload: Record<string, unknown>,
    key: string
): boolean | undefined {
    const value = payload[key];
    return typeof value === "boolean" ? value : undefined;
}

// 잘못된 Google ticket payload 오류를 구성합니다.
function invalidGoogleTicketError() {
    return new HttpsError(
        "invalid-argument",
        "OAuth ticket의 Google 인증 정보가 올바르지 않습니다.",
        { reason: "invalid_oauth_ticket" }
    );
}

// 비밀값 없이 callback 오류의 종류와 문구만 로그 데이터로 구성합니다.
function callbackErrorMetadata(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message
        };
    }
    return {
        name: "UnknownError",
        message: "알 수 없는 Google OAuth callback 오류"
    };
}

// 앱 callback 주소에 ticket 또는 안전한 오류 값만 추가합니다.
function callbackURL(query: { ticket?: string; error?: string }) {
    const url = new URL(APP_CALLBACK_URL);
    if (query.ticket) {
        url.searchParams.set("ticket", query.ticket);
    } else if (query.error) {
        url.searchParams.set("error", query.error);
    }
    return url.toString();
}
