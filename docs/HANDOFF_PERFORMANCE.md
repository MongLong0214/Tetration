# 성능 연구·최적화 핸드오프 (알고리즘 · GPU)

작성일: 2026-10-05. 기준 커밋: `3b9a27d` (main). 대상: TETRA의 깊은 확대 성능을 이어서 연구·최적화할 다음 작업자(사람 또는 에이전트).

이 문서만 읽고 바로 측정 → 가설 → 구현 → 검증 사이클을 돌릴 수 있도록, 구조·수식·기준선 수치·병목 분석·후보 과제·검증 게이트·작업 규칙을 모두 적었다. 수치는 모두 이 저장소의 도구로 재현할 수 있다(§4, `tools/perf/`).

---

## 0. 한 페이지 요약

- **무거운 일은 전부 GPU 프래그먼트 셰이더(GLSL ES 3.0, WebGL2)에서 한다.** JavaScript는 스케줄링·입력·기준 궤도(BigInt, Worker)만 맡는다. 언어를 Rust/WASM으로 바꿔도 렌더 속도는 거의 변하지 않는다(§3.4).
- 깊은 확대는 **perturbation(로그 공간) + floatexp 오프셋 + BLA(bilinear approximation)** 로 한다. BLA 뒤 구간은 2026-10-05부터 **일반 FP32 경로**로 돈다.
- 깊이와 무관하게 BLA 뒤에도 **픽셀당 약 280~400단계의 비선형 궤도**가 남는다. 이것이 근본 비용이다. 혼돈 영역은 픽셀의 약 87%가 적응형 AA 경계로 판정되어, Ultra 품질(16×)은 1× 비용의 약 15배가 든다.
- 최근 개선(같은 SwiftShader에서 측정):
  - perturbation 커널 1.7~1.8배 빨라짐
  - 첫 deep 셰이더 컴파일 3.2초 → 0.7초
  - 480×236 완성 시간: 10¹¹ 4.2→2.8초, 10²⁵ 5.9→3.8초, 10¹⁰⁰ 7.3→4.4초
- 다음 단계에서 효과가 가장 클 것으로 보는 후보(§6):
  1. 깊은 혼돈 영역의 AA 비용 정책
  2. 반복 상한(cap) 픽셀 비용
  3. 기준점 선택 개선
  4. 셰이더 미세 최적화
  5. 라이브 프레임 해상도 정책

---

## 1. 코드 지도

| 파일 | 역할 | 성능 관련 핵심 |
| --- | --- | --- |
| `src/gpu.js` | WebGL2 렌더러 `TetraGPU` | 셰이더 소스(`header`, `footer`, `direct`, `perturbHead`, `perturbStep`, `plainStep`, `orbitLoop`, `perturbBla`), `prepare()`, `drawTile()`, `fence()`, `presentFrame(frame, soft)`, `blaLevels()`, `useBla()`, `warm()`, `warmPerturb()`, `touch()`, `probeTrig()` |
| `src/main.js` | 앱 오케스트레이션 | `chooseMode()`, `iterationsFor()`, `runInteractive()` (라이브 프레임), `livePlanFor()`, `interactiveSize()`, `liveHistory()` (시간 누적), `gpuJob()` (최종 단계), `runStage()` (타일 배치), `scheduleWarm()`, 기준 궤도 캐시(`findReference`, `nearReference`, `ensureReference`) |
| `src/core.js` | 수학 공용부 | `RULES` (gpu: lowA -80, maxB 1e6, tol 2e-6), `perturb64()` (FP64 기준 구현), `blaTable()`, `blaReach()`, `offsetBound()`, `logOffsetBound()`, `BLA_EPS` (gpu 2⁻²⁴, cpu 2⁻⁵³), `paletteGLSL` |
| `src/reference.js` | 정확한 기준 궤도 | 이진 고정소수점 BigInt 궤도, 출력 `V`(값), `T`(탈출 임계 차), `ReA`/`ImA`(Re/Im(L0·V)), `L0`, `c0`, `length`, `values` |
| `src/render.js` | 순수 유틸 | `size()` (DPR 0.25–3, 예산 8,294,400 px), `tiles()`, `referencePoint()`, `perturbScene()` (스케일·mantissa 분해) |
| `src/worker.js` | CPU Worker | FP64/정확 모드 타일, BLA 사용 |
| `tools/perf/` | 측정 도구 | §4 참고 |
| `tests/` | 회귀 게이트 | §7 참고 |

