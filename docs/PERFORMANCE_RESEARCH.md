# TETRA 탐험 성능과 세부 구조 개선 분석

2026년 10월 5일. 원본은 `5487350`의 빌드이며, 변경은 `perf/fluid-exploration` 작업 브랜치에 있다. [기존 핸드오프](HANDOFF_PERFORMANCE.md)의 수학·렌더 파이프라인을 출발점으로 코드, 실제 GPU 동작, 깊은 확대의 품질, 외부 구현과 논문을 조사했다.

가장 큰 누락은 **같은 프랙탈을 조금 움직였는데 고해상도 전체 화면을 다시 계산하는 것**이었다. GPU 셰이더 자체의 비용만 줄이는 접근으로는 이 중복을 없앨 수 없다. 완성된 샘플의 월드 좌표를 고정하고 새로 드러난 띠만 계산하도록 구현했다. 첫 변경의 작은 팬 비교에서 자동화 대기까지 포함한 완성 시간은 약 11~28배 개선됐다. 후속 변경은 앱 안에서 직접 측정한 완료 시간을 추가로 약 1.5~1.8배 줄였고, 기본 화면도 내부 반복 구조가 보이는 위치로 옮겼다. 처음 보는 영역을 확대하는 비용과 모든 기기에서의 매끄러움까지 해결됐다는 뜻은 아니다.

## 실제 비교 결과

Apple M4 Pro, Chromium 149.0.7827.55, ANGLE Metal의 **실제 하드웨어 GPU**에서 측정했다. 동일한 localhost origin에서 원본 HTML을 바이트 그대로 대체하고 서비스 워커를 차단했다. 두 빌드의 실행 순서를 번갈아 세 번 반복한 중앙값이다. 실제 인터넷 다운로드 시간은 비교에 포함하지 않았다. 아래 표는 원본 `5487350`과 첫 변경 빌드 `48173027…`의 기록이며, 후속 변경의 결과는 다음 절에 별도로 표시했다.

| 동작 | 원본 | 수정본 | 개선 비율 |
| --- | ---: | ---: | ---: |
| Plume 페이지 열기부터 완성 | 2,928 ms | 938 ms | 3.1배 |
| Abyss 페이지 열기부터 완성 | 6,461 ms | 1,444 ms | 4.5배 |
| Horizon 페이지 열기부터 완성 | 2,931 ms | 1,440 ms | 2.0배 |
| Plume 작은 팬 이후 완성 | 1,842 ms | 110 ms | 16.8배 |
| Abyss 작은 팬 이후 완성 | 5,861 ms | 212 ms | 27.7배 |
| Horizon 작은 팬 이후 완성 | 2,348 ms | 212 ms | 11.1배 |
| Retina Horizon 연속 드래그 이후 완성 | 4,330 ms | 818 ms | 5.3배 |

페이지 열기는 960×552 픽셀·Ultra 16×이다. 첫 세 행은 별도의 18회 A/B 측정에서 페이지를 연 순간부터 완성까지이며, 로컬 전달과 초기 GPU 생성도 포함한다. 팬·드래그는 42회 전체 탐험 비교에서 측정했다. 새 문서와 빈 이미지 캐시로 시작했지만 드라이버의 셰이더 캐시는 공유될 수 있다. 첫 실행의 큰 이상치도 원자료에 남겼다. 예를 들어 전체 탐험 비교의 Abyss 첫 실행은 앱 내부 렌더만 원본 12.86초, 수정본 8.61초였고 이후 수정본은 1.10~1.18초였다. 중앙값을 최초 방문의 보장값으로 해석하면 안 된다.

작은 팬은 CSS 480×320·DPR 2, 실제 지도 960×472 픽셀·Ultra 16×에서 12×5 CSS 픽셀 이동이다. **453,120개 중 432,432개, 95.43%를 재사용**하고 20,688개만 다시 계산했다. 첫 도구의 팬 이후 완성 시간에는 앱의 정지 대기와 자동화 드라이버의 검사 지연도 포함한다. 그 안의 앱 렌더 시간만 비교하면 Abyss는 5,469→79 ms였다. 후속 측정에서 드라이버의 locator 폴링이 앱 완료보다 상당히 늦을 수 있음을 확인했으므로, 위 표의 팬 시간을 사용자 지연의 정밀한 값으로 해석하면 안 된다.

Retina는 CSS 1440×960·DPR 2, 실제 지도 2880×1744 픽셀·4× AA다. 60회 드래그 후 관성 없이 놓았다. 기존 5,022,720픽셀 중 4,518,596픽셀을 재사용했다. GPU 새 이미지의 표시 간격 p95는 60.1→36.3 ms였다. CSS로 움직이는 기존 고해상도 이미지와 새로 계산되는 GPU 이미지의 갱신률은 별개이며, 이 결과로 모든 상황의 60 fps를 주장하지 않는다.

측정 도구는 [exploration.py](../tools/perf/exploration.py)다. 입력·뷰·표시 해상도·두 빌드의 SHA256·GPU·오류·개별 실행·중앙값을 JSON으로 남긴다. `--scenario cold`로 페이지 열기부터 완성까지의 시간도 별도로 비교할 수 있다. 동시 GPU 부하를 피해서 순차 실행해야 한다.

## 추가 팬 개선과 기본 화면

첫 변경 빌드 `48173027…`과 후속 빌드 `a055788e…`를 같은 조건에서 번갈아 세 번씩, 총 24회 비교했다. 이제 손을 놓은 시각과 앱의 완료 flag가 바뀌는 시각을 **페이지 안에서** 기록한다. 드라이버 대기는 `wait_to_complete_ms`에 분리한다. 아래 결과를 앞 표의 드라이버 대기 값과 직접 비교해서 추가 개선 배수를 계산하면 안 된다.

| 손을 놓은 뒤 앱 완료까지 | 첫 변경 | 후속 변경 | 추가 개선 |
| --- | ---: | ---: | ---: |
| Plume 작은 팬 | 96.2 ms | 57.9 ms | 1.66배 |
| Abyss 작은 팬 | 112.0 ms | 62.6 ms | 1.79배 |
| Horizon 작은 팬 | 134.9 ms | 92.4 ms | 1.46배 |
| Retina Horizon 드래그 | 322.1 ms | 261.2 ms | 1.23배 |

작은 팬은 앞 절과 같은 960×472·Ultra 16×, Retina는 2880×1744·4× AA다. 모든 실행에서 브라우저 예외는 0개였다. 손을 놓은 뒤의 불필요한 40 ms 대기를 없애고, 재사용 팬의 새 영역은 중앙 1샘플 단계를 건너뛰어 **4→16샘플**로 계산한다. 네 샘플의 평균을 보존하고 다음 단계에서 12개를 더 계산한다. 겹치는 영역의 기존 최종 샘플은 그대로 유지한다. 관성이 계속되는 경우와 wheel 입력은 기존 정지 판단을 따른다.

같은 영역을 새로 여는 시간은 Plume 915→904 ms, Abyss 1,409→1,398 ms, Horizon 1,409→1,410 ms로 사실상 같았다. 이 후속 변경으로 새로운 영역의 계산 자체가 크게 빨라졌다고 주장하지 않는다. 필요한 direct/perturb 셰이더만 링크하도록 초기화를 바꿨지만, 첫 실제 draw의 드라이버 컴파일 비용은 여전히 남는다. GPU 표시 간격에서도 추가 향상을 확인하지 못했다.

