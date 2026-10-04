# GitHub 게시 기록

사용자가 생성하고 지정한 공개 저장소는 **[MongLong0214/Tetration](https://github.com/MongLong0214/Tetration)** 입니다. 이전 `tetra-atlas` 조회 404는 별도 대상의 과거 기록입니다.

2026-10-04 GitHub 플러그인 응답으로 소유자 `MongLong0214`, 공개 범위 `public`, 기본 브랜치 `main`, 쓰기 권한을 확인했습니다. 당시 비어 있는 저장소였으며 최초 `.gitignore` 커밋은 `d7a7adccd39aa0b7e7c1e0417cac62f52e7cf0b3`입니다.

## 게시 완료

[PR #1](https://github.com/MongLong0214/Tetration/pull/1)을 병합했습니다.

- 소스 커밋: [`4d89ce9`](https://github.com/MongLong0214/Tetration/commit/4d89ce9df8622748dbb9b59878f5d182c2182880)
- 병합 커밋: [`45a6af4`](https://github.com/MongLong0214/Tetration/commit/45a6af49497774aed523330f4c033626e615141b)
- [GitHub Actions 실행 #1](https://github.com/MongLong0214/Tetration/actions/runs/37175004438): **success**. Node 59개, HTTP 브라우저 29개, WebGL2 출시 16개, WebGPU·병렬 계산 10개 모두 통과.
- 원격 Git clone의 91개 파일(이미지 17개 포함)을 로컬 게시 명세의 Git blob 해시와 대조하여 전부 일치 확인.
- 원격 소스로 재빌드한 HTML: 87,566바이트, SHA-256 `c492e55e146a70e4642fdd31727f9666538b8e3989b2cd8336ed33fb32ff8899`.
- README·소스·이미지·테스트·검증 기록·`.github/workflows/ci.yml` 게시 완료. 기존 첫 커밋과 PR 이력을 보존. force push·공개 범위·라이선스 변경 없음.

[실제 응답 기록](review/modern-2026-10-04/remote-publication.json)과 [CI 검사 출력 발췌](review/modern-2026-10-04/remote-ci-output.txt)를 보존합니다. 이 문서의 후속 갱신은 앱 소스와 빌드 결과를 바꾸지 않습니다. 최신 main의 워크플로 결과는 [Actions](https://github.com/MongLong0214/Tetration/actions)에서 확인합니다.

## 배포 접근 상태

Vercel 인증 계정은 `monglong0214`입니다. 인증 응답의 기본 팀을 사용한 프로젝트 조회가 `403 Forbidden`으로 실패했습니다. 응답은 `monglong0214s-projects` 범위로 재인증하거나 해당 범위에 접근 가능한 연결이 필요하다고 명시했습니다. 기존 프로젝트·도메인을 변경하지 않았습니다. 공개 HTTPS 배포와 검증은 완료되지 않았습니다.

## 최초 게시 스크립트

`scripts/publish-github.sh`는 인증된 로컬 GitHub CLI에서 새 저장소를 처음 생성하는 용도입니다. 대상 이름은 사용자 지정에 맞춰 `Tetration`으로 바꿨습니다. 현재 저장소가 이미 존재하므로 이 스크립트는 중단하며, 이번 게시는 GitHub 플러그인을 사용합니다.

`dist/`, `node_modules/`, 개인 키·계정 설정·임시 테스트 출력은 게시하지 않습니다. `dist/index.html`은 커밋된 소스에서 결정적으로 재생성합니다. 검증 증거는 `docs/review/`에 포함합니다.