빌드: `node build.cjs` → `dist/index.html` 하나(CSP 해시 포함, 의존성 없음). 서버: `node serve.cjs dist` (포트 `PORT`, 기본 4173).

---

## 2. 렌더 파이프라인

### 2.1 모드 선택 (`main.js chooseMode`)
- 픽셀 크기(`span / width`)가 `magnitude × 2⁻¹⁶` 이상이면 `gpu`(direct FP32), 그보다 작으면 `perturb`(GPU perturbation).
- GPU가 없으면 `cpu`(FP64) 또는 `cpu-perturb`. 경계는 `1e-13`.
- 자동 반복 상한: `wanted = 320 + 34·log10(7/span)`을 `AUTO_STEPS`(256…16384) 중 그 이상인 첫 값으로 올린다. 깊이에 따라 10¹¹은 768, 10²⁵는 1536, 10¹⁰⁰은 4096, 10⁻²⁰⁰은 8192.

### 2.2 기준 궤도
- 뷰 중심 근처의 점(`referencePoint`)에서 정확한 궤도를 Worker로 계산한다. 자릿수는 `log10(mag/span) + 24 + 16`(최대 256)이고, 다음 반복 단계까지 미리 계산한다.
- 캐시는 6개다.
  - `findReference`: 64 span 이내이고 자릿수·반복이 충분할 때 재사용
  - `nearReference`: 4096 span 이내이고 자릿수가 12 부족해도 라이브 프레임 임시용으로 사용
- 비용: 10²⁵ 17 ms, 10¹⁰⁰ 73 ms(6,144단계, 140자리), 10⁻²⁰⁰ 약 0.4초(12,288단계, 240자리).

### 2.3 셰이더 수학 (perturbation, 로그 공간)
테트레이션 반복은 `w ← c^w = exp(w · log c)`다. 기준 궤도를 `V_k`, 픽셀 오프셋을 `d = w − V`, `L = log c = L0 + dL`(`dL = log1p((c−c0)/c0)`)로 두면 다음과 같다.

```
eps   = V·dL + d·L
w'    = V' · exp(eps)
d'    = V' · expm1(eps)
```

- 탈출 판정은 `Re(eps) > T_k`(정확한 차이값을 기준 궤도에서 미리 계산)이다.
- 붕괴는 `a < lowA` 또는 `|b| > maxB`, 고정점은 연속 8회, 주기 2는 연속 12회 판정한다.
- `|w| < |d|`이면 가상 시작점 `V_0 = 0`으로 rebase하고, 기준 궤도가 끝나도 rebase한다.
- **floatexp**: `d`, `dL`을 (vec2 mantissa, int exponent)로 저장한다. `expOf`/`scaled`/`normalizeExp`가 `floatBitsToInt`/`intBitsToFloat`로 지수를 다룬다. 10⁻³⁸ 아래 span에서도 상대 정밀도를 유지하지만 단계당 비용이 크다.
- **BLA** (`perturbBla`, `core.blaTable`):
  - `d`가 작을 때 `2^j`단계 묶음을 `d ← A·d + B·dL`로 한 번에 적용한다.
  - 표는 RGBA32F 텍스처(`uBla`)에 floatexp로 들어 있고, 반경 `R`은 log2다.
  - "auto" 모드는 `reach ≥ max(32, 0.25·min(refLength, iterations))`일 때만 BLA 프로그램을 쓴다.
  - BLA 프로그램은 KHR_parallel_shader_compile로 백그라운드 링크한다.
