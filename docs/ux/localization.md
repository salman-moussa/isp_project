# English and Arabic localization guide

## Locale contract

The initial web applications support `en` and `ar`. Locale determines text, direction, typography,
and locale-aware presentation; it must never change underlying values, permission decisions,
filters, identifiers, or domain behavior.

- English uses `lang="en"` and `dir="ltr"`.
- Arabic uses `lang="ar"` and `dir="rtl"`.
- Default business timezone is `Asia/Beirut`; APIs store timestamps in UTC and clients format them
  for the selected tenant timezone.
- Use `en-LB` and `ar-LB` for number/date formatting unless a tenant-specific locale is configured.
- Translation keys should move into the shared i18n package when it is available. The foundation
  currently keeps strongly structured locale objects beside each app so no visible component string
  is hidden in domain logic.

## Language switching

Changing language is an in-place preference update. Preserve:

- the active app and module;
- tenant and branch context;
- search terms, filters, sorting, columns, and pagination;
- open drawer/dialog/wizard step when the result remains understandable;
- draft form values and validation state;
- unsaved financial entries and their selected currency.

If a translated option has a different internal ID, the stable ID—not its label—drives selection.

## Bidirectional content

Use CSS logical properties rather than direction-specific margins, padding, borders, or positioning.
Mark isolated technical values with the smallest practical directional boundary:

- currency amount: `dir="ltr"` around `USD 1,250.00` or `LBP 89,500,000`;
- telephone: `dir="ltr"` around `+961 3 123 456`;
- IDs and versions: `dir="ltr"` around `CN-1842`, `RCPT-82019`, `v1.8.4`;
- PPPoE username, IP address, MAC, ONU serial, VLAN, and router names remain LTR;
- a sentence around those tokens still follows the page direction.

Mirror arrows that mean forward/back/open-detail. Do not mirror checkmarks, warning symbols,
currency codes, plus/minus signs, media controls, charts tied to chronological left-to-right axes,
or brand marks without design review.

## Money

Always show the ISO code when an amount could be ambiguous. USD and LBP remain separate in cards,
entry forms, reconciliation, reports, and exports. A localized view may change digit shapes or
separators but not precision or currency. Never display a combined “total” unless an authorized
exchange-rate conversion explicitly includes source, rate date, approver, and converted value.

Suggested patterns:

| Context        | English                                   | Arabic                             |
| -------------- | ----------------------------------------- | ---------------------------------- |
| Pair           | `USD 4,280.00` and `LBP 186,750,000`      | `USD 4,280.00` و `LBP 186,750,000` |
| Reconciliation | `Expected · USD`                          | `المتوقع · USD`                    |
| Currency input | visible currency selector + numeric input | اختيار عملة ظاهر + إدخال رقمي      |

## Lebanese data

- Accept mobile input such as `03 123 456`, `70 123 456`, and `+961 3 123 456`; normalize to E.164
  when possible and preserve validation feedback in the active language.
- Address hierarchy is Governorate → District → Village → Area, with tenant-managed translations and
  spelling variants.
- Arabic names and addresses do not require Latin transliteration.
- OMT, Whish, POS, MikroTik, PPPoE, ONU, VLAN, USD, and LBP are stable product/technical terms;
  surround them with Arabic grammar without inventing inconsistent transliterations.
- Invoice and receipt PDFs require an embedded Arabic-capable font and selectable/searchable text
  where practical.

## Translation content rules

- Write concise operational language. Prefer “Payment posted” over “Your payment has been
  successfully processed.”
- Explain consequences before destructive actions.
- Avoid ambiguous “customer” in platform copy: use “ISP client.” Inside the tenant workspace, use
  “subscriber.”
- Do not translate an immutable record ID.
- Plurals must use locale-aware ICU message rules when the shared i18n package is integrated; do not
  concatenate numbers and singular nouns.
- Error copy states what failed, what remained safe, and what the user can do.
- Access-denied copy names the missing scope without disclosing protected data.

## Automated evidence

Both app test suites verify that selecting a module and then switching to Arabic:

1. changes the document language to `ar`;
2. changes the document direction to `rtl`;
3. preserves the selected module by stable ID;
4. exposes the translated navigation name with `aria-current="page"`.

Browser-level visual regression remains required for long Arabic labels, compact tables, charts,
dialogs, printable receipts, and 200% zoom.
