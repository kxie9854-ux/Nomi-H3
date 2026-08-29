# 栅格图片元数据误判为标记文本修复

> 状态：🚧 进行中

## 范围

- 修正 `assertLocalAssetMediaBytes` 的判定顺序：文件头已确认的栅格图片不再对任意二进制前缀运行 HTML/XML/SVG 文本搜索。
- 保留并验证三条拒绝边界：HTML/XML/SVG 冒充栅格图、声明格式与真实栅格魔数不一致、未知或损坏的栅格内容。
- 增加带 C2PA 风格内嵌 SVG 元数据的 PNG 回归用例，并覆盖同类“有效栅格二进制中含 `<svg` 文本”边界。
- 更新 R21 根因合同并运行聚焦测试、合同门岗及仓库质量门岗。

## 不动项

- 不修改 Codex 生图、AutoDL.art H3、素材上传服务或消费确认逻辑。
- 不重写、转码或剥离用户已有图片的 C2PA/其他元数据。
- 不修改画布节点、引用边或已生成资产。
- 不触碰现有未提交的 `public/tailwind.generated.css`。

## 回滚策略

- 回滚本次 `assetLocalization` 判定顺序、对应测试和根因合同即可；不涉及持久化格式或数据迁移。

## 验收门

1. 先红：当前实现对“PNG 魔数 + 前 2048 字节内含 SVG 元数据”的用例抛出 HTML/XML/SVG 错误。
2. 后绿：同一用例通过；HTML/XML/SVG 冒充 PNG、PNG/JPEG 声明不一致、损坏 PNG 仍明确失败。
3. `pnpm run check:root-cause-contracts` 通过。
4. 聚焦测试、类型检查、lint、单测与 build 通过；确认 diff 未包含用户的 Tailwind 改动。

## 执行结果

- 先红证据：新增 C2PA 风格 PNG 用例在旧实现抛出与画布一致的 `HTML/XML/SVG` 错误。
- 后绿证据：`assetLocalization.test.ts` 79/79 通过；真实报错文件 `codex-image-01a04978.png` 经修后函数验证通过。
- 类边界：带 HTML 字样的 JPEG 元数据通过；栅格声明/魔数不一致仍失败；HTML 冒充 PNG、损坏 PNG、危险或畸形 SVG 仍失败。
- 全量验证：Vitest 8337 通过/1 跳过，Agent runtime 151/151，通过 lint（0 errors）、三套 TypeScript、filesize、tokens、i18n、heavy-path、vocabularies、test-waits、根因合同、renderer build 与 electron build。
- Electron 安装身份门在沙箱内因无法执行 GUI runtime 误报；沙箱外探测 `v43.4.1` 后通过。完整 renderer/electron 构建未重生成 `public/tailwind.generated.css`，以保护用户已有未提交内容。
