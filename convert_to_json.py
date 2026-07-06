#!/usr/bin/env python3
"""
convert_to_json.py

Converts the "SUM" sheet of the SURRO IPR workbook into dealers.json,
the data file consumed by index.html (the Dealer Network Console).

Usage:
    python3 convert_to_json.py "Copy_of_SURRO_-_SOLAPUR__IPR_June_2026.xlsx" dealers.json

If no arguments are given, it defaults to reading "input.xlsx" from the
current folder and writing "dealers.json" next to it.

Requires: pandas, openpyxl
    pip install pandas openpyxl
"""

import sys
import math
import json
import pandas as pd


# Columns to pull from the SUM sheet, in order, and the clean field names
# they map to in the output JSON. Update this list if a future workbook
# adds/renames/reorders columns on the SUM sheet.
SUM_SHEET_NAME = "SUM"
SUM_HEADER_ROW = 1  # 0-indexed; the real header is on the 2nd row of the sheet

COLUMN_MAP = {
    "OMC": "omc",
    "SA": "sa",
    "CN": "cn",
    "DEALERSHIP NAME": "name",
    "LOCATION": "location",
    "DIST": "dist",
    "Class of \nMarket": "mclass",
    "Trading Area": "tarea",
    "Major \nNH No.": "nh",
    "YEAR \nCOMM.": "yearcomm",
    "U R H": "urh",
    "MS-C": "msC",
    "MS-H": "msH",
    "%": "msPct",
    "HSD-C": "hsdC",
    "HSD-H": "hsdH",
    "%.1": "hsdPct",
    "MS CUMM-C": "msCumC",
    "MS CUMM-H": "msCumH",
    "%.2": "msCumPct",
    "HSD CUMM-C": "hsdCumC",
    "HSD CUMM-H": "hsdCumH",
    "%.3": "hsdCumPct",
}

# String values that mean "not actually a value" in this workbook
# (placeholder zeros, dashes, stray "None"/"DDD" text, etc.)
BLANK_STRINGS = {"0", "-", "none", "nan", "ddd", ""}

STRING_FIELDS = ["omc", "sa", "location", "dist", "mclass", "tarea", "nh", "yearcomm", "urh"]
NUMERIC_FIELDS = [
    "msC", "msH", "msPct", "hsdC", "hsdH", "hsdPct",
    "msCumC", "msCumH", "msCumPct", "hsdCumC", "hsdCumH", "hsdCumPct",
]


def clean_string(v):
    if pd.isna(v):
        return None
    s = str(v).strip()
    return None if s.lower() in BLANK_STRINGS else s


def clean_number(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, 2)


def sanitize(obj):
    """Recursively replace NaN/Infinity floats with None so the output is strict JSON."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    return obj


def convert(xlsx_path, json_path):
    df = pd.read_excel(xlsx_path, sheet_name=SUM_SHEET_NAME, header=SUM_HEADER_ROW)

    missing = [c for c in COLUMN_MAP if c not in df.columns]
    if missing:
        raise SystemExit(
            "These expected columns are missing from the SUM sheet: "
            + ", ".join(missing)
            + "\nThe workbook's column headers may have changed — update COLUMN_MAP in this script."
        )

    df = df[list(COLUMN_MAP.keys())].rename(columns=COLUMN_MAP)

    # Drop rows with no dealership name (blank/footer/total rows)
    df = df.dropna(subset=["name"])
    df = df[df["name"].astype(str).str.strip() != ""]
    df["name"] = df["name"].astype(str).str.strip()

    for col in STRING_FIELDS:
        df[col] = df[col].astype(object).apply(clean_string)

    for col in NUMERIC_FIELDS:
        df[col] = df[col].apply(clean_number)

    # Customer number as a string (avoids "123456.0"-style float artifacts causing confusion)
    df["cn"] = df["cn"].apply(lambda v: None if pd.isna(v) else str(v))

    df.insert(0, "id", range(1, len(df) + 1))

    records = [sanitize(r) for r in df.to_dict(orient="records")]

    with open(json_path, "w") as f:
        json.dump(records, f, separators=(",", ":"), allow_nan=False)

    print(f"Wrote {len(records)} dealer records to {json_path}")


if __name__ == "__main__":
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else "input.xlsx"
    json_path = sys.argv[2] if len(sys.argv) > 2 else "dealers.json"
    convert(xlsx_path, json_path)