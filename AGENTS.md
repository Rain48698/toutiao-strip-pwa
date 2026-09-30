# AGENTS.md — 头条图片去水印 PWA 工具

## 项目目的

独立 PWA 小工具：去除今日头条图片右下角的水印（「头条 @作者名」）。做法是**无脑裁掉图片底部一条横带**，不做水印识别。主要运行在**安卓与鸿蒙手机浏览器**（Chromium 系内核，含鸿蒙 ArkWeb）。

技术栈：**原生 HTML/CSS/JS，零依赖、零构建**；PWA 用 manifest + 手写 Service Worker；UI 采用 Apple（iOS）设计风格（详见下文「设计决策」）。

## 必读文档

- `头条图片去水印裁切逻辑-PWA开发规格.md` — 唯一权威规格（源自今日头条采集工具 `strip_watermark_file()` 的实测结论）。实现任何裁切逻辑前必须通读，所有参数以它为准，不要自行发明数值。

## 文件架构

```
index.html              单页 UI（iOS 大标题 + 毛玻璃导航 + 卡片网格 + 悬浮操作栏 + 底部预览面板）
css/style.css           设计令牌（iOS 系统色/语义灰阶/材质/曲线）、深色模式、无障碍降级
js/strip.js             核心裁切算法（无 UI 依赖，可独立单测）
js/app.js               选图队列、状态渲染、保存策略、预览面板手势、HUD、安装提示、SW 可用性检测
sw.js                   Service Worker（版本化预缓存，cache-first，离线可用）
manifest.json           PWA 清单（standalone + maskable 图标；用 .json 而非 .webmanifest 以避免托管方 octet-stream MIME 问题）
icons/                  工具生成的 PNG 图标（不要手改）
tools/gen_icons.py      图标生成脚本（纯 Python SDF 光栅化，零第三方依赖）
```

## 本地运行与调试

```
python -m http.server 8642 --bind 0.0.0.0   # 手机经局域网 http://<电脑IP>:8642 访问
python tools/gen_icons.py                   # 重新生成图标（改设计后执行）
```

- **SW / 安装能力要求 HTTPS（或 localhost）**；局域网 http 下核心功能全部可用，仅无离线缓存与安装提示。
- **托管平台红线**：短链预览类服务（html2link.dev 等）强制 `CSP: sandbox` 响应头，会禁用 Service Worker、安装必报「无法安装此应用」——沙箱上下文里 `navigator.serviceWorker` 属性访问直接抛异常，代码层无解，只能换托管（app.js 会检测并在页顶显示警告）。
- **改了任何被 SW 预缓存的文件后必须升 `sw.js` 的 `VERSION`**，否则老用户拿不到更新（cache-first）。
- 页面暴露 `window.__app = { addFiles, state }` 仅供自动化冒烟测试注入文件使用。

## 核心算法（js/strip.js，项目常量，不可改动）

```
crop_h = clamp(trunc(宽 × 0.06), 40, 150)     # int 截断，不四舍五入
裁切区域 = (0, 0, w, h − crop_h)               # 只切底部全宽横带，左右上不动
```

跳过规则（满足任一即整张跳过；设计原则：**宁可保留水印，也不把小图裁残**）：

- 动图（GIF 一律跳过，含静态 GIF——浏览器无法按 GIF 原格式导出）
- `crop_h ≥ 高度 × 0.3`
- `高度 − crop_h < 100`

保存规则：写回原文件名；JPEG 重存 `quality=0.9`，其他格式用默认参数；任何异常静默标记跳过/失败、原文件不动。

## 浏览器端关键决策（实测验证过，改动前三思）

1. **格式矩阵**：JPEG / PNG / WebP 处理；GIF、BMP、AVIF、HEIC 跳过并注明原因（Canvas 无法原格式导出/解码，符合规格「格式不识别就跳过」）。WebP 编码不可用时自动回退 PNG 并改扩展名。
2. **EXIF 方向**：`createImageBitmap(blob, {imageOrientation:'from-image'})` 显式转正（回退 `<img>`），裁的是「所见坐标」，预览即结果。
3. **逐张下载策略**（用户选定）：批量=同一次手势内 400ms 间隔连发 `a[download]`（Chrome 系弹一次「允许多文件下载」授权）；**逐张保存引导模式=每点一次只触发 1 个下载，任何浏览器都不会拦**（鸿蒙兜底）。blob URL 延迟 10s 再 revoke。
4. **CSS `[hidden]{display:none !important}`**：author 的 `display:grid/flex` 会覆盖 `hidden` 属性的 UA 默认值导致隐藏弹层照常渲染，此规则是兜底，勿删。
5. **SW 版本更新**：`sw.js` VERSION 升号 + 两次刷新完成接管（install 预缓存 → skipWaiting → claim）。

## 设计决策（Apple / iOS 风格）

- 令牌在 `style.css` `:root`：iOS 系统色（#007AFF 等）、语义灰阶、`--ease-sheet: cubic-bezier(0.32,0.72,0,1)`（iOS sheet 曲线）；深色模式经 `prefers-color-scheme` 自动切换。
- 材质：导航条/底部操作栏/HUD 用 `backdrop-filter: blur(20px) saturate(180%)` 半透明层，内容从下方滚过；`prefers-reduced-transparency` 时转实底。
- 动效：按压反馈在 pointer-down（`:active` scale 0.96）；预览面板可下拉 1:1 跟手关闭（Pointer Events + capture，顶部橡皮筋、松手按速度判定）；`prefers-reduced-motion` 全部降级。
- 触屏细节：`touch-action: manipulation` 消 300ms 点击延迟；44px 最小触控目标；`viewport-fit=cover` + `env(safe-area-inset-*)` 安全区适配。

## 完成度备忘（2026-09-30）

- 已实现：多选图片 → 自动逐张去水印 → 一键保存（批量 + 逐张引导兜底）+ 单张下载/系统分享 + 预览面板 + 深色模式 + 离线缓存 + 安装到桌面。
- 冒烟测试已过：裁切公式（48/64/40px 三档）、小图与 GIF 跳过、批量/逐张下载触发、HUD、SW 注册、无控制台报错。
- 待真机验证：鸿蒙/安卓自带浏览器的「允许多文件下载」授权弹窗、「添加到桌面」路径、Web Share 存相册入口。
