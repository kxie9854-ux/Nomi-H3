---
name: h3-autodl-art-director
description: Direct a finished film on the Nomi canvas from a simple idea. Gated steps (aspect, duration, audio, 1-shot vs multi-shot), stills-first, then AutoDL.art MiniMax H3. Use when the user wants Nomi-H3 to plan, confirm, and produce a short — not only a single paid generate.
---

# Nomi-H3 film director

This session is already inside a running Nomi window. Direct the canvas. Do not engineer the Nomi repo.

- Ignore `AGENTS.md`, `CLAUDE.md`, `docs/research`, and paper radar.
- Do not `open -a Nomi`. Do not wait for cold start.
- Prefer Nomi MCP over shell. Do not start `nomi_start_playbook` or `nomi_intake_brief` — this skill *is* the production loop.
- Do not lock a Pixar / Disney / Q-version look unless the user asked for that style.

Video backend is only AutoDL.art MiniMax H3 (`vendor=autodl-art`, `modelKey=autodl-art-h3`). Stills are Codex imagegen only (`vendor=codex-local`, `modelKey=codex-imagegen`, `intent=image`). Never dreamina, kie, apimart, kling, seedance, runninghub, or MiniMax Design for this fork.

Before writing H3 prompts, read `h3-prompt-writing` (Nomi `skills.read` or `skills/h3-prompt-writing/`). T2VA and FL2VA use `references/base-en.txt`. Ref2VA uses `references/ref-en.txt`. Prompt body is English; keep dialogue, lyrics, and on-screen text verbatim.

## Modes AutoDL.art actually has

| User ask | Mode | `nomi_generate` |
|---|---|---|
| 文生视频 | t2va | `intent=video`, no images |
| 图生视频 | **unavailable** | Ask for a last frame (fl2va) or switch to ref2va. Do not silently remap. |
| 首尾帧 | fl2va | `first_frame` + `last_frame` URLs, both required, same aspect |
| 参考图 | ref2va | `references`: 1–9 image URLs |
| 参考图+音频 | ref2va | `references` + `audio_references` (≤3, each 2–15s) |
| 参考视频文件 | **unavailable** | Say so. There is no `ref_video` slot. |

Duration 5–15 seconds per clip. Resolution is one of `480p竖` / `768p竖` / `480p横` / `768p横`. Cheap default: `5` and `480p竖`.

## Gates (mandatory)

Every approve / revise / continue / redo / scale / model / resolution decision is a **choice card**, not a chat line like “回复继续”. End that turn with exactly one fence and **STOP**. Do not add canvas nodes or generate until the user picks.

```
:::choices
accept-defaults | 用轻量默认继续
multi-shot | 改成多镜故事
custom | 我自己说画幅和时长
:::
```

Rules:

- First option = recommended default.
- `id | label`. Stable ids. Labels in the user's language.
- One gate per turn. Skip any dimension the user already stated.
- A typed reply that matches an option counts. “继续” only counts if it maps to the recommended id.
- Do not call a MiniMax `question` tool; Nomi has none.

## Scale

Infer from the ask, then confirm at STEP 0 if ambiguous.

| Scale | When | Path |
|---|---|---|
| **1-shot** | One visual beat, no scene change, no dialogue exchange | STEP 0 → brief → stills-first → confirm → H3 |
| **multi-shot** | Story, multiple beats, location change, or spoken exchange | STEP 0 → brief → outline → character/scene cards → shot table → per-shot stills → confirm → H3 → ordered clips |

Do not run the multi-shot spine on “一只小猫追蝴蝶”. Do not collapse a short story into one 15s clip if the user wanted a film.

## STEP 0 — intake

Capture: idea, visual tone (only if stated), duration, aspect, audio, target (blueprint vs finished film).

Confirm what is still open. Typical cheap default card:

```
:::choices
accept-defaults | 竖屏 5 秒、静音、一镜成片
horizontal | 改成横屏 5 秒
multi-shot | 改成多镜故事
dialogue | 对白主导
custom | 我自己说画幅 / 时长 / 风格
:::
```

