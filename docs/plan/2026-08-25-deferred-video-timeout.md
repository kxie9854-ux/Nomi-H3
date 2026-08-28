# 画布视频误报加载超时修复

状态：✅ 已交付

## 现象与根因

- AutoDL.art 成功返回并已下载到项目资产的 H.264 MP4，在生成画布的视频卡片上稳定显示“加载超时，请重试”；同一文件可被 `ffprobe`、预览播放器和 MP4 导出正常读取。
- `DeferredNodeMedia` 把 8 秒的“并发槽防卡死 watchdog”同时当成了“媒体加载失败判决”。watchdog 到点会清空 `activeSrc`，因此一个仍在正常解码或等待首帧的健康视频会被主动中止并误报失败。
- 真机把误杀延后后又暴露出更底层根因：`ManagedDeferredNodeVideo` 在 effect cleanup 中移除 `src`。Nomi 根节点启用 React 18 StrictMode，开发模式会在同一个 DOM 节点仍挂载时重放 effect cleanup，导致 `<video>` 留在页面但 `currentSrc=""`、`readyState=0`、`networkState=0`，网络请求从未开始。

## 范围

- 把“释放并发槽”和“判定媒体加载失败”拆开：watchdog 只负责释放槽，不再取消仍在加载的媒体。
- 另设媒体加载超时；视频采用更长阈值，图片保持现有快速失败反馈。
- 视频 DOM 资源释放改由 callback ref 的真实节点更替/卸载驱动，不再绑定到 StrictMode 会重放的 effect cleanup。
- 增加纯队列/超时/节点生命周期回归测试，证明 watchdog 释放后下一项能启动、不会提前触发用户可见 timeout，且同一个已挂载节点不会被清空 `src`。

## 不动项

- 不改媒体并发上限、画布虚拟化、`nomi-local://` 协议、视频转码自愈、项目结构或生成链路。
- 不增加按钮、文案、设置项或新的并行媒体实现。

## 回滚

- 回滚本计划对应的队列与测试改动即可；不涉及数据迁移和已生成资产。

## 验收

- 8 秒槽 watchdog 到点后，下一条媒体可启动；原视频继续加载，不出现 timeout 覆盖层。
- 真正长时间无加载事件的图片/视频仍进入 timeout 并可手动重试。
- 目标 Vitest、typecheck、build 通过；解锁后在真实两镜项目点击重试，两个本地视频卡片可显示画面。
