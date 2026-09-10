#!/usr/bin/env python3
import json
import math
import statistics
import os
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://studio18.radiolize.com/api/nowplaying/109"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OBS_LEGACY = DATA / "observed_history.json"
OBS_DIR = DATA / "observed"
STATS_DIR = DATA / "stats"
OBS_AGG = STATS_DIR / "observed_aggregates.json"
OBS_TOP = STATS_DIR / "observed_top50.json"
PLAYLIST_SCHEDULE = STATS_DIR / "playlist_schedule.json"
LIS = DATA / "listener_history.json"
LOCAL_TZ = ZoneInfo("America/Denver")
DATA.mkdir(parents=True, exist_ok=True)
OBS_DIR.mkdir(parents=True, exist_ok=True)
STATS_DIR.mkdir(parents=True, exist_ok=True)


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
        "playlist": " ".join(str(item.get("playlist") or "").split()),
        "streamer": item.get("streamer") or "",
        "isRequest": bool(item.get("is_request")),
    }


def is_unknown_record(rec):
    title = (rec.get("title") or "").strip().lower()
    artist = (rec.get("artist") or "").strip().lower()
    return title == "unknown" or (not artist and (not title or title == "unknown"))


def month_key_from_played_at(played_at):
    try:
        dt = datetime.fromtimestamp(int(played_at), timezone.utc).astimezone(LOCAL_TZ)
    except Exception:
        dt = datetime.now(LOCAL_TZ)
    return dt.strftime("%Y-%m")


def month_path(month_key):
    return OBS_DIR / f"{month_key}.json"


def blank_aggregates():
    return {
        "schemaVersion": 31,
        "updatedAt": None,
        "totalPlays": 0,
        "unknownPlays": 0,
        "firstObserved": None,
        "lastObserved": None,
        "songs": {},
        "artists": {},
        "albums": {},
        "playlists": {},
    }


def bump_first_last(obj, ts):
    if not ts:
        return
    obj["first"] = ts if not obj.get("first") else min(int(obj["first"]), ts)
    obj["last"] = ts if not obj.get("last") else max(int(obj["last"]), ts)


def bump_track_summary(container, key, rec):
    ts = int(rec.get("playedAt") or 0)
    if key not in container:
        container[key] = {
            "artist": rec.get("artist") or "",
            "title": rec.get("title") or "Unknown",
            "album": rec.get("album") or "",
            "count": 0,
            "first": None,
            "last": None,
            "playlists": {},
        }
    x = container[key]
    x["count"] += 1
    # Keep useful metadata if an earlier play lacked it.
    if not x.get("artist") and rec.get("artist"):
        x["artist"] = rec.get("artist")
    if not x.get("album") and rec.get("album"):
        x["album"] = rec.get("album")
    playlist = " ".join(str(rec.get("playlist") or "").split())
    if playlist:
        x.setdefault("playlists", {})
        x["playlists"][playlist] = int(x["playlists"].get(playlist) or 0) + 1
    bump_first_last(x, ts)


def add_to_aggregates(agg, rec):
    ts = int(rec.get("playedAt") or 0)
    if is_unknown_record(rec):
        agg["unknownPlays"] = int(agg.get("unknownPlays") or 0) + 1
        return

    agg["totalPlays"] = int(agg.get("totalPlays") or 0) + 1
    if ts:
        agg["firstObserved"] = ts if not agg.get("firstObserved") else min(int(agg["firstObserved"]), ts)
        agg["lastObserved"] = ts if not agg.get("lastObserved") else max(int(agg["lastObserved"]), ts)

    artist = (rec.get("artist") or "Unknown artist").strip() or "Unknown artist"
    album = (rec.get("album") or "Unknown album").strip() or "Unknown album"
    track_key = ((rec.get("artist") or "").strip().lower() + "|" + (rec.get("title") or "").strip().lower())
    artist_key = artist.lower()
    album_key = artist_key + "|" + album.lower()

    bump_track_summary(agg["songs"], track_key, rec)

    if artist_key not in agg["artists"]:
        agg["artists"][artist_key] = {
            "artist": artist,
            "count": 0,
            "first": None,
            "last": None,
            "songs": {},
        }
    ar = agg["artists"][artist_key]
    ar["count"] += 1
    bump_first_last(ar, ts)
    bump_track_summary(ar["songs"], track_key, rec)

    if album_key not in agg["albums"]:
        agg["albums"][album_key] = {
            "artist": artist,
            "album": album,
            "count": 0,
            "first": None,
            "last": None,
            "songs": {},
        }
    al = agg["albums"][album_key]
    al["count"] += 1
    bump_first_last(al, ts)
    bump_track_summary(al["songs"], track_key, rec)

    playlist = " ".join(str(rec.get("playlist") or "").split())
    if playlist:
        playlist_key = playlist.lower()
        if playlist_key not in agg["playlists"]:
            agg["playlists"][playlist_key] = {
                "playlist": playlist,
                "count": 0,
                "first": None,
                "last": None,
                "songs": {},
            }
        pl = agg["playlists"][playlist_key]
        pl["count"] += 1
        bump_first_last(pl, ts)
        bump_track_summary(pl["songs"], track_key, rec)


