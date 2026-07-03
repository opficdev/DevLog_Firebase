import * as jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const AppleIdentityIssuer = "https://appleid.apple.com";
const AppleJwksUri = `${AppleIdentityIssuer}/auth/keys`;

// Apple ID 토큰 서명 검증에 사용할 Apple JWKS 클라이언트
const appleJwksClient = jwksClient({
    jwksUri: AppleJwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 60 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
});

// Apple ID 토큰 페이로드 인터페이스 정의
export interface AppleTokenPayload {
  iss: string;          // string: 발행자 (issuer)
  sub: string;          // string: Apple 사용자 고유 ID (subject)
  aud: string;          // string: 앱 ID (audience)
  iat: number;          // number: 발행 시간 (issued at)
  exp: number;          // number: 만료 시간 (expiration)
  email?: string;       // string | undefined: 사용자 이메일
  email_verified?: string; // string | undefined: 이메일 인증 여부
  is_private_email?: boolean; // boolean | undefined: 비공개 릴레이 이메일 여부
  nonce?: string;       // string | undefined: 보안용 난수값
  nonce_supported?: boolean; // boolean | undefined: nonce 지원 여부
  real_user_status?: number; // number | undefined: 실제 사용자 상태
  auth_time?: number;   // number | undefined: 인증 시간
}

// Apple ID 토큰 헤더의 key id로 Apple 공개키를 조회하는 메서드
function getApplePublicKey(
    header: jwt.JwtHeader,
    callback: jwt.SigningKeyCallback
) {
    if (!header.kid) {
        callback(new Error("Apple ID token header is missing key id"));
        return;
    }

    appleJwksClient.getSigningKey(header.kid)
        .then((key) => callback(
            null,
            key.getPublicKey()
        ))
        .catch((error) => callback(error));
}

// 검증된 JWT payload가 Apple ID 토큰 페이로드 형태인지 확인하는 메서드
function isAppleTokenPayload(
    payload: jwt.JwtPayload,
    clientId: string
): payload is AppleTokenPayload {
    return payload.iss === AppleIdentityIssuer &&
        payload.aud === clientId &&
        typeof payload.sub === "string" &&
        typeof payload.iat === "number" &&
        typeof payload.exp === "number";
}

// Apple JWKS와 필수 claim으로 Apple ID 토큰을 검증하고 페이로드를 반환하는 메서드
export function verifyAppleIdToken(
    idToken: string,
    clientId: string
) {
    return new Promise<AppleTokenPayload>((resolve, reject) => {
        jwt.verify(
            idToken,
            getApplePublicKey,
            {
                algorithms: ["RS256"],
                audience: clientId,
                issuer: AppleIdentityIssuer,
            },
            (error, decoded) => {
                if (error) {
                    reject(error);
                    return;
                }

                if (!decoded || typeof decoded === "string" || !isAppleTokenPayload(
                    decoded,
                    clientId
                )) {
                    reject(new Error("Invalid Apple ID token payload"));
                    return;
                }

                resolve(decoded);
            }
        );
    });
}
