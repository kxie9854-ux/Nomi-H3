# 导演可点选 Skill / 模板

日期：2026-08-26

## 为什么现在做

MiniMax Design 的导演可以点选 Skill / 模板。Nomi-H3 的 Codex 侧栏此前每轮都钉死 `h3-autodl-art-director`，仓库里的古装/运镜/表演等知识 skill 进不去对话。

## 范围

- 导演侧栏输入框上方一排可点芯片：成片脊柱始终开；古装/运镜等最多叠 3 个。
- 导入本机 `SKILL.md` 到 `userData/codex-director/imported-skills/`。
- 每轮 `turn/start` 把脊柱 + 选中 overlay 作为 skill 输入。H3 / Codex imagegen / assemble-export 脊柱不变。

## 不动项

- 不把 `brand.promo` / `drama.short` playbook 接到 Codex（那是原生助手工具链）。
- 不接 Dreamina，不伪造 I2VA，不换视频后端。
- 不开放任意路径拷贝，只收 markdown 正文。

## 验收

1. 芯片可点；成片不能关掉。
2. 点古装后下一句发给 Codex 的 input 里带 `director.guzhuang`。
3. 导入 SKILL.md 后出现新芯片，最多 3 个 overlay。
4. 重启 Electron 后才能吃到主进程改动。
