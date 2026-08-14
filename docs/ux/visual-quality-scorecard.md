# Phase-B visual quality scorecard

## Scoring method

This scorecard records implementation coverage, not subjective polish or production acceptance. Each
item is scored from the source and automated evidence available in this repository:

- **2 — Implemented and automatically exercised**
- **1 — Implemented in source; browser or assistive-technology evidence remains**
- **0 — Missing or blocked**

The maximum is 24. A source score cannot substitute for the residual real-browser gates below.

| Quality dimension                 |     Score | Evidence                                                                                           | Residual evidence                                                      |
| --------------------------------- | --------: | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Original visual hierarchy         |       1/2 | Purpose-built catalog hero, numbered navigation, restrained operational surfaces                   | Screenshot review at target viewports                                  |
| Shared token use                  |       1/2 | Catalog CSS uses existing semantic color, spacing, radius, shadow, focus, and motion tokens        | Computed-style and visual review                                       |
| Bilingual copy parity             |       2/2 | Typed EN/AR objects; automated section, state, and record identity parity                          | Human Arabic copy review                                               |
| RTL layout and stable values      |       2/2 | Root `dir`, logical properties, and LTR technical/currency runs are asserted                       | Browser visual and reading-order review                                |
| Navigation semantics              |       2/2 | Named landmarks, anchors, current-page state, and programmatic skip-to-main focus are asserted     | Browser focus-position review                                          |
| Dense data readability            |       1/2 | Captioned/scoped table, focusable labelled overflow, compact-list markup, and breakpoint           | Browser table-to-list, overflow, and zoom review                       |
| Finance presentation              |       2/2 | USD/LBP are never combined; each pair is visibly labelled and direction-stable                     | Locale-specific spoken-output review                                   |
| Status and callout clarity        |       1/2 | Every tone has visible text; persistent fixture disclosure and informational callout               | Computed contrast and visual-priority review                           |
| Approval/support risk context     |       2/2 | Context is visible; approval/end/escalation controls are disabled with visible reasons and tested  | Production confirmation/dialog policy is outside catalog scope         |
| Audit timeline evidence           |       1/2 | Ordered event reference includes context, outcome, isolated identifier, and Beirut time            | Screen-reader and visual reading-order review                          |
| Loading/empty/error/denied states |       2/2 | All four render together; busy/alert semantics and safe next-action copy are tested                | Screen-reader announcement timing                                      |
| Keyboard/focus/motion resilience  |       1/2 | Programmatic skip/heading focus and reduced-motion/forced-colors source contracts pass             | Keyboard, NVDA, forced-colors, and reduced-motion browser sessions     |
| **Total**                         | **18/24** | **Scoped automated checks passed on 2026-08-11; score remains capped by missing browser evidence** | **Six points remain withheld pending retained browser/human evidence** |

## Evidence boundaries

The score deliberately withholds six points because this tranche has no screenshot-regression,
computed-style, browser zoom, forced-colors, reduced-motion capture, NVDA, VoiceOver, or human
Arabic review artifact. The executed evidence is 2 test files/9 tests, package lint and typecheck,
scoped Prettier, and a Vite library build. Axe under jsdom can identify semantic risks but cannot
establish final rendering or assistive-technology behavior.

The catalog contains reference fixtures only. Its approval, permission, support, finance, and audit
examples do not prove live authorization, tenant isolation, database immutability, relay delivery,
or production deployment.

## Release-candidate visual gate

Before increasing the score, attach dated evidence for:

1. EN/LTR and AR/RTL screenshots at 320, 768, 1024, and 1440 CSS px.
2. 200% and 400% reflow, including long Arabic strings and record-list conversion.
3. Keyboard-only traversal with visible focus and correct skip-link landing.
4. Browser axe plus computed WCAG 2.2 AA contrast checks.
5. Reduced-motion and Windows forced-colors captures.
6. NVDA + Chrome table, status, state, and support-context reading order.

Record the tool/browser/AT versions, operating system, date, failures, and remediation links. Do not
raise a score solely because a checklist was completed without retained evidence.
