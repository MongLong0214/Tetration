# 검증 기록 — 0.3.0 / 2026-10-04

| 실행 | 결과 | 증거 |
| --- | --- | --- |
| Node 24.19.0 | 59/59 | [unit-tests.txt](review/modern-2026-10-04/unit-tests.txt) |
| 결정적 빌드·CSP | 성공 | [build-output.txt](review/modern-2026-10-04/build-output.txt) |
| HTTP 브라우저 입력·보안·모바일 | 29/29 | [browser-review.json](review/modern-2026-10-04/browser-review.json) |
| WebGL2·복구·클립보드·응답 헤더 | 16/16 | [browser-release.json](review/modern-2026-10-04/browser-release.json) |
| WebGPU·병렬 Worker·호환 경로 | 10/10 | [browser-modern.json](review/modern-2026-10-04/browser-modern.json) |
| 반응형 화면 | 4개 크기 | [visual-modern.json](review/modern-2026-10-04/visual-modern.json) |
| 소프트웨어 GLES | 8/8 | [gpu-software.json](review/modern-2026-10-04/gpu-software.json) |
| GitHub Actions | 성공: Node 59 + 브라우저 29/16/10 | [실제 응답](review/modern-2026-10-04/remote-publication.json), [출력](review/modern-2026-10-04/remote-ci-output.txt) |

Chromium 153.0.8010.0, Playwright 1.57.0. WebGPU는 SwiftShader/Vulkan, WebGL2는 ANGLE/SwiftShader. GLES는 llvmpipe 소프트웨어 렌더입니다. 실기기·물리 GPU·공개 HTTPS 검사를 뜻하지 않습니다.

Node 검사에는 300자리 독립 참조와 240자리 구현을 비교하는 12개 입력 및 미세 좌표 구분 검사가 포함됩니다. 일부 유한 궤도 검증이며 보편적 오차 상한이나 수학적 증명이 아닙니다. WebGPU 브라우저 10개 검사 안에는 총 15개 기준 픽셀과 실제 PNG 픽셀 검사가 포함됩니다.

## 재현

```bash
npm test
npm run build
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium
# 다른 터미널에서 npm start
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:browser
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:release
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:modern
```

`CHROMIUM_PATH`로 실행 파일을 지정할 수 있습니다. WebGPU 검사는 소프트웨어 Vulkan을 요청하는 Chromium 플래그를 명시합니다. WebGL2 검사는 WebGPU를 테스트에서만 숨겨 대체 경로를 독립적으로 확인합니다. CSP를 완화하지 않습니다. PNG 판독용 Pillow는 QA 의존성입니다.

빌드 및 증거 무결성: [SHA256SUMS.txt](review/modern-2026-10-04/SHA256SUMS.txt). 원격 결과: [게시 기록](PUBLISHING.md).
