# Plan 5: Enhanced Report UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace basic audit report with polished UI — SVG ScoreRing, rich FindingCard, severity filter tabs, improved unverified section.

**Architecture:** Pure React/Tailwind, no new deps. Three new components in `components/`. Audit report page (`app/audits/[id]/page.tsx`) rewired to use them + filter state. No backend changes.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, TypeScript

---

### Files

| Create | Purpose |
|--------|---------|
| `components/ScoreRing.tsx` | SVG circular progress ring with color-coded score |
| `components/FindingCard.tsx` | Rich finding card with expandable reproduction |
| Modify: `app/audits/[id]/page.tsx` | Add SeverityFilter state + use new components |
| Modify: `app/layout.tsx` | Fix title to "PromptProof" |

---

### Task 1: ScoreRing component

- [ ] Create `components/ScoreRing.tsx`

SVG ring, radius 54, circumference≈339, start at top via rotate(-90). Color: ≥80 green, ≥60 yellow, ≥40 orange, else red.

- [ ] Task 2: FindingCard component

- [ ] Create `components/FindingCard.tsx`

Severity badge, type label, confidence display, description, pageUrl, expandable reproduction steps.

- [ ] Task 3: Rewrite report page with filter tabs

- [ ] Modify `app/audits/[id]/page.tsx`

Filter state: 'all'|'critical'|'high'|'medium'|'low'|'unverified'. Count badges on each tab.

- [ ] Task 4: Fix layout title + commit
