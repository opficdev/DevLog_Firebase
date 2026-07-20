import * as admin from "firebase-admin";
import { onRequest, HttpsError } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { FirestoreDatabase, firestoreFor } from "../common/firestore";
import { requestTodoDeletionInFirestore, undoTodoDeletionInFirestore } from "./todoDeletion";
import {
    requestPushNotificationDeletionInFirestore,
    undoPushNotificationDeletionInFirestore
} from "./pushNotificationDeletion";
import {
    requestWebPageDeletionByDocumentID,
    undoWebPageDeletionByDocumentID
} from "./webPageDeletion";
import {
    createAppleChallengeWithDatabase,
    linkAppleProviderWithDatabase,
    requestAppleCustomTokenWithDatabase,
    requestLegacyAppleCustomTokenWithDatabase,
    requestAppleRefreshTokenWithDatabase,
    refreshAppleAccessTokenWithDatabase,
    revokeAppleAccessTokenWithDatabase,
    unlinkAppleProviderWithDatabase
} from "./apple/auth";
import {
    githubConfiguration,
    githubOAuthConfigurationSecret
} from "./githubConfiguration";
import {
    googleConfiguration,
    googleOAuthConfigurationSecret
} from "./googleConfiguration";
import {
    createGithubAccountLinkSession,
    createGithubSignInSession,
    githubCallbackFailureURL,
    githubCallbackURL,
    linkGithubAccount,
    requestGithubCustomToken,
    revokeGithubAccessToken,
    unlinkGithubAccount
} from "./githubOAuth";
import {
    createGoogleAccountLinkSession,
    createGoogleSignInSession,
    googleCallbackFailureURL,
    googleCallbackURL,
    linkGoogleAccount,
    requestGoogleCustomToken,
    revokeGoogleAccessToken,
    unlinkGoogleAccount
} from "./googleAuth";
import {
    RestError,
    restErrorBodyFrom,
    restErrorFrom
} from "./error";
import { matchRestRoute, parseRestRouteSegments, RestRoute } from "./router";

const LOCATION = "asia-northeast3";

export const stagingApi = restApiFor("staging");
export const prodApi = restApiFor("prod");

function restApiFor(firebaseDB: FirestoreDatabase) {
    return onRequest({
        cors: true,
        maxInstances: 3,
        region: LOCATION,
        secrets: [
            githubOAuthConfigurationSecret,
            googleOAuthConfigurationSecret
        ]
    },
    async (request, response) => {
        try {
            const body = requestBody(request);
            const routeSegments = parseRestRouteSegments(pathSegmentsFromRequest(request));
            if (!routeSegments) {
                throw new RestError(404, "not-found", "API 경로를 찾을 수 없습니다.");
            }

            const route = matchRestRoute(request.method, routeSegments);
            if (!route) {
                throw new RestError(404, "not-found", "Endpoint를 찾을 수 없습니다.");
            }

            const db = firestoreFor(firebaseDB);
            const uid = route.requiresAuth ? await authenticatedUID(request) : undefined;
            if (route.action === "githubCallback") {
                let configuration;
                try {
                    configuration = githubConfiguration(firebaseDB);
                } catch (error) {
                    logger.error("GitHub OAuth callback 환경 설정 확인 실패", {
                        firebaseDB,
                        error: toError(error).message
                    });
                    response.redirect(302, githubCallbackFailureURL());
                    return;
                }
                const redirectURL = await githubCallbackURL(
                    db,
                    configuration,
                    optionalQueryString(request.query.state),
                    optionalQueryString(request.query.code)
                );
                response.redirect(302, redirectURL);
                return;
            }
            if (route.action === "googleCallback") {
                let configuration;
                try {
                    configuration = googleConfiguration(firebaseDB);
                } catch (error) {
                    logger.error("Google OAuth callback 환경 설정 확인 실패", {
                        firebaseDB,
                        error: toError(error).message
                    });
                    response.redirect(302, googleCallbackFailureURL());
                    return;
                }
                const redirectURL = await googleCallbackURL(
                    db,
                    configuration,
                    optionalQueryString(request.query.state),
                    optionalQueryString(request.query.code)
                );
                response.redirect(302, redirectURL);
                return;
            }

            const result = await handleRoute(
                route,
                db,
                firebaseDB,
                body,
                uid
            );

            if (result === undefined) {
                response.status(204).send();
            } else {
                response.status(200).json(result);
            }
        } catch (error) {
            sendRestError(request, response, error);
        }
    }
    );
}

