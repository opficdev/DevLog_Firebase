import { getFirestore } from "firebase-admin/firestore";

export type FirestoreDatabaseID = "staging" | "prod";

export function firestoreDatabaseID(environment: string): FirestoreDatabaseID | undefined {
    switch (environment) {
    case "staging":
        return "staging";
    case "prod":
        return "prod";
    default:
        return undefined;
    }
}

export function firestoreFor(databaseID: FirestoreDatabaseID): FirebaseFirestore.Firestore {
    return getFirestore(databaseID);
}
