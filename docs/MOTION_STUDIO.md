# Make a video with Motion Studio

1. Open **Studio** from the Explore toolbar, including on mobile. Your current
   camera and palette become a new shot. Drag, zoom or use the arrow / + / − keys,
   then **Use as Start**. You can also use the starting view unchanged.
2. Continue zooming or dragging in the End view, then **Use as End & animate**.
   This applies End and enables movement together. **Keep camera still** instead
   uses Start and preserves the stored End. Preview never plays automatically.
3. Choose **Look** for a preset, palette, color, Glow, Prism or Kaleidoscope;
   choose **Rhythm** for Pulse or Glow Wave. Each effect has its own visible switch.
   Off preserves its settings. Press **Play** to see motion and time effects;
   **Pause** stays accessible when mobile Settings are open.
4. Open **Export video**. Choose Aspect, Resolution, FPS, Sampling and Format in
   that window, then **Create video**. Once ready, **Download MP4 / WebM** saves
   the file. These are silent videos, computed locally in your browser.

**Save project** saves editable settings on this device, not a video. **Projects**
loads saved shots, imports/exports project JSON and offers **New from Explore**.
Returning to Studio offers **Continue shot** for saved and unsaved work in this
same tab. Export JSON for a separate copy; restarting the browser does not
restore an unsaved session. Up to 10 projects and 50 Undo entries are supported.

**Edit Start / Edit End** opens a draft. Ordinary **Use as End** preserves an
intentional still camera; **Animate A → B** explicitly enables travel. Switching
views asks Apply / Discard / Cancel for changed framing. Reverse and Undo update
an untouched draft. Duration uses whole frames; changing FPS preserves its time.
The Motion Details contain Speed, Easing and Endpoint rotation.

While framing, active spatial effects are temporarily hidden; **View effects**
returns to Preview after resolving the draft. **Original** is preview comparison
only; **Show effects** restores the look without an Undo entry. FX Amount 0
bypasses effects. Invalid numbers block Save project, Play and video creation:
the relevant tab opens and focuses the error. Reset restores that field; a preset
only replaces Look/Rhythm fields. Explicit Discard permits leaving invalid input.

Quick preview uses at most 512 pixels on its long side while playing or framing.
After 300 ms idle, Detailed preview computes actual display pixels at up to DPR 2,
1536 pixels on the long side and 1.5 million output pixels, limited by the selected
output and GPU source budget. Its label distinguishes completed pixels from a
pending target. Final video always uses the selected output size and 4/16 samples.
A failed refinement keeps the last complete image and offers an explicit retry.

Output requires WebGL2 and a supported WebCodecs encoder. Non-neutral effects
need half-float GPU targets. MP4 is preferred; a confirmed WebM alternative must
be selected explicitly. Codec support is checked before final fractal rendering.
An unsupported output preserves the project. Retry begins at frame 0. A hidden
export finishes current work and waits for visible **Resume export**; closing a
modal never starts playback. **How to make a video** explains this flow in the app.

[Desktop controls](review/studio-ux/desktop.png) · [Mobile Look settings](review/studio-ux/mobile.png)

## Technical details

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
starts at frame 0. File ready appears only after finalization and resource cleanup. Download does not
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
