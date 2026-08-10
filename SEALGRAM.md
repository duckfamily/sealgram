# Sealgram — handoff document

Read this whole file before touching anything. It exists because several things
in this tree look like obvious mistakes or obvious cleanups, and acting on that
impression destroys user data, silently removes the security features the fork
exists for, or wastes an hour of build time. Each of those is written down below
with the reason.

Written 2026-07-30. If something here contradicts what you observe in the tree,
trust the tree and fix this file.

---

## 1. What this is

Sealgram is a fork of Telegram Desktop 7.0.6 for Windows, built for two reasons:

1. **A stealer that copies the `tdata` folder must not be able to use the
   account elsewhere.** Upstream derives the local encryption key from a salt
   stored in plaintext next to the data, with one PBKDF2 iteration when no local
   passcode is set. Copying the folder is enough to read everything. This fork
   mixes in a seed produced inside the machine's TPM by a key that cannot be
   exported.
2. **It has to connect from Russia, where Telegram is blocked.** The client
   fetches a signed list of MTProto proxies over ordinary HTTPS from a service
   that is reachable when Telegram is not, and switches to a proxy on its own if
   nothing connects.

**Be precise about what the sealing does and does not do.** It stops the data
being moved to another machine. It does **not** stop a process running as the
same user on this machine: the TPM key has no PIN and no user-presence
requirement, so anything running as the user can ask for the same seed. Do not
write marketing copy, commit messages, or UI text claiming otherwise.

### Locations

| what | where |
|---|---|
| Source tree | `G:\src\tdesktop` |
| Build directory | `G:\src\tdesktop\out` |
| Built binary | `G:\src\tdesktop\out\Release\Sealgram.exe` |
| Installed copy | `%APPDATA%\Sealgram\Sealgram.exe` |
| Installer output | `G:\src\tdesktop\out\Release\sealgram-setup-7.0.6-r2.exe` |
| MSVC toolchain | `G:\BuildTools` (VS Build Tools 17.14, MSVC 14.44.35207) |
| CMake | `G:\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe` |
| Inno Setup | `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` |

Upstream base commit: `12e8d4a`. Generator: `Visual Studio 17 2022`.
`CMAKE_GENERATOR_INSTANCE=G:/BuildTools`.

---

## 2. Build

`cmake` is not on `PATH`. Prepend it:

```powershell
$env:PATH = "G:\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;" + $env:PATH
cd G:\src\tdesktop\out
cmake --build . --config Release -- /m:1 /p:CL_MPCount=3
```

### The two build flags are not optional

`/m:1 /p:CL_MPCount=3`. Without them a full rebuild fails with:

```
error C1076: compiler limit: internal heap limit reached
error C3859: failed to create virtual memory for PCH
```

This is **memory exhaustion, not a code error.** MSBuild's own parallelism
multiplied by per-project `/MP` runs many `cl.exe` at once, each taking 3-4 GB on
tdesktop's precompiled header. `CL_MPCount=6` survives incremental builds of a
few files but fails a full rebuild on this 32 GB machine. The real error is
buried under `MSB8084` noise, so it reads like a broken source change. It is not.

If you see C1076, do not start editing code. Lower the count and rebuild.

**A killed build is cheap to resume.** MSBuild keeps finished `.obj` files, so
stopping and restarting only redoes what changed plus what failed.

### How long

A full rebuild — anything touching `version.h`, `config.h`, or another widely
included header — takes over an hour. Touching one `.cpp` takes a few minutes
plus about two minutes to relink the 214 MB binary.

**Never edit source while a build is running.** That produces object files
compiled against different versions of a header and the failure appears as a
mysterious `LNK2019 unresolved external`, which sends you looking for a missing
definition that is actually present.

### Replacing an image does not rebuild the resource it lives in

Qt's AUTORCC tracks changes to the `.qrc` files, **not to the files they list**.
Overwrite `Resources/art/logo_256_no_margin.png` and nothing in the build system
notices: the compiled resource keeps the old picture, and only a `.qrc` edit or a
different build configuration will refresh it.

This bit once already, and the symptom was confusing rather than obviously
broken: the taskbar and desktop icons were the new Sealgram logo while the logo
*inside* the app was still Telegram's blue plane. The icons come from
`icon256.ico` through the Windows resource script, which `rc.exe` tracks
correctly; the in-app logo comes from `:/gui/art/logo_256_no_margin.png` inside a
Qt resource, which was a day stale. Codex had built Debug after changing the
icons, so the Debug resource was current and the Release one was not.

