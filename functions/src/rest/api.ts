import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest, HttpsError } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { githubOAuthConfigurationSecret } from "./github/githubConfiguration";
import {
    linkGithubAccount,
    revokeGithubAccessToken,
    unlinkGithubAccount
} from "./github/githubOAuth";
import {
    RestError,
    restErrorBodyFrom,
    restErrorFrom
} from "./error";
import { matchRestRoute, parseRestRouteSegments, RestRoute } from "./router";

const LOCATION = "asia-northeast3";

// 현재 Firebase project의 REST 요청을 처리합니다.
export const api = onRequest({
        cors: true,
        maxInstances: 3,
        region: LOCATION,
        secrets: [
            githubOAuthConfigurationSecret
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

            const db = getFirestore();
            const uid = route.requiresAuth ? await authenticatedUID(request) : undefined;
            const result = await handleRoute(
                route,
                db,
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

// 일치한 REST route의 요청을 처리합니다.
async function handleRoute(
    route: RestRoute,
    db: FirebaseFirestore.Firestore,
    body: Record<string, unknown>,
    uid?: string
): Promise<unknown> {
    switch (route.action) {
    case "linkGithubAccount":
        return linkGithubAccount(
            db,
            requiredUID(uid),
            requiredBodyString(body, "ticket"),
            requiredBodyString(body, "appVerifier")
        );
    case "unlinkGithubAccount":
        return unlinkGithubAccount(
            db,
            requiredUID(uid)
        );
    case "revokeGithubAccessToken":
        return revokeGithubAccessToken(
            db,
            requiredUID(uid)
        );
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
