"""Export saved XLSX values to reviewable CSVs without external dependencies.

Recalculate and save the workbook in a spreadsheet engine first. This script is
not a formula engine and will fail if a formula's cached result is missing.
"""

import argparse
import csv
import io
from decimal import Decimal
from pathlib import Path
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"s": MAIN}
SHEETS = ("README", "Summary", "Inputs", "Forecast_A", "Forecast_B")


def column_index(address):
    column = 0
    for char in address:
        if not char.isalpha():
            break
        column = column * 26 + ord(char.upper()) - ord("A") + 1
    return column - 1


def saved_rows(archive, target, strings):
    root = ET.fromstring(archive.read(target))
    cells = {}
    for cell in root.findall(".//s:sheetData/s:row/s:c", NS):
        address = cell.attrib["r"]
        row = int("".join(c for c in address if c.isdigit())) - 1
        col = column_index(address)
        kind = cell.attrib.get("t", "n")
        node = cell.find("s:v", NS)
        raw = node.text if node is not None else None
        if cell.find("s:f", NS) is not None and raw is None:
            raise ValueError(f"{target}!{address}: recalculate/save before exporting")
        if kind == "e":
            raise ValueError(f"{target}!{address}: saved formula error {raw}")
        if kind == "s":
            value = strings[int(raw)]
        elif kind == "inlineStr":
            value = "".join(n.text or "" for n in cell.findall(".//s:t", NS))
        elif kind == "b":
            value = "True" if raw == "1" else "False"
        elif raw is None:
            continue
        elif kind == "n":
            value = format(Decimal(raw), "f")
            if "." in value:
                value = value.rstrip("0").rstrip(".")
        else:
            value = raw
        cells[(row, col)] = value
    height = max((r for r, _ in cells), default=-1) + 1
    width = max((c for _, c in cells), default=-1) + 1
    return [[cells.get((r, c), "") for c in range(width)] for r in range(height)]


def export(workbook, output, check=False):
    with zipfile.ZipFile(workbook) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            tree = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(n.text or "" for n in item.findall(".//s:t", NS)) for item in tree]
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall(f"{{{PKG_REL}}}Relationship")}
        tree = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = tree.findall("s:sheets/s:sheet", NS)
        if tuple(s.attrib["name"] for s in sheets) != SHEETS:
            raise ValueError("Unexpected sheet inventory; review the export scope explicitly")
        failures = []
        for sheet in sheets:
            name = sheet.attrib["name"]
            target = targets[sheet.attrib[f"{{{DOC_REL}}}id"]]
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            rows = saved_rows(archive, target, strings)
            buffer = io.StringIO(newline="")
            csv.writer(buffer, lineterminator="\n").writerows(rows)
            expected = buffer.getvalue()
            path = output / f"{name}.csv"
            if check:
                if not path.exists() or path.read_text(encoding="utf-8") != expected:
                    failures.append(name)
            else:
                output.mkdir(parents=True, exist_ok=True)
                path.write_text(expected, encoding="utf-8", newline="")
        if failures:
            raise ValueError("Stale or missing CSV snapshots: " + ", ".join(failures))
        print(f"{'Verified' if check else 'Exported'} {len(sheets)} saved-value CSV snapshots")


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify snapshots without writing")
    args = parser.parse_args()
    try:
        export(root / "docs/finance/ragasa-cashflow.xlsx", root / "docs/finance/exports", args.check)
    except (ValueError, OSError, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
