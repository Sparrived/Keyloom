# Overview History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Keyloom's confirmed overview trend and recent-activity areas from AMKR metric history rather than placeholder data.

**Architecture:** AMKR currently exposes only aggregate `/metrics` data. React retains a bounded in-memory history of real 15-second metric polls while the overview is open, renders it with a dependency-free SVG chart, and derives the activity summary from the same snapshots. A new AMKR history endpoint can replace this local history later without changing the chart contract.

**Tech Stack:** Rust, Tauri 2 IPC, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Keep bounded real metric snapshots

**Files:**
- Create: `src/features/overview/useMetricHistory.ts`
- Create: `src/features/overview/useMetricHistory.test.ts`

- [ ] **Step 1: Write failing Rust tests**

Use a metric sample factory with timestamped aggregate responses. Assert `appendMetricSnapshot` preserves chronological values and removes the oldest sample after 60 entries.

- [ ] **Step 2: Run the focused test**

Run: `npm test -- --run src/features/overview/useMetricHistory.test.ts`
Expected: FAIL because the helper and snapshot type do not exist.

- [ ] **Step 3: Implement the smallest safe IPC command**

Define a `MetricSnapshot` that stores the real poll timestamp and the aggregate response fields. Add one pure helper that appends the latest successful metrics result and caps the array at 60 items.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --run src/features/overview/useMetricHistory.test.ts`
Expected: PASS.

### Task 2: Render the overview from real snapshots

**Files:**
- Create: `src/features/overview/UsageChart.tsx`
- Create: `src/features/overview/UsageChart.test.tsx`
- Modify: `src/api/amkr.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles/tokens.css`

- [ ] **Step 1: Write failing component tests**

Render three snapshots and assert a semantic chart, request/token/cache selection, keyboard-accessible data points, and a detail panel containing timestamp, requests, token total, cached tokens, success rate, and average latency. Render an empty array and assert the explicit no-history state.

- [ ] **Step 2: Run the focused test**

Run: `npm test -- --run src/features/overview/UsageChart.test.tsx`
Expected: FAIL because the component and IPC client function do not exist.

- [ ] **Step 3: Implement the smallest chart**

Use the existing typed `getAmkrMetrics` IPC call. Use a React-rendered SVG polyline and native buttons for data points; no chart package. Append each successful 15-second poll to local history and derive recent activity from the latest non-zero snapshot.

- [ ] **Step 4: Run focused UI tests**

Run: `npm test -- --run src/App.test.tsx src/features/overview/UsageChart.test.tsx`
Expected: PASS.

### Task 3: Verify the integrated increment

**Files:**
- Test: `src/App.test.tsx`

- [ ] **Step 1: Add app integration coverage**

Mock two successful `get_amkr_metrics` results during startup and refresh. Assert the overview replaces the placeholder trend message with the chart and chart detail.

- [ ] **Step 2: Run all relevant checks**

Run:

```powershell
npm test -- --run
npm run build
```

Expected: PASS.