- **일반 FP32 경로** (`plainStep`, `orbitLoop`):
  - `|d| ≥ 2⁻⁶⁰`이면 들어가고 `|d|² < 1e-40`(|d| < 1e-20)이면 floatexp로 돌아간다.
  - 가수는 floatexp와 같은 24비트다.
  - `V·dL` 항은 `dL`을 일반 float로 쓴다. 10⁻³⁸ 아래에서는 0으로 내려가지만, 그때 그 항은 `d·L`의 FP32 분해능보다 작다.
  - `perturb`와 `perturbBla`는 **같은 `orbitLoop` 문자열**로 끝난다(테스트가 강제).
- **`orbitColor` 호출은 정확히 한 곳**(footer `main()`의 단일 샘플 루프)이다.
  - GPU 컴파일러는 함수를 호출 위치마다 인라인한다. 네 곳에서 호출하던 시절 첫 deep 프레임 컴파일이 3.2초였고, 한 곳으로 모은 뒤 0.7초가 됐다.
  - `hardening.test.cjs`가 호출 위치 수(정의 1 + 호출 1)를 강제한다.

### 2.4 샘플링 · 표시
- **최종 렌더** (`gpuJob`):
  - preview(라이브 크기 1×) → detail(풀 해상도 1×) → antialias(적응형 4×, 회전 격자) → ultra(적응형 16×, 4×4 격자, 4× 샘플 재사용) 순서다.
  - 적응형 판정은 3×3 이웃 최대 채널 차이가 0.035 이상인 경우다.
  - 타일 배치는 약 14 ms(`BATCH_MS`)이고 `fence()`로 비동기 완료를 확인한다.
- **라이브 프레임** (`runInteractive`):
  - 월드 고정 그리드(정수 픽셀 시프트, 1/8 옥타브 줌 레벨, 1픽셀 오버스캔)를 쓴다.
  - **시간 누적**: 픽셀마다 최대 16개 계층 샘플의 평균을 쌓고, alpha 채널에 개수를 둔다(`liveHistory`). 같은 그리드면 정수 시프트로 그대로 이어받고, 그리드가 바뀌면 직전 이미지를 bilinear로 다시 샘플링해 최대 4샘플만 신뢰한다.
  - **인터리빙**: 해상도가 부족하면 2×2 위상 중 하나만 매 프레임 갱신한다. 비용은 1/4이고 픽셀은 4배다.
  - 계획(`livePlanFor`)은 크기와 샘플 수를 고정해 두고, 3프레임 연속 느리거나 아주 느린 프레임 1번일 때만 다시 계산한다.
- 매끈한 라이브 화면 위에 1× 단계를 바로 띄우지 않는다. 라이브보다 선명할 때는 **soft**(2×2 평균 blit 후 bilinear 확대)로 보여 준다(`presentFrame(frame, true)`).

---

## 3. 현재 성능 기준선과 병목 분석

환경: Chromium 141 / ANGLE / **SwiftShader**(CPU 소프트웨어 WebGL2, 4코어). 하드웨어 GPU는 보통 10~100배 빠르다. 절대값보다 **같은 환경에서의 A/B 비율**로 판단한다. 실행마다 ±10% 정도 흔들린다.

### 3.1 픽셀당 작업량 (`node tools/perf/orbit_work.cjs`, 64×40 격자, FP64, GPU 규칙)

| 뷰 | 반복 상한 | 기준 길이 | 단계 p10/p50/p90 | cap 도달 | BLA reach | 루프/픽셀 plain → BLA |
| --- | --- | --- | --- | --- | --- | --- |
| Plume 10¹¹ | 768 | 191 | 190 / 213 / 768 | 11.8% | 20 | 308 → 286 |
| Abyss 10²⁵ | 1536 | 407 | 391 / 446 / 852 | 2.5% | 244 | 553 → 277 |
| Horizon 10¹⁰⁰ | 4096 | 2692 | 2629 / 2724 / 3107 | 0.3% | 2372 | 2807 → 400 |

해석:
- BLA 뒤 작업은 깊이와 거의 무관하게 **약 280~400단계**다(비선형 구간: 오프셋이 2⁻²⁴ 상대 크기에서 O(1)까지 커지고, 그 뒤 탈출·붕괴까지 걸리는 단계).
- Plume은 BLA가 거의 효과가 없다(reach 20). cap 픽셀(11.8% × 768단계)이 전체 작업의 약 30%다.
- 얕은 direct 뷰도 평균 194~265단계라서, **깊은 곳이 느린 이유는 단계 수보다 단계당 비용**이었다.

