# Phase G performance evidence

This directory separates design inputs, executable preparation, and measured evidence:

- [Capacity model](capacity-model.md) contains planning assumptions and formulas, never benchmark
  claims.
- [Scaling and backpressure](scaling-and-backpressure.md) maps scale controls to the current
  Fastify/PostgreSQL/finance-relay stack.
- [Load and soak plan](load-and-soak-plan.md) defines increment gates and correctness checks.
- [Benchmark report template](benchmark-report-template.md) is completed only from captured runs.

The local harness lives in `infra/performance`. No Phase G capacity or soak target is marked proven
until a production-like staging run includes hardware/configuration, raw reports, monitoring,
database query plans, queue/relay lag, and business-invariant evidence.