async function handleRoute(
    route: RestRoute,
    db: FirebaseFirestore.Firestore,
    firebaseDB: FirestoreDatabase,
    body: Record<string, unknown>,
    uid?: string
): Promise<unknown> {
    switch (route.action) {
    case "githubCallback":
    case "googleCallback":
        return undefined;
    case "requestTodoDeletion":
        await requestTodoDeletionInFirestore(db, requiredUID(uid), requiredID(route));
        return { success: true };
    case "undoTodoDeletion":
        await undoTodoDeletionInFirestore(db, requiredUID(uid), requiredID(route));
        return { success: true };
    case "requestWebPageDeletion":
        await requestWebPageDeletionByDocumentID(db, requiredUID(uid), requiredID(route));
        return { success: true };
    case "undoWebPageDeletion":
        await undoWebPageDeletionByDocumentID(db, requiredUID(uid), requiredID(route));
        return { success: true };
    case "requestPushNotificationDeletion":
        await requestPushNotificationDeletionInFirestore(db, requiredUID(uid), requiredID(route));
        return { success: true };
    case "undoPushNotificationDeletion":
        await undoPushNotificationDeletionInFirestore(db, requiredUID(uid), requiredID(route));
        return { success: true };
    case "createAppleChallenge":
        return createAppleChallengeWithDatabase(db);
    case "requestAppleCustomToken":
        if ("challengeId" in body) {
            return requestAppleCustomTokenWithDatabase(
                db,
                requiredBodyString(body, "challengeId"),
                requiredBodyString(body, "authorizationCode"),
                optionalBodyString(body, "displayName")
            );
        }
        return requestLegacyAppleCustomTokenWithDatabase(
            db,
            requiredBodyString(body, "idToken"),
            requiredBodyString(body, "authorizationCode")
        );
    case "linkAppleProvider":
        return linkAppleProviderWithDatabase(
            db,
            requiredUID(uid),
            requiredBodyString(body, "challengeId"),
            requiredBodyString(body, "authorizationCode"),
            optionalBodyString(body, "credentialEmail")
        );
    case "unlinkAppleProvider":
        return unlinkAppleProviderWithDatabase(
            db,
            requiredUID(uid)
        );
    case "requestAppleRefreshToken":
        return requestAppleRefreshTokenWithDatabase(
            db,
            requiredUID(uid),
            requiredBodyString(body, "authorizationCode")
        );
    case "refreshAppleAccessToken":
        return refreshAppleAccessTokenWithDatabase(db, requiredUID(uid));
    case "revokeAppleAccessToken":
        return revokeAppleAccessTokenWithDatabase(
            db,
            requiredUID(uid),
            body.token
        );
    case "createGithubSignInSession":
        return createGithubSignInSession(
            db,
            githubConfiguration(firebaseDB),
            requiredBodyString(body, "appChallenge")
        );
    case "requestGithubCustomToken":
        return requestGithubCustomToken(
            db,
            firebaseDB,
            requiredBodyString(body, "ticket"),
            requiredBodyString(body, "appVerifier")
        );
    case "createGithubAccountLinkSession":
        return createGithubAccountLinkSession(
            db,
            githubConfiguration(firebaseDB),
            requiredUID(uid),
            requiredBodyString(body, "appChallenge")
        );
    case "linkGithubAccount":
        return linkGithubAccount(
            db,
            firebaseDB,
            requiredUID(uid),
            requiredBodyString(body, "ticket"),
            requiredBodyString(body, "appVerifier")
        );
    case "unlinkGithubAccount":
        return unlinkGithubAccount(
            db,
            requiredUID(uid),
            firebaseDB
        );
    case "revokeGithubAccessToken":
        return revokeGithubAccessToken(
            db,
            requiredUID(uid),
            firebaseDB
        );
    case "createGoogleSignInSession":
        return createGoogleSignInSession(
            db,
            googleConfiguration(firebaseDB),
            requiredBodyString(body, "appChallenge")
        );
    case "requestGoogleCustomToken":
        return requestGoogleCustomToken(
            db,
            requiredBodyString(body, "ticket"),
            requiredBodyString(body, "appVerifier")
        );
    case "createGoogleAccountLinkSession":
        return createGoogleAccountLinkSession(
            db,
            googleConfiguration(firebaseDB),
            requiredUID(uid),
            requiredBodyString(body, "appChallenge")
        );
    case "linkGoogleAccount":
        return linkGoogleAccount(
            db,
            requiredUID(uid),
            requiredBodyString(body, "ticket"),
            requiredBodyString(body, "appVerifier")
        );
    case "unlinkGoogleAccount":
        return unlinkGoogleAccount(
            db,
            requiredUID(uid)
        );
    case "revokeGoogleAccessToken":
        return revokeGoogleAccessToken(
            db,
            requiredUID(uid)
        );
    }
}

