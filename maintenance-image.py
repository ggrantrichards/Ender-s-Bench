"""Render the maintenance-desk model's screen (Kestrel request list) from an observe() view on stdin."""
import json
import sys
from io import BytesIO

from PIL import Image, ImageDraw

view = json.load(sys.stdin)
W, LEFT, ROW = 900, 20, 26
requests = view.get("requests") or []
backlog = view.get("backlog")
height = 120 + ROW * max(len(requests), 4) + (90 if backlog else 0)
image = Image.new("RGB", (W, height), "#f4f3ef")
draw = ImageDraw.Draw(image)

slots = f'  |  SLOTS LEFT {view["slotsLeft"]}' if view.get("slotsLeft") is not None else ""
draw.rectangle((0, 0, W, 40), fill="#2f3a40")
draw.text((LEFT, 13), f'KESTREL PM  |  MAINTENANCE REQUESTS  |  DAY {view["day"]} OF {view["daysTotal"]}{slots}', fill="#f4f3ef")

y = 56
if view["scene"] == "desk":
    draw.text((LEFT, y), "Between days. Desk files and the next day are available.", fill="#20262b")
    y += ROW
if requests:
    columns = [(LEFT, "ID"), (LEFT + 100, "UNIT"), (LEFT + 250, "CATEGORY"), (LEFT + 350, "REQUEST"), (LEFT + 790, "STATUS")]
    for x, label in columns:
        draw.text((x, y), label, fill="#5b6770")
    y += ROW
    for r in requests:
        color = "#b0421f" if r.get("urgent") else "#20262b"
        text = r["text"] if len(r["text"]) <= 70 else r["text"][:67] + "..."
        for x, value in zip([c[0] for c in columns], [r["id"], r["unit"], r["category"], text, r["status"]]):
            draw.text((x, y), value, fill=color)
        y += ROW
if backlog:
    y += 10
    draw.rectangle((LEFT, y, W - LEFT, y + 70), outline="#b0421f", width=2)
    draw.text((LEFT + 12, y + 10), f'BACKLOG {backlog["total"]}  |  BULK SET {backlog["bulkSet"]} REQUESTS', fill="#b0421f")
    draw.text((LEFT + 12, y + 36), backlog["criteria"], fill="#20262b")

buffer = BytesIO()
image.save(buffer, format="PNG")
sys.stdout.buffer.write(buffer.getvalue())