기본 Bloom 카메라는 `(-2.2930579, 0.3320804)`, span `0.00025`다. 이전 기본 span `3`보다 **12,000배 가까이** 들어간 위치이며, 화면 배율 표시는 28,000×다. 단순히 기존 큰 꽃잎의 중심만 확대하면 평탄한 면이 화면을 채웠다. 여러 후보를 실제 렌더로 확인하고 작은 꽃잎·가지·그 안의 반복 구조가 함께 보이는 위치를 선택했다. 기본 화면도 native Ultra 16샘플로 새 기하를 계산한다. Overview와 명시적인 공유 URL은 기존 좌표 의미를 유지한다.

Ultra가 끝나기 전에 native 4샘플 단계가 완성되면 그 선명한 화면도 이동 중 보존한다. 16샘플 완성을 기다려야만 세부 구조를 유지하며 탐험할 수 있었던 제한을 없앴다.

## 놓쳤던 병목과 남아 있는 비용

| 위치 | 관찰 | 적용 또는 판단 |
| --- | --- | --- |
| `main.js gpuJob` | 팬이 끝날 때 기존의 고해상도 AA 샘플을 버리고 전체 1→4→16단계를 반복했다 | 정수 월드 그리드와 겹침 복사로 새로 드러난 영역만 계산 |
| `gpu.js fence` | 재귀 `setTimeout(1)`이 중첩 타이머 규칙에 의해 최소 4 ms로 늘어났다 | MessageChannel task를 거쳐 중첩을 끊고 긴 작업은 1 ms 타이머로 폴링 |
| `main.js runStage` | 작은 타일을 지나치게 잦은 fence로 직렬화했다 | 최종 배치 예산 14→28 ms. 라이브 예산 12 ms와 타일당 계산 한도 유지 |
| 완성 이미지 캐시 | 기준 궤도는 캐시했지만 완성 픽셀은 보존하지 않았다 | 최근 세 뷰의 텍스처를 소유하고 정확한 Back/Forward 복원 |
| 이동 중 표시 | 선명한 완성 화면을 작은 라이브 화면이 덮었다 | 실제 고해상도 픽셀을 별도 레이어로 유지하고 정확한 카메라로 재투영 |
| 첫 GPU 초기화 | 삼각함수 검사 readPixels, 동기 링크, 첫 실제 draw의 드라이버 컴파일이 있다 | 필요한 모드만 지연 링크. 첫 draw 비용은 남음. BLA는 병렬 링크·유휴 warm-up 사용 |
| 픽셀 셰이더 | BLA 뒤에도 평균 약 280~400회 비선형 반복이 남는다 | 새 영역의 근본 계산 비용. 다음 후보는 고차 근사와 활성 궤도 작업 큐 |
| 적응형 AA | 혼돈 영역 약 87%가 경계 판정을 받아 Ultra가 거의 16회 궤도 계산이 된다 | 품질 기준을 낮추지 않았다. RGB 경계 검사만으로 작은 구조의 부재를 증명할 수 없음 |
| 반복 길이 편차 | Plume의 cap 픽셀이 긴 실행 꼬리를 만든다 | cap 감소 대신 완료된 픽셀을 제외하는 compute 경로가 연구 후보 |
| 라이브 해상도 | Retina Horizon에서 약 480×291로 작고 보수적인 iteration 예산을 쓴다 | 계산량 예측 개선 여지. 예산을 단순 확대하는 실험은 이득이 없어 제외 |
| 기준 궤도 Worker | 이 M4에서 Plume·Abyss·Horizon 기준 계산은 대략 2·3·30 ms였다 | 수 초 단위 팬 지연의 지배 요인이 아님. 고반복·더 깊은 영역은 다시 측정 필요 |
| CPU fallback | FP64 타일·Worker 전달·AA 반복·취소 비용이 있다 | 이번 GPU 팬 최적화의 수혜가 제한적. 기능 검증은 통과 |
| 입력 처리 | pointer마다 컨트롤 동기화·BigInt 변환·그리드 표시 작업이 있다 | 장시간 JS 작업은 주요 팬 비교에서 관찰되지 않았다. 입력 coalescing은 후순위 |
| 전달과 설치 | 하나의 HTML, CSP 해시, 네트워크 우선 SW다 | 공개 배포 원본은 약 224 KB. 단일 네트워크 관측 TTFB 약 554 ms로, 수 초의 반복 계산 전체를 설명하지 못함 |

타이머 원인은 [HTML 표준의 중첩 타이머 규칙](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)으로 확인했다. 변경은 지속적인 busy polling을 하지 않는다. 완성 이미지의 캐시는 최대 64 MiB, `deviceMemory`가 4 이하이면 24 MiB로 제한한다. 이는 **완성 이미지 캐시 자체의 한도**이며 scratch 텍스처·캔버스·드라이버 전체 메모리 한도는 아니다. 할당 실패·context loss 때 캐시와 보존 레이어를 비운다.

## 세부 구조를 실제로 들여다보는 방법

`Detail`, `Z` 이후 드래그 또는 `Shift-drag`로 작은 구조를 둘러싸면 그 영역에 맞는 새 카메라를 만들고 **풀 표시 해상도로 새로운 궤도를 계산**한다. 선택 사각형의 종횡비를 보존하며 카메라 중심·span 계산은 256자리 고정소수점에서 수행한다. `Escape`로 취소할 수 있고, 선택 중 두 번째 손가락은 핀치 동작으로 전환한다. 확대 깊이에 따라 Auto 반복 상한도 기존 규칙대로 증가한다.

이동 중에는 이미 계산한 작은 가지·꽃·경계가 저해상도 이미지 때문에 사라지지 않는다. 더 촘촘한 월드 샘플을 계산하면 그 새 결과로 바꾼다. 확대 순간의 CSS 재투영은 임시 표시이며, 최종 해상도가 새로운 세부 기하를 계산하는 경로와 구분된다. 팬 재사용은 같은 span·해상도·AA·팔레트·반복 수·기준 궤도를 공유할 때 적용한다. 다른 확대 배율의 샘플을 최종 픽셀로 둔갑시키지 않는다.

최종 팬 카메라는 기존 월드 그리드의 가장 가까운 정수 픽셀 위치에 샘플을 놓고, 원하는 정확한 카메라와의 남은 서브픽셀 차이는 표시 변환으로 처리한다. 정확한 카메라 좌표와 실제 샘플 위치를 각각 보존해야 여러 번 이동하거나 기록으로 돌아올 때 흔들림과 잘못된 재사용을 막을 수 있다.

## 구현과 수치 검증

[browser_reuse.py](../tests/browser_reuse.py)는 10¹¹·10²⁵·10¹⁰⁰ 확대에서 네 가지 이동 부호를 검사한다. 겹치는 영역 **전체**는 이전 이미지와 바이트 단위로 동일하다. 새로 드러난 영역 **전체**는 같은 월드 그리드의 새 16샘플 렌더와 비교했고 최대 RGB 차이는 1 byte였다. 이는 4샘플 평균을 RGBA8에 저장한 뒤 16샘플로 이어 계산하는 반올림 차이다. Back은 원래 이미지 전체와 동일하며 궤도 작업이 0이다. 10¹⁰⁰에서 선택 확대가 더 작은 span의 실제 새 픽셀을 계산하는 것도 검증했다.

