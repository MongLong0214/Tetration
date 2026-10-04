# 검증 기록 — 0.2.0

2026-10-04에 현재 소스를 대상으로 다시 실행했습니다. 이 문서가 이전 40개 테스트/과거 브라우저 결과 설명을 대체합니다.

## 결과와 실행 환경

| 검사 | 결과 | 환경 / 증거 |
| --- | --- | --- |
| 수치·보안·빌드·HTTP | 57/57 | Node.js 22.16.0, [로그](review/unit-tests.txt) |
| 브라우저 회귀 | 29/29 | Chromium 144.0.7559.96, Playwright 1.57.0, [JSON](review/browser-review.json) |
| 실제 GLSL 소프트웨어 실행 | 8/8 | Mesa 25.0.7-2 / llvmpipe / GLES 3.2, [JSON](review/gpu-software.json) |
| 빌드 | 성공, 76,203 bytes | 단일 HTML, SHA-256 기반 CSP |
| 300자리 참조 대비 240자리 유한 궤도 | 12 입력 | 위 57개에 포함, 4회 반복 |

57개에는 기존 core 40개, 새 참조 비교 13개, 보안·빌드·HTTP 4개가 포함됩니다. 마지막 13개는 12입력 비교와 미세 좌표 차이 보존 1개입니다. 이 숫자들을 중복해서 합산하지 마세요. 하나의 HTTP 테스트는 여러 응답 케이스를 검사하지만 테스트 수는 1개로 셉니다.

## 재실행

```bash
npm test
npm run build
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium
npm run test:browser
```

`CHROMIUM_PATH=/path/to/chromium`으로 설치된 Chromium을 지정할 수 있습니다. 새 증거는 `tests/review-output/`에 기록됩니다. 현재 검증 시점의 원본은 `docs/review/`에 따로 보관합니다.

별도 터미널에서 `npm run dev`를 실행한 뒤 다음을 쓰면 실제 원점에서 검사합니다.

```bash
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:browser
```

현재 환경은 브라우저의 localhost 탐색이 차단되어 문서에 HTML을 직접 주입한 경로로 실행했습니다. CSP meta는 실제 적용했습니다. Node HTTP 테스트는 서버 요청/응답을 별도 검사했습니다. CI에는 원점 기반 Chromium 검사를 넣었지만 GitHub에서 실행된 것은 아닙니다.

독립 참조를 재생성하려면:

```bash
python3 tests/generate_orbit_reference.py
npm test
```

기존 oracle 파일을 덮어씁니다. 생성기는 mpmath 300자리 계산을 사용합니다. 앱 구현의 출력을 참조값으로 복사한 것이 아닙니다. 절삭 방식의 자체 라이브러리에 인증 오차 상한을 부여하는 검사는 아닙니다.

소프트웨어 GPU 검사는 Linux의 EGL/GLES 공유 라이브러리가 있는 환경에서 실행합니다.

```bash
python3 tests/gpu_software_test.py
```

실제 앱의 GLSL로 컴파일·링크 및 픽셀을 계산합니다. 그래픽 드라이버 설치는 앱 런타임의 의존성이 아닙니다. CI 기본 작업에는 이 플랫폼 특화 검사를 넣지 않았습니다.

## 이번 검증에서 확인하지 못한 것

실제 브라우저 GPU/하드웨어 드라이버, 물리적인 iPhone/Safari, 공개 HTTPS 주소, 배포 헤더와 브라우저의 결합, 안전한 원점에서의 클립보드 내용, GitHub 원격 CI는 미확인입니다. Playwright 터치 입력은 Chromium 에뮬레이션입니다.

`tests/browser-report.json`, `tests/artifacts/`와 `tests/unit-report.txt`는 기존 묶음에 들어 있던 **이전 기록**입니다. 이번 리뷰 증거로 합산하지 않습니다. `browser_test.py`/`browser_extra_test.py`는 과거 스크립트로 보존했으며, 현재 검사 경로는 `browser_review.py`입니다.

## 성능 해석

최신 `browser-review.json`에 각 렌더의 경과 시간이 있습니다. CPU 초기 화면 약 7–8초, 단순 좌표의 `1e-200` 고정밀 화면 약 24초라는 단발 환경 관측이며 실제 사용자 기기의 속도 보장이 아닙니다. 고정밀 최대 가로 72샘플을 전체 캔버스 해상도와 혼동하지 마세요.

검사 통과는 전체 복소평면에서의 정확성, 수렴·발산 증명, 정식 서비스 승인을 의미하지 않습니다. 자세한 판정과 남은 조건은 [최종 리뷰](PRODUCTION_REVIEW.md)를 참조하세요.
