import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import axios from "axios";
import * as jwt from "jsonwebtoken";
import {
    AppleTokenPayload,
    isAppleEmailVerified,
    verifyAppleIdToken
} from "../auth/appleIdToken";

interface FirebaseAuthClient {
    getUser(uid: string): Promise<{ uid: string }>;
    getUserByEmail(email: string): Promise<{ uid: string }>;
    getUserByProviderUid(providerId: string, uid: string): Promise<{ uid: string }>;
    createUser(properties: {
        uid?: string;
        email?: string;
        emailVerified?: boolean;
    }): Promise<{ uid: string }>;
}

export async function requestAppleCustomTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    idToken: string,
    authorizationCode: string
): Promise<{ customToken: string }> {
    const { clientId } = appleConfiguration();
    let decodedToken: AppleTokenPayload;
    try {
        decodedToken = await verifyAppleIdToken(idToken, clientId);
    } catch (error) {
        console.error("Error verifying Apple ID token:", error);
        throw new HttpsError("invalid-argument", "Failed to verify Apple ID token");
    }

    const userId = decodedToken.sub;
    const email = decodedToken.email;
    const emailVerified = isAppleEmailVerified(decodedToken);

    if (!userId) {
        throw new HttpsError("internal", "Could not get user ID from Apple token");
    }

    try {
        const uid = await resolveAppleFirebaseUID(
            admin.auth(),
            userId,
            email,
            emailVerified
        );
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

async function resolveAppleFirebaseUID(
    auth: FirebaseAuthClient,
    userId: string,
    email?: string,
    emailVerified?: boolean
): Promise<string> {
    try {
        const userRecord = await auth.getUserByProviderUid("apple.com", userId);
        return userRecord.uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
            throw error;
        }
    }

    return email ?
        await firebaseUIDForEmail(auth, email, emailVerified === true) :
        await firebaseUIDForAppleUser(auth, userId);
}

async function firebaseUIDForEmail(
    auth: FirebaseAuthClient,
    email: string,
    emailVerified: boolean
): Promise<string> {
    try {
        const userRecord = await auth.getUserByEmail(email);
        console.log(`Found existing user by email (${email})`);
        return userRecord.uid;
    } catch (error) {
        try {
            const userRecord = await auth.createUser({
                email,
                emailVerified,
            });
            console.log(`Created new user with email: ${userRecord.uid}`);
            return userRecord.uid;
        } catch (createError) {
            if (firebaseAuthErrorCode(createError) === "auth/email-already-exists") {
                return (await auth.getUserByEmail(email)).uid;
            }
            throw createError;
        }
    }
}

async function firebaseUIDForAppleUser(
    auth: FirebaseAuthClient,
    userId: string
): Promise<string> {
    const uid = `apple:${userId}`;
    try {
        const userRecord = await auth.getUser(uid);
        return userRecord.uid;
    } catch (error) {
        try {
            const userRecord = await auth.createUser({ uid });
            console.log(`Created new user with Apple ID: ${userRecord.uid}`);
            return userRecord.uid;
        } catch (createError) {
            if (firebaseAuthErrorCode(createError) === "auth/uid-already-exists") {
                return (await auth.getUser(uid)).uid;
            }
            throw createError;
        }
    }
}

function firebaseAuthErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
        return undefined;
    }

    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : undefined;
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