네이티브 Metal 검사에서는 기존 코드의 별도 수치 결함도 찾았다. 정확히 기준점인 픽셀에서 0 가수가 임의의 큰 지수와 결합해 `0 × overflow`가 NaN으로 번질 수 있었다. `scaled`가 0 가수를 즉시 반환하도록 수정했고, 기존 release의 기준점 분류 검사가 통과했다. 분류 임계값과 반복 상한을 성능을 위해 낮추지 않았다.

후속 빌드 `a055788e…`에서 ESLint, 단위 테스트 126개, production build가 통과했다. Chromium의 review 29개·release 16개·quality 22개·perf 12개·explorer 23개·reuse 12개도 모두 통과했다. deep 스위트 29개는 강제로 선택한 SwiftShader에서 통과했다. macOS의 Playwright WebKit 26.6 스위트 13개와 reuse 스위트 12개도 통과했다. native 4샘플 화면이 준비된 뒤 Ultra 계산 도중 이동해도 선명한 이미지가 유지되는 검사를 두 브라우저에서 추가로 확인했다.

첫 변경 빌드의 Metal deep 검사에서는 structured FP64 비교와 chaotic 통계 비교가 통과했지만, 같은 스위트의 작은 커널에 대한 기존 2.5배 속도 단언이 1.62배로 실패했다. 소프트웨어 렌더러의 비율 조건을 하드웨어 결과로 바꾸거나 통과로 보고하지 않았다. 빠른 1× 이미지가 완성된 순간과 병렬 BLA 컴파일의 완료 순간은 다르므로, WebKit 검사는 기존의 즉시 완료 단언을 유한 시간 안에 실제 컴파일을 기다리는 검사로 수정했다.

GPU FP32는 혼돈 영역의 개별 픽셀에서 FP64와 다를 수 있다. structured 영역은 픽셀 단위, chaotic 영역은 블록 구조·분류 통계와 기존 허용 범위로 검증했다. 95자리 정확 궤도 비교, 실수축 대칭, 1·4·16샘플 타일 경계, 10⁻²⁰⁰ 표시 해상도, CPU FP64와 정확 모드도 deep 스위트에 포함된다. 현재 계산은 구간 산술로 인증된 수학적 증명이 아니다. 연구용 도구에서는 관측 분류, 반복 상한, 정확 확인을 계속 구분해야 한다.

## 사용 중 오동작 재현과 수정

이 절의 `33781ddc…` 결과는 첫 안정화 단계의 기록이다. 아래 프로덕션 점검의 `32951abf…` 결과와 측정 시점을 구분한다.

앞의 개별 기능 검사가 통과해도 입력과 비동기 작업이 겹치는 경우까지 정상이라는 뜻은 아니었다. 후속 점검에서 다음 문제들을 실제 앱에서 재현하고 수정했다. 렌더 결과의 분류 임계값·반복 상한·수학 커널은 이 수정에서 바꾸지 않았다.

| 재현한 동작 | 잘못된 결과 | 수정 |
| --- | --- | --- |
| 이동 중인 GPU 작업의 완료가 늦어지고, 그 사이 Back 또는 CPU 전환이 완료됨 | 완료 flag는 true인데 늦은 라이브 결과가 복원된 픽셀을 덮거나 GPU 캔버스를 다시 표시 | 최종 렌더가 화면을 소유하면 라이브 결과를 버림. 설정·화면 크기가 바뀐 결과도 표시하지 않음 |
| 선명한 화면에서 축소한 뒤 최종 렌더가 완료됨 | 이전 고해상도 레이어가 새 이미지 위에 계속 남음 | 보존 레이어는 이동 중 preview로 사용하고 완료 시 제거 |
| 영역 선택 도중 Home·wheel·외부 링크·resize, 이후 손을 뗌 | 이전 박스의 좌표를 적용해 새 탐색을 되돌림 | 다른 탐색과 설정 변경 때 포인터·선택·capture를 함께 취소. resize observer보다 pointerup이 먼저 오는 경우도 실제 DOM 크기로 검사 |
| 첫 손가락으로 선택을 시작한 뒤 두 번째 손가락으로 pinch | Back 기록이 없거나 이전 제스처의 카메라로 돌아감 | 첫 pointerdown에서 두 경로가 공유하는 제스처 시작 카메라를 기록 |
| 드래그 중 wheel 확대 후 계속 드래그 | 취소 경로를 강화한 첫 수정에서는 이후 이동까지 중단됨 | 선택 박스는 취소하되 일반 드래그는 새 배율의 카메라로 재기준화. pan·zoom을 하나의 Back 기록으로 유지 |
| wheel → Home → wheel을 500 ms 안에 수행한 뒤 Back | 다른 탐색을 같은 wheel 묶음으로 취급해 Home을 건너뜀 | 시간과 변경 serial을 함께 확인. 중간 탐색은 새 기록, 중단 없는 wheel burst는 한 기록 |
| 이동 중 PNG 저장을 시작한 뒤 다른 카메라·화면 크기로 이동 | 이미지와 메타데이터를 잡은 뒤 await에서 돌아와 세부 레이어에 새 좌표를 적용 | 카메라·viewport·모든 레이어 변환을 bitmap 생성 전에 함께 고정 |
| URL 갱신 debounce가 끝나기 전에 이동 중 PNG를 공유 | PNG의 좌표는 현재 뷰인데 첨부 링크는 이전 뷰 | 캡처 시작 전에 현재 좌표로 URL을 동기화 |
| Discover 작업을 요청한 뒤 Home 또는 다른 탐색을 수행 | 늦은 탐색 결과가 사용자의 더 최근 이동을 덮음 | 요청 이후 상태가 바뀌었으면 그 결과를 적용하지 않음 |
| 외부 좌표 링크를 요청한 직후 완료 렌더·grid 등에서 URL을 다시 동기화 | 큐에 있던 hashchange가 바뀐 `location.hash`를 읽어 새 좌표·반복 상한을 놓침 | hashchange 이벤트의 `newURL`에서 요청된 fragment를 읽음 |

PNG 문제는 같은 JS task에서 같은 화면의 저장을 두 번 시작하고, 두 번째 bitmap 전달만 늦춰 확인했다. 수정 전에는 같은 482×238 이미지가 **88,792픽셀, 최대 채널 차이 76**으로 달랐다. 수정 후에는 그 사이 Home과 resize를 수행해도 두 PNG가 바이트 단위로 동일하다. GPU 지연 검사는 실제 draw 이후 fence 결과의 전달만 늦춘다. Discover 검사는 실제 Worker 메시지의 전송을 늦춘 뒤 실제 계산 결과를 받는다. 수학 결과나 캐시 픽셀을 fixture로 바꾸지 않았다.

[browser_interactions.py](../tests/browser_interactions.py)가 이 중단·전환 경로를 검사한다. 같은 검사가 수정 전 HTML에서는 첫 번째 축소 레이어 검사에서 실패하는 것도 확인했다. [browser_explorer.py](../tests/browser_explorer.py)는 Chromium의 실제 touch event delivery를 사용해 첫 제스처와 이전 탐색 후의 selection→pinch→Back을 검사한다. 이미지 공유 API는 기존 테스트처럼 stub하며, 전달되는 PNG와 링크의 좌표를 확인한다. 수평 wheel 입력만 있는데도 Zoom limit 토스트가 뜨던 작은 오류도 수정했다.

