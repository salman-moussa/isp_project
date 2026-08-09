# Web accessibility baseline

## Target

The web applications target WCAG 2.2 AA. This document describes the implemented shell baseline and
the review gates required as modules become functional. Automated checks assist review; they do not
replace keyboard, screen-reader, zoom, contrast, and RTL testing in a real browser.

## Implemented shell behavior

- A visible-on-focus skip link targets the single main landmark.
- Primary navigation has an accessible name and the active item uses `aria-current="page"`.
- Mobile navigation exposes `aria-expanded`, `aria-controls`, a named close control, and closes
  after navigation.
- Main content receives programmatic focus after module navigation so keyboard and screen-reader
  users receive the new context.
- English/Arabic controls use pressed states and update document `lang` and `dir`.
- Buttons are native controls; KPI drill-down cards are not clickable `div` elements.
- Focus has a high-visibility blue outline and offset. No component removes focus without a
  replacement.
- Status badges combine words, a shape, and color.
- Loading uses `aria-busy` and a polite live region. Errors use an alert. Access denial is described
  in text.
- The support-session banner is a labelled section and keeps ticket, scope, expiry, audit state, and
  end control in the reading order.
- Reduced-motion preferences suppress decorative transitions and animations.
- Forced-colors mode retains component boundaries and status signals.

## Keyboard model

| Interaction             | Keyboard behavior                                                           |
| ----------------------- | --------------------------------------------------------------------------- |
| Skip link               | `Tab`, then `Enter` moves to main content                                   |
| Primary navigation      | Standard `Tab` order; `Enter`/`Space` activates an item                     |
| Locale switch           | Standard buttons; pressed locale is announced                               |
| KPI                     | Standard button; opens the exact filtered list                              |
| Segmented state preview | Standard button group with one pressed option                               |
| Mobile menu             | Menu button toggles drawer; close scrim is keyboard reachable               |
| Support session         | End action is a standard button and requires production confirmation policy |

Future dialogs and drawers must trap focus only while modal, set an accessible name, restore focus
to the invoking control, and close on `Escape` unless doing so would discard or interrupt high-risk
work without confirmation.

## Form requirements

- Every input has a persistent visible label. Placeholder text is not a label.
- Required status, format hints, and units/currency are announced before input.
- Inline errors reference inputs with `aria-describedby`; failed submission focuses an error summary
  whose links move to fields.
- Do not clear values after validation failure or locale switching.
- Currency inputs require an explicit USD/LBP selection and announce that currency with the value.
- Phone inputs accept Lebanese display formats and describe normalization without rejecting valid
  Arabic text nearby.
- OTP controls may visually split digits but expose a coherent input and paste path.
- Sensitive values such as PPPoE passwords are masked by default and need permission-aware reveal
  controls.

## Data display requirements

- Tables require a caption or nearby labelled heading, header cells, correct sort state, and
  paginated/virtualized keyboard behavior.
- Charts require a text summary and accessible data table. Color is never the only series
  distinction.
- Live updates must not steal focus. Announce only user-relevant changes and offer pause controls
  for high-frequency feeds.
- Amounts identify currency in both visible and accessible text.
- Empty, error, loading, denied, offline, conflict, and partial-failure states appear in the same
  reading location as the expected content.

## Responsive and zoom review

Test at 320 CSS px and at 200% browser zoom with no loss of content or function. A horizontal
exception is acceptable only for inherently two-dimensional data such as a complex comparison table,
and it requires a labelled scroll region. Touch targets should be at least 44 × 44 CSS px for
primary mobile workflows; tightly packed desktop controls must still meet WCAG 2.2 target-size
exceptions deliberately.

## Test matrix

| Gate                                  | Platform    | Tenant                                | Frequency                 |
| ------------------------------------- | ----------- | ------------------------------------- | ------------------------- |
| Vitest semantic shell test            | Required    | Required                              | Every change              |
| axe-core DOM scan                     | Required    | Required                              | Every change              |
| English/Arabic direction preservation | Required    | Required                              | Every change              |
| Keyboard-only smoke                   | Required    | Required                              | Per release candidate     |
| NVDA + Chrome                         | Required    | Required                              | Per release candidate     |
| VoiceOver + Safari                    | Recommended | Required for supported Safari release | Major releases            |
| 200% zoom / reflow                    | Required    | Required                              | Per release candidate     |
| Forced colors / high contrast         | Required    | Required                              | Major releases            |
| Reduced motion                        | Required    | Required                              | Per release candidate     |
| Browser color contrast                | Required    | Required                              | Every visual token change |

## Known foundation limitations

- The current shells demonstrate navigation and state patterns; full module forms, tables, dialogs,
  charts, and route focus announcements are not implemented yet.
- Browser-level color contrast is not asserted by jsdom. It must run in the future browser E2E
  accessibility job.
- The mobile drawer does not yet trap focus. Because it is currently a non-modal responsive
  navigation region with a scrim, focus can reach the page behind it; production integration should
  either add an inert/modal focus boundary or use a nonmodal push layout.
- Self-hosted Arabic and Latin font assets are not yet bundled. System fallbacks work, but
  document/PDF font embedding is a separate deliverable.

These limitations are release work, not accessibility exceptions.
