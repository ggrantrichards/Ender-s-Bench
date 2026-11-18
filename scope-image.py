"""Render the model's optical display from the same board state as the browser."""
import io
import json
import sys

from PIL import Image, ImageDraw

state = json.load(sys.stdin)
image = Image.new("RGB", (504, 392), "#101713")
draw = ImageDraw.Draw(image)
draw.text((26, 13), f'BREAKWATER  |  OPTICAL SCOPE  |  SECTOR {state["sector"]}', fill="#e6edda")
battle = state["battle"]
wings = battle.get("wings", [])

def position(lane, row):
    return 53 + 29 * lane, 55 + 21 * row

for row in range(14):
    left, y = position(0, row)
    right, _ = position(14, row)
    draw.line((left, y, right, y), fill="#38463b")
    draw.text((20, y - 6), str(row), fill="#9daf9a")

for lane in range(15):
    x, y = position(lane, 0)
    draw.line((x, y, x, position(lane, 13)[1]), fill="#38463b")
    draw.text((x - 4, 35), str(lane), fill="#e4eddb")

def ship(x, y, color, down=False):
    direction = -1 if down else 1
    draw.polygon([(x, y - direction * 6), (x + 6, y + direction * 4),
                  (x, y + direction), (x - 6, y + direction * 4)],
                 fill="#101713", outline=color)

for track in [*battle["contacts"], battle["secondary"], battle["terminalTrack"]]:
    if not track:
        continue
    x, y = position(track["x"], track["y"])
    if track.get("kind") == "planet":
        draw.ellipse((x - 28, y - 28, x + 28, y + 28), fill="#555344", outline="#d6c5a4")
        draw.arc((x - 20, y - 24, x + 20, y + 24), 115, 279, fill="#a69576", width=2)
        draw.text((x - 20, y + 30), track["id"], fill="#e4eddb")
        continue
    if wings:
        ship(x, y, "#ecc29f", down=True)
    else:
        draw.rectangle((x - 2, y - 2, x + 2, y + 2), fill="#f0ecd5")
        draw.rectangle((x - 5, y - 5, x + 5, y + 5), outline="#829582")
    draw.text((x - 11, y + 6), track["id"], fill="#e4eddb")

for index, wing in enumerate(wings):
    if not wing["ships"]:
        continue
    x, y = position(wing["x"], wing["y"])
    y += 9 if index else -9
    color = "#94c7eb" if wing["id"] == "blue" else "#f0d48b"
    route = wing.get("route", [])
    if route:
        points = [(x, y), *[position(point["x"], point["y"]) for point in route]]
        draw.line(points, fill=color, width=1)
        wx, wy = points[-1]
        draw.rectangle((wx - 4, wy - 4, wx + 4, wy + 4), outline=color)
    for i in range(wing["ships"]):
        ship(x + (-7 if i == 0 else 7), y, color)
    draw.text((x - 10, y + 8), wing["id"].upper(), fill=color)

for shot in battle["incoming"]:
    x, y = position(shot["x"], shot["y"])
    draw.line((x, y - 3, x, y + 3), fill="#f0a290", width=2)

for name, lane, delta, color in [
    ("OWN", battle["playerX"], 9, "#ccedda"), ("ESC", 7, 23, "#e6cc94"),
]:
    if not state["hull" if name == "OWN" else "escort"]:
        continue
    x, y = position(lane, 13)
    if wings:
        ship(x, y + delta - 12, color)
    else:
        draw.line((x - 6, y, x + 6, y), fill=color, width=2)
    draw.text((x - 10, y + delta), name, fill=color)

draw.text((26, 373), f'TURN {battle["turn"]}  HULL {state["hull"]}/5  ESCORT {state["escort"]}/5  SCORE {state["score"]}', fill="#e4eddb")
buffer = io.BytesIO()
image.resize((392, 305)).save(buffer, format="PNG")
sys.stdout.buffer.write(buffer.getvalue())
