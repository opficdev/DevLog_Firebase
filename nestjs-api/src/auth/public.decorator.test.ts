import { PUBLIC_ENDPOINT_KEY, Public } from './public.decorator';

// 공개 인증 경계 metadata 시험용 Controller입니다.
class AuthenticationTestController {
  // 공개 인증 경계 시험 method입니다.
  @Public()
  publicEndpoint(this: void): void {}

  // 인증 필수 경계 시험 method입니다.
  authenticatedEndpoint(this: void): void {}
}

describe(Public.name, () => {
  it('지정한 method에만 공개 인증 metadata를 설정한다', () => {
    expect(
      Reflect.getMetadata(
        PUBLIC_ENDPOINT_KEY,
        AuthenticationTestController.prototype.publicEndpoint,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        PUBLIC_ENDPOINT_KEY,
        AuthenticationTestController.prototype.authenticatedEndpoint,
      ),
    ).toBeUndefined();
  });
});
