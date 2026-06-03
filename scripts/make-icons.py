#!/usr/bin/env python3
"""
scripts/make-icons.py — generate every app icon from one master image.

Usage:
    npm run icons            (or: python3 scripts/make-icons.py)

Source of truth:
    resources/icon-master.png   (1024x1024 RGBA)

If icon-master.png does not exist, this script DRAWS the default Maverick
Voice icon (black-glass squircle + white waveform mark) and saves it there.
To use your own design (Figma/Canva/AI-generated/Apple Icon Composer), export
a 1024x1024 PNG over resources/icon-master.png and re-run — your art should
fill the full canvas; macOS margins are applied automatically here.

Outputs:
    resources/icon.icns          macOS app icon (Dock, Cmd+Tab, Finder)
    resources/icon.png           512px PNG (dev-mode Dock icon, Linux)
    resources/icons/icon.icns    copy for the electron-builder icons dir
    resources/icons/icon.ico     Windows app icon (full-bleed variant)

Requires: Pillow (pip3 install pillow) and iconutil (ships with macOS).
"""

import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'resources')
MASTER = os.path.join(RES, 'icon-master.png')

S = 1024  # master canvas


def draw_waveform(d, cx, cy, usable, color=(255, 255, 255, 255)):
    """The Maverick mark: 5 rounded bars, symmetric voice silhouette."""
    heights = [0.34, 0.64, 1.00, 0.64, 0.34]
    bar_w = int(usable * 0.16)
    gap = int(usable * 0.09)
    total_w = len(heights) * bar_w + (len(heights) - 1) * gap
    x0 = cx - total_w // 2
    for i, h in enumerate(heights):
        bh = int(usable * h)
        x = x0 + i * (bar_w + gap)
        d.rounded_rectangle(
            [x, cy - bh // 2, x + bar_w, cy + bh // 2],
            radius=bar_w // 2, fill=color,
        )


def draw_master():
    """Default icon: 3D black-glass squircle, white waveform, full-bleed 1024."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # Squircle mask (Pillow's rounded_rectangle at macOS-ish 22.5% radius).
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)

    # Glass body: vertical gradient, near-black.
    body = Image.new('RGBA', (S, S))
    bp = body.load()
    for y in range(S):
        t = y / S
        v = int(42 - 32 * t)  # 42 -> 10
        for x in range(S):
            bp[x, y] = (v, v, v + 2, 255)

    # Top glass highlight: white band fading out over the upper 45%.
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hp = hl.load()
    for y in range(int(S * 0.45)):
        a = int(46 * (1 - y / (S * 0.45)) ** 1.6)
        for x in range(S):
            hp[x, y] = (255, 255, 255, a)
    body = Image.alpha_composite(body, hl)

    # Inner edge glow: 1.5%-inset white stroke, soft.
    edge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        [3, 3, S - 4, S - 4], radius=int(S * 0.222),
        outline=(255, 255, 255, 56), width=4,
    )
    edge = edge.filter(ImageFilter.GaussianBlur(2))
    body = Image.alpha_composite(body, edge)

    # Mark: soft shadow below the bars, then the bars (slight vertical sheen).
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw_waveform(ImageDraw.Draw(shadow), S // 2, S // 2 + 14, int(S * 0.46), (0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    body = Image.alpha_composite(body, shadow)

    bars = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw_waveform(ImageDraw.Draw(bars), S // 2, S // 2, int(S * 0.46))
    sheen = Image.new('L', (S, S), 255)
    sp = sheen.load()
    for y in range(S):
        v = int(255 - 38 * (y / S))  # white -> faint grey
        for x in range(S):
            sp[x, y] = v
    bars.putalpha(Image.composite(bars.split()[3], Image.new('L', (S, S), 0), bars.split()[3]))
    body = Image.alpha_composite(body, bars)

    img.paste(body, (0, 0), mask)
    img.save(MASTER)
    print(f'drew default master -> {MASTER}')


def macos_framed(master):
    """Apple icon grid: art at ~80.5% of canvas, centered, with drop shadow."""
    inner = int(S * 0.805)
    art = master.resize((inner, inner), Image.LANCZOS)
    off = (S - inner) // 2
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    a = art.split()[3].point(lambda v: int(v * 0.55))
    sh.paste(Image.new('RGBA', (inner, inner), (0, 0, 0, 255)), (off, off + int(S * 0.012)), a)
    sh = sh.filter(ImageFilter.GaussianBlur(int(S * 0.011)))
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out = Image.alpha_composite(out, sh)
    out.paste(art, (off, off), art)
    return out


def build_icns(framed):
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    with tempfile.TemporaryDirectory() as td:
        iconset = os.path.join(td, 'icon.iconset')
        os.makedirs(iconset)
        for sz in sizes:
            im = framed.resize((sz, sz), Image.LANCZOS)
            if sz < 1024:
                im.save(os.path.join(iconset, f'icon_{sz}x{sz}.png'))
            if sz > 16:
                im.save(os.path.join(iconset, f'icon_{sz // 2}x{sz // 2}@2x.png'))
        dst = os.path.join(RES, 'icon.icns')
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', dst], check=True)
        shutil.copy(dst, os.path.join(RES, 'icons', 'icon.icns'))
        print(f'icns -> {dst} (+ resources/icons/)')


def build_ico(master):
    # Windows icons are full-bleed (no macOS margin).
    dst = os.path.join(RES, 'icons', 'icon.ico')
    master.save(dst, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f'ico  -> {dst}')


def main():
    os.makedirs(os.path.join(RES, 'icons'), exist_ok=True)
    if not os.path.exists(MASTER):
        draw_master()
    master = Image.open(MASTER).convert('RGBA')
    if master.size != (S, S):
        print(f'warning: master is {master.size}, resizing to {S}x{S}')
        master = master.resize((S, S), Image.LANCZOS)

    framed = macos_framed(master)
    if sys.platform == 'darwin':
        build_icns(framed)
    else:
        print('skipping .icns (iconutil is macOS-only)')
    build_ico(master)

    framed.resize((512, 512), Image.LANCZOS).save(os.path.join(RES, 'icon.png'))
    print('png  -> resources/icon.png (512, dev Dock icon)')


if __name__ == '__main__':
    main()