To force it, delete the bookkeeping rather than the generated files - deleting
the generated `.cpp` alone leaves autogen convinced there is nothing to do, and
the build then fails on missing includes:

```powershell
$dir = "G:\src\tdesktop\out\Telegram\CMakeFiles\Telegram_autogen.dir"
Get-ChildItem $dir -Filter "*_Used_Release.txt" | Remove-Item
Remove-Item "$dir\ParseCache_Release.txt"
```

Then rebuild. Verify the result rather than assuming it: search the binary for
bytes from the new file.

```powershell
$png = [System.IO.File]::ReadAllBytes('...\logo_256_no_margin.png')
$needle = $png[40..71]   # past the header, into the image data
```

That check returned False before the fix and True after, which is what made it
certain rather than probable.

### Configure, if you ever have to redo it

Do not reconfigure unless something is genuinely broken; the cache is correct.
`api_id` and `api_hash` are already in `out\CMakeCache.txt` as
`TDESKTOP_API_ID` and `TDESKTOP_API_HASH`. Do not copy them into any file that
could be published, and do not print them in output that gets shared.

`NoDefaultCurrentDirectoryInExePath=1` is set in this environment. That means
**every** command upstream's docs tell you to run "from the current folder" must
be invoked by full path. `configure.bat` will report "not recognized" otherwise.

---

## 3. Do not change these

### 3.1 The TPM key name

`storage/details/storage_tpm_seal.cpp`:

```cpp
constexpr auto kKeyName = L"TelegramDesktop.LocalKeySeal";
```

It still says TelegramDesktop after the rename to Sealgram. **Leave it.**
Changing the name makes every already-sealed `tdata` unreadable forever, because
the seed comes from that specific key. There is no migration path — the old key
is not exportable and its seed cannot be recovered from anywhere else.

For the same reason the key is created **without** `NCRYPT_OVERWRITE_KEY_FLAG`.
Do not add it. Overwriting orphans all sealed data.

### 3.2 Autoupdate stays off

`DESKTOP_APP_DISABLE_AUTOUPDATE:BOOL=ON`.

The update feed serves **official Telegram Desktop** packages. If autoupdate
were on, the client would download one and overwrite this binary with a build
that has no TPM sealing, no ACG, no CIG and no proxy feed. Re-enabling it would
quietly delete the entire point of the fork.

Consequence: `Updater.exe` and `StartupTask.exe` are **not built**. The
hardcoded `"Telegram.exe"` strings in `_other/updater_win.cpp` and
`_other/startup_task_win.cpp` are dead code in this configuration. Renaming them
is harmless but pointless; do not treat them as a bug.

`DESKTOP_APP_DISABLE_CRASH_REPORTS:BOOL=ON` is also set.

### 3.3 Code Integrity Guard needs no certificate

There was an earlier assumption that signed-only image loading required an
Authenticode certificate. **It does not.** CIG governs images loaded *after* the
policy is applied; our own executable is already mapped by then, so its
signature is never checked.

Verified empirically: all 130 modules the running process loads are
Microsoft-signed, and the only bundled DLL (`modules/x64/d3d/d3dcompiler_47.dll`)
ships signed by Microsoft. Third-party libraries are linked statically.

Do not add signing work as a prerequisite for CIG. The binary is unsigned and
CIG is on.

---

## 4. What each change does

### 4.1 TPM sealing

`storage/details/storage_tpm_seal.{h,cpp}` (new)

- `TpmSeed(context)` opens a persisted non-exportable RSA-2048 key in
  `MS_PLATFORM_KEY_STORAGE_PROVIDER`, signs `SHA-256(context)` with
  deterministic PKCS#1 v1.5 padding, and returns `SHA-256(signature)`.
- PKCS#1 v1.5 is chosen precisely because it has no randomised padding: the same
  input always gives the same signature, which is what allows the result to be
  key material rather than a yes/no answer software could step past. **Do not
  switch it to PSS.** PSS is randomised and would produce a different key every
  launch.
- The signature itself is never returned, only a digest of it.
- Returns an empty result when there is no usable TPM, and the client must still
  start in that case.
- `TDESKTOP_TPM_SEAL=0` skips the chip. This cannot be used to downgrade
  existing sealed data — verified, see section 6.

`storage/details/storage_file_utilities.cpp` — `CreateLocalKey` mixes the seed
into the SHA-512 that feeds PBKDF2. The salt is used as the context, so each
account gets a distinct seed.

### 4.2 The data-loss fallback — understand this before touching storage

