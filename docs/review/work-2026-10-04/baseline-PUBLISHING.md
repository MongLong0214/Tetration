# 최초 GitHub 공개 업로드

대상은 **`MongLong0214/tetra-atlas`**입니다. 실제 생성 완료를 의미하지 않습니다.

## 이번 시도

2026-10-04 연결 계정은 `MongLong0214`로 확인했습니다. 연결에는 파일·커밋 쓰기 기능이 있으나 새 저장소 생성 기능이 없습니다. 저장소 조회와 README 생성 요청이 모두 404를 반환했습니다. 현재 환경에 인증된 GitHub CLI도 없어 원격 생성/푸시는 완료하지 않았습니다. 원격 파일·공개 범위·기존 저장소는 변경하지 않았습니다.

대상 공개 저장소를 생성하고 연결 앱에 접근을 허용하는 단계가 필요합니다. 개인 토큰을 채팅이나 코드에 넣지 마세요. 빈 저장소 또는 README만 있는 저장소여도 후속 게시 시 현재 상태를 읽고 다른 변경을 보존해야 합니다.

## 별도 로컬 환경의 최초 게시 도우미

Node.js **22 또는 24**, npm, Git, [GitHub CLI](https://cli.github.com/)가 필요합니다. 인증이 없으면 CLI 브라우저 로그인을 사용합니다.

```bash
cd tetra-atlas
bash scripts/publish-github.sh
```

소유자 확인 → 동명 저장소/.git 존재 시 중단 → 테스트/빌드 → 명시적 파일 목록의 최초 커밋 → 새 공개 저장소 생성/푸시 → 원격 공개 상태와 SHA 일치 확인 순서입니다. 개인 이메일 대신 GitHub noreply 주소를 사용합니다. 실패하면 자동 강제 재시도하지 않습니다.

이미 공개 저장소를 만든 경우 이 도우미는 안전을 위해 중단합니다. 기존 내용을 덮어쓰는 도구가 아닙니다. 리뷰 증거는 `docs/review/`에 포함되며 일시적인 `tests/review-output`, `dist`, `.env*`, 개인 키, `.vercel`, `node_modules`, `.venv`는 제외합니다.

전역 Git 설정, GitHub Pages, Vercel 도메인/프로젝트, 라이선스는 변경하지 않습니다. 이 환경에서 확인한 것은 구문과 로컬 테스트뿐이며 인증·생성·푸시 end-to-end 검증이 아닙니다.

참고: [gh repo create](https://cli.github.com/manual/gh_repo_create).
