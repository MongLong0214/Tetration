# 검증 기록 — 0.2.0 / Work 2026-10-04

이번 실행에서 확인한 결과만 아래에 집계합니다. 원래 ZIP의 증거는 삭제하지 않고 역사적 기록으로 보존했습니다.

| 검사 | 결과 | 현재 원본 |
| --- | --- | --- |
| Node 24.19.0 수치·참조·보안·빌드·HTTP | 57/57 | [unit-tests.txt](review/work-2026-10-04/unit-tests.txt) |
| HTTP Chromium 회귀 | 29/29 | [browser-review.json](review/work-2026-10-04/browser-review.json) |
| HTTP 출시 경로 | 16/16 | [browser-release.json](review/work-2026-10-04/browser-release.json) |
| 소프트웨어 GLES | 8/8 | [gpu-software.json](review/work-2026-10-04/gpu-software.json) |
| 4개 화면 크기 | 통과 | [visual-checks.json](review/work-2026-10-04/visual-checks.json) |
| 단일 HTML | 76,203 bytes, 정본과 동일 | SHA-256 `e9c6a620ea224abfdec0e6d97538c6b95942f2dd92c940882c2abc702c10113f` |
| 원격 GitHub | 404 / 미게시 | [remote-status.json](review/work-2026-10-04/remote-status.json) |

브라우저: Chromium 153.0.8010.0, Playwright 1.57.0. 그래픽: ANGLE / SwiftShader, WebGL 2.0 / OpenGL ES 3.0, fragment precision 23 bits. 별도 GLES: llvmpipe LLVM 20.1.2 / Mesa 25.2.8-0ubuntu0.24.04.2.

57개에는 기존 core 40개, 독립 참조 13개, 보안·빌드·HTTP 4개가 포함됩니다. 참조 13개는 12개 입력의 첫 4회 궤도 비교와 미세 좌표 구분 1개입니다. 추가로 중복 합산하지 않습니다. 허용 오차 `1e-221 × (1 + |참조값|)`는 선택된 입력과 단계에 대한 조건이며 보편적 221자리 정확성 보증이 아닙니다.

## 재현

```bash
npm test
npm run build
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium
```

서버와 브라우저가 같은 네트워크 환경에서 실행돼야 합니다. 별도 터미널에서 `npm run dev`를 실행하고:

```bash
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:browser
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:release
```

`CHROMIUM_PATH=/absolute/path/to/chromium`으로 다른 설치된 Chromium을 지정할 수 있습니다. 이번 환경에서는 Playwright 공식 Chromium 다운로드가 실패해, 테스트 전용 별도 디렉터리에 `@sparticuz/chromium@153.0.0` 패키지의 실행 파일을 준비했습니다. 앱 의존성에는 추가하지 않았습니다. `test:release`는 브라우저 WebGL2를 사용할 수 없으면 실패하며 이를 통과로 숨기지 않습니다.

컨테이너의 한글 폰트 부재는 테스트 환경에 Noto Sans KR을 설치해 해결했습니다. 새 화면 증거에는 한글이 표시됩니다. 시스템 폰트를 사용하는 앱 소스와 CSP는 그대로입니다.

`test:browser`에 URL을 주지 않으면 `set_content` 경로가 사용됩니다. 이번 29개 검사는 실제 HTTP 원점에서 실행했습니다. `test:release`는 URL을 생략하면 기본 loopback 주소를 사용하며 HTML 주입으로 대체하지 않습니다. 두 스크립트의 새 결과는 `tests/review-output/`에 저장됩니다.

```bash
python3 tests/gpu_software_test.py
```

GLES 검사는 EGL/GLES 공유 라이브러리가 있는 Linux에서 실행됩니다. 실제 production GLSL의 컴파일·링크와 기준 픽셀 5개를 검사합니다. 하드웨어 GPU 검증이 아닙니다.

독립 참조를 다시 생성할 때만 `python3 tests/generate_orbit_reference.py`를 실행하세요. mpmath 300자리 계산으로 기존 oracle 파일을 덮어씁니다. 이번에는 기존 oracle로 회귀를 수행했으며 참조값을 다시 만들지 않았습니다.

## 범위와 한계

- HTTP 응답과 CSP, 브라우저 동작을 결합해 검사했습니다. 공개 HTTPS 주소는 아직 없습니다.
- loopback secure context의 클립보드 내용과 URL 재접속은 확인했습니다. 공개 호스트의 권한 동작은 별도입니다.
- WebGL2 컨텍스트 진입·실제 손실·CPU 복구를 확인했습니다. 드라이버는 소프트웨어입니다.
- 핀치·한 손가락 드래그는 Chromium CDP 터치 입력입니다. 물리 iPhone/Safari가 아닙니다.
- 고정밀 단일 렌더 약 19.1초는 현재 환경의 특정 입력 결과이며 성능 개선 주장이나 최악 시간 추정이 아닙니다.
- GPU elapsed는 CPU 측 제출 시간 중심이며 실제 프레임/GPU 완료 시간으로 사용하지 않습니다.
- 테스트 통과가 수학적 수렴·발산 증명이나 정식 서비스 승인을 뜻하지 않습니다.
- CI에 두 브라우저 검사를 연결했지만 원격 Actions 실행은 미완료입니다.

과거 `docs/review/` 루트의 로그·JSON과 `tests/browser-report.json`, `tests/artifacts/`, `tests/unit-report.txt`를 이번 실행 결과와 합산하지 않습니다. 최신 판정은 [프로덕션 리뷰](PRODUCTION_REVIEW.md)를 참조하세요.
