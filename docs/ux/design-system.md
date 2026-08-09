# Orvex ISP design system

## Purpose

Orvex ISP is the shared product language for Orvex ISP Control Center and each isolated Orvex ISP
Operations workspace. It is designed for dense, consequential operational work in Lebanon: cash
collection, bilingual office workflows, subscription administration, deployment health, and network
operations. The interface is calm, direct, and evidence-oriented. It does not use ornamental
dashboards, decorative KPIs, glass effects, or blended-currency totals.

The executable foundation lives in `packages/ui`. Both web applications consume the same tokens and
accessible primitives while keeping separate navigation, content, permissions, and data boundaries.

## Visual character

- Deep navy navigation separates global wayfinding from white and pale-gray work surfaces.
- Electric blue identifies the single emphasized action and interactive focus.
- Cedar teal means healthy, complete, or connected; amber means attention or a reversible risk; red
  is reserved for critical or destructive states.
- The original Orvex mark is a geometric “O” with a routed connection between two endpoints. It
  avoids telecom logos, decorative sparkles, and competitor imagery.
- Surfaces use deliberate 6–20 px radii and restrained elevation. Important data structure comes
  from alignment, borders, and typography rather than decoration.
- Arabic uses a `Noto Sans Arabic`-first stack and Latin uses an `Inter`-first stack. Production
  deployments should self-host licensed font files; the system stack remains a resilient fallback.

## Token contract

Tokens are CSS custom properties in `packages/ui/src/theme.css`.

| Group     | Contract                                                                                      |
| --------- | --------------------------------------------------------------------------------------------- |
| Ink       | `--color-ink`, `--color-ink-muted`, `--color-ink-subtle`                                      |
| Surfaces  | `--color-canvas`, `--color-surface`, `--color-surface-raised`                                 |
| Brand     | Midnight navy `#0B1F33`, Orvex cobalt `#2458E6`, and cedar teal `#0F8B7B` via semantic tokens |
| Semantics | `--color-primary`, `--color-teal`, `--color-amber`, `--color-red` plus soft counterparts      |
| Spacing   | 4 px base: `--space-1` through `--space-12`                                                   |
| Radius    | `--radius-sm` 6 px, `--radius-md` 10 px, `--radius-lg` 14 px, `--radius-xl` 20 px             |
| Elevation | `--shadow-sm` for structure and `--shadow-md` for hovered/raised work                         |
| Motion    | 140 ms fast feedback, 220 ms layout motion; suppressed for reduced motion                     |
| Layout    | 264 px desktop navigation, 84 px context header, logical inline dimensions                    |

Token values meet the intended WCAG 2.2 AA contrast target on their documented surfaces. Automated
DOM accessibility tests deliberately do not claim color-contrast verification because jsdom cannot
compute the final rendered colors; browser-level contrast and visual regression remain a release
gate.

## Type and density

The default web density is optimized for finance and operations teams using laptops, with a 15 px
base size and 1.5 line height. Page headings scale from 26–38 px. Controls are at least 40 px tall
on desktop; mobile navigation and primary workflow controls should reach 44 px. Numeric values use
tabular figures and preserve an LTR numeric run inside RTL layouts.

Do not force Arabic names or addresses into Latin transliteration. Use the locale’s typographic
stack while preserving identifiers such as `CN-1842`, `USD`, `LBP`, `MikroTik`, receipt numbers, and
version numbers as stable technical tokens.

## Shared components

The initial shared package provides:

- `AppShell`: skip link, responsive navigation drawer, context header, main landmark, direction
  handling, and main-content focus on navigation.
- `BrandMark`: accessible Orvex connection-and-routing mark.
- `Button`: primary, secondary, tertiary, danger, loading, disabled, and permission-blocked
  behavior.
- `LocaleSwitcher`: in-place English/Arabic change with pressed-state semantics.
- `StatusBadge`: text, dot, and tone; status is never conveyed by color alone.
- `SupportSessionBanner`: persistent ticket, scope, expiry, audit state, and immediate end action.
- `KpiCard`: a button, never a decorative card; it opens an exact filtered record set.
- `MoneyPair`: visibly separated USD and LBP amounts with stable numeric direction.
- `DrilldownPanel`: the exact filtered list behind a KPI.
- `StatePanel`: loading, empty, error, and access-denied variants with safe next actions.
- `SegmentedControl`, `Surface`, `ActivityList`, `QuickAction`, `PageHeader`, and `SectionHeading`.

