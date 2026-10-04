#!/usr/bin/env bash
# First publication only. Creates a NEW public repository; never overwrites one.
# Authentication stays in GitHub CLI. No token is embedded in the project.
set -euo pipefail

OWNER='MongLong0214'
NAME='Tetration'
REPO="$OWNER/$NAME"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { printf '\n오류: %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == '--help' ]]; then
  printf '%s\n' "새 공개 저장소 $REPO 생성 후 main 브랜치를 업로드합니다." \
    '요구 사항: Node.js 22 또는 24, npm, Git, GitHub CLI(gh).' \
    '기존 저장소나 기존 Git 작업 폴더는 변경하지 않습니다.' \
    '인증 정보나 토큰은 이 스크립트에 넣지 마세요.'
  exit 0
fi
[[ $# -eq 0 ]] || fail '인수 없이 실행하거나 --help를 사용하세요.'

cd "$ROOT"
for executable in node npm git gh; do
  command -v "$executable" >/dev/null 2>&1 || \
    fail "$executable 명령이 필요합니다. gh가 없다면 GitHub CLI를 먼저 설치하세요."
done
node -e 'if (![22,24].includes(Number(process.versions.node.split(".")[0]))) process.exit(1)' || \
  fail 'Node.js 22 또는 24가 필요합니다.'
[[ ! -e .git ]] || fail '이미 Git 저장소인 폴더입니다. 자동으로 덮어쓰거나 재게시하지 않습니다.'
[[ -f package.json && -f src/main.js && -f README.md ]] || fail '소스 묶음이 불완전합니다.'

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web
fi
LOGIN="$(gh api --hostname github.com user --jq '.login')"
[[ "$LOGIN" == "$OWNER" ]] || fail "현재 로그인 계정은 $LOGIN 입니다. $OWNER 계정으로 전환 후 실행하세요."
USER_ID="$(gh api --hostname github.com user --jq '.id')"
[[ "$USER_ID" =~ ^[0-9]+$ ]] || fail 'GitHub 사용자 ID를 확인하지 못했습니다.'
if gh repo view "$REPO" --json name >/dev/null 2>&1; then
  fail "$REPO 저장소가 이미 있습니다. 기존 저장소의 내용이나 공개 범위는 변경하지 않습니다."
fi

printf '\n테스트와 빌드를 확인합니다.\n'
npm test
npm run build

git init -b main
# Repository-local authentication helper only; do not alter global Git settings.
git config --local credential.https://github.com.helper ''
git config --local --add credential.https://github.com.helper '!gh auth git-credential'
# Explicit paths avoid accidentally publishing unrelated top-level files.
git add -- .gitignore .gitattributes .nvmrc .vercelignore .github README.md package.json build.cjs serve.cjs \
  vercel.json src docs scripts tests
# Use a GitHub noreply address rather than copying a personal email into the commit.
git -c user.name="$OWNER" \
  -c user.email="${USER_ID}+${OWNER}@users.noreply.github.com" \
  commit -m 'feat: publish TETRA power tower explorer with documentation'

printf '\n새 공개 저장소 %s를 생성하고 업로드합니다.\n' "$REPO"
if ! gh repo create "$REPO" --public --source="$ROOT" --remote=origin --push \
  --description 'Browser-native complex power-tower explorer with pan, zoom, WebGL2 and BigInt deep zoom.'; then
  fail '생성 또는 푸시가 실패했습니다. 저장소가 일부 생성되었을 수 있으므로 자동 재시도·강제 덮어쓰기는 하지 않습니다. GitHub 상태와 git status를 확인하세요.'
fi

PRIVATE="$(gh api --hostname github.com "repos/$REPO" --jq '.private')"
[[ "$PRIVATE" == 'false' ]] || fail '공개 저장소 상태를 확인하지 못했습니다.'
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$LOCAL_SHA" == "$REMOTE_SHA" ]] || fail '원격 main의 커밋이 로컬 커밋과 다릅니다.'
printf '\n공개 업로드 확인 완료\n'
gh api --hostname github.com "repos/$REPO" --jq '.html_url'
printf '커밋: %s\n' "$LOCAL_SHA"
