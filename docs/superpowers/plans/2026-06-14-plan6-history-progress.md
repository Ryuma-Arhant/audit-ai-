# Plan 6: Audit History + Live Pipeline Progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** Home page shows recent audit history. Report page shows live pipeline phase rows (Crawl → Checks → Phase A → B → C → D) with status icons and durations while running and after completion.

**Architecture:** Add `GET /api/audits` for history list. `Audit` type on report page gets `agentRuns[]`. New `PipelineStatus` component reads agentRuns grouped by phase and derives crawl/check status from `pagesCrawled`. No schema changes.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, Prisma

---

### Files

| Action | File | Purpose |
|--------|------|---------|
| Modify | `app/api/audits/route.ts` | Add GET handler — 20 most recent audits |
| Modify | `app/page.tsx` | History list below URL form |
| Create | `components/PipelineStatus.tsx` | Phase progress rows |
| Modify | `app/audits/[id]/page.tsx` | Add AgentRun type, show PipelineStatus |
