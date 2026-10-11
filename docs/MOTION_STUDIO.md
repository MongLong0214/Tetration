# Motion Studio

Open Studio from an Explore view. Start A and End B store exact decimal camera
coordinates, horizontal span and roll. Selecting an endpoint opens a draft:
drag/arrow keys pan, scroll/pinch/double-click zoom, and Roll changes its angle.
Set / Update applies one Undo entry. Switching endpoints, playing, exporting or
loading asks Apply / Discard / Cancel when the draft changed. Framing temporarily
hides Prism/Kaleidoscope; Preview and video use their saved values.

Hold uses A and retains B. Tunnel In/Out derives from the actual span ratio;
Drift uses equal spans. Reversing the path exchanges both complete endpoints.
Motion follows the zoom-aware path in `studio-camera.js`, with exact endpoints
and frame-index easing. Roll follows the direct angle difference. Duration is
quantized to N frames; Speed is 10 seconds divided by duration. Changing FPS
preserves duration. Frame k uses `k/(N−1)` for camera and `k/fps` for effects.

Look offers Neutral, Neon Pulse, Deep Ambient and Prism Wave, with editable hue,
saturation, exposure, Bloom, Prism, Kaleidoscope and FX Amount. Rhythm controls
Pulse and Glow Wave. Details groups reveal the remaining values; switching an
effect off preserves them. Presets rebuild a complete Neutral look before their
overrides. Reset Look retains the palette. Original and Amount 0 bypass FX while
keeping the current framing, roll and palette.

Save explicitly writes up to 10 projects under `tetra.motion.projects.v1`.
Explorer's 24 bookmarks and URL format remain separate. Project JSON uses strict
schema v1 and decimal strings up to 256 places; invalid imports preserve the
current shot. Undo/Redo holds 50 snapshots, with one slider drag per entry.
Storage errors preserve edits; export JSON to keep a separate copy.

Preview uses a smaller image and four complete samples while playing, and refines
the paused selected frame to the chosen 4/16 samples. Playback keeps one active
frame plus one latest desired frame and shows completed useful work, even when
rendering is slower than the clock. Seeking invalidates older work. Look edits
reuse compatible orbit pixels. Hidden/leave/export stop the clock; returning does
not autoplay. Paused playback can refine the selected frame.

Export freezes the project and drains preview before taking GPU ownership. It
computes every source pixel at the selected 4/16 samples and a fixed shot-wide
iteration cap, then composes roll/crop, Kaleidoscope, Prism, encoded hue/saturation,
linear exposure/Pulse/Wave, Bloom and the linear Amount mix. Neutral/Original/zero
Amount preserve framed RGB8 pixels exactly. Sampling extends images by reflection;
spatial FX do not request extra fractal area. Only roll determines overscan.

Outputs are silent SDR, 720/1080 short-side pixels, 16:9/9:16/1:1, 24/30 fps and
2–20 seconds. MP4/AVC is preferred; select the confirmed WebM/VP9 alternative if
MP4 is unavailable. Unsupported configurations never reduce quality silently.
WebGL2 is required for movie rendering; supported WebGPU accelerates orbit work.
Non-neutral FX need half-float render targets. Deep/high-cap work can be slow.
The source is limited to 8.3 million pixels, the GPU texture limit and 64 MiB;
some rolled 1080 shots therefore exceed the source limit and need an explicit edit.

One awaited CanvasSource add consumes each stable composed canvas at integer
microsecond timestamps. Hidden export completes current work, then suspends before
the next frame; visible Resume continues from the next k. Finalization can finish
while hidden. Cancel/device/encoder errors never publish a partial file; retry
starts at frame 0. File ready appears only after finalization. Download does not
claim that a browser save dialog completed. Closing the result, exporting again
or leaving Studio releases its Blob URL.

The position-aware output collector caps the logical file at 64 MiB. This does
not cap total browser RAM, driver allocations or encoder surfaces. The app retains
one source frame, fixed FX scratch, two tiny endpoint thumbnail images and one
video result; it does not keep a raw-video frame array. The media operations have
60-second deadlines; deliberate hidden suspension has none.

Run `npm run test:studio` with pinned browser QA dependencies and host ffmpeg/
ffprobe. These decoders are test tools, never runtime dependencies. Current native
Chromium results and unverified physical-device limits are in [VALIDATION.md](VALIDATION.md).
Pinned media source, bundle hash and video-art borrow map are in
[NOTICE.md](../src/vendor/NOTICE.md). Normal builds require no installation/network.
