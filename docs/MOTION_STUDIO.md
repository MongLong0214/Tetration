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
4. Open **Export video**. Choose Aspect, Resolution, FPS, Sampling, Format,
   Bitrate and Motion stability in that window, then **Create video**. Once ready,
   **Download MP4 / WebM** saves the file. These are silent videos, computed
   locally in your browser. A video estimated above 64 MiB renders into private
   temporary browser storage; once it is ready, **Save** asks where to keep it
   (Chromium browsers). Other browsers explain the limit before any rendering starts.

**Save project** saves editable settings on this device, not a video. **Projects**
loads saved shots, imports/exports project JSON and offers **New from Explore**.
Returning to Studio offers **Continue shot** for saved and unsaved work in this
same tab. Export JSON for a separate copy; restarting the browser does not
restore an unsaved session. Up to 10 projects and 50 Undo entries are supported.

The **1 · Start / 2 · End / 3 · Preview** buttons stay above the canvas. Start
and End open a draft; the confirmation sits beside its instruction. Visible
**+ / −** buttons zoom about the centre, and the zoom readout is relative to Start.
Ordinary **Use as End** preserves an
intentional still camera; **Animate A → B** explicitly enables travel. Switching
views asks Apply / Discard / Cancel for changed framing. Reverse and Undo update
an untouched draft. Duration uses whole frames; changing FPS preserves its time.
The Motion Details contain Speed, Easing and Endpoint rotation.

**Zoom speed.** With Linear easing a Tunnel path changes the zoom by a constant
ratio per frame, so a long path is fast even at 20 seconds: Overview to Horizon (about 100 decades) at
30 fps and 20 s changes by about 1.47× between frames. Under Duration the Motion
tab shows the total zoom, the peak ratio per frame (easing included: ease-in/out
peak at twice the average, ease-in-out at 1.5×), the peak in decades per second and
the length that keeps the peak at or below 1.15× per frame (about 55 s for that
path at 30 fps with Linear, about 82 s with the default ease-in-out). **Use recommended length** applies it, limited to 120 s.
**Hold at end** (0–10 s) keeps the End camera after the travel and counts toward
Duration; the travel uses the remaining frames.

While framing, active spatial effects are temporarily hidden; **View effects**
returns to Preview after resolving the draft. **Original** is preview comparison
only; **Show effects** restores the look without an Undo entry. FX Amount 0
bypasses effects. Invalid numbers block Save project, Play and video creation:
the relevant tab opens and focuses the error. Reset restores that field; a preset
only replaces Look/Rhythm fields. Explicit Discard permits leaving invalid input.

Framing uses at most 512 pixels on its long side. Completed pixels immediately
follow a drag or zoom while the GPU refines the new view. Moving playback uses
actual display density up to DPR 2 and 1024 pixels on its long side.
After 300 ms idle, Detailed preview computes actual display pixels at up to DPR 2,
1536 pixels on the long side and 1.5 million output pixels, limited by the selected
output and GPU source budget. Its label distinguishes completed pixels from a
pending target. Final video always uses the selected output size and 4/16 samples.
A failed refinement keeps the last complete image and offers an explicit retry.

