// Firebase rewrite 경로에서 API 하위 segment를 반환합니다.
export function parseRestRouteSegments(pathSegments: string[]): string[] | undefined {
    const apiIndex = pathSegments.indexOf("api");
    if (apiIndex < 0) {
        return undefined;
    }

    return pathSegments.slice(apiIndex + 1);
}

// 현재 Functions에서 처리하는 REST route가 없음을 반환합니다.
export function matchRestRoute(
    _method: string,
    _routeSegments: string[]
): undefined {
    return undefined;
}