def sorted_track_items(mapping, limit=50):
    items = list(mapping.values())
    items.sort(key=lambda x: (-int(x.get("count") or 0), -int(x.get("last") or 0), (x.get("title") or "").lower()))
    return items[:limit]


def build_top50(agg):
    artists = list(agg.get("artists", {}).values())
    artists.sort(key=lambda x: (-int(x.get("count") or 0), -int(x.get("last") or 0), (x.get("artist") or "").lower()))
    top_artists = []
    for a in artists[:50]:
        top_artists.append({
            "artist": a.get("artist") or "Unknown artist",
            "count": int(a.get("count") or 0),
            "first": a.get("first"),
            "last": a.get("last"),
            "songs": sorted_track_items(a.get("songs", {}), 50),
        })

    albums = list(agg.get("albums", {}).values())
    albums.sort(key=lambda x: (-int(x.get("count") or 0), -int(x.get("last") or 0), (x.get("album") or "").lower()))
    top_albums = []
    for a in albums[:50]:
        top_albums.append({
            "artist": a.get("artist") or "",
            "album": a.get("album") or "Unknown album",
            "count": int(a.get("count") or 0),
            "first": a.get("first"),
            "last": a.get("last"),
            "songs": sorted_track_items(a.get("songs", {}), 50),
        })

    playlists = list(agg.get("playlists", {}).values())
    playlists.sort(key=lambda x: (
        -int(x.get("count") or 0),
        -int(x.get("last") or 0),
        (x.get("playlist") or "").lower()
    ))
    top_playlists = []
    for a in playlists[:10]:
        top_playlists.append({
            "playlist": a.get("playlist") or "Unspecified",
            "count": int(a.get("count") or 0),
            "first": a.get("first"),
            "last": a.get("last"),
            "songs": sorted_track_items(a.get("songs", {}), 5),
        })

    return {
        "schemaVersion": 31,
        "updatedAt": agg.get("updatedAt"),
        "summary": {
            "totalPlays": int(agg.get("totalPlays") or 0),
            "unknownPlays": int(agg.get("unknownPlays") or 0),
            "uniqueTracks": len(agg.get("songs", {})),
            "uniqueArtists": len(agg.get("artists", {})),
            "uniqueAlbums": len(agg.get("albums", {})),
            "uniquePlaylists": len(agg.get("playlists", {})),
            "firstObserved": agg.get("firstObserved"),
            "lastObserved": agg.get("lastObserved"),
        },
        "topSongs": sorted_track_items(agg.get("songs", {}), 50),
        "topArtists": top_artists,
        "topAlbums": top_albums,
        "topPlaylists": top_playlists,
    }


def migrate_legacy_if_needed(agg, force=False):
    # One-time migration/rebuild from any existing monthly archives and the old
    # ever-growing observed_history.json. This preserves accumulated history.
    if OBS_AGG.exists() and not force:
        return agg

    # Rebuild from monthly files first, if any already exist.
    archived_keys = set()
    for path in sorted(OBS_DIR.glob("????-??.json")):
        doc = load_json(path, {"plays": []})
        plays = doc if isinstance(doc, list) else doc.get("plays", [])
        for rec in plays:
            key = rec.get("playKey")
            if not key or key in archived_keys:
                continue
            archived_keys.add(key)
            add_to_aggregates(agg, rec)

    # Then import legacy plays that are not already in monthly files.
    legacy = load_json(OBS_LEGACY, {"plays": []})
    legacy_plays = legacy if isinstance(legacy, list) else legacy.get("plays", [])
    month_maps = {}
    for rec in legacy_plays:
        key = rec.get("playKey")
        if not key or key in archived_keys:
            continue
        month = month_key_from_played_at(rec.get("playedAt"))
        if month not in month_maps:
            existing = load_json(month_path(month), {"plays": []})
            existing_plays = existing if isinstance(existing, list) else existing.get("plays", [])
            month_maps[month] = {p.get("playKey"): p for p in existing_plays if p.get("playKey")}
        if key not in month_maps[month]:
            month_maps[month][key] = rec
            archived_keys.add(key)
            add_to_aggregates(agg, rec)

    for month, mapping in month_maps.items():
        plays_out = sorted(mapping.values(), key=lambda x: int(x.get("playedAt") or 0))
        save_json(month_path(month), {"month": month, "plays": plays_out})

    return agg