`storage/storage_domain.cpp`, `Domain::startModern`.

A machine can gain a usable TPM **after** data has already been written: the
chip enabled in firmware, or Windows getting round to provisioning the platform
key. The seeded key would then fail to open a key file written without a seed,
the user would be shown a passcode prompt they never set, and their local history
would be gone.

So: seeded decrypt is tried first; on failure the unsealed derivation is tried;
if that works, the key file is **re-sealed** with the chip. The re-seal happens
at the very end of `startModern`, after the accounts have actually been read —
doing it earlier and then failing would leave a key file describing accounts that
were never loaded.

`LocalKeySeal::{Sealed,Unsealed}` in `storage_file_utilities.h` selects the mode.

The reverse direction — sealed data, TPM then cleared — still refuses to open.
That is the intended security property, not a bug.

### 4.3 Process hardening

`core/process_hardening.{h,cpp}` (new). Applied as the **first statement** in
`main.cpp`, before the launcher is created, and logged from `launcher.cpp` right
after `Logs::start()`.

Applied: `ProcessExtensionPointDisablePolicy`, `ProcessImageLoadPolicy`
(NoRemote | NoLowLabel | PreferSystem32), `HeapEnableTerminationOnCorruption`,
`ProcessDynamicCodePolicy` (ACG), `ProcessSignaturePolicy` (CIG).

Escape hatches: `TDESKTOP_ACG=0`, `TDESKTOP_CIG=0`.

Deliberately **not** applied, with reasons already in the source comments — read
them before adding any of these:

- `ProcessChildProcessPolicy` — the updater and "open link in browser" both need
  to start processes.
- `ProcessStrictHandleCheckPolicy` — turns any sloppy handle use anywhere in Qt,
  ANGLE or a display driver into an instant crash.
- A restrictive DACL on our own process — would also lock out the crash reporter.

### 4.4 Auth key memory

`mtproto/mtproto_auth_key.{h,cpp}` — constructors `VirtualLock` the key pages, a
new destructor wipes them with `OPENSSL_cleanse` then unlocks. `OPENSSL_cleanse`
rather than a plain loop because the compiler may elide a write that is never
read again.

### 4.5 Proxy feed

`mtproto/proxy_feed.{h,cpp}` (new) plus five methods in `core/application.cpp`:
`refreshProxyFeed`, `pruneExpiredFeedProxies`, `removeFeedProxies`,
`applyProxyFeed`, `considerProxyFallback`.

- Endpoint `https://tg-proxy-feed.vercel.app/api/proxies`. Verified reachable,
  HTTP 200, about 6 KB.
- Payload is `{payload, signature}`; `payload` is signed Ed25519 and verified
  against `kFeedPublicKey[32]` compiled into `proxy_feed.cpp`. A response failing
  verification is discarded and logged loudly. 128 KiB response cap, 15 s
  timeout. Rejects `version != 2`.
- Ed25519 is one-shot: it signs the message, not a digest of it, so
  `EVP_DigestVerify` is used, **not** `Update` plus `Final`. Do not "fix" this
  into the streaming form.
- State lives in `tdata/proxy_feed` as `{keys, expires}`. Expiry pruning runs
  **before** the network call, so an expired list cannot outlive a feed that has
  gone away.
- `removeFeedProxies` never removes the currently selected proxy. Expiry must not
  cut a live connection; rotation drops it when it stops answering.
- Proxies the user typed in by hand are never touched — only keys the feed itself
  supplied, tracked separately in that state file.
- `considerProxyFallback` runs 25 s after a feed apply. It returns early if any
  production account reports `MTP::ConnectedState`. It keys on
  `Account::mtpExists()`, **not** `sessionExists()` — the person this is for is
  most likely sitting on the login screen unable to authorise because nothing
  gets through, and requiring a session would skip them entirely. That was a real
  bug that got fixed; do not reintroduce it.

The signing service is a separate Vercel project, not in this tree. Only the
public key is compiled in.

### 4.6 Rename

Every identifier that Windows or Telegram uses to tell applications apart is now
ours, so that an official Telegram Desktop can be installed alongside without the
two fighting over a shared one.

