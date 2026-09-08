#!/usr/bin/env python3
import json
import math
import os
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

API = "https://studio18.radiolize.com/api/nowplaying/109"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OBS = DATA / "observed_history.json"
LIS = DATA / "listener_history.json"
SVG = DATA / "listeners_90d.svg"

DATA.mkdir(parents=True, exist_ok=True)

def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def fetch_nowplaying():
    req = urllib.request.Request(API, headers={"User-Agent": "BottleRag-GitHub-History/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))

def normalize(item):
    song = item.get("song") or {}
    played = int(item.get("played_at") or 0)
    sh = item.get("sh_id")
    duration = int(item.get("duration") or 0)
    artist = song.get("artist") or ""
    title = song.get("title") or "Unknown"
    key = f"sh:{sh}" if sh else f"fallback:{played}|{artist}|{title}|{duration}"
    return {
        "playKey": key,
        "shId": sh,
        "songId": song.get("id"),
        "artist": artist,
        "title": title,
        "album": song.get("album") or "",
        "genre": song.get("genre") or "",
        "art": song.get("art") or "",
        "duration": duration,
        "playedAt": played,
        "playlist": item.get("playlist") or "",
        "streamer": item.get("streamer") or "",
        "isRequest": bool(item.get("is_request")),
    }

def collect_observed(data):
    existing = load_json(OBS, {"updatedAt": None, "plays": []})
    if isinstance(existing, list):
        existing = {"updatedAt": None, "plays": existing}
    by_key = {p.get("playKey"): p for p in existing.get("plays", []) if p.get("playKey")}
    items = []
    np = data.get("now_playing") or {}
    items.append({
        "sh_id": np.get("sh_id"), "played_at": np.get("played_at"), "duration": np.get("duration"),
        "playlist": np.get("playlist"), "streamer": np.get("streamer"), "is_request": np.get("is_request"),
        "song": np.get("song") or {},
    })
    items.extend(data.get("song_history") or [])
    for item in items:
        rec = normalize(item)
        if rec["playedAt"] or rec["shId"]:
            by_key[rec["playKey"]] = rec
    plays = sorted(by_key.values(), key=lambda x: x.get("playedAt", 0))
    save_json(OBS, {"updatedAt": datetime.now(timezone.utc).isoformat(), "plays": plays})

def collect_listeners(data):
    doc = load_json(LIS, {"updatedAt": None, "samples": []})
    if isinstance(doc, list):
        doc = {"updatedAt": None, "samples": doc}
    samples = doc.get("samples", [])
    now = datetime.now(timezone.utc)
    count = data.get("listeners", {}).get("total")
    if not isinstance(count, (int, float)):
        count = data.get("listeners", {}).get("current")
    if isinstance(count, (int, float)):
        samples.append({"timestamp": now.isoformat(), "listeners": int(count)})
    cutoff = now - timedelta(days=90)
    kept = []
    for s in samples:
        try:
            dt = datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00"))
            if dt >= cutoff:
                kept.append(s)
        except Exception:
            pass
    save_json(LIS, {"updatedAt": now.isoformat(), "samples": kept})
    return kept

def nice_max(v):
    if v <= 1: return 1
    mag = 10 ** math.floor(math.log10(v))
    n = v / mag
    step = 1 if n <= 1 else 2 if n <= 2 else 5 if n <= 5 else 10
    return step * mag

def make_svg(samples):
    W, H = 1100, 360
    L, R, T, B = 58, 20, 24, 46
    plot_w, plot_h = W-L-R, H-T-B
    if not samples:
        SVG.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" fill="#aaa" text-anchor="middle" font-family="system-ui">No listener samples yet</text></svg>', encoding="utf-8")
        return
    parsed=[]
    for s in samples:
        try:
            dt=datetime.fromisoformat(s["timestamp"].replace("Z","+00:00"))
            parsed.append((dt, int(s["listeners"])))
        except Exception: pass
    if not parsed: return
    parsed.sort()
    x0,x1=parsed[0][0].timestamp(),parsed[-1][0].timestamp()
    if x1<=x0: x1=x0+1
    ymax=max(1,nice_max(max(v for _,v in parsed)))
    pts=[]
    for dt,v in parsed:
        x=L+(dt.timestamp()-x0)/(x1-x0)*plot_w
        y=T+plot_h-(v/ymax)*plot_h
        pts.append(f"{x:.1f},{y:.1f}")
    avg=sum(v for _,v in parsed)/len(parsed)
    mn=min(v for _,v in parsed); mx=max(v for _,v in parsed)
    # grid + labels
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           '<rect width="100%" height="100%" fill="#111"/>',
           '<g font-family="system-ui,-apple-system,Segoe UI,sans-serif" fill="#aaa" font-size="13">']
    for i in range(5):
        val=ymax*(4-i)/4
        y=T+plot_h*i/4
        parts.append(f'<line x1="{L}" y1="{y:.1f}" x2="{W-R}" y2="{y:.1f}" stroke="#333" stroke-width="1"/>')
        parts.append(f'<text x="{L-9}" y="{y+4:.1f}" text-anchor="end">{val:g}</text>')
    # date labels at 0, 1/2, 1
    for frac in (0,.5,1):
        ts=x0+(x1-x0)*frac
        dt=datetime.fromtimestamp(ts,timezone.utc)
        x=L+plot_w*frac
        parts.append(f'<text x="{x:.1f}" y="{H-16}" text-anchor="middle">{escape(dt.strftime("%b %d"))}</text>')
    parts.append('</g>')
    parts.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#f3f3f3" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>')
    parts.append(f'<text x="{L}" y="17" fill="#f3f3f3" font-family="system-ui" font-size="14">Samples: {len(parsed)} · Min {mn} · Avg {avg:.1f} · Max {mx}</text>')
    parts.append('</svg>')
    SVG.write_text("".join(parts), encoding="utf-8")

def main():
    data = fetch_nowplaying()
    collect_observed(data)
    samples = collect_listeners(data)
    make_svg(samples)

if __name__ == "__main__":
    main()
