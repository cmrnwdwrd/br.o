#!/usr/bin/env python3
import json
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://studio18.radiolize.com/api/nowplaying/109"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OBS = DATA / "observed_history.json"
LIS = DATA / "listener_history.json"
LOCAL_TZ = ZoneInfo("America/Denver")
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
    np = data.get("now_playing") or {}
    items = [{
        "sh_id": np.get("sh_id"),
        "played_at": np.get("played_at"),
        "duration": np.get("duration"),
        "playlist": np.get("playlist"),
        "streamer": np.get("streamer"),
        "is_request": np.get("is_request"),
        "song": np.get("song") or {},
    }]
    items.extend(data.get("song_history") or [])
    for item in items:
        rec = normalize(item)
        if rec["playedAt"] or rec["shId"]:
            by_key[rec["playKey"]] = rec
    plays = sorted(by_key.values(), key=lambda x: x.get("playedAt", 0))
    save_json(OBS, {"updatedAt": datetime.now(timezone.utc).isoformat(), "plays": plays})


def parse_ts(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def local_day(dt):
    return dt.astimezone(LOCAL_TZ).strftime("%Y-%m-%d")


def empty_hour_bins():
    return [{"hour": h, "sum": 0, "count": 0, "min": None, "max": None} for h in range(24)]


def add_hour_sample(bins, dt, value):
    h = dt.astimezone(LOCAL_TZ).hour
    b = bins[h]
    b["sum"] += value
    b["count"] += 1
    b["min"] = value if b["min"] is None else min(b["min"], value)
    b["max"] = value if b["max"] is None else max(b["max"], value)


def merge_daily_summary(target, date_key, values):
    if not values:
        return
    current = target.get(date_key, {"date": date_key, "min": None, "max": None, "sum": 0, "count": 0})
    current["sum"] += sum(values)
    current["count"] += len(values)
    vmin, vmax = min(values), max(values)
    current["min"] = vmin if current["min"] is None else min(current["min"], vmin)
    current["max"] = vmax if current["max"] is None else max(current["max"], vmax)
    current["avg"] = current["sum"] / current["count"] if current["count"] else 0
    target[date_key] = current


def summarize_samples(samples):
    days = {}
    for s in samples:
        try:
            dt = parse_ts(s["timestamp"])
            value = int(s["listeners"])
        except Exception:
            continue
        key = local_day(dt)
        days.setdefault(key, []).append(value)
    out = {}
    for key, vals in days.items():
        out[key] = {
            "date": key,
            "min": min(vals),
            "max": max(vals),
            "sum": sum(vals),
            "count": len(vals),
            "avg": sum(vals) / len(vals),
        }
    return out


def compute_records(old_daily, recent_samples, existing_all_max):
    all_days = {d["date"]: dict(d) for d in old_daily if d.get("date")}
    for key, d in summarize_samples(recent_samples).items():
        all_days[key] = d

    day_values = list(all_days.values())
    highest_avg = max(day_values, key=lambda d: d.get("avg", 0), default=None)
    highest_daily_max = max(day_values, key=lambda d: d.get("max", 0), default=None)

    return {
        "allTimeMax": existing_all_max,
        "highestDailyAverage": highest_avg,
        "highestDailyMax": highest_daily_max,
        "daysRecorded": len(day_values),
    }


def collect_listeners(data):
    raw = load_json(LIS, {})
    if isinstance(raw, list):
        raw = {"samples": raw}

    # Migrate v24/v25 schema where all detailed samples lived under "samples".
    recent_samples = list(raw.get("recentSamples") or raw.get("samples") or [])
    old_daily = list(raw.get("dailySummaries") or [])
    old_map = {d.get("date"): dict(d) for d in old_daily if d.get("date")}

    now = datetime.now(timezone.utc)
    count = data.get("listeners", {}).get("current")

    # All-time max survives detailed-sample pruning.
    all_time_max = raw.get("allTimeMax")
    if isinstance(count, (int, float)):
        value = int(count)
        sample = {"timestamp": now.isoformat(), "listeners": value}
        recent_samples.append(sample)
        if (
            not isinstance(all_time_max, dict)
            or value > int(all_time_max.get("listeners", -1))
        ):
            all_time_max = {"listeners": value, "timestamp": now.isoformat()}

    # Initialize all-time hourly bins from any pre-v26 samples exactly once.
    bins = raw.get("hourBins")
    if not isinstance(bins, list) or len(bins) != 24:
        bins = empty_hour_bins()
        for s in recent_samples:
            try:
                add_hour_sample(bins, parse_ts(s["timestamp"]), int(s["listeners"]))
            except Exception:
                pass
    elif isinstance(count, (int, float)):
        add_hour_sample(bins, now, int(count))

    cutoff = now - timedelta(days=90)
    keep = []
    expired_by_day = {}
    for s in recent_samples:
        try:
            dt = parse_ts(s["timestamp"])
            value = int(s["listeners"])
        except Exception:
            continue
        if dt >= cutoff:
            keep.append(s)
        else:
            expired_by_day.setdefault(local_day(dt), []).append(value)

    # Compress samples older than 90 days into daily summaries.
    for key, vals in expired_by_day.items():
        merge_daily_summary(old_map, key, vals)

    daily_summaries = sorted(old_map.values(), key=lambda d: d["date"])
    records = compute_records(daily_summaries, keep, all_time_max)

    doc = {
        "schemaVersion": 26,
        "updatedAt": now.isoformat(),
        "recentSamples": keep,
        # Keep this alias for old clients while transitioning.
        "samples": keep,
        "dailySummaries": daily_summaries,
        "hourBins": bins,
        "allTimeMax": all_time_max,
        "records": records,
    }
    save_json(LIS, doc)


def main():
    data = fetch_nowplaying()
    collect_observed(data)
    collect_listeners(data)


if __name__ == "__main__":
    main()