| thing | file | value |
|---|---|---|
| `AppName`, `AppFile` | `core/version.h` | `Sealgram` |
| `AppId` | `core/version.h` | `{5EB37BD1-9A9B-4FEF-A7D3-5FBD65607ADC}` |
| `AppNameOld` | `core/version.h` | `Sealgram Legacy` |
| single-instance GUID | `config.h`, `cGUIDStr()` | `{D5B6D148-1759-4478-9C10-0FEC81025C4A}` |
| portable folder | `core/launcher.cpp`, `PortableFolder()` | `SealgramForcePortable` |
| Qt application name | `core/launcher.cpp` | `Sealgram` |
| AppUserModelId | `platform/win/windows_app_user_model_id.cpp` | `Sealgram.Sealgram` |
| URL scheme key | `core/application.cpp`, `shortAppName` | `sealgram` |
| exe name | `Telegram/CMakeLists.txt`, `output_name` | `Sealgram` |
| file properties | `Resources/winrc/Telegram.rc` | `Sealgram` |
| window title fallback | `window/main_window.cpp` | `AppName.utf16()` |

`AppNameOld` points at a folder that has never existed **on purpose**. Upstream
uses that field to migrate data from a much older build of itself; leaving
`Telegram Win (Unofficial)` there would mean rummaging in another application's
directory.

Not renamed, and this is fine: in-app text from the language pack still says
"Telegram Desktop".

### 4.7 Installer

`Telegram/build/sealgram_setup.iss` — written as a separate file rather than an
edit to upstream's `setup.iss`, so pulling a newer Telegram Desktop does not
conflict. Build it with:

```powershell
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" `
  /DReleasePath=G:\src\tdesktop\out\Release `
  "G:\src\tdesktop\Telegram\build\sealgram_setup.iss"
```

- Per-user install to `%APPDATA%\Sealgram`, `PrivilegesRequired=lowest`, no
  administrator prompt.
- No `SignTool` line — there is no certificate. SmartScreen will warn on first
  run. Do not add a `SignTool` directive; it will fail the compile.
- No `Updater.exe` in `[Files]` — it is not built, see 3.2. Adding it breaks the
  compile.
- Ships `LICENSE.txt` and `Sealgram (compatibility mode).cmd`.
- Revision `r2` removes residual `tdata`, caches and logs only when no registered
  Sealgram installation exists. Reinstalling/upgrading preserves the profile.
- `lzma2/max` + `SolidCompression`: the 224,560,640-byte Release executable
  becomes a 55,063,449-byte installer.

**Inno remembers previous choices.** Installing once with `/NOICONS` makes the
next `/SILENT` install skip shortcuts too, because `UsePreviousGroup` defaults on.
If you are testing shortcut creation, uninstall first or pass `/GROUP=Sealgram`.
This caused a false "shortcuts are broken" conclusion once already.

### 4.8 Signed update notifications

The upstream updater remains disabled. Sealgram has a separate notifier in
`core/update_feed.{h,cpp}` which never downloads or installs code by itself.
After the first window exists it requests:

`https://sealgram-updates.vercel.app/api/update`

The response is an envelope containing the exact JSON payload and an Ed25519
signature. The client verifies the signature against the 32-byte public key
compiled into `update_feed.cpp`, rejects malformed fields and non-HTTPS URLs,
and ignores any response larger than 32 KiB or slower than 15 seconds. The
private key exists only in the Vercel sensitive environment variable
`UPDATE_SIGNING_PRIVATE_KEY`.

The service source is in `G:\src\sealgram-updates`; its Vercel project is
`duckfamilys-projects/sealgram-updates`. `release.json` is the only release
metadata to edit. Keep `available: false` with empty URLs, hash and notes when
there is no update. For a real release set a monotonically larger numeric
version, both HTTPS download URLs, the installer's lowercase SHA-256 and short
notes, run `npm test`, deploy the exact reviewed directory, then verify the live
signature before announcing it.

When a newer available version is accepted, the client shows a localized
Download/Later box. Download opens the signed installer URL in the browser;
Later and Download both suppress the same version for 24 hours. State is stored
in `tdata/update_feed`. The SHA-256 is signed metadata but is not checked by the
client because the client does not download the installer itself.

### 4.9 Sealgram settings

The first row below the account cover opens `Settings::SealgramId`. The page
uses Telegram Desktop's normal section stack and theme styles, shows the
current logo and `AppVersionStr`, and links to three functional subsections:

- **Security** reads `Core::ProcessHardeningStatus()` and the TPM capability.
  It is informational only; there are no controls that weaken hardening or
  reset the TPM key.
- **Network** stores `sealgram_proxy_feed_enabled` in the existing local KV
  store. The default is on. Turning it off cancels automatic application of an
  in-flight feed result without deleting user or previously fetched proxies.
  The second row opens Telegram's existing proxy and rotation dialog.
