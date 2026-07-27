import * as jwt from "jsonwebtoken";
import jwksClient, { SigningKeyNotFoundError } from "jwks-rsa";

const GOOGLE_IDENTITY_ISSUERS = [
    "https://accounts.google.com",
    "accounts.google.com"
];
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

const googleJwksClient = jwksClient({
    jwksUri: GOOGLE_JWKS_URI,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 60 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10
});

// Google JWKS 통신·응답 실패를 token 검증 실패와 구분합니다.
export class GoogleJwksLookupError extends Error {}

// 검증된 Google ID token의 인증·프로필 claim을 나타냅니다.
export interface GoogleTokenPayload {
    // token 발행자를 저장합니다.
    iss: string;
    // 변경되지 않는 Google 사용자 식별자를 저장합니다.
    sub: string;
    // token을 발급받은 OAuth client 식별자를 저장합니다.
    aud: string;
    // token 발행 시각을 저장합니다.
    iat: number;
    // token 만료 시각을 저장합니다.
    exp: number;
    // Google 계정 이메일을 저장합니다.
    email?: string;
    // 이메일 검증 여부를 저장합니다.
    email_verified?: boolean;
    // 사용자 표시 이름을 저장합니다.
    name?: string;
    // 사용자 프로필 이미지 주소를 저장합니다.
    picture?: string;
}

// ID token header의 key id로 Google 공개키를 조회합니다.
function getGooglePublicKey(
    header: jwt.JwtHeader | undefined,
    callback: jwt.SigningKeyCallback
) {
    if (!header?.kid) {
        callback(new Error("Google ID token header is missing key id"));
        return;
    }

    googleJwksClient.getSigningKey(header.kid)
        .then((key) => callback(null, key.getPublicKey()))
        .catch((error) => callback(
            error instanceof SigningKeyNotFoundError ?
                error :
                new GoogleJwksLookupError("Google JWKS lookup failed")
        ));
}

// 검증된 JWT payload가 필요한 Google ID token claim을 포함하는지 확인합니다.
function isGoogleTokenPayload(
    payload: jwt.JwtPayload,
    clientId: string
): payload is GoogleTokenPayload {
    return GOOGLE_IDENTITY_ISSUERS.includes(payload.iss ?? "") &&
        payload.aud === clientId &&
        typeof payload.sub === "string" &&
        0 < payload.sub.length &&
        typeof payload.iat === "number" &&
        typeof payload.exp === "number";
}

// Google JWKS와 필수 claim으로 ID token을 검증하고 payload를 반환합니다.
export function verifyGoogleIdToken(
    idToken: string,
    clientId: string
) {
    return new Promise<GoogleTokenPayload>((resolve, reject) => {
        let publicKeyError: Error | null = null;
        jwt.verify(
            idToken,
            (header, callback) => getGooglePublicKey(
                header,
                (error, publicKey) => {
                    publicKeyError = error;
                    callback(error, publicKey);
                }
            ),
            {
                algorithms: ["RS256"],
                audience: clientId,
                issuer: GOOGLE_IDENTITY_ISSUERS
            },
            (error, decoded) => {
                if (error) {
                    reject(publicKeyError ?? error);
                    return;
                }

                if (
                    !decoded ||
                    typeof decoded === "string" ||
                    !isGoogleTokenPayload(decoded, clientId)
                ) {
                    reject(new Error("Invalid Google ID token payload"));
                    return;
                }

                resolve(decoded);
            }
        );
    });
}
