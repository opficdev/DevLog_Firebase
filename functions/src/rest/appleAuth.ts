import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import axios from "axios";
import * as jwt from "jsonwebtoken";

interface AppleTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: string;
  is_private_email?: boolean;
  nonce?: string;
  nonce_supported?: boolean;
  real_user_status?: number;
  auth_time?: number;
}

export async function requestAppleCustomTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    idToken: string,
    authorizationCode: string
): Promise<{ customToken: string }> {
    let decodedToken: AppleTokenPayload;
    try {
        decodedToken = jwt.decode(idToken) as AppleTokenPayload;
        if (!decodedToken) {
            throw new HttpsError("invalid-argument", "Invalid Apple ID token");
        }
    } catch (error) {
        console.error("Error decoding Apple ID token:", error);
        throw new HttpsError("invalid-argument", "Failed to decode Apple ID token");
    }

    const userId = decodedToken.sub;
    const email = decodedToken.email;

    if (!userId) {
        throw new HttpsError("internal", "Could not get user ID from Apple token");
    }

    let uid;

    try {
        if (email) {
            try {
                const userRecord = await admin.auth().getUserByEmail(email);
                uid = userRecord.uid;
                console.log(`Found existing user by email (${email})`);
            } catch (error) {
                const userRecord = await admin.auth().createUser({
                    email: email,
                    emailVerified: decodedToken.email_verified === "true",
                });
                uid = userRecord.uid;
                console.log(`Created new user with email: ${uid}`);
            }
        } else {
            try {
                const userRecord = await admin.auth().getUser(`apple:${userId}`);
                uid = userRecord.uid;
            } catch (error) {
                const userRecord = await admin.auth().createUser({});
                uid = userRecord.uid;
                console.log(`Created new user with Apple ID: ${uid}`);
            }
        }

        const refreshToken = await requestAppleRefreshTokenFromApple(authorizationCode);
        await saveAppleRefreshToken(db, uid, refreshToken);

        const customToken = await admin.auth().createCustomToken(uid);
        return { customToken };
    } catch (error) {
        console.error("Error processing Apple authentication:", error);
        throw new HttpsError(
            "internal",
            error instanceof Error ? error.message : "Unknown error occurred during authentication"
        );
    }
}

export async function requestAppleRefreshTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string,
    authorizationCode: string
): Promise<{ success: true; refreshToken: string }> {
    const refreshToken = await requestAppleRefreshTokenFromApple(authorizationCode);
    await saveAppleRefreshToken(db, uid, refreshToken);

    return {
        success: true,
        refreshToken
    };
}

export async function refreshAppleAccessTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<{ token: string }> {
    console.log(`Fetching from collection(${uid})/doc(info)`);
    const userDoc = await db.collection("users").doc(uid).collection("userData").doc("tokens").get();

    if (!userDoc.exists) {
        console.error(`User document not found for ID: ${uid}`);
        throw new HttpsError("not-found", `User document not found at collection('/users/${uid}')/userData/doc('info')`);
    }

    const userData = userDoc.data();
    const refreshToken = userData?.appleRefreshToken;

    if (!refreshToken) {
        console.error("User document exists but has no appleRefreshToken field:", userData);
        throw new HttpsError("not-found", "Apple refresh token not found for this user");
    }

    console.log("Successfully retrieved refresh token from Firestore");
    const { teamId, clientId, keyId, privateKey } = appleConfiguration();

    const clientSecret = jwt.sign({}, privateKey, {
        algorithm: "ES256",
        expiresIn: "5m",
        audience: "https://appleid.apple.com",
        issuer: teamId,
        subject: clientId,
        keyid: keyId,
    });

    const response = await axios.post<{access_token: string}>("https://appleid.apple.com/auth/token",
    new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    }).toString(), {
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
        }
    );

    if (response.data && response.data.access_token) {
        return { token: response.data.access_token };
    }

    throw new HttpsError(
        "internal",
        "Failed to retrieve access token from Apple response."
    );
}

export async function revokeAppleAccessTokenWithToken(
    uid: string,
    token: string
): Promise<{ success: true }> {
    console.log("Starting Apple token revocation", { uid });
    console.log("Starting Apple configuration load for token revocation");
    const { teamId, clientId, keyId, privateKey } = appleConfiguration();

    console.log("Starting Apple client secret creation for token revocation");
    const clientSecret = jwt.sign({}, privateKey, {
        algorithm: "ES256",
        expiresIn: "5m",
        audience: "https://appleid.apple.com",
        issuer: teamId,
        subject: clientId,
        keyid: keyId,
    });

    console.log("Starting Apple revoke API request");
    await axios.post(
        "https://appleid.apple.com/auth/revoke",
        new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: token,
            token_type_hint: "access_token"
        }).toString(), {
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
    });

    return { success: true };
}

async function requestAppleRefreshTokenFromApple(authorizationCode: string): Promise<string> {
    const { teamId, clientId, keyId, privateKey } = appleConfiguration();

    const clientSecret = jwt.sign({}, privateKey, {
        algorithm: "ES256",
        expiresIn: "5m",
        audience: "https://appleid.apple.com",
        issuer: teamId,
        subject: clientId,
        keyid: keyId,
    });

    const tokenResponse = await axios.post<{
        access_token: string,
        refresh_token: string,
        id_token: string,
        token_type: string,
        expires_in: number
    }>("https://appleid.apple.com/auth/token",
    new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: "authorization_code",
    }).toString(), {
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
    });

    const refreshToken = tokenResponse.data.refresh_token;
    if (!refreshToken) {
        throw new HttpsError("internal", "Apple에서 refresh_token을 받아오지 못했습니다.");
    }
    return refreshToken;
}

async function saveAppleRefreshToken(
    db: FirebaseFirestore.Firestore,
    uid: string,
    refreshToken: string
): Promise<void> {
    await db.collection("users").doc(uid).collection("userData").doc("tokens").set({
        appleRefreshToken: refreshToken
    }, { merge: true });
}

function appleConfiguration() {
    const teamId = process.env.APPLE_TEAM_ID;
    const clientId = process.env.APPLE_CLIENT_ID;
    const keyId = process.env.APPLE_KEY_ID;
    const privateKey = (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const configs = {
        APPLE_TEAM_ID: teamId,
        APPLE_CLIENT_ID: clientId,
        APPLE_KEY_ID: keyId,
        APPLE_PRIVATE_KEY: privateKey
    };
    const missingKeys = Object.entries(configs)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (0 < missingKeys.length) {
        console.error("Missing Apple configuration", {
            missingKeys
        });
        throw new HttpsError(
            "internal",
            `Missing Apple configuration for: ${missingKeys.join(", ")}`
        );
    }

    return {
        teamId: teamId!,
        clientId: clientId!,
        keyId: keyId!,
        privateKey: privateKey!
    };
}