- **Updates** stores `sealgram_update_checks_enabled`, also defaulting on.
  Automatic and manual requests share `checkSealgramUpdate()`. Automatic
  checks honour both the setting and the 24-hour postponement; a manual check
  bypasses both and reports current, newer or failed status.

New strings live in `lang.strings` with English fallback. Russian overrides are
applied by `Lang::Instance` both at startup and after a cloud language pack is
loaded, so Telegram's downloaded Russian pack cannot erase Sealgram strings.

---

## 5. Branding

The application icon is now a custom Sealgram mark: a smooth round violet disc
with a white folded-message glyph and no speech-bubble tail. The editable
source is `Telegram/Resources/art/sealgram_logo.svg`. The complete PNG size set,
`logo_256*.png`, `icon_round512@2x.png`, and the five-size `icon256.ico` are
generated from that one source. The banner is still the remaining branding
task.

Assets are extracted to `G:\src\tdesktop\out\Release\branding\` and archived as
`sealgram-branding.zip`. Its `README.md` has the full table; the essentials:

### The banner images are masks, not pictures

`colorizeImage` in `lib_ui/ui/style/style_core.cpp` takes only the **first byte**
of each pixel as coverage and fills it with a palette colour. In the source PNGs:

- **black = transparent, white = solid, greys = partial**
- whatever colour is painted in the file is discarded

So a multi-coloured banner cannot be made by editing these PNGs. The current one
looks colourful because it is **five separate masks stacked**, each with its own
palette colour.

### Exact format, checked against the PNG headers of the originals

- 8-bit **RGBA** PNG, colour type 6. Not greyscale, not indexed.
- **R = G = B** in every pixel; the shape lives in luminance.
- **Alpha = 255 everywhere.** These are not alpha masks. A transparent
  background is wrong.
- Background `#000000`, shape `#FFFFFF`, intermediate greys only on
  anti-aliased edges.

Qt loads these as ARGB32, whose first byte in memory on x86 is blue; with a grey
image blue equals luminance, which is why the channel choice does not matter as
long as R = G = B.

### Files, all three scales required or the build fails

| mask | 1x | 2x | 3x | colour |
|---|---|---|---|---|
| `intro_left` | 240x160 | 480x320 | 720x480 | `introCoverIconsFg` |
| `intro_right` | 280x160 | 560x320 | 840x480 | `introCoverIconsFg` |
| `intro_plane_trace` | 202x143 | 404x286 | 606x429 | `introCoverPlaneTrace` |
| `intro_plane_inner` | 202x143 | 404x286 | 606x429 | `introCoverPlaneInner` |
| `intro_plane_outer` | 202x143 | 404x286 | 606x429 | `introCoverPlaneOuter` |
| `intro_plane_top` | 202x143 | 404x286 | 606x429 | `introCoverPlaneTop` |

They live in `Telegram/Resources/icons/`. Layout is
`Telegram/SourceFiles/intro/intro.style`: band height `208px`, max width `880px`.

The four plane masks are facets of **one** shape at **one** position — `inner` is
the dark fold, `outer` the mid tone, `top` the lit face, `trace` the motion
lines. If they are not pixel-registered to each other the plane shows seams.

### Colours

`Telegram/lib_ui/ui/colors.palette`. Current values:

```
introCoverTopBg:      #0f89d0
introCoverBottomBg:   #39b0f0
introCoverIconsFg:    #5ec6ff
introCoverPlaneTrace: #5ec6ff69
introCoverPlaneInner: #c6d8e8
introCoverPlaneOuter: #a1bed4
introCoverPlaneTop:   #ffffff
```

Changing these seven values is the cheapest rebrand: shape stays, whole screen
changes colour.

### Logo

`Telegram/Resources/art/`. Unlike the banner these **are** real colour images
with alpha. `icon16/32/48/64/128/256/512.png` plus `@2x` of each, `logo_256.png`,
`logo_256_no_margin.png`, and `icon256.ico` — the last is what Windows shows for
the exe and what `SetupIconFile` puts on the installer. Regenerate the `.ico`
from the PNGs; do not rename a single PNG to `.ico`.

### Recommended approach

**Author SVG by hand and rasterise it. Do not use image generation for the
masks.** The four plane facets must be pixel-registered across three scales in
exact dimensions in pure black and white — an image generator cannot guarantee
identical position and scale across four separate generations, and a two-pixel
drift makes the facets fail to meet. In SVG the geometry is defined once and the
facets are three paths of one shape, so registration is exact by construction.