def collect_observed(data):
    raw_agg = load_json(OBS_AGG, None)
    valid_agg = isinstance(raw_agg, dict) and raw_agg.get("schemaVersion") == 31
    agg = raw_agg if valid_agg else blank_aggregates()
    agg = migrate_legacy_if_needed(agg, force=not valid_agg)

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

    changed_months = {}
    for item in items:
        rec = normalize(item)
        if not (rec["playedAt"] or rec["shId"]):
            continue
        month = month_key_from_played_at(rec["playedAt"])
        if month not in changed_months:
            existing = load_json(month_path(month), {"plays": []})
            existing_plays = existing if isinstance(existing, list) else existing.get("plays", [])
            changed_months[month] = {p.get("playKey"): p for p in existing_plays if p.get("playKey")}
        mapping = changed_months[month]
        if rec["playKey"] not in mapping:
            mapping[rec["playKey"]] = rec
            add_to_aggregates(agg, rec)
        else:
            # Refresh metadata without double-counting the play.
            mapping[rec["playKey"]] = rec

    for month, mapping in changed_months.items():
        plays_out = sorted(mapping.values(), key=lambda x: int(x.get("playedAt") or 0))
        save_json(month_path(month), {"month": month, "plays": plays_out})

    agg["schemaVersion"] = 31
    agg["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_json(OBS_AGG, agg)
    save_json(OBS_TOP, build_top50(agg))
    build_playlist_schedule()



def normalize_playlist_name(value):
    return " ".join(str(value or "").split())


def circular_typical_minute(values):
    """Typical minute-of-day, handling values around midnight."""
    if not values:
        return None
    angles = [2 * math.pi * (v % 1440) / 1440 for v in values]
    x = sum(math.cos(a) for a in angles) / len(angles)
    y = sum(math.sin(a) for a in angles) / len(angles)
    if abs(x) < 1e-9 and abs(y) < 1e-9:
        return int(round(statistics.median(values))) % 1440
    angle = math.atan2(y, x)
    if angle < 0:
        angle += 2 * math.pi
    return int(round(angle * 1440 / (2 * math.pi))) % 1440


def circular_distance_minutes(a, b):
    d = abs((a % 1440) - (b % 1440))
    return min(d, 1440 - d)


def schedule_confidence(session_count, start_minutes):
    if session_count <= 1 or not start_minutes:
        return "Low"
    typical = circular_typical_minute(start_minutes)
    spread = sum(circular_distance_minutes(v, typical) for v in start_minutes) / len(start_minutes)
    if session_count >= 6 and spread <= 35:
        return "High"
    if session_count >= 3 and spread <= 75:
        return "Medium"
    return "Low"


def add_session_heat_minutes(heat, start_ts, end_ts):
    """Add exact overlapping minutes to local weekday/hour bins."""
    cursor = datetime.fromtimestamp(start_ts, timezone.utc)
    end = datetime.fromtimestamp(end_ts, timezone.utc)
    guard = 0
    while cursor < end and guard < 200:
        guard += 1
        local = cursor.astimezone(LOCAL_TZ)
        next_local_hour = (local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
        boundary = next_local_hour.astimezone(timezone.utc)
        if boundary <= cursor:
            boundary = cursor + timedelta(hours=1)
        segment_end = min(end, boundary)
        minutes = max(0.0, (segment_end - cursor).total_seconds() / 60)
        heat[local.weekday()][local.hour] += minutes
        cursor = segment_end



def add_session_quarter_minutes(heat, start_ts, end_ts):
    """Add exact overlapping minutes to local weekday/15-minute bins."""
    cursor = datetime.fromtimestamp(start_ts, timezone.utc)
    end = datetime.fromtimestamp(end_ts, timezone.utc)
    guard = 0
    while cursor < end and guard < 500:
        guard += 1
        local = cursor.astimezone(LOCAL_TZ)
        quarter_minute = (local.minute // 15) * 15
        quarter_start_local = local.replace(minute=quarter_minute, second=0, microsecond=0)
        next_quarter_local = quarter_start_local + timedelta(minutes=15)
        boundary = next_quarter_local.astimezone(timezone.utc)
        if boundary <= cursor:
            boundary = cursor + timedelta(minutes=15)
        segment_end = min(end, boundary)
        minutes = max(0.0, (segment_end - cursor).total_seconds() / 60)
        slot = local.hour * 4 + (local.minute // 15)
        heat[local.weekday()][slot] += minutes
        cursor = segment_end



def bridge_short_playlist_interruptions(sessions, max_interrupt_tracks=2, max_interrupt_seconds=10*60):
    """
    Merge A -> short B -> A into one A session when the interruption is no more
    than max_interrupt_tracks and max_interrupt_seconds. Repeat until stable.
    """
    sessions = [dict(s) for s in sessions]
    changed = True
    while changed and len(sessions) >= 3:
        changed = False
        out = []
        i = 0
        while i < len(sessions):
            if i + 2 < len(sessions):
                a, b, c = sessions[i], sessions[i+1], sessions[i+2]
                b_duration = max(0, b["end"] - b["start"])
                if (
                    a["playlistKey"] == c["playlistKey"]
                    and b["playlistKey"] != a["playlistKey"]
                    and int(b.get("playCount", 0)) <= max_interrupt_tracks
                    and b_duration <= max_interrupt_seconds
                ):
                    merged = dict(a)
                    merged["end"] = max(c["end"], b["end"], a["end"])
                    merged["lastTrackStart"] = max(c.get("lastTrackStart", c["start"]), a.get("lastTrackStart", a["start"]))
                    merged["playCount"] = int(a.get("playCount", 0)) + int(b.get("playCount", 0)) + int(c.get("playCount", 0))
                    out.append(merged)
                    i += 3
                    changed = True
                    continue
            out.append(sessions[i])
            i += 1
        sessions = out
    return sessions


def build_playlist_schedule():
    """
    Infer playlist sessions from the rolling last 90 days of observed plays.
    The raw monthly archives stay server-side; the browser receives only this
    compact derived file.
    """
    now = datetime.now(timezone.utc)
    cutoff_ts = int((now - timedelta(days=90)).timestamp())

    records = []
    for path in sorted(OBS_DIR.glob("????-??.json")):
        doc = load_json(path, {"plays": []})
        plays = doc if isinstance(doc, list) else doc.get("plays", [])
        for rec in plays:
            try:
                ts = int(rec.get("playedAt") or 0)
            except Exception:
                continue
            if ts < cutoff_ts:
                continue
            playlist = normalize_playlist_name(rec.get("playlist"))
            if not playlist:
                continue
            duration = max(0, int(rec.get("duration") or 0))
            records.append({
                "playedAt": ts,
                "duration": duration,
                "playlist": playlist,
                "playlistKey": playlist.lower(),
            })

    records.sort(key=lambda r: r["playedAt"])

    sessions = []
    current = None
    max_same_playlist_gap = 45 * 60

    for rec in records:
        ts = rec["playedAt"]
        track_end = ts + (rec["duration"] if rec["duration"] > 0 else 180)

        if (
            current
            and rec["playlistKey"] == current["playlistKey"]
            and ts - current["lastTrackStart"] <= max_same_playlist_gap
        ):
            current["lastTrackStart"] = ts
            current["end"] = max(current["end"], track_end)
            current["playCount"] += 1
            continue

        if current:
            sessions.append(current)

        current = {
            "playlist": rec["playlist"],
            "playlistKey": rec["playlistKey"],
            "start": ts,
            "end": track_end,
            "lastTrackStart": ts,
            "playCount": 1,
        }

    if current:
        sessions.append(current)

    # If a following playlist starts before the estimated final-track end,
    # clamp the prior session so sessions never overlap.
    sessions.sort(key=lambda s: s["start"])
    for i in range(len(sessions) - 1):
        sessions[i]["end"] = min(sessions[i]["end"], sessions[i + 1]["start"])
        sessions[i]["end"] = max(sessions[i]["end"], sessions[i]["start"] + 60)

    sessions = bridge_short_playlist_interruptions(sessions)
    sessions.sort(key=lambda s: s["start"])
    for i in range(len(sessions) - 1):
        sessions[i]["end"] = min(sessions[i]["end"], sessions[i + 1]["start"])
        sessions[i]["end"] = max(sessions[i]["end"], sessions[i]["start"] + 60)

    by_playlist = {}
    for s in sessions:
        p = by_playlist.setdefault(s["playlistKey"], {
            "playlist": s["playlist"],
            "sessions": [],
            "playCount": 0,
        })
        p["sessions"].append(s)
        p["playCount"] += s["playCount"]
        # Prefer the latest capitalization/spelling seen.
        p["playlist"] = s["playlist"]

    playlist_rows = []
    for p in by_playlist.values():
        ss = sorted(p["sessions"], key=lambda s: s["start"])
        heat = [[0.0 for _ in range(24)] for _ in range(7)]
        quarter_heat = [[0.0 for _ in range(96)] for _ in range(7)]
        start_heat = [[0 for _ in range(24)] for _ in range(7)]
        day_groups = {d: [] for d in range(7)}
        start_minutes_all = []
        durations_all = []

        for s in ss:
            start_local = datetime.fromtimestamp(s["start"], timezone.utc).astimezone(LOCAL_TZ)
            end_ts = max(s["end"], s["start"] + 60)
            duration_min = max(1.0, (end_ts - s["start"]) / 60)
            start_minute = start_local.hour * 60 + start_local.minute

            start_minutes_all.append(start_minute)
            durations_all.append(duration_min)
            day_groups[start_local.weekday()].append((start_minute, duration_min, s))
            start_heat[start_local.weekday()][start_local.hour] += 1
            add_session_heat_minutes(heat, s["start"], end_ts)
            add_session_quarter_minutes(quarter_heat, s["start"], end_ts)

        likely_windows = []
        for weekday in range(7):
            group = day_groups[weekday]
            if not group:
                continue
            starts = [x[0] for x in group]
            durations = [x[1] for x in group]
            likely_windows.append({
                "weekday": weekday,
                "sessions": len(group),
                "typicalStartMinute": circular_typical_minute(starts),
                "typicalDurationMinutes": int(round(statistics.median(durations))),
                "confidence": schedule_confidence(len(group), starts),
            })

        recent_sessions = []
        for s in reversed(ss[-20:]):
            recent_sessions.append({
                "start": s["start"],
                "end": s["end"],
                "durationMinutes": int(round(max(1, (s["end"] - s["start"]) / 60))),
                "playCount": s["playCount"],
            })

        playlist_rows.append({
            "playlist": p["playlist"],
            "sessionCount": len(ss),
            "playCount": p["playCount"],
            "firstObserved": ss[0]["start"] if ss else None,
            "lastObserved": ss[-1]["start"] if ss else None,
            "typicalStartMinute": circular_typical_minute(start_minutes_all),
            "typicalDurationMinutes": int(round(statistics.median(durations_all))) if durations_all else None,
            "confidence": schedule_confidence(len(ss), start_minutes_all),
            "heatmapMinutes": [[round(v, 1) for v in row] for row in heat],
            "quarterHeatmapMinutes": [[round(v, 1) for v in row] for row in quarter_heat],
            "startHeatmap": start_heat,
            "likelyWindows": likely_windows,
            "recentSessions": recent_sessions,
        })

    playlist_rows.sort(key=lambda p: (-p["sessionCount"], -p["playCount"], p["playlist"].lower()))

    doc = {
        "schemaVersion": 1,
        "updatedAt": now.isoformat(),
        "timezone": "America/Denver",
        "windowDays": 90,
        "summary": {
            "playlistCount": len(playlist_rows),
            "sessionCount": sum(p["sessionCount"] for p in playlist_rows),
            "firstObserved": min((p["firstObserved"] for p in playlist_rows if p["firstObserved"]), default=None),
            "lastObserved": max((p["lastObserved"] for p in playlist_rows if p["lastObserved"]), default=None),
        },
        "playlists": playlist_rows,
    }
    save_json(PLAYLIST_SCHEDULE, doc)

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
    source = os.environ.get("BOTTLERAG_COLLECTOR_SOURCE", "primary")

    # All-time max survives detailed-sample pruning.
    all_time_max = raw.get("allTimeMax")
    if isinstance(count, (int, float)):
        value = int(count)
        sample = {"timestamp": now.isoformat(), "listeners": value, "source": source}
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
        "lastSampleSource": source,
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
