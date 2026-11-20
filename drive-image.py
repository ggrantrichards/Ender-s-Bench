"""Render the driving model's dashboard view (Ridgeline van 12) from an observe() view on stdin."""
import json
import sys
from io import BytesIO

from PIL import Image, ImageDraw

v = json.load(sys.stdin)
W, H = 760, 420
dark = v["lighting"].startswith("dark")
img = Image.new("RGB", (W, H), "#0b0d10" if dark else "#1d2329")
d = ImageDraw.Draw(img)
# Road in perspective: a trapezoid with lane markings.
d.polygon([(250, 300), (510, 300), (430, 60), (330, 60)], fill="#202428" if dark else "#3a4046")
for y in range(70, 300, 40):
    d.line([(380, y), (380, y + 18)], fill="#c9c2a3", width=2)
reach = 140 if dark else 260
d.polygon([(300, 300), (460, 300), (400, 300 - reach), (360, 300 - reach)], fill="#2d3238" if dark else "#4a5157")
for det in v.get("detections", []):
    y = 300 - min(240, det["distance_m"] * 2.4)
    x = 470 if "right" in det["lane"] else 300
    box = "#e0b04a" if det["confidence"] < 0.5 else "#7fb0d8"
    d.rectangle([(x - 18, y - 22), (x + 18, y)], outline=box, width=2)
    d.text((x + 24, y - 20), f'{det["class"]} {det["confidence"]:.2f} · {det["distance_m"]} m', fill=box)
d.rectangle([(0, 320), (W, H)], fill="#111417")
d.text((20, 334), f'RIDGELINE VAN 12  |  {v["time"]}  |  {v["road"]}', fill="#e6e8ea")
d.text((20, 360), f'SPEED {v["speed_mph"]} mph   LIMIT {v["speedLimit_mph"]} mph   {v["lighting"].upper()}', fill="#e6e8ea")
d.text((20, 386), f'REMAINING {v["remaining_km"]} km   DUE {v["due"]}   ETA AT LIMITS {v["etaAtLimits"]}', fill="#9aa4ad")
if v["scene"] == "incident":
    d.rectangle([(20, 20), (W - 20, 52)], fill="#5a1d14")
    d.text((32, 30), "VAN STOPPED · IMPACT RECORDED", fill="#ffd6cc")
buf = BytesIO()
img.save(buf, format="PNG")
sys.stdout.buffer.write(buf.getvalue())