### After replacing anything

`codegen_style` packs the three scales into a sprite sheet at build time, so a
rebuild is required. Copying files into the installed folder does nothing.

**Verify by looking at the result, not by checking the script exited 0.** The
first preview render made during this work was wrong — it read alpha, which these
files do not carry, and produced a flat rectangle instead of clouds. Nothing in
the exit code revealed that. Composite the masks with their palette colours onto
a 880x208 gradient and look at the image.

---

## 6. Sealgram privacy, appearance and first-run proxy (2026-07-31)

### Privacy controls

`Settings -> Sealgram -> Privacy` contains independent ghost protections for
message/media receipts, story views, online state, typing/upload progress and
automatic offline. The master row is derived from the five flags (`N/5`), so a
partial selection remains active without claiming that full ghost mode is on.
Read-on-action and scheduled delay are mutually exclusive. Silent sending is
merged with Telegram's explicit silent flag and cannot turn an explicitly
silent message back into a noisy one.

Ghost mode reduces client-originated visibility traffic; it is not an
anonymity boundary. Telegram can still infer activity from ordinary RPCs,
delivery timing, IP addresses and server-side behaviour outside these request
sites. Delayed sending applies only to new sends while full 5/5 mode is active;
it does not rewrite schedules chosen by the user.

Sponsored messages, sponsored search results and promoted suggestions are
suppressed when ad blocking is enabled. Local Premium changes client-side
premium values reactively, but cannot bypass server-side limits.

### Encrypted archive

Deleted messages and the previous version of edited messages are captured
before the server update mutates the in-memory item. Each account uses its
existing local storage key, which is the same key protected by Sealgram's TPM
sealing. No AyuGram `ayudata.db` or other plaintext database is used.

The format is versioned (`SGAR`, version 1), with an encrypted manifest and
encrypted numbered segments. A segment is capped at 512 records or 4 MiB.
Retention is 50,000 records and 90 days per account. The manifest is committed
after its segments. If an existing manifest or segment cannot be decrypted or
parsed, Sealgram refuses to overwrite it. Clearing the archive writes an empty,
valid encrypted manifest for every currently loaded account.

Current archive payload stores text, author/date, peer/message/reply/topic IDs
and a cached-media marker. Media files are not copied. The settings button can
clear all loaded-account archives. A dedicated per-chat archive browser,
pagination, search, edit-history message menu and keeping deleted items visible
in the live feed are **not implemented yet**; do not advertise those UI pieces
as finished.

### Custom wallpaper

`Settings -> Sealgram -> Appearance` accepts PNG/JPEG/WebP/BMP, GIF, MP4, M4V,
MOV and WebM. One cover-scaled frame is painted in top-level-window coordinates
behind both the chat background and normal chat-list rows, so the two columns
form one continuous surface. Hovered and selected rows keep Telegram's opaque
state colours. The selected path is stored in `tdata/sealgram_wallpaper`; the
media itself is not duplicated. If the file moves or disappears the custom
wallpaper is disabled safely.

#### Animated wallpapers use FrameGenerator, not the clip reader — do not change this back

Animated files are decoded with `FFmpeg::FrameGenerator`, the decoder Telegram
uses for animated stickers. They were originally decoded with
`Media::Clip::Reader`, and that never worked: loading any ordinary 1080p GIF or
video showed nothing at all.

Two separate causes, both worth knowing before touching this code:

1. **`Media::Clip::Reader` caps decoding at 1280x720.**
   `media_clip_ffmpeg.cpp` sets `kMaxInlineArea = 1280 * 720` into `max_pixels`
   immediately before `avcodec_open2`, which then refuses anything larger with
   `EINVAL`. Confirmed from the client's own log:
   `Gif Error: Unable to avcodec_open2 ... error -22, Invalid argument` for a
   1920x1080 GIF. That limit is correct for what the clip reader is for —
   inline previews inside a chat — and wrong for a full-screen wallpaper.
   `FrameGenerator` allows `1920 * 1080 * 4`.
2. **The clip reader's failures are silent.**
   `Manager::handleProcessResult` posts the error notification to the main
   thread and then erases the reader from its own map before that post runs, so
   `SafeCallback`'s `carries()` check drops it. A file that cannot be opened is
   indistinguishable from one that was never processed. Anything built on those
   notifications cannot report its own failure.

Frames are pulled from a `base::Timer` using each frame's own `duration`, and
`jumpToStart()` is called on the last frame — without it the animation plays
once and freezes. Files over 64 MB are refused, because `FrameGenerator` decodes
from bytes held in memory for as long as the wallpaper is set.