외부 링크 문제는 deep 스위트에서 `n=1024` 요청 뒤 기존 30초 대기가 실패한 것을 계기로 찾았다. 같은 JS task에서 새 링크를 설정하고 실제 grid 컨트롤로 URL을 갱신하자, 수정 전에는 새 `x=0.5, span=0.05, n=1024`가 사라지고 이전 Bloom 좌표와 `n=auto`가 남았다. 이벤트의 `newURL`을 읽는 것으로 수정했고, 지연 허용 시간이나 반복 상한 검사는 완화하지 않았다.

오동작·준비 경로 수정을 포함한 최종 `33781ddc…`와 기준 `a055788e…`를 같은 Metal GPU에서 번갈아 24회 비교했다. 손을 놓은 뒤 앱 완료까지의 중앙값은 Plume **58.2→48.6 ms**, Abyss **70.6→73.4 ms**, Horizon **100.7→97.6 ms**, Retina Horizon **242.0→249.0 ms**였다. 일부는 짧아졌고 일부는 3~7 ms 늘었으며, 오류는 0개였다. 샘플 재사용·반복 상한·표시 해상도는 같은 조건이다. 커널 계산량을 줄인 변경이 아니므로, 이 차이를 새로운 수학 알고리즘의 가속 성과로 해석하지 않는다. 개별 실행은 로컬 `tests/review-output/stability-ab.json`에 보관했다.

이 점검 중 Metal 성능 스위트에서 BLA warm-up readiness가 한 번 30초 안에 완료되지 않았다. 상태 계측을 붙인 재실행은 통과했지만 원인은 재현하지 못했다. 이 타임아웃을 해결됐다고 처리하지 않는다. 컴파일 실패 이유를 삼키던 경로는 `tetraDiagnostics.blaCompile`에 pending·warmed·error를 남기도록 바꿨다. 이는 다음 발생 때 원인을 구분하기 위한 진단이며, 셰이더 준비 지연 자체의 해결을 의미하지 않는다.

