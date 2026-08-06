import { onRequest } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import {
    RestError,
    restErrorBodyFrom,
    restErrorFrom
} from "./error";
import { matchRestRoute, parseRestRouteSegments } from "./router";

const LOCATION = "asia-northeast3";

// 현재 Firebase project의 REST 요청을 처리합니다.
export const api = onRequest({
        cors: true,
        maxInstances: 3,
        region: LOCATION
    },
    async (request, response) => {
        try {
            const routeSegments = parseRestRouteSegments(pathSegmentsFromRequest(request));
            if (!routeSegments) {
                throw new RestError(404, "not-found", "API 경로를 찾을 수 없습니다.");
            }

            if (!matchRestRoute(request.method, routeSegments)) {
                throw new RestError(404, "not-found", "Endpoint를 찾을 수 없습니다.");
            }
        } catch (error) {
            sendRestError(request, response, error);
        }
    }
    );

// Firebase rewrite를 포함한 요청 경로를 API 하위 segment로 나눕니다.
function pathSegmentsFromRequest(request: Request): string[] {
    const path = request.path || new URL(request.url, "https://localhost").pathname;
    return path
        .split("/")
        .filter((segment) => segment.length !== 0)
        .map((segment) => decodeURIComponent(segment));
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