Every failure path logs, prefixed `Wallpaper:`. Keep it that way. The feature
originally shipped with no logging at all, which is why nobody could tell that
the decoder was rejecting the file.

Known cost, accepted deliberately: frames are decoded at a fixed 2560x1440
regardless of window size, which is about 33% of one core for a 1080p GIF.
Deriving `targetSize` from the window would cut that, and matters only on
battery — the owner runs desktops.

The wallpaper is shut down before the global clip subsystem during teardown.

### First-run proxy

On an empty profile, the first valid signed feed is no longer merely a delayed
fallback. If no MTProto account exists yet, Sealgram immediately enables the
first signed-feed candidate and rotation so the login screen can connect. The
bootstrap remains pending; once an MTProto instance appears, Sealgram probes
the signed candidates and replaces the temporary choice with the lowest
responding ping. Closing the app before login does not lose this pending state.
An explicit user proxy change completes the bootstrap instead of being
overwritten, and disabling the automatic feed cancels probes already in
progress. Persisted pending/completed flags make this first-profile behaviour
restart-safe. Feed signature, URL and format were not changed.

### Build evidence

- Debug build after ghost/privacy integration: success, `Sealgram.exe`
  timestamp `2026-07-31 00:06:42`, 491,307,008 bytes.
- Debug build after wallpaper, first-run proxy and local Premium: success,
  timestamp `2026-07-31 01:05:00`, 491,382,784 bytes.
- Debug build after encrypted archive: success, timestamp
  `2026-07-31 01:33:00`, 491,420,160 bytes.
- Final full Debug rebuild after the restart-safe two-phase proxy bootstrap:
  success, timestamp `2026-07-31 02:32:14`, 491,423,744 bytes.
- Full Release build for installer `r2`: success, timestamp
  `2026-07-31 04:01:12`, 224,560,640 bytes.
- Final installer: `sealgram-setup-7.0.6-r2.exe`, 55,063,449 bytes, SHA-256
  `D175A9B23D41A40CF30ADB7584973E6647F75B4304CCA13712C70F3B59673387`.
- All client builds used `/m:1 /p:CL_MPCount=3`. The only linker diagnostic was the
  pre-existing `LNK4199` warning for unused delayed `bcrypt.dll`.

The installed Release was run on a fresh accountless profile. It remained alive,
accepted 40 signed proxies and selected the best response at 51 ms without the
former `!accounts.empty()` assertion. Normal and compatibility-mode windows both
opened. Visual wallpaper playback and archive round trips remain separate
runtime test items.

GPL note: the behaviour is inspired by AyuGram Desktop 6.7.8. No plaintext
AyuGram database code was copied; preserve both projects' GPL attribution when
distributing corresponding source.

---

## 7. What is verified, and what is not

Be honest about this distinction in anything you report.

### Verified by running it

| claim | evidence |
|---|---|
| Hardening applies, including CIG | log: `applied: extension-points, image-load, heap-terminate, dynamic-code(ACG), signed-images(CIG)` |
| Graphics work under CIG | full ANGLE/EGL D3D11 extension list in the log |
| Sealed `tdata` opens after the rename | `MTP Info: read keys, current: 4, to destroy: 0` |
| Compat mode really disables both | log: `dynamic-code(ACG): disabled by environment, signed-images(CIG): disabled by environment` |
| Proxy feed fetch and signature | `Proxy feed: 40 proxies accepted.` |
| Update feed deployment and signature | production endpoint returned HTTP 200; an independent Ed25519 verification succeeded |
| Update feed in the real client | Debug launch logged `Update feed: version 7000006 accepted.` |
| New executable icon resource | the Debug PE resource extracted as the Sealgram mark; ICO contains 16, 32, 48, 64 and 256 px images |
| Sealgram settings layout | row below the profile, cover, back navigation, search and all three pages checked at 100%, 150% and 200% |
| Sealgram settings themes | the root page was checked in both dark and light themes |
| Sealgram settings languages | Russian overrides and English fallback were both opened in the running client |
| Settings persistence | proxy feed and automatic update switches remained off after a full client restart |
| Manual update check | with automatic checks off, production returned the localized `No updates` result |
| Proxy list preservation | disabling the feed left the existing proxy list visible and the proxy/rotation dialog operational |
| Security status page | TPM available and ACG/CIG applied matched the startup hardening log |
| Stale removal works | `Proxy feed: +3 new, -3 stale, 40 in the list.` |
| Expiry pruning | backdated `expires`, restarted: `dropped 40 expired entries` then re-added, list stayed at 40 not 80 |
| Fallback to unsealed, then re-seal | `opened an unsealed key file, will seal it now.` then `key file sealed to this machine's TPM.` |
| Re-sealed profile opens cleanly | third launch produced no fallback messages |
| **Sealing cannot be downgraded** | sealed profile with `TDESKTOP_TPM_SEAL=0` refuses: `could not decrypt`. The escape hatch works forward only. |
| First-run best proxy | fresh installed Release accepted 40 proxies, stayed alive and logged `first launch selected best proxy (51 ms)` |
| Installer, per-user, no admin | `r2` exit 0, `%APPDATA%\Sealgram`, uninstall entry `{5EB37BD1-…}_is1`; first install removed residual state and upgrade preserved a marker byte-for-byte |
| Shortcuts | all three created on a clean install |
| Normal and compatibility launch | normal hardening applied; compatibility log showed ACG/CIG disabled by environment |
| Uninstall | exit 0, profile directory, shortcuts and uninstall entry removed completely |

