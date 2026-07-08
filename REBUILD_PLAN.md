# Kynda v3 — From-Scratch Rebuild Plan

Drafted: 2026-07-05
Goal: same product, truth-first architecture. Eliminate entity-level hallucinations deterministically; make claim-level assertions grounded, labeled, and cumulative.

---

## 1. The agentic question, answered first

**Yes — build the dataset agentically. But split the system into two paths with different jobs:**

- **Runtime path (hot, seconds):** serves user queries. Reads from the verified corpus first, falls back to generation + deterministic entity verification. No agents here — a user can't wait for web research.
- **Offline path (slow, cumulative):** a fleet of research agents that process subjects from a queue, hunting primary sources across the web — interviews, liner notes, documentaries, books, artist statements. Their output feeds a claims store that the runtime path reads. This corpus grows forever and is Kynda's actual moat.

**The core design principle: never trust an agent's claim — trust the verified artifact.** An agent can hallucinate a Melody Maker interview as easily as a chat model can. The difference is that agents produce *checkable output*: a URL plus an exact quote. A dumb deterministic script fetches the URL, snapshots it to archive.org, and string-matches the quote. If it matches, the claim is now as reliable as the source itself, regardless of which model produced it. That fetch-and-match step is the mechanism that converts model output into ground truth. Without it, agentic research just moves hallucination up one layer.

