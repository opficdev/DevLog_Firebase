// REST route가 실행할 처리 종류를 나타냅니다.
export type RestAction =
    "linkGithubAccount" |
    "unlinkGithubAccount" |
    "revokeGithubAccessToken";

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

    return undefined;
}