With **Motion stability: Stable**, preview and exported video reproject the
preceding camera frame before the time effects, limit its colours to the current
local neighbourhood, and combine it with the new full-sample frame. This can
reduce sparkling in subpixel fractal detail but blends neighbouring frames, so
compare it with Raw on your shot. It applies only to Tunnel paths, and only while
adjacent frames differ by 0.8–1.25× in scale, which a long path at a short Duration
exceeds; the zoom-rate line shows the ratio. **Raw** (the default and the only
behaviour of earlier versions) renders each frame independently in both preview and
video, so the test render and the final output use the same filter. Seeking,
changing views and large camera jumps reset the history; a still camera and
Original retain their exact ordinary pixels. History uses two bounded GPU images
and never changes orbit rules or iteration limits. Final video always uses the
selected 4/16 sampling.

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
quantized to N frames; Speed is 10 seconds divided by duration. Number fields show
at most five decimals, and any shown value can be typed back: an entry inside the
shown range is clamped to the exact limit (Speed 0.08333 at 120 s is 1/12). Changing FPS
preserves duration and Hold at end. With H hold frames the camera uses
`k/(N−H−1)` for the first N−H frames, then stays exactly on B; effects use `k/fps`.
Hold at end changes the camera path, so projects with a hold are not frame-identical
to the same shot without one.

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
2–120 seconds. Bitrate targets 12 / 24 / 40 Mbps (Standard / High / Master) at 1080
and 6 / 12 / 20 Mbps at 720; Standard is the earlier default. A new bitrate goes
through the same real-encode capability probe as any other output. MP4/AVC is preferred; select the confirmed WebM/VP9 alternative if
MP4 is unavailable. Unsupported configurations never reduce quality silently.
When the probe confirms quantizer mode, H.264 export chooses the quantizer of each frame from the
size of the packets so far. This keeps the bitrate target without the encoder's variable-bitrate
mode, which kept refining a held end for about a second. A hold is encoded once, finer, and its
exact repeats keep that quantizer. Measurements are in [VALIDATION.md](VALIDATION.md).
WebGL2 is required for movie rendering; supported WebGPU accelerates orbit work.
Non-neutral FX need half-float render targets. Deep/high-cap work can be slow.
The source is limited to 8.3 million pixels, the GPU texture limit and 64 MiB;
some rolled 1080 shots therefore exceed the source limit and need an explicit edit.

One awaited CanvasSource add consumes each stable composed canvas at integer
microsecond timestamps. Hidden export completes current work, then suspends before
the next frame; when the tab is visible again it resumes automatically from the
next k (**Resume export** remains as a fallback). Hidden time is reported apart
from active time. Finalization can finish
while hidden. Cancel/device/encoder errors never publish a partial file; retry
starts at frame 0. File ready appears only after finalization and resource cleanup. Download does not
claim that a browser save dialog completed. Closing the result, exporting again
or leaving Studio releases its Blob URL and deletes any temporary file.

The position-aware output collector caps the in-memory file at 64 MiB. Before
rendering, the export compares an estimate (bitrate × duration plus 5 % and
64 KiB) with that cap. Above it, a browser with the origin private file system
(OPFS), Web Locks and `showSaveFilePicker` checks `navigator.storage.estimate()`
for room, then streams the encoder output into a private temporary file
(`tetra-export-<id>.mp4` or `.webm`). No file you choose is opened, truncated or
removed while the video renders: the save dialog opens only when you press
**Save** on a finished video, and the video is then copied into the chosen file
by stream. Only a completed write and close is reported as "Saved to …". Choosing
an existing file replaces it, as the browser's save dialog warns. A canceled
dialog or a failed write or close keeps the temporary video, says so and lets you
press **Save** again. The temporary file is deleted after a successful save, when
the export fails or is canceled, and when you close the result, export again or
leave Studio; a failed deletion is reported, never ignored. When Studio starts it
removes temporary files left by a closed or crashed tab; a Web Lock keeps it from
removing a file that another open tab still uses. Without these APIs the export
fails up front (`OUTPUT_TOO_LARGE_ESTIMATE`) and lists shorter duration, lower
bitrate or 720p; without enough browser storage it fails up front with
`STORAGE_QUOTA`. The cap
does not limit total browser RAM, driver allocations or encoder surfaces. The app retains
one source frame, fixed FX scratch, two tiny endpoint thumbnail images and one
video result; it does not keep a raw-video frame array. The media operations have
60-second deadlines; deliberate hidden suspension has none.

Run `npm run test:studio` with pinned browser QA dependencies and host ffmpeg/
ffprobe. These decoders are test tools, never runtime dependencies. Current native
Chromium results and unverified physical-device limits are in [VALIDATION.md](VALIDATION.md).
Pinned media source, bundle hash and video-art borrow map are in
[NOTICE.md](../src/vendor/NOTICE.md). Normal builds require no installation/network.