// query parameter에서 하나의 필수 문자열을 반환합니다.
function optionalQueryString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function authenticatedUID(request: Request): Promise<string> {
    const authorization = request.headers.authorization;
    const bearerPrefix = "Bearer ";
    if (!authorization || !authorization.startsWith(bearerPrefix)) {
        throw new HttpsError("unauthenticated", "인증 토큰이 필요합니다.");
    }

    const token = authorization.slice(bearerPrefix.length).trim();
    if (!token) {
        throw new HttpsError("unauthenticated", "인증 토큰이 필요합니다.");
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
}

function pathSegmentsFromRequest(request: Request): string[] {
    const path = request.path || new URL(request.url, "https://localhost").pathname;
    return path
        .split("/")
        .filter((segment) => segment.length !== 0)
        .map((segment) => decodeURIComponent(segment));
}

function requestBody(request: Request): Record<string, unknown> {
    const body = request.body;
    if (!body) {
        return {};
    }

    if (Buffer.isBuffer(body)) {
        return parseBodyString(body.toString("utf8"));
    }

    if (typeof body === "string") {
        return parseBodyString(body);
    }

    if (typeof body === "object") {
        return body as Record<string, unknown>;
    }

    return {};
}

function parseBodyString(body: string): Record<string, unknown> {
    if (!body) {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body) as unknown;
    } catch {
        throw new HttpsError("invalid-argument", "JSON body 형식이 올바르지 않습니다.");
    }

    if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
    }

    return {};
}

function requiredID(route: RestRoute): string {
    const id = route.id?.trim();
    if (!id) {
        throw new HttpsError("invalid-argument", "id가 필요합니다.");
    }
    return id;
}

function requiredUID(uid?: string): string {
    if (!uid) {
        throw new HttpsError("unauthenticated", "인증된 사용자가 아닙니다.");
    }
    return uid;
}

function requiredBodyString(body: Record<string, unknown>, key: string): string {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new HttpsError("invalid-argument", `${key}가 필요합니다.`);
    }
    return value.trim();
}

// 요청 body의 선택 문자열을 공백을 제거해 반환합니다.
function optionalBodyString(
    body: Record<string, unknown>,
    key: string
): string | undefined {
    const value = body[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `${key} 형식이 올바르지 않습니다.`);
    }

    const trimmedValue = value.trim();
    return trimmedValue || undefined;
}

// REST 오류 응답 body와 같은 내용을 Cloud Logging에 남긴 뒤 클라이언트에 반환합니다.
function sendRestError(
    request: Request,
    response: Response,
    error: unknown
): void {
    const restError = restErrorFrom(error);
    const body = restErrorBodyFrom(error);

    logger.error("REST API 오류 응답", toError(error), {
        method: request.method,
        path: request.path || new URL(request.url, "https://localhost").pathname,
        status: restError.status,
        body
    });
    response.status(restError.status).json(body);
}
