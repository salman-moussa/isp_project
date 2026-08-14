# Orvex ISP Collect

Android-first Expo reference workspace for assigned field collection. The executable core implements
persist-before-success payments, ordered idempotent sync outcomes, revocation locking, printer
failure isolation, and per-currency/method end-of-day reconciliation.

The default app is visibly labeled **Reference mode** and never calls a real service. It is not a
subscriber portal. See `../../docs/mobile/collect-reference.md` for the backend and release gates
that must be supplied before production use.

Run focused validation from the repository root:

```text
npm run typecheck --workspace=@isp/collect
npm run lint --workspace=@isp/collect
npm test --workspace=@isp/collect
npm run build --workspace=@isp/collect
```

Native development and EAS builds require this workspace's exact pinned Expo dependencies to be
installed and the external configuration documented in the mobile reference guide.
