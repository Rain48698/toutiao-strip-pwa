# 头条图片去水印 PWA

裁掉今日头条图片右下角水印条带的纯前端小工具。多选图片 → 自动去水印 → 一键保存，全部处理在手机本地完成，图片不上传。

**在线使用**：https://rain48698.github.io/toutiao-watermark-remover/

- 安卓 Chrome / Edge：菜单「安装应用 / 添加到主屏幕」，或页面右上角「安装」按钮
- 鸿蒙华为浏览器：菜单「添加到桌面」
- 鸿蒙 5+ 请用「存入相册」按钮保存（系统分享 → 保存到图库）；「下载」的图片只进文件管理器、图库看不到
- 安装后离线可用；裁切规则与算法依据见《头条图片去水印裁切逻辑-PWA开发规格.md》

## 技术要点

- 原生 HTML/CSS/JS，零依赖零构建；UI 为 Apple/iOS 设计风格
- 核心算法：`crop_h = clamp(trunc(宽 × 6%), 40, 150)`，只裁底部横带；小图与动图跳过
- Service Worker 全量预缓存（cache-first），改文件后需升 `sw.js` 的 `VERSION`
- 图标由 `tools/gen_icons.py` 生成（纯 Python，零第三方依赖）

## 本地开发

```bash
python -m http.server 8642 --bind 0.0.0.0   # 手机同 Wi-Fi 访问 http://<电脑IP>:8642
python tools/gen_icons.py                   # 重新生成图标
```
