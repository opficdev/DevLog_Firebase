// REST route가 실행할 처리 종류를 나타냅니다.
export type RestAction =
    "createAppleChallenge" |
    "requestAppleCustomToken" |
    "linkAppleProvider" |
    "unlinkAppleProvider" |
    "requestAppleRefreshToken" |
    "refreshAppleAccessToken" |
    "revokeAppleAccessToken" |
    "createGithubSignInSession" |
    "githubCallback" |
    "requestGithubCustomToken" |
    "createGithubAccountLinkSession" |
    "linkGithubAccount" |
    "unlinkGithubAccount" |
    "revokeGithubAccessToken" |
    "requestGoogleCustomToken" |
    "linkGoogleAccount" |
    "unlinkGoogleAccount" |
    "revokeGoogleAccessToken";

export interface RestRoute {
    action: RestAction;
    requiresAuth: boolean;
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

    if (routeSegments.join("/") === "auth/apple/custom-token" && normalizedMethod === "POST") {
        return {
            action: "requestAppleCustomToken",
            requiresAuth: false
        };
    }

    if (routeSegments.join("/") === "auth/apple/challenges" && normalizedMethod === "POST") {
        return {
            action: "createAppleChallenge",
            requiresAuth: false
        };
    }

    if (routeSegments.join("/") === "auth/apple/account-link" && normalizedMethod === "PUT") {
        return {
            action: "linkAppleProvider",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/apple/account-link" && normalizedMethod === "DELETE") {
        return {
            action: "unlinkAppleProvider",
            requiresAuth: true
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

    if (routeSegments.join("/") === "auth/github/sign-in-sessions" && normalizedMethod === "POST") {
        return {
            action: "createGithubSignInSession",
            requiresAuth: false
        };
    }

    if (routeSegments.join("/") === "auth/github/callback" && normalizedMethod === "GET") {
        return {
            action: "githubCallback",
            requiresAuth: false
        };
    }

    if (routeSegments.join("/") === "auth/github/custom-token" && normalizedMethod === "POST") {
        return {
            action: "requestGithubCustomToken",
            requiresAuth: false
        };
    }

    if (
        routeSegments.join("/") === "auth/github/account-link-sessions" &&
        normalizedMethod === "POST"
    ) {
        return {
            action: "createGithubAccountLinkSession",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/github/account-link" && normalizedMethod === "PUT") {
        return {
            action: "linkGithubAccount",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/github/account-link" && normalizedMethod === "DELETE") {
        return {
            action: "unlinkGithubAccount",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/github/access-token" && normalizedMethod === "DELETE") {
        return {
            action: "revokeGithubAccessToken",
            requiresAuth: true
        };
    }

    if (
        routeSegments.join("/") === "auth/google/authorization-code/custom-token" &&
        normalizedMethod === "POST"
    ) {
        return {
            action: "requestGoogleCustomToken",
            requiresAuth: false
        };
    }

    if (
        routeSegments.join("/") === "auth/google/authorization-code/account-link" &&
        normalizedMethod === "PUT"
    ) {
        return {
            action: "linkGoogleAccount",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/google/account-link" && normalizedMethod === "DELETE") {
        return {
            action: "unlinkGoogleAccount",
            requiresAuth: true
        };
    }

    if (routeSegments.join("/") === "auth/google/access-token" && normalizedMethod === "DELETE") {
        return {
            action: "revokeGoogleAccessToken",
            requiresAuth: true
        };
    }

    return undefined;
}
