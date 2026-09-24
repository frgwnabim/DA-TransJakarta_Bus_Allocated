"""
Build data untuk dashboard web (web/data/trips.json).

Mengikuti alur transjakarta_enrichment.ipynb (cleaning + granularity enrichment),
lalu menyimpan tiap trip dalam format kolom yang ringkas supaya dashboard bisa
memfilter dan mengagregasi langsung di browser.

Catatan: sebagian tapInTime/tapOutTime hasil Pentaho terpotong (mis. "4/10/2023 17:"),
jadi tanggal & jam diambil pakai regex. Jam tetap utuh. Durasi hanya bisa
dihitung kalau kedua timestamp lengkap, jadi dipakai untuk filter saja (bukan output).

Jalankan:  python scripts/build_dashboard_data.py
"""

import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Data_TransJakarta(Cleaned).csv"
OUT = ROOT / "web" / "data" / "trips.json"

TS_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{0,2})")


def parse_ts(value):
    """Return (year, month, day, hour, minute_or_None) atau None kalau tidak valid."""
    m = TS_RE.match(str(value).strip())
    if not m:
        return None
    month, day, year, hour, minute = m.groups()
    minute = int(minute) if len(minute) == 2 else None
    return int(year), int(month), int(day), int(hour), minute


def main():
    df = pd.read_csv(SRC, sep=";", dtype=str)
    rows_before = len(df)

    for col in df.columns:
        df[col] = df[col].str.strip()

    df = df.dropna(subset=[
        "tapInTime", "tapOutTime", "tapInStops", "tapInStopsName",
        "tapInStopsLat", "tapInStopsLon", "corridorID",
    ])

    tin = df["tapInTime"].map(parse_ts)
    tout = df["tapOutTime"].map(parse_ts)
    df = df[tin.notna() & tout.notna()].copy()
    tin, tout = tin[df.index], tout[df.index]

    df["date"] = [pd.Timestamp(y, mo, d) for y, mo, d, _, _ in tin]
    df["hour"] = [h for _, _, _, h, _ in tin]

    def duration(a, b):
        if a[4] is None or b[4] is None:
            return None
        start = pd.Timestamp(a[0], a[1], a[2], a[3], a[4])
        end = pd.Timestamp(b[0], b[1], b[2], b[3], b[4])
        return (end - start).total_seconds() / 60

    df["dur"] = [duration(a, b) for a, b in zip(tin, tout)]
    # Sama seperti notebook: buang trip dengan durasi negatif/nol (kalau durasinya diketahui)
    df = df[~(df["dur"].notna() & (df["dur"] <= 0))].copy()

    stations = (
        df.groupby("tapInStops")
        .agg(name=("tapInStopsName", "first"),
             lat=("tapInStopsLat", "first"),
             lon=("tapInStopsLon", "first"))
        .reset_index()
    )
    station_idx = {sid: i for i, sid in enumerate(stations["tapInStops"])}

    corridors = (
        df.groupby("corridorID")["corridorName"]
        .agg(lambda s: s.dropna().mode().iat[0] if s.notna().any() else "")
        .reset_index()
    )
    corridor_idx = {cid: i for i, cid in enumerate(corridors["corridorID"])}

    start_date = df["date"].min()
    payload = {
        "meta": {
            "source": SRC.name,
            "rows_raw": rows_before,
            "rows_used": len(df),
            "start_date": start_date.strftime("%Y-%m-%d"),
            "days": int((df["date"].max() - start_date).days) + 1,
        },
        "stations": [
            [r.tapInStops, r.name, round(float(r.lat), 6), round(float(r.lon), 6)]
            for r in stations.itertuples()
        ],
        "corridors": [[r.corridorID, r.corridorName] for r in corridors.itertuples()],
        "trips": {
            "s": [station_idx[v] for v in df["tapInStops"]],
            "c": [corridor_idx[v] for v in df["corridorID"]],
            "d": [int((d - start_date).days) for d in df["date"]],
            "h": df["hour"].astype(int).tolist(),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"Rows raw  : {rows_before:,}")
    print(f"Rows used : {len(df):,}")
    print(f"Stations  : {len(stations):,}  Corridors: {len(corridors):,}")
    print(f"Output    : {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