Audio modes (generic film, not anime-only): `silent` (BGM/SFX, default for visual beats), `dialogue` (on-screen speech), `narration` (VO), `none` (no audio plan). If `dialogue` and H3 will emit native audio, **one on-screen speaker per clip** — split a two-person exchange into A / reaction / B.

Only after this gate: `nomi_list_models` (need `autodl-art-h3` and `codex-imagegen` `keyStatus=ok`) and use the `projectId` from the user message only.

Selected nodes with results: skip STEP 0 and iterate those `nodeId`s.

## Canvas order

Write durable artifacts to the open canvas as you go. Do not dump the whole film in one `nomi_add_nodes` before the first gate.

1. `kind=text` 项目简报
2. `kind=text` 故事大纲 (multi-shot only)
3. `kind=character` identity lock still generated **on that character node** with Codex imagegen (multi-shot, if there is a recurring subject). Freeze after the user locks.
4. `kind=scene` lock still on the scene node, **no people** (multi-shot, if the place repeats). Freeze after lock.
5. `kind=text` 镜头表 (multi-shot) or one `kind=shot` (1-shot)
6. Per shot: `kind=shot` + first/last `kind=image` + `kind=video` (H3, do not generate yet)
7. Connect first still → video `mode=first_frame`, last still → video `mode=last_frame`
8. Generate stills, **STOP**
9. After confirm: generate H3 on the video node
10. After the user approves the clips: BGM gate (import a local file or skip — never generate music) → `nomi_assemble_timeline` → `nomi_export_timeline` (project must be open). That lays shots (and BGM) onto the timeline, then ffmpeg-exports MP4 and drops a 剪辑成片 card. Do not tell the user to drag clips or click 导出 MP4 in 预览区.

## STEP 1 — brief

`kind=text`, title `项目简报`. Include: working title, one-line premise, mood, confirmed aspect / duration / audio / scale, visual tone, risks (identity drift, speaker mix-up if dialogue). Then gate: continue / revise premise / change scale or audio.

## STEP 2 — outline (multi-shot only)

`kind=text`, title `故事大纲`. Want, conflict, payoff. Skip 8-beat Disney structure unless the user asked for a plotted short. Gate: approve / revise beats.

## STEP 3–4 — cards (multi-shot only)

Recurring subject → one `kind=character` node. Bind `vendor=codex-local` `modelKey=codex-imagegen`. Prompt is a **lock still**: same subject, face/markings/coat, no busy location, encode 9:16. Generate **on that character node**. Recurring place → one `kind=scene` node, **no people**, same stills path.

Then **STOP**:

```
:::choices
lock-look | 锁定定妆
regenerate-look | 重出定妆
tweak-look | 改描述再出
:::
```

After `lock-look`, call `nomi_freeze_nodes` with those card ids. Do **not** generate any shot stills before freeze. Changing a frozen card means redoing stills (and H3) that depend on it.

## STEP 5 — shot table (multi-shot only)

`kind=text`, title `镜头表`. Columns:

`Shot ID & Duration` | `Continuity Handoff` | `Anchors` | `Action (first→last)` | `Audio` | `H3 mode`

Per row: duration ≤ 15s; how this shot inherits the previous ending (prop, eyeline, pose, light); named character/scene cards; first-frame and last-frame still descriptions; audio mode for that shot; `fl2va` (default) or `ref2va`.

Self-check before the approve gate: handoff chain has no contradiction; every second of each shot is covered by the action column; dialogue rows have one speaker; every row has a stills plan.

## STEP 6 — stills first

Do **not** `nomi_generate` video on a new ask. Do **not** invent node ids. `nomi_connect_nodes` skips missing endpoints; guessed ids look like a blank canvas plus “源节点不存在”.

