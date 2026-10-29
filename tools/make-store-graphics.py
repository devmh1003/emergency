"""플레이 스토어 등록 그림을 만든다: python tools/make-store-graphics.py

android/store/icon-512.png        앱 아이콘 (512×512)
android/store/feature-1024x500.png 그래픽 이미지 (1024×500, 투명 없음)

글꼴은 Windows 의 맑은 고딕을 쓴다.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'android' / 'store'
FONT_BOLD = 'C:/Windows/Fonts/malgunbd.ttf'
FONT = 'C:/Windows/Fonts/malgun.ttf'

NAVY = (22, 46, 81)
RED = (216, 57, 51)
GOLD = (255, 190, 46)
WHITE = (255, 255, 255)

OUT.mkdir(parents=True, exist_ok=True)

icon = Image.open(ROOT / 'web' / 'icons' / 'icon-512.png').convert('RGB')
icon.save(OUT / 'icon-512.png')

W, H = 1024, 500
img = Image.new('RGB', (W, H), NAVY)
d = ImageDraw.Draw(img)
# 오른쪽 아래 붉은 띠 (경보)
d.polygon([(W * 0.62, H), (W, H * 0.38), (W, H)], fill=RED)
d.rectangle([0, H - 14, W, H], fill=GOLD)

art = icon.resize((220, 220))
mask = Image.new('L', art.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, 219, 219], radius=48, fill=255)
img.paste(art, (64, 140), mask)

title = ImageFont.truetype(FONT_BOLD, 64)
sub = ImageFont.truetype(FONT, 30)
tag = ImageFont.truetype(FONT_BOLD, 26)
d.text((320, 150), '우리 가족 비상연락', font=title, fill=WHITE)
d.text((322, 245), '1급 비상은 잠금 화면 위 전체 화면 경보', font=sub, fill=WHITE)
d.text((322, 290), '생존신고 · 집합장소 · 가족 현황', font=sub, fill=(223, 225, 226))
d.text((322, 92), 'FAMILY EMERGENCY', font=tag, fill=GOLD)

img.save(OUT / 'feature-1024x500.png')
for f in sorted(OUT.iterdir()):
    print(f.name, Image.open(f).size)
