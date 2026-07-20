import { HttpsError } from "firebase-functions/v2/https";

// JSON Secret에서 필수 인증 설정 문자열을 검증해 반환합니다.
export function requiredAuthenticationConfigurationValue(
    configuration: unknown,
    fieldName: string,
    provider: string
): string {
    if (
        !configuration ||
        typeof configuration !== "object" ||
        Array.isArray(configuration)
    ) {
        throw new HttpsError(
            "internal",
            `${provider} 설정 형식이 올바르지 않습니다.`
        );
    }

    const value = (configuration as Record<string, unknown>)[fieldName];
    if (typeof value !== "string" || value.trim() === "") {
        throw new HttpsError(
            "internal",
            `${provider} 설정에 유효한 ${fieldName} 값이 필요합니다.`
        );
    }
    return value.trim();
}