### 3.2 단계당 비용 (SwiftShader, 160×96, 1샘플)

| 경로 | ns/단계 | 비고 |
| --- | --- | --- |
| direct FP32 (얕은 곳) | 약 14~19 | exp + cos/sin(PRECISE_TRIG 다항식) |
| perturbation floatexp (이전) | 약 88 | 지수 관리, 텍스처 fetch, 분기 |
| perturbation 일반 FP32 (현재) | 약 55 | 아직 direct의 약 3배: `refAt` fetch, `sincosh`/`expm1s`, cmul 2회, 분류 검사 |

### 3.3 커널과 앱 단위 비교

`python3 tools/perf/gpu_kernel.py` (240×118, 1×, 자동 BLA):

| 뷰 | `f109c7f` (floatexp만) | `3b9a27d` (일반 FP32 경로) |
| --- | --- | --- |
| Plume | 800 ms | 388~438 ms |
| Abyss | 934 ms | 562 ms |
| Horizon | 1156 ms | 683 ms |

`python3 tools/perf/app_timeline.py` 또는 deep 스위트, 480×236 완성, 새로 연 페이지(기준 궤도·컴파일 포함):

| 뷰 | v1.0.0 증거 | 현재 |
| --- | --- | --- |
| 10¹¹ | 4.2초 | 2.8초 |
| 10²⁵ | 5.9초 | 3.8초 |
| 10¹⁰⁰ | 7.3초 | 4.4초 |
| 10⁻²⁰⁰ | 2.1초 | 1.9초 (첫 perturbation draw 0.7초가 컴파일) |

960×640 Horizon 1×는 BLA만 있을 때 약 25초, 현재 15.4초(perf 스위트)다. 10¹⁰⁰ 드래그 중 화면 갱신 간격 p95는 16.8 ms다.

### 3.4 언어(Rust/WASM) 검토 결론
- 렌더 시간의 대부분이 GPU 셰이더다. JavaScript를 바꿔도 이 부분은 그대로다.
- WASM이 이득을 줄 수 있는 곳:
  - 기준 궤도 BigInt: GMP급 라이브러리로 몇 배 빨라질 수 있다. 다만 위치당 1번이고 10¹⁰⁰에서도 73 ms다.
  - CPU 대체 경로(WebGL2 없는 기기): WASM SIMD로 1.5~3배를 기대할 수 있다.
- 네이티브 앱으로 가도 소비자용 GPU의 FP64는 FP32보다 수십 배 느려서, 같은 FP32 perturbation과 BLA 구조가 최선이다.

---

## 4. 측정 도구 (`tools/perf/`, 자세한 사용법은 `tools/perf/README.md`)

```sh
npm run build && node serve.cjs dist &         # http://127.0.0.1:4173
node tools/perf/orbit_work.cjs plume abyss horizon      # 브라우저 불필요
python3 tools/perf/gpu_kernel.py --size 240x118         # 셰이더 커널 시간
python3 tools/perf/app_timeline.py --viewport 480x320   # 앱 단위: 기준, draw 목록, 첫 컴파일
```

- 뷰 정의는 `tools/perf/views.json`에 있다(plume, abyss, horizon, deep200).
- **A/B 방법**:
  1. `git worktree add /tmp/wt-A <commit>` 후 `(cd /tmp/wt-A && node build.cjs)`
  2. `PORT=4174 node serve.cjs /tmp/wt-A/dist &`
  3. 도구에 `--port 4174`를 넘긴다. A/B를 번갈아 2회 이상 실행한다.
- 브라우저 내 정밀 비교 헬퍼는 `tests/browser_pixels.js`(`window.__tetraPixels`)에 있다.
  - `compare`: GPU와 FP64·정확 궤도 비교
  - `bla`: BLA on/off 속도
  - `antialias`: 64샘플 기준 RMSE
  - `accumulate`: 라이브 누적
  - `seams`: 타일 이음매
