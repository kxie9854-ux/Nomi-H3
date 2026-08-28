---
name: director-skill-author
description: Write a reusable Nomi-H3 director overlay skill (SKILL.md) and save it with nomi_save_director_skill. Use when the user is in 创建技能 mode or asks to author a director template.
---

# Director skill author

This turn is **only** for writing a director overlay skill. Do not plan a film. Do not add canvas nodes. Do not call `nomi_generate`, `nomi_assemble_timeline`, or `nomi_export_timeline`.

## What to write

A knowledge overlay for the Codex director, same shape as `director-guzhuang` / `director-cinematography`: craft, period, style, or a short production recipe that still uses AutoDL.art H3 + Codex imagegen.

Frontmatter:

```
---
name: kebab-or-dot.id
description: One line — what it does and when to attach it.
---
```

Body in the user's language. Include: when to use it, the steps or craft rules, what to put in stills vs H3 prompts, and honest gaps (no music model, no I2VA-only, no reference video).

## Save

Call `nomi_save_director_skill` once with the full markdown. Then tell the user the chip name and that they should switch back to **成片** and click it. Do not invent a file path.

If they already imported a similar skill, ask whether to overwrite (same `name` replaces the file).

## Do not

- Lock Pixar / Disney looks unless they asked.
- Map to `nomi_start_playbook` or native assistant tools (`propose_storyboard_plan`, `create_canvas_nodes`).
- Generate sample stills or video to "test" the skill in this mode.
