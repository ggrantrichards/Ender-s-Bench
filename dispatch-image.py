"""Render the dispatch model's map view (Harbor County CAD) from an observe() view on stdin."""
import io
import json
import sys

from PIL import Image, ImageDraw

state = json.load(sys.stdin)
W, H, CELL, LEFT, TOP = 12, 9, 34, 30, 46
image = Image.new("RGB", (LEFT + W * CELL + 20, TOP + H * CELL + 44), "#f3f1ea")
draw = ImageDraw.Draw(image)
header = state["console"]
mode = header["mode"] + (f'  {header["pack"]}' if header.get("pack") else "")
board = state.get("board")
minute = f'  |  MIN {board["minute"]}' if board else ""
draw.text((LEFT, 12), f'HARBOR COUNTY CAD  |  SHIFT {state["shift"]}  |  MODE {mode}{minute}', fill="#20262b")

DISTRICTS = {"Northgate": "#e6e9df", "Old Quay": "#e2e6ea", "Millbrook": "#ece7dc", "Ferris Point": "#e3e8e1", "Ridgeway": "#eadfd8"}


def district(x, y):
    if y <= 3:
        return "Northgate" if x <= 5 else "Old Quay"
    if y >= 6:
        return "Ferris Point" if x <= 5 else "Ridgeway"
    return "Millbrook"


def cell(x, y):
    return LEFT + x * CELL, TOP + y * CELL


for y in range(H):
    for x in range(W):
        cx, cy = cell(x, y)
        draw.rectangle((cx, cy, cx + CELL - 1, cy + CELL - 1), fill=DISTRICTS[district(x, y)], outline="#c9c5ba")
for name, (x, y) in {"NORTHGATE": (0, 0), "OLD QUAY": (6, 0), "MILLBROOK": (0, 4), "FERRIS PT": (0, 6), "RIDGEWAY": (6, 6)}.items():
    cx, cy = cell(x, y)
    draw.text((cx + 3, cy + 2), name, fill="#8a8578")

for station in state["stations"]:
    cx, cy = cell(station["x"], station["y"])
    draw.rectangle((cx + 6, cy + 6, cx + CELL - 7, cy + CELL - 7), outline="#3c5a78", width=2)
    draw.text((cx + 9, cy + 11), station["id"], fill="#3c5a78")
for hospital in state["hospitals"]:
    cx, cy = cell(hospital["x"], hospital["y"])
    draw.rectangle((cx + 5, cy + 5, cx + CELL - 6, cy + CELL - 6), fill="#ffffff", outline="#9b2d2d", width=2)
    draw.line((cx + CELL // 2, cy + 10, cx + CELL // 2, cy + CELL - 10), fill="#9b2d2d", width=3)
    draw.line((cx + 10, cy + CELL // 2, cx + CELL - 10, cy + CELL // 2), fill="#9b2d2d", width=3)

COLORS = {1: "#c23b22", 2: "#d9902b", 3: "#4f8a4b"}
if board:
    for call in board["calls"]:
        cx, cy = cell(call["x"], call["y"])
        draw.ellipse((cx + 8, cy + 8, cx + CELL - 8, cy + CELL - 8), fill=COLORS[call["priority"]], outline="#20262b")
        draw.text((cx + 1, cy + CELL - 11), call["id"][2:], fill="#20262b")
    for unit in board["units"]:
        cx, cy = cell(unit["x"], unit["y"])
        color = "#1f5f99" if unit["state"] == "available" else "#5b6770"
        draw.polygon([(cx + CELL // 2, cy + 3), (cx + CELL - 4, cy + CELL // 2), (cx + CELL // 2, cy + CELL - 3), (cx + 4, cy + CELL // 2)], fill=color)
        draw.text((cx + 10, cy + 11), unit["id"], fill="#ffffff")
if state.get("queue"):
    cx, cy = cell(6, 7)
    draw.rectangle((cx - 4, cy - 4, cx + 3 * CELL, cy + CELL + 4), fill="#fff4e6", outline="#c23b22", width=2)
    draw.text((cx + 2, cy + 4), f'{state["queue"]["district"].upper()} QUEUE', fill="#c23b22")
    draw.text((cx + 2, cy + 18), f'{state["queue"]["calls"]} calls pending', fill="#20262b")

legend = "P1 red  P2 amber  P3 green  |  diamond: medic unit  |  square: station  |  cross: hospital"
rating = state.get("rating")
draw.text((LEFT, TOP + H * CELL + 12), legend + (f"  |  RATING {rating}" if rating is not None else ""), fill="#4a4f55")
buffer = io.BytesIO()
image.save(buffer, format="PNG")
sys.stdout.buffer.write(buffer.getvalue())