New components must use semantic HTML first, accept translated content rather than embedding
user-visible English, and support both directions without app-specific overrides.

## Operational interaction rules

1. A panel has at most one emphasized primary action.
2. Every KPI opens the filtered list or work queue that produced its number.
3. A data-changing action returns visible feedback within 100 ms; longer work shows progress and a
   safe cancellation policy.
4. Financial actions identify the currency at entry, review, success, receipt, and report stages.
   USD and LBP are separate by default.
5. Permission denial explains the missing scope and offers the smallest useful escalation path. It
   does not silently hide why work is unavailable.
6. Retry copy distinguishes a safe read retry from a write that could duplicate work. Financial and
   network writes depend on server idempotency before offering a retry.
7. Sensitive platform-to-tenant access is never an ordinary account switch. An approved support
   session must remain visible, scoped, expiring, revocable, and audited.
8. Destructive controls use the danger treatment only after impact preview, permission checks, a
   reason, and any required approval.

## State matrix

| State           | User sees                                                  | Required behavior                                             |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Loading         | Existing context, progress indication, plain-language task | Preserve current navigation, filters, form work, and layout   |
| Empty           | What is empty and why it may be empty                      | Clear-filter or create action only when permitted             |
| Validation      | Inline field message plus form-level summary               | Focus the summary, link to fields, preserve entered values    |
| Error           | What failed, what remained safe, next action               | Never imply a financial write failed if outcome is uncertain  |
| Access denied   | Missing scope and escalation route                         | Record denied sensitive access attempts where policy requires |
| Offline         | Last-sync time, pending count, available actions           | Never show success before durable local persistence           |
| Partial failure | Succeeded, failed, skipped, and uncertain counts           | Retry only records proven safe to retry                       |
| Success         | Identifier, posted/queued state, audit context             | Provide receipt, next action, or exact resulting record       |

## Responsive behavior

- Above 1024 px: persistent 264 px navigation, sticky context header, four KPI columns when space
  permits.
- 768–1024 px: navigation becomes a modal drawer; KPI cards use two columns.
- Below 768 px: single-column work surfaces, stacked page actions, simplified context header, and
  horizontally scrollable segmented controls.
- Below 480 px: 16 px canvas padding and one-column action groups.
- The navigation drawer overlays the workspace and has a named close scrim. Opening state is exposed
  with `aria-expanded` and `aria-controls`.
- Tables added later must switch to a deliberate card/list representation or use labelled horizontal
  scrolling. Never squeeze columns until meaning is lost.

## RTL contract

- Direction is set on `<html>` through `useDocumentLocale`; components use logical properties such
  as `margin-inline-start`, `inset-inline-start`, and `border-inline-end`.
- Navigation selection, layout edges, drawer motion, and directional arrows mirror in RTL.
- Diagonal “open detail” arrows and forward arrows mirror; status icons, currency codes, plus signs,
  charts, and technical identifiers do not.
- Numeric and currency runs use `dir="ltr"` where reordering would make values ambiguous.
- Switching locale does not navigate, reload, clear filters, replace form state, or change the
  active module.
- Arabic text may grow by 30–40%; controls must wrap or truncate only where the full accessible name
  remains available.

## Theme and extension

Light theme is the release baseline. Semantic tokens make later tenant branding or a dark theme
possible, but tenant customization must not lower contrast, alter meaning, or create a different
component API. A tenant logo may accompany the product mark; it must not replace navigation identity
in a way that obscures the active ISP context.

## Review checklist

- [ ] User-visible strings exist in English and Arabic translation objects.
- [ ] Component works at 320 px, 768 px, 1024 px, and 1440 px.
- [ ] LTR and RTL preserve the same meaning, values, permissions, and tab order.
- [ ] Keyboard focus is visible and ordered by task, not visual positioning.
- [ ] Status has text or an accessible description in addition to color.
- [ ] Empty, loading, error, denied, and long-content states are exercised.
- [ ] Currency is explicit and USD/LBP are not combined.
- [ ] Sensitive actions expose impact, reason, approval, and audit expectations.
- [ ] Browser axe, contrast, zoom to 200%, and reduced-motion checks pass.
