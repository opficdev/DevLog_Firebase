export type RestAction =
    "requestTodoDeletion" |
    "undoTodoDeletion" |
    "requestWebPageDeletion" |
    "undoWebPageDeletion" |
    "requestPushNotificationDeletion" |
    "undoPushNotificationDeletion" |
    "requestAppleCustomToken" |
    "requestAppleRefreshToken" |
    "refreshAppleAccessToken" |
    "revokeAppleAccessToken" |
    "linkGithubProvider" |
    "requestGithubTokens" |
    "revokeGithubAccessToken";

export interface RestRoute {
    action: RestAction;
    requiresAuth: boolean;
    id?: string;
}

export function parseRestRouteSegments(pathSegments: string[]): string[] | undefined {
    const apiIndex = pathSegments.indexOf("api");
    if (apiIndex < 0) {
        return undefined;
    }

    return pathSegments.slice(apiIndex + 1);
}

export function matchRestRoute(method: string, routeSegments: string[]): RestRoute | undefined {
    const normalizedMethod = method.toUpperCase();

    if (
        routeSegments.length === 3 &&
        routeSegments[0] === "todos" &&
        routeSegments[2] === "deletion-request"
    ) {
        return deletionRoute(
            normalizedMethod,
            routeSegments[1],
            "requestTodoDeletion",
            "undoTodoDeletion"
        );
    }

    if (
        routeSegments.length === 3 &&
        routeSegments[0] === "web-pages" &&
        routeSegments[2] === "deletion-request"
    ) {
        return deletionRoute(
            normalizedMethod,
            routeSegments[1],
            "requestWebPageDeletion",
            "undoWebPageDeletion"
        );
    }

    if (
        routeSegments.length === 3 &&
        routeSegments[0] === "push-notifications" &&
        routeSegments[2] === "deletion-request"
    ) {
        return deletionRoute(
            normalizedMethod,
            routeSegments[1],
            "requestPushNotificationDeletion",
            "undoPushNotificationDeletion"
        );
    }

    if (routeSegments.join("/") === "auth/apple/custom-token" && normalizedMethod === "POST") {
        return {
            action: "requestAppleCustomToken",
            requiresAuth: false
        };
    }

    if (routeSegments.join("/") === "auth/apple/access-token" && normalizedMethod === "POST") {
        return {
            action: "refreshAppleAccessToken",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/apple/refresh-token" && normalizedMethod === "POST") {
        return {
            action: "requestAppleRefreshToken",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/apple/access-token" && normalizedMethod === "DELETE") {
        return {
            action: "revokeAppleAccessToken",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/github/tokens" && normalizedMethod === "POST") {
        return {
            action: "requestGithubTokens",
            requiresAuth: false
        };
    }

    if (routeSegments.join("/") === "auth/github/link" && normalizedMethod === "POST") {
        return {
            action: "linkGithubProvider",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/github/access-token" && normalizedMethod === "DELETE") {
        return {
            action: "revokeGithubAccessToken",
            requiresAuth: true
        };
    }

    return undefined;
}

function deletionRoute(
    method: string,
    id: string,
    requestAction: RestAction,
    undoAction: RestAction
): RestRoute | undefined {
    if (!id) {
        return undefined;
    }

    if (method === "POST") {
        return {
            action: requestAction,
            requiresAuth: true,
            id
        };
    }

    if (method === "DELETE") {
        return {
            action: undoAction,
            requiresAuth: true,
            id
        };
    }

    return undefined;
}