- `tests/browser_benchmark.py`는 임의 뷰의 드래그 프레임 간격 벤치다.
- 주의: SwiftShader에서는 깊은 곳 라이브 프레임이 최소 크기(40×23)에 붙는다. 라이브 해상도 정책(인터리빙 등)의 효과는 **하드웨어 GPU에서만** 평가할 수 있다.

---

## 5. 지금까지 얻은 교훈 (함정 목록)

1. **셰이더 인라인 폭발**: 무거운 함수를 여러 곳에서 호출하면 컴파일 시간과 바이너리가 호출 수만큼 커진다. 첫 deep 프레임이 수 초 멈춘 원인이었다. 샘플 루프는 하나로 유지한다.
2. **드라이버 지연 컴파일**: `linkProgram`이 끝나도 ANGLE/SwiftShader는 첫 draw에서 실제로 번역한다. 그래서 `touch()`(1×1 draw)로 한가할 때 미리 컴파일한다(`warm`, `warmPerturb`).
3. **속도 추정 오염**: 누적 프레임은 수렴한 픽셀을 건너뛰어 실제보다 빨라 보인다. 그런 프레임은 속도 추정을 **낮추기만** 한다(`runInteractive`). 이걸 놓치면 계획이 줄지 않아 GPU가 포화되고 입력이 밀린다.
4. **GPU 포화 = 입력 지연**: SwiftShader는 CPU라서 GPU를 계속 쓰면 컴포지터와 입력이 굶는다. 정지 화면 정제는 프레임 시간만큼 쉬게 했다. 관성 속도는 `e.timeStamp`로 계산한다.
5. **테스트 순서 간섭**: 같은 브라우저에서 새 페이지를 열면 기존 페이지의 rAF·입력 타이밍이 바뀌어 플릭 테스트가 흔들렸다. 별도 페이지를 여는 검사는 스위트 끝에 둔다.
6. **8비트 누적 오차**: RGBA8 이동 평균은 프레임마다 반올림해서 16샘플 float 평균과 최대 3/255 차이가 난다. 테스트 허용치가 이 값이다.
7. **같은 결과의 기준**: 구조 영역(threshold boundary 10⁻⁵⁵, convergence 2e-6, 축 1e-9, 하반면 1e-30, 원점 1e-20, fixed interior 1e-150, 3e-9)은 GPU perturbation이 FP64와 **픽셀 단위로 같아야** 한다. 혼돈 영역은 통계(클래스 ±6%, block diff 상한)로 비교한다. 최적화가 구조 영역 픽셀을 바꾸면 그 최적화는 틀린 것이다.

---

## 6. 다음 최적화 후보 (우선순위순)

각 항목에 가설, 예상 효과, 손댈 위치, 위험, 검증 방법을 적었다. "예상 효과"는 추정이므로 반드시 §4 도구로 측정한다.

### P1. 깊은 혼돈 영역의 AA 비용 정책
- **관찰**: 혼돈 영역은 87% 안팎의 픽셀이 경계로 판정된다. 그래서 4× 단계에 1× 대비 약 2.6배, 16× 단계에 약 10.4배가 더 든다(antialias 테스트의 `changed16`/`pixels`).
- **아이디어**:
  - (a) 시간 예산형 AA: 1× 단계 시간 t1으로 예상 비용을 계산하고, 예산(예: 기기별 2~4초)을 넘으면 16×를 건너뛰거나 경계 임계값을 올린다.
  - (b) 점진 패스: 모든 픽셀에 패스마다 1샘플씩 더한다. 누적 셰이더를 그대로 재사용할 수 있고, 패스마다 완성 화면이 나온다.
  - (c) 경계 판정에 색 차이 대신 반복 수·클래스 차이를 쓴다.
- **위치**: `gpuJob()` 단계 구성, `footer` 적응형 판정, `runStage()`.
- **위험**: 품질 테스트(64샘플 기준 RMSE 감소율 4×≤0.85·1×, 16×≤0.95·4×)를 깨지 않아야 한다. 예산형이면 테스트 뷰가 예산 안에 들도록 설계한다.
- **예상 효과**: 깊은 곳 Ultra 완성 시간 2~5배 단축(체감 최대).

