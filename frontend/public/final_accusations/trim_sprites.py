"""Trim transparent padding from accusation sprites.

Crops each PNG to its content bounding box + small padding,
then re-centers on a square canvas. This normalizes sprites
so CSS sizing behaves consistently regardless of where Gemini
placed the character within the original 1024x1024 frame.

Usage: python3 trim_sprites.py
"""

from PIL import Image
import os

PADDING = 20  # px padding around content

dir_path = os.path.dirname(os.path.abspath(__file__))

for fname in sorted(os.listdir(dir_path)):
    if not fname.endswith('.png'):
        continue

    fpath = os.path.join(dir_path, fname)
    img = Image.open(fpath)

    if img.mode != 'RGBA':
        print(f"  SKIP {fname} (not RGBA)")
        continue

    bbox = img.getbbox()
    if not bbox:
        print(f"  SKIP {fname} (fully transparent)")
        continue

    # Crop to content
    cropped = img.crop(bbox)
    cw, ch = cropped.size

    # Create square canvas sized to the larger dimension + padding
    canvas_size = max(cw, ch) + PADDING * 2
    result = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))

    # Center horizontally, anchor to bottom
    x_offset = (canvas_size - cw) // 2
    y_offset = canvas_size - ch - PADDING  # bottom-anchored with padding
    result.paste(cropped, (x_offset, y_offset))

    old_fill = (cw * ch) / (img.size[0] * img.size[1]) * 100
    new_fill = (cw * ch) / (canvas_size * canvas_size) * 100

    result.save(fpath)
    print(f"  {fname}: {img.size} -> {result.size} (fill {old_fill:.0f}% -> {new_fill:.0f}%)")
