# B站多倍速调节（知识区学习向优化版）

专为在 Bilibili 高效观看知识区、网课与长视频打造的 Tampermonkey / Violentmonkey 油猴脚本。

## 核心特性

- **黄金倍速预设**：精简聚焦 `1.5x ~ 2.0x` 常用区间（`2x`、`1.8x`、`1.75x`、`1.6x`、`1.5x`、`1.25x`、`1x`），菜单紧凑，无滚动条遮挡。
- **「持续 / 仅当前视频」独立开关**：
  - **持续：开**：所有视频、分 P、合集自动沿用并记住当前倍速。
  - **持续：关**：仅对当前正在播放的视频生效，切到下一个视频或分 P 自动恢复 `1x`。
- **实际剩余时间折算**：在播放器左下角时间栏旁实时显示 `实际剩 MM:SS`，按当前倍速换算真正还需要观看的时间。
- **内联自定义倍速**：支持 `0.1 ~ 16` 倍速输入，直接在菜单内完成输入与回车确认，全屏观看不会弹出系统弹窗退出全屏。
- **SPA 与播放器重建自适应**：基于 `MutationObserver` 与 `history` 路由监听，切换分 P、合集、推荐视频或更换清晰度时稳定生效。

## 安装方式

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 点击下方直链安装脚本：
   - [点击安装 bilibili-playback-rate.user.js](https://raw.githubusercontent.com/ccawmiku/bilibili-playback-rate/main/bilibili-playback-rate.user.js)

## 致谢与协议

- 基于 `lgldlk` 的 B 站多倍速调节脚本重构改进。
- 采用 [MIT License](./LICENSE) 开源。
