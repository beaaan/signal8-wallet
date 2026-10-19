# Finance track contribution

Contributed by Ngọc, Dung and Hân. Imported on 14 October 2026.

## This version

The original English import is preserved in commit `d57bcd4` (PR #28). That
version copied the supplied workbook byte for byte and translated only prose.
Its live Google Sheet URL is intentionally omitted for privacy; the committed
XLSX and CSV exports supply the workbook content. Other research links remain.
The workbook in this version corrects remaining-shortfall reporting and explains
its assumptions and limits. Numeric inputs and the original credit-sizing
algorithm are unchanged. See [Workbook review](WORKBOOK_REVIEW.md).

The [finance pack](finance-pack.md) now separates reviewed research, current demo
behaviour and unapproved proposals. [Review findings](REVIEW.md) records the
corrections, evidence, unresolved decisions and remaining task gates.
Publication is not approval of pricing or proposed runtime changes. This is not
a final deck, a timed rehearsal or a product approval.

## Files

- [Finance pack](finance-pack.md): product research, forecast discussion,
  business case, paperwork notes, pitch script, Q&A and deck outline.
- [Review findings](REVIEW.md): scope, research qualifications, source-template
  reproduction and finance/technical follow-up.
- [Decision on the finance model](DECISION.md): keeps the implemented model
  (19 October 2026, closes issue #31) and maps the workbook to the runtime.
- [Finance research follow-up](NONRUNTIME_FOLLOWUP.md): arithmetic forecast comparison,
  benefit/premium arithmetic, business evidence and remaining acceptance gates.
- [Translation review](../../translations/translation-review.md): AI-assisted
  editorial findings. Independent native-speaker sign-off is not a prototype
  completion gate under the requested 16 October 2026 review scope; no human
  review is claimed.
- [Cash-flow workbook](ragasa-cashflow.xlsx): the original five-sheet structure
  with reviewed shortfall reporting, labels, assumptions and chart.
- `exports/*.csv`: values exported from this exact workbook, one file per sheet.
  They do not preserve formulas, formatting or the chart. Do not edit them by
  hand. Update the workbook and regenerate its exports together.

After recalculating and saving the workbook in the spreadsheet application, run
`python scripts/export-finance-csv.py` from the repository root. To verify the
committed snapshots without writing them, run the same command with `--check`.
The script uses Python's standard library. It reads saved values, not a formula
calculation engine, and rejects formula cells without a saved result.

## Provenance

| Source supplied by the team | SHA-256 |
|---|---|
| Ragasa_cashflow_forecast.xlsx | `e9d9da4ac7167c82b95e6b33ec8fc8ef29e0758b25633cf249e7fa6cde571208` |
| Signal 8 Wallet Finance track pack (Ngọc, Dung, Hân).md, before translation | `cb5d7cd8aca62519babd5d02832c21164c5ff10be2429e574dcba84ba54ae307` |

The supplied source files remain unchanged; the workbook hash above describes
the original import, not the corrected workbook. Proper names and source URLs may contain
Vietnamese characters; the repository contribution's prose is in English.

## Task mapping

| Task | Assigned finance members |
|---|---|
| Typhoon cover and credit line terms | Hân |
| Cash-flow forecast for the Ragasa storm | Dung, Ngọc, Hân |
| Business case and numbers for the deck | Dung, Hân |
| After-storm paperwork and Vietnam rules check | Dung |
| Pitch script and story | Ngọc, Hân |
| Pitch deck | Dung, Ngọc |

An artifact being present does not establish that its task's acceptance criteria
are complete. In particular, the deck outline is not a submission PDF. This
research follow-up does not add code or author a PowerPoint/PDF deck.