### P2. 반복 상한(cap) 픽셀 비용
- **관찰**: Plume에서 11.8% 픽셀이 768단계 끝까지 돌고 분류되지 않는다(kind 0). 전체 작업의 약 30%다.
- **아이디어**:
  - (a) 탈출 통계 기반 적응형 반복 상한: 이전 프레임의 탈출 단계 분포로 상한을 정한다(Kalles Fraktaler의 auto iterations 방식).
  - (b) 주기 탐지 강화: 현재는 고정점과 주기 2만 본다. Brent 방식 주기 n 탐지로 내부 픽셀을 일찍 끝낸다.
  - (c) cap 픽셀 비율이 높으면 라이브 프레임에서만 상한을 낮춘다(색이 바뀌므로 최종 단계는 유지).
- **위치**: `perturbStep`/`plainStep`/`direct` 분류부, `iterationsFor()`.
- **위험**: 색(palette steps)과 분류가 바뀐다. FP64 기준 구현 `core.perturb64`와 worker에도 같은 규칙을 넣어야 deep 스위트의 FP64 일치가 유지된다. `RULES`를 바꾸면 `reference.js`의 `T` 계산과 정확 궤도 테스트도 확인한다.
- **예상 효과**: Plume류 뷰 20~30%.

### P3. 기준점 선택 개선
- **관찰**: 기준점은 뷰 중심 근처다. Plume 기준 길이 191인데 픽셀 중앙값 213단계라서, 많은 픽셀이 기준 궤도가 끝난 뒤 가상 시작점으로 rebase한다(사실상 direct FP32 계산). BLA reach도 20뿐이다.
- **아이디어**:
  - 이전 프레임에서 가장 오래 산 픽셀이나 주기 핵(nucleus)을 기준점으로 고른다(Kalles Fraktaler의 auto reference).
  - 기준 궤도를 여러 개 쓰고 픽셀별로 가까운 것을 선택한다.
  - 기준 궤도를 cap까지 연장한다(탈출 후에도 계속 계산할 수 있는지 검토).
- **위치**: `referencePoint` (`render.js`), `referenceSpec`/`findReference` (`main.js`), `reference.js`.
- **위험**: 기준 재사용(64 span) 때문에 같은 링크에서도 혼돈 픽셀이 달라질 수 있다(알려진 한계). 테스트 "Pans, zooms and history return reuse one exact reference orbit"를 유지한다.
- **예상 효과**: BLA reach 증가와 rebase 감소로 Plume·Abyss류 1.3~2배(불확실).

### P4. perturbation 단계 미세 최적화 (일반 FP32 경로)
- **관찰**: 아직 direct의 약 3배(55 ns 대 14~19 ns)다.
- **아이디어**:
  - `refAt(k+1)` 텍스처 fetch(RGBA32F)를 줄인다. 다음 값을 레지스터로 미리 받아 두거나(`cur`/`nx` 재사용 확인), `T`/`ReA`를 하나로 합칠 수 있는지 본다.
  - 분류 검사의 `length()` 3회를 `dot()`과 `tol²` 비교로 바꾼다(sqrt 제거).
  - `sincosh` 분기와 `exp(.5x)` 계산을 정리한다.
  - `periodCount` 검사를 i>2 분기 없이 처리한다.
  - PRECISE_TRIG 다항식을 정밀도가 허용하는 범위에서 줄인다.
- **위치**: `plainStep`, `perturbStep`, `header`의 `polyCosSin`.
- **위험**: 구조 영역 FP64 픽셀 일치(deep 스위트)와 `probeTrig` 기준(4e-6)을 지켜야 한다. `sqrt` 제거는 tol 비교 의미를 정확히 보존해야 한다(`length(a)<t` ⇔ `dot(a,a)<t²`, t≥0).
- **예상 효과**: 커널 10~40%.