### Not verified — do not claim these work

1. **CIG during file dialogs, calls and video.** Graphics are proven, these are
   not. The common file dialog loads third-party shell extensions in-process;
   they are expected to fail the load and be skipped, but that is an expectation.
2. `TDESKTOP_TPM_SEAL=0` is new and only exercised by the four-step test above.
3. **The newer-version dialog and Download button.** Production intentionally
   advertises the current version with `available: false`, so publishing a fake
   update merely to exercise the positive UI path was not safe. The available
   manifest, signature-tampering and validation paths are covered by the update
   service tests, but the visible positive dialog has not been clicked in a
   running client.

### One thing that was broken and repaired

Earlier test runs with `-workdir` overwrote the machine's `tg://` and
`tonsite://` handlers. The `r2` installer test exported both registry trees
before launch and restored them byte-for-byte afterward. Their current target
remains the same Debug executable that was registered before this test:
`G:\src\tdesktop\out\Debug\Sealgram.exe`.

---

## 8. Open items

1. **Test first-run proxy bootstrap with the VPN off.** Verify the lowest-ping
   candidate is selected, rotation is enabled, and a restart does not overwrite
   a later manual choice.
2. **User presence on the TPM key.** The key has no `NCRYPT_UI_POLICY`, so any
   process running as the user can reproduce the seed. Adding a Windows Hello /
   PIN requirement, or mixing in a passphrase, is what would turn "the account
   cannot be moved to another machine" into "a stealer cannot read the account".
   This is the single change that most improves the security of the fork. It has
   a real UX cost and the owner has not decided on it. **Do not implement it
   unilaterally.**
3. Banner branding — section 5. The application logo is complete.
4. Optional: move the proxy feed's Ed25519 private key out of the Vercel
   deployment into an environment variable.
5. Optional: set `PROXY_SOURCES` on Vercel to skip dead channels.

---

## 9. Distribution

The installer is shared with a small group of friends over Discord.

- `sealgram-source-7.0.6.zip` must go **with** it. Telegram Desktop is GPLv3;
  distributing the binary obliges giving recipients the corresponding source. The
  zip holds a 25-file patch against commit `12e8d4a`, build instructions and the
  licence. It contains no `api_id` or `api_hash` — this was checked, keep it that
  way.
- SmartScreen will warn. An OV certificate would not silence it either, since
  that depends on accumulated download reputation; only EV suppresses it
  immediately, and that is not worth buying for this. The warning is explained in
  the Discord post instead.
- Every user shares one `api_id`. At this scale that is acceptable. If it is ever
  posted publicly or goes past roughly 50 users, revisit — a ban would break the
  client for everyone at once.
- The exe is 214 MB and the installer 52.5 MB, over Discord's attachment limit.
  It goes on a file host with a link.

---

## 10. Working style expected here

- **State what you verified and what you assumed.** Half the mistakes in this
  project came from a plausible diagnosis nobody checked. One build reported
  exit 0 while having silently skipped both configurations, and it was caught
  only by looking at the artefacts instead of the status code.
- **Distinguish return codes.** `-1073741819` is a crash, `9009` is a missing
  command, `C1076` is out of memory. They are different problems with different
  fixes.
- **Do not touch the api credentials in output that gets shared.**
- **Do not weaken a security property to make something build or pass.** If ACG,
  CIG or the sealing gets in the way, say so and stop; do not quietly remove it.
