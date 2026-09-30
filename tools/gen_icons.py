# -*- coding: utf-8 -*-
"""生成 PWA 图标（iOS 风格）：蓝色垂直渐变 + 白色裁切(crop)回旋针图形。

零依赖：不使用 Pillow，用有向距离场(SDF)逐像素光栅化（解析式抗锯齿），
并用 zlib/struct 手写 PNG 编码。输出：
  icons/icon-192.png / icon-512.png                （any，圆角矩形）
  icons/icon-maskable-192.png / icon-maskable-512.png （maskable，全出血正方形）
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")

GRAD_TOP = (47, 155, 255)    # #2F9BFF
GRAD_BOTTOM = (8, 88, 224)   # #0858E0

# crop 回旋针图形（归一化坐标，参考 Feather icons "crop"）：
# 左竖线上段 + 底部横线右段 / 顶部横线左段 + 右竖线下段
SEGMENTS = [
    ((0.25, 0.055), (0.25, 0.62)),   # 左竖线
    ((0.33, 0.75), (0.945, 0.75)),   # 底部横线
    ((0.055, 0.25), (0.62, 0.25)),   # 顶部横线
    ((0.75, 0.33), (0.75, 0.945)),   # 右竖线
]
STROKE = 0.10          # 线宽（占图形盒的比例）
CORNER_RATIO = 0.2237  # iOS 图标圆角比例
GLYPH_ANY = 0.60       # any 图标：图形盒占边长比例
GLYPH_MASKABLE = 0.42  # maskable：图形需留在中心 80% 安全区内，取更小


def sd_rounded_rect(px, py, half, radius):
    """圆角矩形 SDF：<=0 在内部。"""
    qx = abs(px) - (half - radius)
    qy = abs(py) - (half - radius)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - radius


def sd_segment(px, py, seg):
    (x0, y0), (x1, y1) = seg
    dx, dy = x1 - x0, y1 - y0
    t = 0.0
    L2 = dx * dx + dy * dy
    if L2 > 0.0:
        t = ((px - x0) * dx + (py - y0) * dy) / L2
        t = max(0.0, min(1.0, t))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def render(size, maskable):
    half = size / 2.0
    radius = CORNER_RATIO * size
    glyph_half = half * (GLYPH_MASKABLE if maskable else GLYPH_ANY)
    stroke_r = STROKE * glyph_half
    # 归一化线段映射到屏幕坐标（图形盒居中）
    segs = []
    for (a, b) in SEGMENTS:
        ax = (a[0] - 0.5) * 2 * glyph_half
        ay = (a[1] - 0.5) * 2 * glyph_half
        bx = (b[0] - 0.5) * 2 * glyph_half
        by = (b[1] - 0.5) * 2 * glyph_half
        segs.append(((ax, ay), (bx, by)))

    rows = []
    for y in range(size):
        row = bytearray()
        py = y + 0.5 - half
        t = y / max(1, size - 1)
        br = GRAD_TOP[0] + (GRAD_BOTTOM[0] - GRAD_TOP[0]) * t
        bg_g = GRAD_TOP[1] + (GRAD_BOTTOM[1] - GRAD_TOP[1]) * t
        bb = GRAD_TOP[2] + (GRAD_BOTTOM[2] - GRAD_TOP[2]) * t
        for x in range(size):
            px = x + 0.5 - half
            if maskable:
                cover = 1.0
            else:
                cover = max(0.0, min(1.0, 0.5 - sd_rounded_rect(px, py, half, radius)))
            alpha = 0.0
            if cover > 0.0:
                for seg in segs:
                    d = sd_segment(px, py, seg)
                    alpha = max(alpha, max(0.0, min(1.0, stroke_r - d + 0.5)))
                    if alpha >= 1.0:
                        break
            row += bytes((
                int(br + (255 - br) * alpha + 0.5),
                int(bg_g + (255 - bg_g) * alpha + 0.5),
                int(bb + (255 - bb) * alpha + 0.5),
                int(cover * 255 + 0.5),
            ))
        rows.append(bytes(row))
    return size, size, rows


def write_png(path, w, h, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8bit RGBA
    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        for maskable, suffix in ((False, ""), (True, "-maskable")):
            w, h, rows = render(size, maskable)
            path = os.path.abspath(os.path.join(OUT_DIR, f"icon{suffix}-{size}.png"))
            write_png(path, w, h, rows)
            print(f"OK {path} ({w}x{h})")


if __name__ == "__main__":
    main()