### P5. 라이브 프레임 해상도 정책 (하드웨어 GPU에서 평가)
- **관찰**:
  - `interactiveSize`의 크기 양자화가 1/24 단위라서 최소 구간에서 너무 거칠다(1/24 → 2/24가 픽셀 4배).
  - 바닥값이 2048/8192 px다.
  - 깊은 곳에서는 줌 레벨이 바뀔 때마다(9%) 모든 픽셀을 다시 샘플링한다.
- **아이디어**:
  - 작은 크기에서 더 촘촘한 양자화.
  - 중앙을 고해상도로, 가장자리를 저해상도로 하는 foveated 라이브 프레임.
  - 줌 중에는 이전 레벨 픽셀을 더 오래 신뢰한다(XaoS식 재사용, resample cap 조정).
  - 인터리빙 위상 순서를 blue-noise로 바꾼다.
- **위치**: `livePlanFor`, `interactiveSize`, `liveHistory`, footer 인터리빙.
- **위험**: grid-lock(겹침 픽셀 동일)과 누적 테스트를 유지한다. 텍스처 풀(크기별 재사용)과 상호작용한다.
- **예상 효과**: 깊은 곳 드래그 선명도 2배 안팎(하드웨어 의존).

### P6. 스케줄링 오버헤드
- **관찰**: `fence()`는 6번까지 MessageChannel로 확인한 뒤 `setTimeout(1)`로 폴링한다. 타이머는 중첩되면 4 ms 이상으로 늘어난다. 배치 하나가 약 14 ms라서 최대 20% 안팎의 유휴가 생길 수 있다.
- **아이디어**: 다음 배치를 미리 제출하는 이중 버퍼링, `KHR_parallel_shader_compile` 외 `EXT_disjoint_timer_query_webgl2`로 실제 GPU 시간을 측정해 배치 크기를 정한다.
- **위치**: `runStage`, `fence`.
- **위험**: 드라이버 watchdog(한 draw가 너무 길면 컨텍스트 손실). 지금 draw당 궤도 작업 상한 8e7 단계를 지킨다.
- **예상 효과**: 최종 렌더 5~20%.

### P7. WebGPU 컴퓨트 경로 (장기)
- **아이디어**: WGSL 컴퓨트 셰이더로 persistent threads와 작업 압축(early-exit 픽셀 제거)을 쓴다. 분기 발산이 줄어든다.
- **위험**: 지원 범위, 별도 셰이더 유지 비용, f32만 지원. 테스트는 현재 `NO_WEBGPU`로 WebGPU를 끈다.
- **예상 효과**: 수십 %(추정). 큰 작업이다.

### P8. 최종 렌더 해상도 정책
- **관찰**: DPR 3 휴대폰은 예산 8.3M px까지 렌더한다.
- **아이디어**: 깊은 곳에서는 DPR 2로 렌더한 뒤 업스케일하거나 AA만 줄인다. 사용자 설정으로 노출할 수도 있다.
- **위치**: `targetSize`, `render.size`.
- **예상 효과**: DPR 3 기기에서 약 2.25배.

### P9. CPU 측 (낮은 우선순위)
- 기준 궤도 BigInt → WASM(GMP 계열): 10⁻²⁰⁰ 첫 진입 0.4초 단축.
- CPU 대체 경로 WASM SIMD: WebGL2가 없는 기기 1.5~3배.

### 알려진 정확도 한계 (최적화 중 악화 금지)
- 최종 렌더는 64 span 이내의 기준을 재사용하므로, 혼돈 픽셀은 같은 링크라도 새 탭과 다를 수 있다.
- FP32 탈출 임계는 약 10⁻⁹⁰ 아래, 반복 상한 근처에서 underflow할 수 있다.

---

## 7. 검증 게이트 (머지 전 필수)

```sh
npm run lint            # 0 problems
npm test                # 123 passed (node --test)
npm run build && node serve.cjs dist &   # 서버 필요
python3 tests/browser_quality.py   # 22
python3 tests/browser_perf.py      # 12
python3 tests/browser_review.py    # 29
python3 tests/browser_release.py   # 16
python3 tests/browser_explorer.py  # 22
python3 tests/browser_deep.py      # 29  (가장 오래 걸림, 약 20분)
```

