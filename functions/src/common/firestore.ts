import { getFirestore } from "firebase-admin/firestore";

// FirestoreDatabase는 배포 함수가 사용하는 이름 지정 Firestore 데이터베이스를 나타냅니다.
export type FirestoreDatabase = string;

// firebaseDBs는 예약 함수가 처리할 모든 이름 지정 Firestore 데이터베이스를 저장합니다.
export const firebaseDBs: FirestoreDatabase[] = ["staging", "prod"];

// firestoreDatabaseID는 환경 이름을 지원하는 Firestore 데이터베이스 ID로 변환합니다.
export function firestoreDatabaseID(environment: string): FirestoreDatabase | undefined {
    switch (environment) {
    case "staging":
        return "staging";
    case "prod":
        return "prod";
    default:
        return undefined;
    }
}

// isFirebaseDB는 값이 지원하는 Firestore 데이터베이스인지 확인합니다.
export function isFirebaseDB(value: unknown): value is FirestoreDatabase {
    return typeof value === "string" && firebaseDBs.includes(value as FirestoreDatabase);
}

// firestoreFor는 이름 지정 데이터베이스용 Firestore 클라이언트를 반환합니다.
export function firestoreFor(firebaseDB: FirestoreDatabase): FirebaseFirestore.Firestore {
    return getFirestore(firebaseDB);
}