이후 같은 readiness 대기가 다시 실패했고, 이번에는 화면이 완료돼 있고 오류는 없지만 `pending=true, warmed=false`인 상태를 잡았다. `startLink()`는 유휴 타이머에서 `linkProgram()` 뒤 명령을 제출하지 않았다. [MDN의 결과 대기·RAF 밖 flush 지침](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#flush_when_expecting_results)과 [KHR의 비차단 완료 조회](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/)를 참고해, 실제 GPU에 링크 요청 뒤 `flush()`를 추가하는 비교를 했다. 같은 브라우저에서 off/on을 번갈아 네 번 실행했을 때 준비 대기는 off **7.42·7.46초**, on **4.96·5.00초**였다. 기존 2.5초 유휴 polling 한 회차가 줄어든 결과이며, 대기는 컴파일 시작 전 유휴 시간도 포함한다. 제품의 `startLink()`에 `flush()`를 추가했다. 30초 지연이 이 제출 누락만으로 발생했다는 인과관계나 모든 드라이버에서의 해소를 확정하지 않는다.

### 기본 클로즈업에서 불필요했던 BLA 컴파일

별도 관측에서 기본 화면은 perturbation을 쓰지만 BLA 테이블의 `levels=0, reach=0`이었다. 그래도 이전 유휴 타이머는 `currentMode === 'perturb'`만 보고 큰 BLA 셰이더의 병렬 링크를 시작했다. 실제로 완료 직후 `pending=false`였던 기본 화면이 4초의 유휴 뒤 `pending=true`로 바뀌었다. 현재 기준 궤도와 일치하는 테이블에 유효한 레벨이 있을 때만 BLA를 준비하도록 바꿨다. direct 화면의 일반 perturbation 준비와 Plume·Abyss·Horizon의 유효한 BLA 준비는 유지한다. 기본 화면에서 유휴 뒤에도 BLA 링크가 시작되지 않는 회귀 검사를 추가했다.

불필요한 컴파일 제거와 새 픽셀 계산 자체의 가속은 구분한다. 최종 빌드의 별도 Metal 관측에서 1440×872·Ultra 16샘플의 기본 화면은 **2,877 ms**, 4초 유휴 뒤 한 번 확대는 **2,914 ms**, 캐시 Back은 **1.4 ms**였다. 기본 화면의 유휴 뒤에는 BLA pending과 ready가 모두 false였다. 이는 동작당 한 번의 관측이며 최초 방문의 보장값이 아니다. 이전 자동화 CLI 확인에서는 확대 상태에 9.8초가 표시되기도 했다. 그 긴 값의 원인을 컴파일만으로 확정하지 않았으며, 새 영역의 비선형 궤도·AA 비용은 여전히 남아 있다. 최종 관측은 로컬 `tests/review-output/stability-default.json`에 보관했다.

최종 HTML은 `33781ddc9bf85ff3e3a729351ca98aa6464b5cb578e43cad3be713e1fe38f7c6`이며 242,650 bytes다. 링크 요청과 1×1 warm-up draw 양쪽에 명시적 `flush()`를 넣었고, 외부 링크 이벤트의 원래 요청을 보존한다. 이 빌드로 ESLint·production build·단위 테스트 126개, 11개 스위트의 브라우저 검사 **200개**가 통과했다. 기본 화면의 불필요한 BLA 준비와 queued link를 검사하는 회귀 항목도 포함한다. 모든 보고서의 origin은 4187이며 bundle SHA가 위 값과 일치하고, uncaught exception은 0개다. 실패했던 기존 deep 반복 상한 검사와 30초 BLA readiness 검사도 시간 조건을 바꾸지 않고 통과했다. 간헐적 긴 준비 지연이 모든 드라이버에서 제거됐다는 보장은 아니다.

같은 최종 빌드에서 seed `20261005`의 빠른 혼합 조작 **150회**도 통과했다. GPU·CPU·Exact, 깊은 프리셋, 품질, 확대·이동, Back/Forward, 집중 모드와 선택 도중 Home을 섞었다. 10회마다 실제 최종 렌더를 기다린 15개 지점 모두에서 완료 카메라가 현재 좌표와 같고, 해당 엔진의 캔버스가 표시되며, 이전 세부 레이어가 남지 않았다. GPU 프레임은 6개 이하이고 브라우저 예외는 0개였다. 이 상태 전환 검사는 반복 상한 64로 실행하므로 수치 품질이나 실기기 성능 검증을 대체하지 않는다. 원자료는 로컬 `tests/review-output/stability-stress.json`에 있다.

## 반복 확대에서 없던 영역이 나타나는 현상

[browser_zoom.py](../tests/browser_zoom.py)에서 실제 `+` 버튼을 반복해서 눌러 재현했다. 중심 좌표는 `x=-2.2930579295428124999999991`, `y=0.3320804455471875`, 시작 span은 `5e-11`, 반복 수는 Auto다. 481×321·DPR 1의 홀수 크기 캔버스에서 중앙 1샘플이 같은 월드 좌표를 계속 가리키도록 했다. AA는 점 하나가 아닌 픽셀 면적을 샘플링하므로 점 궤도와 구분해서 검사한다.

| 조건 | 같은 점의 결과 |
| --- | --- |
| Auto, 처음부터 `+` 6회까지 | 상한 768, unresolved, RGB `[10,9,24]` |
| Auto, `+` 8회 이후 | 상한 1024, 838회째 임계값 통과, RGB `[241,84,144]` |
| 1024 고정, `+` 62회 | 기준 궤도 재계산 뒤에도 중앙 판정과 색 유지 |
| 1024 고정, span `1e-100`·`1e-200` | 같은 점의 판정과 색 유지 |
| 동일 카메라·span `1e-50`·Ultra, 상한만 512→1024 | 어두운 미판정 영역이 분홍색 임계 통과 영역으로 바뀜 |

제품의 궤도 구현과 별개인 decimal 계산도 80·120·180자리에서 모두 768회 미판정, 838회 임계 통과를 확인했다. Chromium과 WebKit의 반복 확대가 이 결과와 일치했다. 공개 사이트에서도 Auto가 올라가는 같은 유형의 변화를 관측했다. Custom view에 현재 Auto 상한을 표시하고, 가이드에 미판정 영역과 반복 상한 변화의 의미를 설명했다.

이 재현은 **Auto가 더 오래 계산하면서 같은 좌표의 판정이 바뀌는 경우**를 확인한다. 모든 새 구조를 정상이라고 판정한 것은 아니다. 픽셀보다 작은 구조가 확대해서 보이는 현상과 수치 오차에 의한 구조 변화도 구분해야 한다. 고정 상한으로 비교하고, 의심되는 점을 독립 고정밀 궤도로 확인해야 한다. 임계값 통과는 발산의 수학적 증명도 아니다.

## 프로덕션 점검에서 추가로 고친 오류

[browser_production.py](../tests/browser_production.py)는 다음 문제를 실제 표시 픽셀과 사용자 상태로 검증한다.

| 문제 | 수정과 검증 |
| --- | --- |
| soft 단계 PNG 저장이 지도 샘플링을 바꿈 | 현재 soft 표시와 aspect를 캡처. 수정 전 지도 채널 2,115,969개가 바뀌던 재현에서 저장 전후 모든 바이트가 같음 |
| 이동 중 PNG의 세로 비율이 화면과 다름 | 캡처 시점의 viewport와 원본 aspect로 합성. 같은 CSS 변환과 비교한 최대 채널 차이 Chromium 1, WebKit 0 |
| 거부된 링크가 Forward 이력을 지움 | 링크를 검증·수락한 뒤 이전 카메라 저장. 잘못된 버전·좌표·span·과대 길이·무관한 fragment와 정상 Back/Forward 검사 |
| 다른 탭의 저장 데이터 전체 삭제를 무시 | 네이티브 `storage`의 `key=null` 처리. stale bookmark가 다음 저장에 되살아나지 않음 |
| 작은 화면에서 Detail과 Exact 안내가 겹침 | 320×568·390×844·844×390에서 두 안내 영역의 교차 면적 0 |
| fullscreen 뒤 DPR만 바뀌면 렌더 크기가 그대로임 | 누락된 resolution 이벤트를 보완. Chromium에서 DPR 1→2→1의 실제 완료 해상도 확인 |
| GPU fence가 끝없이 pending이면 탐험 전체가 멈춤 | 10초 이상 완료 보고가 없으면 해당 context를 포기하고 FP64로 재계산. 정상 계산량·AA·반복 상한은 유지 |
| GPU 복구 경로의 CPU 렌더가 선택한 AA를 무시함 | GPU와 같은 progressive 4×4 패턴으로 실제 4·16샘플 궤도 계산. Worker/타일 경계의 픽셀 일치와 독립 고해상도 샘플 평균으로 검증 |
| 배경에서 reduced-motion으로 바뀌어도 복귀 시 flow 재시작 | 대기 중인 flow 재개 취소. 명시적으로 주입한 visibility 전환과 실제 media 변경으로 앱의 전환 검사 |

최대 반복 수 16,384·Ultra의 조밀한 장면에서 이 M4 WebKit은 네이티브 GPU context를 잃거나 완료를 보고하지 않는 경우가 있었다. 작은 타일만으로 해결되지 않아 무한 대기 복구를 추가했다. 최종 실행의 640×354 이미지는 Chromium GPU에서 27.16초, WebKit FP64 fallback에서 71.726초 걸렸다. 양쪽 모두 상한 16,384·실제 AA 16을 유지했고 이어지는 Home/Back도 완료됐다. 이는 극단 설정의 빠른 완료를 뜻하지 않는다. CPU의 기존 계산 예산은 1.6 MP·가로 최대 2048이고 Exact는 별도의 작은 고정밀 격자다. fallback을 GPU의 8.3 MP 예산과 동일하다고 해석하면 안 된다.

`43512ba`의 로컬 HTML SHA256은 `32951abfc1929e13f2941afd5d3d391fd26c1c60da8752087898436c57fd078f`, 크기는 247,938 bytes다. 실제 4187 응답도 같은 SHA임을 확인했다. 이 빌드를 고정하고 GPU 검사를 순차 실행해 **15개 브라우저 스위트·247개 검사**, 단위 검사 **131개**, ESLint를 통과했다. 모든 보고서의 origin·bundle SHA가 같고 uncaught exception은 0이다. Metal Chromium, Playwright WebKit을 사용했으며 deep 가속 비교는 기존과 같은 SwiftShader로 실행했다. 실패했던 최대 반복 수/AA 검사의 조건과 기존 시간 한도를 완화하지 않았다. GitHub의 Linux CI 결과와 병합 여부는 해당 커밋의 Actions·Git 이력에서 확인할 수 있다.

네이티브 fullscreen·문서 이동/Back·다중 탭 storage는 실제 브라우저 API로 검사했다. 이 자동화 환경에서는 다른 탭 전환·창 최소화로도 네이티브 hidden 상태를 얻지 못했다. 위 visibility 검사는 주입한 앱 전환 검사이며 네이티브 백그라운드 동작의 실기기 검증이 아니다. WebKit의 hot DPR, Safari 앱, 물리 iPhone·Android·저사양 GPU와 모든 chaotic 픽셀의 정밀도 일치는 여전히 별도 검증 대상이다.

## Linux 표시 경로 후속 재현

`43512ba`의 [Linux CI 실행](https://github.com/MongLong0214/Tetration/actions/runs/37302481156)은 실패했다. macOS 로컬 통과만으로 병합하지 않았다. WebKit의 확대·팬 픽셀 오류, 양 브라우저의 이동 중 PNG 비교 오류, Chromium의 큰 Ultra 장면 시간 초과를 각각 조사했다. 위 `32951abf…` 247개 통과는 그 커밋의 로컬 기록이며, 후속 빌드의 통과를 대신하지 않는다.

Linux Playwright WebKit에서 기본 drawing buffer로 `blitFramebuffer`하면 `INVALID_OPERATION`(1282)이 발생했다. 최종 표시를 작은 텍스처 복사 셰이더로 바꿨다. RGBA8 내부 프레임의 실제 AA 표시는 유지하고 화면 alpha만 1로 만든다. 궤도 수식·반복 수·최종 해상도를 변경하지 않는다.

복사 오류를 고친 뒤에도 재사용한 framebuffer에서 이전 프리뷰 색이 남았다. 같은 context에서 새 프레임은 정상인데 pooled 프레임은 단색 offscreen clear 후 기본 화면을 clear하면 offscreen readback까지 바뀌었다. 재사용 시 attachment를 분리하고 원래 텍스처를 다시 연결하면 확대 재현이 통과했다. 팬·Back·새 영역의 픽셀 비교도 복사 원본과 readback을 함께 갱신해야 통과했다. 연결 갱신은 공통 `refreshFrame`으로 처리한다. 브라우저 내부의 정확한 원인은 확정하지 않았고, `gl.finish()` 대기·표시 전 resize·scissor 대신 viewport를 사용하는 실험은 이 오류를 해결하지 못해 적용하지 않았다.

QA의 Playwright를 로컬과 동일한 `1.63.0`으로 고정했다. 이동 중 PNG의 기대 이미지와 export 클릭도 한 JavaScript 작업에서 잡도록 고쳤다. 기존 1-byte RGB 허용 범위와 장면·AA·시간 한도는 유지했다. ready 시간 초과 시 아직 열린 페이지에서 실제 렌더 상태를 출력하고, 확대 픽셀 실패 시 상태와 PNG를 보존한다.

부분 수정 HTML `61ec03df…`(249,142 bytes)의 결과와 최종 후속 HTML `6fb08b745b4dd4cf4e3e9ce0b7fe37a84b32832b006821408946810806f41b52`(249,466 bytes)을 구분한다. 단위 검사 131개와 ESLint를 통과했다. 부분 수정 빌드는 Linux x86_64 Playwright 컨테이너의 확대 재현 7개 검사를 통과했다. 공통 갱신 함수의 실험에서는 팬 재사용 12개 검사도 원래 픽셀·시간 조건으로 통과했다. 최종 후속 빌드의 확대·팬·PNG 및 전체 브라우저 실행은 별도로 재검증한다. 이 컨테이너는 Mac에서 에뮬레이션한 환경으로 GitHub의 네이티브 Linux 성능을 인증하지 않는다. 전체 후속 브라우저 실행과 해당 head의 CI 결과는 별도로 확인해야 한다.

`249f9f1`의 [후속 Linux CI](https://github.com/MongLong0214/Tetration/actions/runs/37310730310)에서 확대·WebKit 팬 재사용·WebKit PNG 복구 스위트는 통과했다. 큰 Chromium 기본 장면은 기존 240초 한도에서 Ultra 계산 중이었고 1440×872의 4샘플 이미지는 이미 표시되고 있었다. 정확한 기본 framebuffer 내부 포맷과 브라우저 구현 원인은 측정하지 않았다. 소프트웨어 GPU의 큰 장면 속도가 해결됐다고 해석하면 안 된다.

대형 `explorer`와 Chromium `reuse`·`production`은 원래 입력·픽셀 조건·시간 한도로 `macos-15`에서도 검증한다. `249f9f1`의 Linux Chromium production은 앞 16개 검사(이동 중 PNG 오차 0, 실제 GPU/CPU 복구, DPR·storage 포함)를 통과한 뒤 16,384회·AA16의 최종 Ultra 단계에서 240초를 초과했다. 이 최대 설정을 검사에서 제거하지 않는다. 실제 GL renderer 문자열을 보고서에 기록한다. OS 이름만으로 하드웨어 GPU라고 단정하지 않는다. Linux 확대·품질·팬(WebKit)·PNG·fallback 검사도 유지한다. macOS 러너의 브라우저 의존성은 가상 환경에 설치한다. 실패했던 Linux 실행과 Docker의 1280px 4샘플 단계 30초 시간 초과는 별도의 성능 한계로 보존한다.

`d07f6cc`의 macOS Chromium 153도 기본 headless 설정에서는 SwiftShader를 사용했다. 팬의 첫 10개 픽셀 검사는 통과했지만 1280px의 4샘플 완료 30초 한도는 실패했다. macOS라는 이유로 Metal 결과라고 부르지 않는다. [Chromium의 현재 headless GPU 문서](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md)에 따라 macOS QA에 `--enable-gpu`를 적용해 일반 드라이버 선택을 허용한다. 실제 renderer 기록으로 결과를 구분하고, 사용 가능한 GPU가 있다고 가정하지 않는다. Linux SwiftShader의 deep 성능 비교 경로는 유지한다.

동일 후속 HTML `6fb08b74…`를 로컬 M4에서 고정하고 15개 스위트를 순차 실행해 249개 검사, 0 uncaught exception을 확인했다. 131개 단위 검사·ESLint도 통과했다. 이 실행의 Chromium은 149/ANGLE Metal M4 Pro이며, CI Chromium 153과 구분한다. WebKit 최대 16,384회·AA16은 context loss 후 실제 FP64 AA16으로 75.563초, Chromium의 같은 설정은 GPU에서 27.075초였다. 물리 Safari·모바일과 네이티브 hidden 상태는 여전히 이 검사로 인증되지 않는다.

하드웨어 QA는 [Playwright의 `chromium` channel](https://playwright.dev/python/docs/browsers#chromium-new-headless-mode)로 실제 Chromium의 새 headless 모드를 사용한다. 기본 headless shell과 실행 파일을 지정한 로컬 Chrome은 다른 구현이었다. Chromium 153 바이너리도 로컬에 설치해 이 경로를 확인한다. 브라우저 라이브러리 버전이 같다는 이유만으로 바이너리·드라이버까지 같다고 가정하지 않는다.

동일 HTML을 Chromium 153으로 다시 검증한 로컬 10개 스위트는 186개 검사와 0 uncaught exception으로 통과했다. 같은 HTML의 WebKit 5개 스위트 63개 검사와 합하면 249개다. 원격 실행 `37314566651`의 macOS 팬 재사용 12개·탐험 26개 검사는 실제 `ANGLE Metal Renderer: Apple Paravirtual device`로 통과했다. 그러나 production은 최대 설정 전 16개 검사 이후 출력이 멈췄으며, 이 실행을 전체 통과로 기록하지 않는다. Linux의 나머지 브라우저 작업은 통과했다. 자동화의 응답 없는 페이지 진단·타임아웃 취소가 무기한 기다릴 수 있어, 원래 렌더 시간 한도 뒤 5초의 실패 기록 유예를 두고 강제 실패 스택을 남긴다. 이미 완료한 검사도 미완료 상태로 저장하며 전체 본문이 끝나야 성공으로 바뀐다. 계산 품질·장면·개별 렌더 시간 한도는 그대로다.

후속 실행 `37317977341`도 같은 Metal Paravirtual 장치에서 16개 검사 후 16,384회·AA16 장면의 원래 240초 한도를 넘겼다. 렌더 대기의 타임아웃은 반환했지만 페이지 상태를 읽는 진단은 응답하지 않아, 5초 후 실패 스택과 미완료 JSON을 보존했다. 최초 실행은 취소, 후속 실행은 실제 실패로 구분한다. 이 최대 설정은 아직 원격에서 미검증이다. 수동 workflow의 `suite=production`은 GPU 호출 전후와 브라우저 로그를 남기는 진단용 실행이며 처리량 인증에 사용하지 않는다. 기본 `all`과 push/PR은 원래 15개 브라우저 스위트를 계측 없이 실행한다.

진단 실행 `37320489901`에서는 최대 설정의 마지막 draw·flush 뒤 약 10초까지 `clientWaitSync`가 계속 반환했고, 이후 출력이 끊겼다. 이는 코드의 10초 펜스 복구 시점과 일치하지만 파기 호출 자체를 아직 직접 관측한 것은 아니다. `suite=production-skip-loss`는 이 가설을 검사하기 위해 최대 설정에서만 native `loseContext()` 호출을 생략하는 반사실 진단이다. 원래 반복 수·AA16·240초 한도와 실제 CPU 계산은 유지하며, 성공하더라도 제품 복구나 처리량 인증으로 인정하지 않는다. 일반 production 진단은 파기 호출과 `deleteSync`·`isContextLost`의 전후 및 반환값도 기록한다. 기본 `all`에는 이 동작 변경과 계측을 적용하지 않는다.

반사실 실행 `37323631737`도 실패했다. native 파기 호출을 생략한 뒤 `GPU renderer unavailable: GPU completion timed out`까지 진행했지만, 여전히 원래 240초 한도를 넘기고 페이지 진단이 응답하지 않았다. 따라서 파기 호출 하나가 원격 정지의 유일한 원인이라는 가설은 기각한다. CPU fallback의 2D Canvas도 기본적으로 GPU 가속을 사용할 수 있으므로 후속 진단은 Canvas·Worker의 실제 호출 전후를 함께 기록한다. 펜스 조회 로그는 256회당 한 번으로 제한한다. 그 의존성이 실제 정지 원인인지는 아직 확인하지 않았다.

복구 순서 자체도 수정했다. 10초 한도에서 먼저 실패를 반환해 CPU 전환을 시작하고, 제출된 펜스가 실제 완료됐을 때만 native 컨텍스트를 파기한다. 진행 중인 작업은 새 draw 없이 하나의 컨텍스트와 낮은 빈도의 완료 조회로 보관한다. [Khronos의 파기·복원 명세](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/)와 [Chromium의 동기적인 ForceLostContext 정리 경로](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc)를 참고했다. 미완료 자원 파기를 금지하는 회귀 검사는 기존 코드에서 실패하고 수정 후 통과했다. native 복원 검사는 강제 pending 전달을 해제하고 실제 loss 이벤트가 완료된 뒤 복원하며, 실제 FP64 AA16·반복 수·기존 렌더 시간 한도를 유지한다. 이 빌드 `eca11320…`는 로컬 단위 검사 132개·ESLint·production 18개를 통과했다. 원격 최대 설정의 정지와 새 빌드의 전체 브라우저 검증은 아직 미완료다.

## 직접 실험하고 제외한 방법

| 실험 | 이 기기의 결과 | 판단 |
| --- | --- | --- |
| 최종 타일을 고정으로 크게 만들기 | Horizon의 약 2.4초가 4.5~5.1초로 악화 | 타일 폭 확대와 fence 배치 확대는 다른 문제 |
| 타일 전용 작은 framebuffer 후 blit | 약 3~6배 느려짐 | draw·copy·타깃 변경 비용을 추가 |
| 16샘플을 별도 4샘플 패스로 분할 | 유의한 속도 이득 없이 일부 chaotic 반올림 경로 변화 | 채택하지 않음 |
| 재사용 팬의 새 영역을 단일 16샘플로 계산 | 새 픽셀은 독립적인 16샘플 결과와 바이트 단위로 같지만, 일부 깊은 뷰의 계산 시간이 약 10~15% 증가 | 중앙 1샘플만 생략하는 4→16 경로 채택 |
| 계속 MessageChannel로 폴링 | 짧은 GPU 지연에는 유리하지만 CPU를 지속 사용 | 1 ms 이후 타이머로 양보하는 현재 경로 채택 |
| 라이브 픽셀 예산 4배 | 선명도와 프레임 유지의 동시 이득을 확인하지 못함 | 기존 예산 유지, 완성 이미지 보존으로 선명도 해결 |
| GLSL을 WGSL compute로 직접 변환 | 동일 픽셀·샘플에서 WebGL보다 느림 | API 교체만으로 가속된다는 가설 제외 |

WebGPU 실험은 Naga 변환과 8×8 workgroup으로 같은 계산을 실행한 임시 프로토타입이다. 960×552·16샘플의 커널은 Plume 382 vs WebGL 281 ms, Abyss 538 vs 359 ms, Horizon 626 vs 467 ms였다. 첫 compute pipeline 컴파일도 약 562 ms였다. 이는 이 프로토타입·M4·브라우저에 한정한 결과다. compiler별 chaotic 픽셀 차이가 있어 정식 수치 검증도 필요하다. **작업 큐를 사용하는 다른 WebGPU 알고리즘의 가능성까지 배제하지 않는다.**

## 추가 개선에서 효과가 클 것으로 보는 알고리즘

### 확대 배율별 월드 타일 캐시

이번 구현은 같은 해상도의 최근 완성 뷰 세 개를 재사용한다. 다음 확장은 현재 라이브 렌더의 1/8 옥타브 그리드를 재사용해 **월드 좌표·배율별 타일을 저장하는 이미지 피라미드**다. 팬·Back·같은 영역의 확대 왕복에서 화면 전체와 무관하게 이미 계산한 타일을 찾을 수 있다. 가까운 줌 레벨은 즉시 표시하고, 현재 배율의 실제 샘플을 계산해서 대체한다.

이는 [XaoS의 연속 확대와 재사용 설계](https://github.com/xaos-project/XaoS/wiki/Developer's-Guide)에서 참고한 방향이다. TETRA에서는 기준 궤도·팔레트·반복 상한·샘플 격자·실수축 반사를 캐시의 계산 의미에 포함해야 한다. 다른 참조점의 chaotic RGB를 검증 없이 같은 최종 샘플로 합치면 안 된다. 새로 방문한 미세 구조는 캐시만으로 만들어지지 않는다.

### 활성 궤도만 실행하는 WebGPU 작업 큐

가설은 BLA 뒤 남은 픽셀을 32 또는 64회씩 실행하고, 종료한 궤도를 빼서 활성 상태만 다음 큐에 넣는 것이다. 긴 cap 픽셀 때문에 GPU의 다른 lane이 놀고 있는 시간을 줄일 수 있다. 초기화·BLA·비선형 tail·AA 누적을 작은 compute kernel로 나누고 indirect dispatch로 GPU 안에서 이어갈 수 있다. 8.3 MP×16샘플의 전체 상태를 한꺼번에 저장하면 메모리가 폭증하므로, 타일 단위·샘플 단위의 제한된 큐가 필요하다.

[NVIDIA의 wavefront 연구](https://research.nvidia.com/publication/2013-07_megakernels-considered-harmful-wavefront-path-tracing-gpus)는 분기 편차와 큰 register 사용의 비용을 설명한다. 적용 가능성은 **TETRA에 대한 가설**이다. [Active Thread Compaction 연구](https://www.highperformancegraphics.org/previous/www_2011/media/Papers/HPG2011_Papers_Wald.pdf)는 상태 저장·occupancy·불규칙 메모리 접근 때문에 기대보다 이득이 작거나 오히려 느려질 수 있음을 보여 준다. 큐를 만들었다는 이유로 성능 향상을 보장할 수는 없다.

[Chrome 134의 subgroups](https://developer.chrome.com/blog/new-in-webgpu-134)는 prefix·ballot 등의 선택지를 넓힌다. [Chrome 151·152의 subgroup size control](https://developer.chrome.com/blog/new-in-webgpu-151-152)은 더 새로운 선택 기능이지만, 이 측정의 Chrome 149에서 사용 가능한 것으로 가정하지 않았다. 일반 workgroup 경로와 기능 탐지, 기존 WebGL fallback이 필요하다.

### 테트레이션에 맞는 고차 BLA

[Fractalshades의 BLA·series 설명](https://gbillotey.github.io/Fractalshades-doc/math.html), [mathr의 deep zoom 이론](https://mathr.co.uk/web/deep-zoom.html), [FractalShark 구현](https://github.com/mattsaccount364/FractalShark), [2차 BLA WebGPU 예제](https://github.com/Desarso/mandelbrot-webgpu)는 접근 방법을 참고할 수 있다. Mandelbrot의 `z²+c` 수식을 TETRA의 `exp(w Log c)`에 그대로 넣을 수는 없다.

아래는 TETRA의 식에서 직접 전개한 **미구현 후보**다. `l = dL`, `d = w−V`, `L0 = Log c0`, 다음 기준값을 `Vnext`라고 하면:

```text
eps = L0 d + V l + d l
dnext = Vnext expm1(eps)

dnext ≈ A d + B l + C d² + D d l + E l²
A = Vnext L0
B = Vnext V
C = Vnext L0² / 2
D = Vnext (1 + L0 V)
E = Vnext V² / 2
```

두 근사 F1, F2의 2차 합성은 다음과 같다. 모든 계수는 복소수다.

```text
A = A2 A1                        B = A2 B1 + B2
C = A2 C1 + C2 A1²
D = A2 D1 + 2 C2 A1 B1 + D2 A1
E = A2 E1 + C2 B1² + D2 B1 + E2
```

선형 근사가 끝나는 구간 일부를 더 긴 점프로 바꿀 수 있다는 가설이다. 하지만 단순 Taylor 계수만으로 안전한 BLA는 되지 않는다. `e1=L0 d+V l`, `t=d l`, `a=|e1+t|`일 때 한 단계의 생략항은 `|Vnext| [exp(a) a³/6 + |e1||t| + |t|²/2]`로 상계할 수 있다. 이를 합성 과정의 오차 전파·floatexp 범위·탈출 임계·고정점·주기 판정과 함께 다뤄 유효 반경을 계산해야 한다. 그 검증 없이 점프 길이만 늘리면 작은 구조를 놓칠 수 있다.

### 과학적 샘플링과 궤도 정보 보존

현재 AA 판정은 RGB 대비다. 새 경계가 샘플 사이에 있을 수 있으므로 RGB가 평탄하다는 사실만으로 균일한 궤도를 보장하지 않는다. [Deferred Adaptive Compute Shading](https://www.cemyuksel.com/research/papers/DACS_HPG2018.pdf)의 선택적 작업 분배는 참고할 수 있지만, 프랙탈에서는 분류 변화·반복 길이·민감도 정보를 같이 봐야 한다. 임의의 보간으로 final 픽셀 계산을 없애는 방식은 특히 얇은 구조에서 위험하다.

팔레트 변경 때 다시 궤도를 계산하는 것도 낭비다. 분류·반복 수·위상 등 필요한 궤도 특징을 저장하면 재색칠할 수 있다. 다만 AA의 비선형 색 평균까지 재현하려면 샘플별 특징 또는 충분한 통계가 필요하다. 8.3 MP×16샘플은 상당한 저장 비용을 만들므로 단순하게 모든 궤도 이력을 저장하는 구조는 적합하지 않다. 선택한 점의 실제 궤도·정밀도별 비교·unresolved 분류 확인을 제공하는 기능도 수학자의 조사에 유용하다.

## 라이브러리와 외부 구현의 활용 판단

| 기술 또는 구현 | 참고하거나 적용할 부분 | 이번 변경에서의 상태 |
| --- | --- | --- |
| [XaoS와 XaoSjs](https://github.com/xaos-project/XaoSjs) | 이동·연속 확대에서 이미 계산한 정보 재사용 | 설계 참고, 고해상도 팬 재사용 구현 |
| [Fraktaler 3](https://fraktaler.mathr.co.uk/) | BLA·progressive sampling·기기별 계산 설정 | 렌더 구조와 향후 하드웨어 정책 참고 |
| [Kalles Fraktaler](https://mathr.co.uk/kf/manual.html) | 깊은 확대·여러 기준 궤도·고정밀 확인 | 기준점 선택과 정확 확인의 참고 |
| [Fractalshades](https://gbillotey.github.io/Fractalshades-doc/_modules/fractalshades/perturbation.html) | BLA·고차 series·참조 구현 | 수식과 구현을 함께 참고 |
| [FractalShark](https://github.com/mattsaccount364/FractalShark) | CUDA perturbation·고급 근사 | GPU 자료 구조·근사 연구 참고 |
| [gcollombet Mandelbrot](https://github.com/gcollombet/mandelbrot) | Rust WASM·wgpu·깊은 확대·재색칠 | 렌더 구조·재색칠·연구용 조작 참고 |
| [Naga](https://github.com/gfx-rs/wgpu/tree/trunk/naga) | GLSL과 WGSL 변환 | 임시 WebGPU 성능 실험에 사용, 런타임 의존성 추가 없음 |
| [GMP WASM](https://github.com/Daninet/gmp-wasm) | GMP·MPFR의 고정밀 기준 계산 | 초고반복·정밀도 확장 후보. 현재 30 ms 기준 계산만 줄여 수 초의 전체 지연을 해결할 수 없음 |
| [AMD FSR 1](https://github.com/GPUOpen-Effects/FidelityFX-FSR) | 저비용 이동 화면 재구성 | preview 후보. 새로운 프랙탈 기하를 계산하는 기능을 대체하지 못함 |
| [WebGPU 표준](https://gpuweb.github.io/gpuweb/) | compute·storage·indirect dispatch | 작업 큐를 구현할 경우의 API 기반 |
| [병렬 셰이더 컴파일](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/) | 블로킹 링크 회피 | 기존 BLA warm-up과 readiness 검증에 사용 |
| [GPU 타이머 쿼리](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/) | GPU 시간과 JS 대기 분리 | 다음 커널 실험에 유용. disjoint 확인과 계측 자체의 간섭 필요 |

라이브러리 사용 제한 때문에 선택지를 제외하지 않았다. 실제 Naga·WebGPU 실험까지 했지만, 현재 측정에서 이득이 없는 API 이식은 제품에 넣지 않았다. 지금 가장 큰 개선은 이미 계산한 수학적 샘플을 보존하는 알고리즘에서 나왔다. 다음 큰 개선은 새로운 영역의 비선형 계산량을 줄이는 쪽에서 검증해야 한다.

Safari 앱, 실제 iPhone·Android와 저사양 GPU의 성능은 이 M4 실험으로 확정할 수 없다. 서로 다른 기준점·compiler의 chaotic 픽셀 차이도 남아 있다. 이 문서의 측정값은 위 SHA의 로컬 빌드 기록이며 공개 서버의 응답과 구분한다.