| 스위트 | 성능 작업에서 특히 보는 것 |
| --- | --- |
| `tests/hardening.test.cjs` | 셰이더 구조: `orbitLoop`가 두 프로그램에 그대로 있음, `orbitColor` 호출 1곳, LOG_R/규칙 상수 |
| `tests/bla.test.cjs` | BLA 표 대수, 반경, reach, 충실도(FP64·GPU 오차 한계) |
| `tests/perturbation.test.cjs` | FP64 perturbation과 정확 궤도 일치(10⁻⁹…10⁻¹⁵⁰) |
| `browser_deep.py` | GPU와 FP64 픽셀 일치(구조 영역 7개, BLA 강제 포함), 혼돈 통계, 95자리 정확 궤도, 대칭, 이음매, 풀 해상도 시간, 기준 재사용 |
| `browser_quality.py` | AA RMSE, 라이브 누적·인터리빙 수렴(≤3/255), grid-lock, 1샘플 화면 노출 금지, 글라이드, 관성 |
| `browser_perf.py` | 첫 화면 <3초, long task <400 ms, 얕은 곳에서 BLA 미컴파일, perturbation 미리 컴파일, 드래그 프레임과 p95, 리소스 상한 |
| GitHub Actions `ci.yml` | 위 전부 + WebKit(로컬은 다운로드 차단) |

성능 수치는 `docs/VALIDATION.md`의 Speed 표와 `CHANGELOG.md`에 이전 → 이후 형식으로 기록한다. 증거 묶음(`docs/review/v1.0.0/`)을 다시 만들 때는 모든 리포트의 빌드 해시가 같아야 한다.

---

## 8. 작업 환경·규칙

- **런타임**: 의존성 없는 바닐라 JS. 페이지는 엄격한 CSP(인라인 해시, eval 금지)를 따르고 빌드가 해시를 계산한다. 새 외부 라이브러리를 넣지 않는다.
- **린트**: ESLint 10.1.0, 정확성 규칙(`eslint.config.mjs`). 위반 0을 유지한다.
- **브랜치와 배포**:
  - 작업 브랜치에서 개발하고, 검증이 끝나면 `git push origin HEAD:main`(fast-forward)으로 main에 반영한다.
  - Vercel이 main을 자동 배포한다(https://tetration.vercel.app).
  - 사용자가 요청하지 않으면 PR을 만들지 않는다.
- **커밋**: 메시지 끝에 저장소의 `Co-Authored-By`·`Claude-Session` trailer를 붙인다. 커밋과 문서에 모델 식별자나 비밀값을 넣지 않는다.
- **로컬 환경 특성**:
  - Chromium은 SwiftShader라서 하드웨어 GPU 수치가 아니다.
  - WebKit 다운로드와 일부 외부 사이트가 egress 프록시에 막힌다.
  - `pkill -f` 패턴이 자기 셸을 죽일 수 있으니 `ps`/`awk`로 PID를 골라 종료한다.
  - 테스트 서버는 4173 포트를 쓴다.
- **사용자 선호**: 응답은 한국어로 한다. 코딩 문제에는 코드 예시를 붙인다. 코드를 생략하지 않는다. map key로 index를 쓰지 않는다(React 해당 시).

---

## 9. 추천 착수 순서

1. `node tools/perf/orbit_work.cjs`와 `gpu_kernel.py`로 기준선을 재현한다(이 문서 수치와 ±10% 이내인지 확인).
2. **P4**(미세 최적화)부터 시작한다. 위험이 낮고 deep 스위트로 정확성을 바로 검증할 수 있다.
3. **P1**(AA 비용 정책)을 설계한다. 체감 효과가 가장 크다. `browser_quality.py` 기준을 지키는 방식으로 설계한다.
4. **P2·P3**는 FP64 기준 구현(`core.perturb64`, worker)과 함께 바꾼다. deep 스위트의 FP64 일치 검사를 다시 설계해야 할 수 있으니 별도 커밋으로 나눈다.
5. P5·P6는 가능하면 하드웨어 GPU 기기에서 측정한다.
