"""アイコン (icons/icon16.png, icon48.png, icon128.png) を生成するスクリプト。

AWSのオレンジ/ネイビーを基調にしたシンプルな矢印アイコンを描画する。
再生成が必要な場合は `python generate_icons.py` を実行する。
"""

from pathlib import Path

from PIL import Image, ImageDraw

ICON_DIR = Path(__file__).resolve().parent
NAVY = (35, 47, 62, 255)
ORANGE = (255, 153, 0, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = max(1, size // 16)
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=max(2, size // 6),
        fill=NAVY,
    )

    # 起動(外部リンク)を表す矢印を中央に描画
    cx, cy = size / 2, size / 2
    arrow_scale = size * 0.36
    points = [
        (cx - arrow_scale * 0.6, cy + arrow_scale * 0.6),
        (cx + arrow_scale * 0.6, cy - arrow_scale * 0.6),
    ]
    line_width = max(1, size // 10)
    draw.line(points, fill=ORANGE, width=line_width)

    head = arrow_scale * 0.55
    tip = points[1]
    draw.polygon(
        [
            tip,
            (tip[0] - head, tip[1]),
            (tip[0], tip[1] + head),
        ],
        fill=ORANGE,
    )

    return img


def main() -> None:
    for size in (16, 48, 128):
        icon = draw_icon(size)
        out_path = ICON_DIR / f"icon{size}.png"
        icon.save(out_path)
        print(f"generated: {out_path}")


if __name__ == "__main__":
    main()
