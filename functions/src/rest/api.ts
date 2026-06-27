import * as admin from "firebase-admin";
import { onRequest, HttpsError } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { FirestoreDatabaseID, firestoreFor } from "../common/firestore";
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
    requestAppleCustomTokenWithDatabase,
    requestAppleRefreshTokenWithDatabase,
    refreshAppleAccessTokenWithDatabase,
    revokeAppleAccessTokenWithToken
} from "./appleAuth";
import {
    requestGithubTokensWithCode,
    revokeGithubAccessTokenWithDatabase
} from "./githubAuth";
import { RestError, restErrorFrom } from "./error";
import { matchRestRoute, parseRestRouteSegments, RestRoute } from "./router";

const LOCATION = "asia-northeast3";

export const stagingApi = restApiFor("staging");
export const prodApi = restApiFor("prod");

function restApiFor(databaseID: FirestoreDatabaseID) {
    return onRequest({
        cors: true,
        maxInstances: 3,
        region: LOCATION,
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

            const db = firestoreFor(databaseID);
            const uid = route.requiresAuth ? await authenticatedUID(request) : undefined;
            const result = await handleRoute(route, db, body, uid);

            response.status(200).json(result);
        } catch (error) {
            sendRestError(response, error);
        }
    }
    );
}

async function handleRoute(
    route: RestRoute,
    db: FirebaseFirestore.Firestore,
    body: Record<string, unknown>,
    uid?: string
): Promise<unknown> {
    switch (route.action) {
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
    case "requestAppleCustomToken":
        return requestAppleCustomTokenWithDatabase(
            db,
            requiredBodyString(body, "idToken"),
            requiredBodyString(body, "authorizationCode")
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
        return revokeAppleAccessTokenWithToken(
            requiredUID(uid),
            requiredBodyString(body, "token")
        );
    case "requestGithubTokens":
        return requestGithubTokensWithCode(requiredBodyString(body, "code"));
    case "revokeGithubAccessToken":
        return revokeGithubAccessTokenWithDatabase(db, requiredUID(uid), body.accessToken);
    }
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

function sendRestError(response: Response, error: unknown): void {
    const restError = restErrorFrom(error);
    response.status(restError.status).json({
        code: restError.code,
        message: restError.message
    });
}
