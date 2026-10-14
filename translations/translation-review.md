# After-storm translation review

AI-assisted editorial review, 14 October 2026. Not an independent human
native-speaker review or legal approval. Runtime `agent/src/drafts.ts` is unchanged.
Generator fixes and required human review remain tracked in issue #32.

## Source and method

Read the generated Yagi preview (claim, deadlines and Vietnamese request), the
current template source and the official Circular 53 conditions. Quoted source
fragments below are Vietnamese because they are the text being reviewed; the
review and instructions are in English.

The preview uses sample facts and zero contract addresses. It is not a real
filing, accepted claim, real borrower assessment or live execution record.

## Findings and suggested wording for a future fix

| Source wording / behaviour | Finding | Proposed wording or rule |
|---|---|---|
| Current date plus a request under Circular 53/2024 | The event is historical and the consideration window ended in 2025 | Label a historical preview: “Bản minh họa lịch sử, không phải hồ sơ đề nghị nộp tại thời điểm hiện tại.” Keep the actual generation date and an explicitly separate fictional application date, if needed |
| “Bằng chứng trước bão đã được ghi nhận: mã băm PRE_STORM (không có).” | It asserts evidence was recorded while showing none | When missing: “Chưa có bằng chứng trước bão hoặc giao dịch ghi nhận được xác minh trong bản nháp này.” |
| “nhà xưởng, máy móc, nguyên vật liệu và hàng hóa bị hư hỏng” | It states actual damage without owner-supplied facts | Use an owner field: “Thiệt hại thực tế do chủ doanh nghiệp xác nhận và cung cấp chứng từ: …” |
| “khoản nợ phát sinh trước ngày bão gây thiệt hại” | The eligibility summary should use the circular's specific cutoff rather than a variable local damage date | Summarise principal before 7 September 2024, relevant due dates and bank assessment; verify all Article 4 conditions before use |
| Requests to preserve debt classification, reduce fees and make new loans | These are requests, not automatic entitlements | Retain “đề nghị xem xét”; identify which request relies on the applicable regulation and which depends on bank policy |
| Closing signature/seal instruction | Legal form and borrower type may differ | Leave signatory authority and required supporting documents for the bank/borrower to confirm |

## Human review checklist

- [ ] Vietnamese speaker checks accuracy, tone and the complete corrected output.
- [ ] Reviewer records name, date, version and any accepted wording changes.
- [ ] Reviewer checks historical/current-date labels and absence of invented facts.
- [ ] Appropriate bank/legal reviewer checks eligibility and required documents if
  this is ever used outside a clearly labelled demonstration.
- [ ] Chinese speaker reviews applicable Chinese outputs separately; this file
  does not certify them from the Vietnamese review.

## Acceptance boundary

This file supplies a review artifact where the earlier task referenced a missing
file. It does not itself meet the task's human-speaker condition, change the
generator or establish that an insurer/bank will accept the result. Re-run the
preview and review the actual corrected output after issue #32 is implemented.