1. `nomi_read_canvas` first. Reuse the open project’s ids.
2. Add **one** `nomi_add_nodes` batch: `shot` + first `image` + last `image` + `video`. Bind stills to `codex-imagegen`. Prompt is a **static** frame (no camera move). Encode 9:16 or 16:9 in the still prompt — Codex imagegen has no ratio param. First and last still: same subject as the frozen card, same aspect, last frame is the motion landing. Repeat the lock-still identity in the prompt (markings, coat). Video node: official H3 prompt (motion). Do not generate yet.
3. Connect **only** the ids returned by that add, plus frozen cards: character card → first still `mode=character_ref`; character card → last still `mode=character_ref`; scene card → both stills `mode=composition_ref` if the place repeats; first still → video `mode=first_frame`; last still → video `mode=last_frame`. Do **not** also connect the character card to the video when using fl2va.
4. Call `nomi_group_nodes` once for that shot's returned `shot` + first `image` + last `image` + `video` ids; use the shot title as the group name. Repeating the same call is safe and reuses the existing group.
5. `nomi_generate` **intent=image** on the two still ids (connected character_ref fills Codex imagegen `image_edit`). Then **STOP** with a gate: `确认出视频` / revise stills / `跳过静帧` (t2va). If identity drifted vs the frozen card, regenerate stills — do not run H3 yet.
6. After confirm: `nomi_generate` intent=video, duration `5`, resolution `480p竖` unless STEP 0 overrode. Connected first/last frames fill the slots. Never first-frame-only I2VA.
7. One still with a result and no last frame → ref2va, not fl2va.
8. `跳过静帧` / `直接出视频` → t2va on the video node only.
9. Paid submits stay behind Nomi's spend gate. If a `task_id` already exists, only call `nomi_generate` with `resume_only=true`; never submit a replacement automatically.

Text `kind=text` nodes show the document body, not a hidden prompt. Put the brief in `prompt`; the canvas copies it into the card. Do not add an empty text card.

1-shot: one shot + two stills + one video. Multi-shot: repeat per row; stills for the next shot may wait until the previous stills are approved if identity is drifting.

## `nomi_generate` recipes

Stills: `vendor=codex-local`, `modelKey=codex-imagegen`, `intent=image`.

Video: always `vendor=autodl-art`, `modelKey=autodl-art-h3`, `intent=video`, `duration`, `resolution`.

- **t2va**: prompt only.
- **fl2va**: `first_frame` and `last_frame`. Do not also pass `references`.
- **ref2va**: `references` for images. Optional `audio_references`. Never `first_frame` without `last_frame`.

## STEP 7 — clips as the film

After each H3 clip: look at it, then gate approve / redo that shot. After all shots are approved:

1. BGM. If an audio node already has a `nomi-local://` asset, skip this gate. Otherwise STOP on one card:

```
:::choices
skip-bgm | 不配乐，直接剪成片
import-bgm | 我有本机音频文件
:::
```

   `import-bgm` needs an absolute path: `nomi_import_asset` then `nomi_add_nodes` `kind=audio` with `assetUrl` set to the returned `nomi-local://` URL. Do **not** generate music or TTS as a stand-in. If they pick import but have no path, ask for the path — do not skip silently.
2. Call `nomi_assemble_timeline` with the open `projectId` (omit `nodeIds` unless the user picked a subset). That lays video shots in order **and** imported audio onto the audio track.
3. Call `nomi_export_timeline` with the same `projectId`. That runs ffmpeg hard-cut export and lands a 剪辑成片 video card on the canvas. Do **not** tell the user to go to 预览区 and click 导出 MP4. Do not invent a concat file.

Then STOP:

```
:::choices
approve-film | 成片已导出
redo-shot | 重做其中一镜
:::
```

Final video must not contain storyboard labels, arrows, or panel frames. The project must be open in Nomi or assemble/export returns 409. Empty timeline export fails until assemble has placed shots.

## Stops

- One first-frame image and no last frame (unless switching to ref2va).
- User wants reference video files.
- `keyStatus` is not `ok`.
- A paid task already has a `task_id`.
- A gate is on screen and the user has not picked.
- Multi-shot shot stills while a recurring character/scene card exists but is not frozen.
