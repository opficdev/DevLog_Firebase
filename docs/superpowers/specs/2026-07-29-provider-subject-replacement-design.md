# Provider subject 교체 거부 설계

## 목적

계정 연결 요청에서 현재 Firebase Auth 사용자에게 같은 종류의 provider가 이미 연결되어 있고 새 인증 결과의 subject가 다르면 기존 provider를 교체하지 않음.

## 적용 범위

- Google `google.com` provider
- GitHub `github.com` provider
- Apple `apple.com` provider
- 각 provider의 계정 연결 기능 시험

## 동작

- 같은 provider가 없으면 기존 연결 처리 유지
- 같은 provider와 같은 subject이면 기존 재인증 처리 유지
- 같은 provider와 다른 subject이면 Firebase Auth 변경과 credential 저장 전에 provider 충돌 오류 반환
- 공급자별 기존 충돌 reason과 REST 응답 계약 유지

## 구현 경계

- Google은 현재 사용자 조회 결과의 `google.com` provider uid와 `payload.sub` 비교
- GitHub는 이메일 확인에 사용한 현재 사용자 조회 결과의 `github.com` provider uid와 `providerUID` 비교
- Apple은 현재 사용자 조회 결과의 `apple.com` provider uid와 `payload.sub` 비교
- 공급자별 흐름과 타입이 달라 공통 helper를 추가하지 않음
- 실패 뒤 provider를 복원하는 보상 처리는 추가하지 않음

## 검증

- 공급자별 다른 subject 요청이 기존 충돌 reason으로 실패하는지 확인
- 거부된 요청에서 Firebase Auth `updateUser`가 호출되지 않는지 확인
- 같은 subject 재인증과 provider 최초 연결 시험 유지
- `functions`에서 `npm run build`와 `npm test` 실행

## 운영 영향

- Firestore 문서 구조 변경 없음
- 환경 변수와 Secret 변경 없음
- Firestore 인덱스 변경 없음
- 기존 `api` 함수 배포 범위 유지
