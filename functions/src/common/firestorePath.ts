export namespace FirestorePath {
    enum Collection {
        users = "users",
        userData = "userData",
        todoLists = "todoLists",
        notifications = "notifications",
        notificationDispatches = "notificationDispatches",
        webPages = "webPages",
        authChallenges = "authChallenges",
        authCredentials = "authCredentials",
        providers = "providers"
    }

    export enum UserDataDocument {
        info = "info",
        tokens = "tokens",
        settings = "settings",
        categories = "categories"
    }

    // 사용자 데이터 하위 컬렉션을 collection group query에 사용할 이름입니다.
    export const userDataCollectionGroup = Collection.userData;

    export function user(userId: string): string {
        return `${Collection.users}/${userId}`;
    }

    export function userData(userId: string, document?: UserDataDocument): string {
        const path = `${user(userId)}/${Collection.userData}`;
        if (!document) { return path; }
        return `${path}/${document}`;
    }

    export function todos(userId: string): string {
        return `${user(userId)}/${Collection.todoLists}`;
    }

    export function todo(userId: string, todoId: string): string {
        return `${todos(userId)}/${todoId}`;
    }

    export function notifications(userId: string): string {
        return `${user(userId)}/${Collection.notifications}`;
    }

    export function notification(userId: string, notificationId: string): string {
        return `${notifications(userId)}/${notificationId}`;
    }

    export function notificationDispatches(userId: string): string {
        return `${user(userId)}/${Collection.notificationDispatches}`;
    }

    export function notificationDispatch(userId: string, dispatchId: string): string {
        return `${notificationDispatches(userId)}/${dispatchId}`;
    }

    export function webPages(userId: string): string {
        return `${user(userId)}/${Collection.webPages}`;
    }

    export function webPage(userId: string, documentId: string): string {
        return `${webPages(userId)}/${documentId}`;
    }

    // Apple 인증 challenge 컬렉션 경로를 저장합니다.
    export const authChallenges = Collection.authChallenges;

    // 지정한 Apple 인증 challenge 문서 경로를 반환합니다.
    export function authChallenge(challengeId: string): string {
        return `${authChallenges}/${challengeId}`;
    }

    // 지정한 사용자의 서버 전용 인증 자격 증명 루트 경로를 반환합니다.
    export function authCredential(userId: string): string {
        return `${Collection.authCredentials}/${userId}`;
    }

    // 지정한 사용자의 서버 전용 Apple 자격 증명 문서 경로를 반환합니다.
    export function appleCredential(userId: string): string {
        return `${authCredential(userId)}/${Collection.providers}/apple`;
    }
}
