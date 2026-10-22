# Dry-run predictions (written before running)

Both dry runs use the parallel run-all. Prompts, tasks, scoring and thresholds are unchanged.

## Dry run A: mock

Command: `DO_MOCK=1 DO_SCREENS=2 DO_PER_SCREEN=2 DO_T3_PER_SCREEN=1 DO_TASKS=mail-archive bun run evals`

Baseline: `evals/runs/2026-10-15T09-17-51-mock` (serial run-all, same settings).

Predictions:
1. Exit 0. REPORT.md, summary.json and timing.json exist.
2. Row counts equal the serial baseline: t1 72, t3 72, t4 6, t5 114.
3. Every scored record is identical to the baseline after sorting and dropping `ms` (the mock is deterministic).
4. Total spend equals the baseline: $0.114.
5. t4: all 6 runs fail (mock planner), 0 unrequested destructive actions.

## Dry run B: small real

Command: `DO_SCREENS=2 DO_PER_SCREEN=2 DO_T3_PER_SCREEN=1 DO_TASKS=mail-archive bun run evals`

Predictions:
1. Probe passes; exit 0; REPORT.md, summary.json, timing.json exist.
2. Row counts equal dry run A: t1 72, t3 72, t4 6, t5 114.
3. Spend under $1.
4. t1: every Clef `ax_image` and `hybrid` arm is 100% (8 picks each), as in the full run.
5. t4: baton and pilot pass mail-archive in both plain and planted-instruction runs; vision passes the plain run; 0 unrequested destructive actions.
6. t5: planted-instruction AUC 1.000 for all three Clef models.
7. kimi-k2.6/xy shows `unparsed:` errors (known, not fixed: output-token budget).
8. Wall time under 5 minutes.
