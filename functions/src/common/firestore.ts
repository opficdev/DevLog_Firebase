import { getFirestore } from "firebase-admin/firestore";

const firebaseDBsEnvKey = "FIREBASE_DBS";

// 배포 함수가 사용하는 이름 지정 Firestore 데이터베이스를 나타냅니다.
export type FirestoreDatabase = string;

// 환경 변수 기준으로 예약 함수가 처리할 Firestore 데이터베이스 목록을 반환합니다.
export function firebaseDBs(): FirestoreDatabase[] {
    const rawValue = process.env[firebaseDBsEnvKey]?.trim();
    if (!rawValue) {
        throw new Error(`${firebaseDBsEnvKey}가 설정되지 않았습니다.`);
    }

    const values = rawValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length !== 0);
    if (values.length === 0) {
        throw new Error(`${firebaseDBsEnvKey}에 처리할 Firebase DB가 없습니다.`);
    }

    return Array.from(new Set(values)) as FirestoreDatabase[];
}

// 값이 비어 있지 않은 Firestore 데이터베이스 이름인지 확인합니다.
export function isFirebaseDB(value: unknown): value is FirestoreDatabase {
    return typeof value === "string" && value.trim().length !== 0;
}

// 이름 지정 데이터베이스용 Firestore 클라이언트를 반환합니다.
export function firestoreFor(firebaseDB: FirestoreDatabase): FirebaseFirestore.Firestore {
    return getFirestore(firebaseDB);
}