**Why this is the right call:**
- The claims graph with provenance (canonical entity IDs + typed connections + cited, quote-confirmed sources) is the licensable asset. Pointers and short excerpts are yours; full-text licensing (news archives, Rock's Backpages, etc.) becomes a later business decision negotiated from strength.
- It is exactly the substrate the DECISIONS.md Phase 4–6 vision (human curation → artist-curated maps → multi-perspective toggle) needs. Agent-researched claims become the starting draft humans curate — attribution and sourcing built in from day one.
- Query traffic is Zipf-distributed. Agent-research the top ~500–1,000 subjects and most real searches hit verified corpus; the long tail gets the runtime pipeline with honest "inferred" labeling.
- The free Fable 5 window is precisely when to batch-run the corpus build. This is the single best use of free tokens available to this project.

---

## 2. Architecture

Four layers:

### 2.1 Canonical entity layer
Every subject and every recommended work resolves to stable external IDs:
| Domain | Source | License |
|---|---|---|
| Music (artists, releases, recordings, relationships) | MusicBrainz | CC0, no API key |
| Film / TV | TMDb | Free with attribution |
| Books | Open Library | Open |
| Everything (cross-domain spine) | Wikidata | CC0 |

Entities cannot be invented by construction: anything without a resolvable ID is either dropped or explicitly flagged as unresolved.

### 2.2 Claims store (Postgres)
- `entities` — canonical ID(s), names, domain, metadata.
- `claims` — typed edges between entities: `influenced_by`, `covered_by`, `collaborated_with`, `same_scene`, `cross_medium_influence`, `cited_in_interview`, `used_gear`, … Each claim carries slot-type affinity so mixes can be assembled from it.
- `provenance` — per claim: source URL, archived URL, exact quote excerpt, publication, date, retrieval date, verification status (`quote_confirmed` / `url_live` / `unverifiable` / `dead_link`), verification method, model/agent version.
- `review` — human curation state: pending / approved / rejected / edited, with attribution (evolves the current `curated/` directory).

**Confidence becomes machine-assigned provenance, never model self-report:**
- `verified` — quote-confirmed against a live or archived source, or structured-DB relationship match.
- `sourced` — agent cited a source; URL live but quote not yet confirmed (e.g., paywalled).
- `inferred` — model reasoning, no documentation. Labeled honestly in the UI.

### 2.3 Runtime query path
1. **Disambiguate (retrieval-first):** query hits MusicBrainz/TMDb/Wikidata search APIs → real candidate list → Haiku ranks and annotates. The model can no longer invent an entity; it only chooses among real ones. Keep the certain/likely/ambiguous UX exactly as designed (AD-02).
2. **Corpus check:** if the subject has agent-researched coverage, assemble the KyndaMix from verified claims. Fable 5 writes the `reason` prose *from the supplied claims and quotes only* — grounded writing, with real linked citations.
3. **Gap path:** no corpus coverage → Fable 5 generates candidates via structured outputs → every (title, creator, year) tuple verified against the entity layer → failures regenerated or dropped → surviving items labeled `likely`/`inferred` → subject enqueued for offline research so the next visitor gets better data.
4. Persistent cache keyed on canonical entity IDs, not name strings.

### 2.4 Offline research pipeline
1. **Queue:** seeded from query logs (popularity order) + a hand-picked launch list.
2. **Research agent** (Claude Agent SDK, `claude-fable-5`, web search + fetch): per subject, per candidate connection — find primary sources; emit structured claims with URL + exact quote.
3. **Deterministic verifier** (no model): fetch URL → archive snapshot → string-match quote → cross-check entity tuples against structured DBs → write provenance status.
4. **Adversarial critique pass:** a second, cheap model call attempts to refute each claim that lacks quote confirmation. Refuted claims are dropped or downgraded.
5. **Human review queue:** the `curated/` concept, now backed by the claims store with full attribution.
6. **Re-crawl job:** periodic link-rot check; dead links fall back to archived snapshots.

---

## 3. Eval harness — first-class, built in Phase 0

The most important artifact in a project whose goal is eliminating hallucinations is the thing that measures them.

- **Golden set:** 50–100 subjects across domains the team knows cold, each with known-true facts and known-trap facts (seeded from CORRECTIONS.md — e.g., the Blur/Radiohead misattribution).
- **Metrics:** entity error rate (wrong creator/title/year), unsupported-citation rate, quote-match rate, slot-rule violations (self-reference, medium-crossing).
- Runs against every prompt or pipeline change. Free-window tokens make large sweeps effectively free.

---

## 4. Stack

- **App:** Next.js on Vercel (already the deploy target) — frontend + API routes in one deploy; server-side orchestration replaces the dumb proxy.
- **DB:** Postgres (Neon or Supabase).
- **Queue/jobs:** Vercel cron + DB-backed queue to start; Inngest if job orchestration outgrows it.
- **Models:** `claude-fable-5` for mix generation, grounded writing, and research agents; Haiku for disambiguation ranking, connection context, slot alternatives. Structured outputs everywhere — deletes the hand-rolled SSE JSON parser and all "respond ONLY with valid JSON" scaffolding.
- **Agents:** Claude Agent SDK with web search + fetch tools for the offline pipeline.

---

## 5. Salvage list (explicit)

Carried forward from kynda2:
- **DECISIONS.md** — the actual IP: slot taxonomy, disambiguation tiers, interaction models, rejected paths, signal-integrity phasing.
- **Prompts** — become the generation-stage starting points.
- **Design system** — Instrument Serif / DM Mono / DM Sans, slot colors, typewriter pacing, dark editorial layout.
- **D3 graph component** — the "let D3 own the SVG" insight (AD-04) ports directly.
- **Disambiguation UX** — certain/likely/ambiguous flows, now retrieval-first.
- **curated/ format + CORRECTIONS.md** — seed the review layer and the eval golden set.

Left behind: the 2,450-line monolith, client-side orchestration, string-keyed in-memory cache, streaming JSON parser, self-reported confidence.

---

## 6. Phases

**Phase 0 — Foundation (schema is the deliverable)**
New repo. Postgres schema for entities/claims/provenance/review. Eval harness with golden set. Design tokens ported. CI running evals.

**Phase 1 — Runtime pipeline (ship parity + trust)**
Retrieval-first disambiguation → generation with structured outputs → entity verification → provenance badges → grounded reasons where Wikipedia extracts suffice. Feature parity with kynda2 (Mix, Graph, Connections, alternatives) but every badge machine-assigned. Old deployment stays live until this ships.

**Phase 2 — Agentic corpus (spend the free window here)**
Research agent + deterministic verifier + queue. Batch-run the top ~500–1,000 subjects. Runtime path flips to corpus-first for covered subjects. This phase is the priority for free Fable 5 tokens — it produces the permanent asset.

**Phase 3 — Curation layer**
Review UI over the claims store. Human-curated claims outrank agent claims. Artist/critic/fan perspective toggles (DECISIONS.md Phases 5–6) become data-model queries, not new architecture.

---

## 7. Risks, honestly

- **Agents hallucinating sources** — mitigated structurally by fetch-and-match; unconfirmed claims can never earn the `verified` badge. This is the load-bearing mitigation; everything depends on it staying deterministic.
- **Link rot / paywalls** — archive.org snapshot at ingest; paywalled citations stay `sourced`, one tier down.
- **Rewrite sprawl** — Phase 1 scope is parity + trust, nothing else. No mobile, no new features until the pipeline ships.
- **Free window ends** — corpus batch jobs front-loaded; runtime costs stay modest because corpus hits replace generation calls (better than the old cache: verified, persistent, shared).
- **Reason prose remains interpretive** — even grounded writing paraphrases. The UI mitigation: quotes and links shown alongside, so users can check the primary source in one click.
