# Kynda v2 — Decision Log

Last updated: 2026-02-14

---

## Product Vision

**Kynda** is a contextual recommendation engine that maps the influences, connections, and legacy of any work of culture — music, film, literature, art, television, and beyond.

**Core outputs:**
- **KyndaMix:** 8 curated influence slots (titan, ghost, geography, culture, peer, essential, legacy, collaborator)
- **Influence Graph:** Force-directed visualization of predecessors, peers, and successors

**Terminology:** Never use "cultural DNA" — rejected as clinical/forensic. Kynda is a "contextual recommendation engine."

---

## Architecture Decisions

### AD-01: Two-call architecture (Disambiguate → Mix)
**Decision:** Split the AI interaction into two sequential calls rather than one monolithic call.
**Rationale:** Call 1 (disambiguation) returns in ~1s, letting the subject card appear immediately. Call 2 (full mix) takes 4-8s but the user already has context. Progressive loading beats a blank screen.

### AD-02: Three-tier disambiguation
**Decision:** Three confidence levels — certain, likely, ambiguous.
- **Certain:** Unambiguous queries (Radiohead) → proceed immediately, zero friction
- **Likely:** Dominant match with alternatives worth noting → show subject + inline alternatives bar ("Not this one?")
- **Ambiguous:** No clear frontrunner → pause, show full choice card before firing mix
**Rationale:** Avoids bombarding users with disambiguation for obvious queries while handling genuine ambiguity gracefully.

### AD-03: Claude over Gemini
**Decision:** Switched from Gemini 3 to Claude Sonnet 4.5 for the rebuild.
**Rationale:** Original Gemini build was slow (~8,700 lines, 4-7s before anything appeared, brittle). Claude's output quality for the mix descriptions is significantly better. Cost difference addressed via tiered model strategy (AD-08).

### AD-04: D3 force simulation for graph
**Decision:** Use D3's force simulation with SVG rendering, letting D3 own the simulation entirely.
**Rationale:** Previous approach (manual canvas layout) produced static, messy graphs. D3 force simulation gives organic, physics-based layout with draggable nodes. The key architectural insight: let D3 own the SVG, React just manages the container lifecycle. No fighting between D3 mutation and React rendering.

### AD-05: Graph is lazy-loaded
**Decision:** Graph data only fetches when user clicks the GRAPH tab.
**Rationale:** Most users will engage with the mix first. Lazy loading means you don't pay the API cost unless the user wants the graph. Once loaded, switching between mix/graph is instant.

### AD-06: Slot alternatives (MORE →)
**Decision:** Each mix card has a "MORE →" button that fetches 2-4 alternatives for that slot type. First tap fires an API call; subsequent taps cycle through the pre-fetched set instantly.
**Rationale:** Turns each slot into a mini-playlist of alternatives. Capped at 3-5 total (original + 2-4 alternatives) to prevent the uncanny infinite scroll where quality degrades. On-demand fetching means you only pay for slots users actually engage with.

### AD-07: Graph interaction model (tap for context, double-tap to navigate)
**Decision:** Single-click a graph node → shows connection context tooltip explaining the relationship. Double-click → navigates to that entity as a new subject.
**Rationale:** Two modes of discovery — understanding a connection vs. exploring a new subject. The tooltip includes a "Double-click to explore" hint. Connection context is generated via a separate API call (Haiku, cached).

### AD-08: Tiered model strategy
**Decision:** Use different Claude models for different call types:
| Call | Model | Rationale |
|---|---|---|
| Disambiguation | Haiku | Pattern matching, doesn't need deep reasoning |
| KyndaMix | Sonnet | Writing quality and accuracy matter |
| Graph generation | Sonnet | Needs cultural knowledge depth |
| Slot alternatives | Haiku | Shorter responses, simpler task |
| Connection context | Haiku | 2-3 sentence explanations |
**Rationale:** Haiku is ~3x cheaper than Sonnet. Using it for 4 of 6 call types cuts costs ~40% with minimal quality impact. The two calls where quality matters most (mix + graph) stay on Sonnet.

### AD-09: Caching layer
**Decision:** In-memory cache (Map) with 6-month TTL, keyed on normalized query strings. Cache versioning for invalidation.
**Rationale:** Influence data is stable — Radiohead's influences aren't changing next month. Caching eliminates repeat API calls entirely. For production, swap for Vercel KV or Redis so cache persists across serverless invocations. Estimated to eliminate 60-80% of API calls once user base has overlapping queries.
**TTL:** 6 months for all cache types (disambiguations, mixes, graphs, connection contexts).

### AD-10: Self-reference prohibition
**Decision:** Explicit prompt rule: "NEVER cite the subject as an influence on themselves." The only slot where the subject's own work belongs is "essential."
**Rationale:** Early results showed circular citations (Kid A as a key influence on Radiohead). Nonsensical.

### AD-11: Web search removed
**Decision:** Attempted and removed web search integration for recent/unknown works.
**Rationale:** Too fragile. Web search responses contain mixed block types (text, tool_use, tool_result) making JSON parsing unreliable. Model returned category groupings instead of specific works. Standard disambiguation handles the vast majority of queries. Knowledge gap affects a small percentage and shrinks as models update. Future solution: curated database APIs (TMDb, MusicBrainz) rather than LLM web search.

---

## Design Decisions

### DD-01: Two-panel layout
**Decision:** Navigation + output panel, content-first, dark editorial aesthetic.
**Rationale:** Magazine feel vs. data dashboard. Fonts: Instrument Serif (display), DM Mono (metadata), DM Sans (body). Muted color identity per slot type.

### DD-02: Typewriter animations
**Decision:** RevealText component with word-by-word fade-in. Bio: 55ms/word (400ms delay). Intro: 45ms/word (900ms delay). Connection context: 40ms/word (100ms delay).
**Rationale:** Creates a sense of the system "thinking" and revealing. Slower than typical typing animations to feel deliberate rather than performative.

### DD-03: Graph color scheme
**Decision:** Predecessors: #a8c8d8 (cool blue-gray), Peers: #e04040 (red), Successors: #8844cc (purple). Subject: dark fill with gold (#facc15) border. Preserved from original Gemini build.

### DD-04: Subject image handling
**Decision:** Wikipedia API for images, with SVG initial-based placeholder fallback.
**Rationale:** Wikipedia is the most reliable free image source. Placeholder ensures the UI never has empty image wells. Center graph node uses the subject image clipped to a circle.

### DD-05: Homepage copy
**Decision:** Title "Kynda", subtitle "(KIN-duh): Old Norse for 'to light up'" in italic gold, tagline "Discover the connections between your favorite works of culture, and the creators behind them." Search placeholder: "Map any creator or creation..."

---

## Cost Analysis

### Per-search cost (post-optimization):
- First hit: ~$0.03 (Haiku disambiguation + Sonnet mix)
- Cache hit: $0.00
- Graph (if requested): ~$0.03 additional
- Slot alternative (if requested): ~$0.005 each (Haiku)
- Connection context (if requested): ~$0.002 each (Haiku)

### At scale (1,000 DAU, 5 searches/day):
- Without caching: ~$150/day ($4,500/mo)
- With caching (est. 70% hit rate): ~$45/day ($1,350/mo)
- Further reduction possible with pre-computed popular subjects

### Future cost strategies (not yet implemented):
- **Pre-compute popular subjects:** Nightly batch job for Billboard/IMDb/streaming trending
- **Rate limiting:** Free tier capped at 10-15 searches/day
- **Gemini for specific layers:** Use Gemini Flash for disambiguation/alternatives (~30-50x cheaper than Sonnet)
- **Prompt compression:** Trim system prompts once engineering is stable

---

## Infrastructure

### Deployment: Vercel
- Frontend: Vite + React, builds to static
- API proxy: Serverless function at `/api/claude` (keeps API key server-side)
- GitHub repo: `brancato9000/kynda2` (separate from original Kynda)
- Environment variable: `ANTHROPIC_API_KEY`

### File structure:
```
kynda-deploy/
├── api/claude.js          # Vercel serverless proxy
├── src/
│   ├── main.jsx           # React entry point
│   └── KyndaApp.jsx       # Full application (~1700 lines)
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── .gitignore
```

---

## Known Limitations / Future Work

- **Knowledge cutoff:** Claude's training data has a cutoff. Very recent works (post-July 2025) may not be recognized. Future solution: curated database API integration.
- **In-memory cache:** Resets on page refresh / serverless cold start. Needs Vercel KV or Redis for production persistence.
- **Mobile responsive:** Not yet implemented.
- **Cost monitoring:** No usage tracking or billing dashboards yet.
- **Error handling:** Basic — could be more graceful for rate limits, network failures.
- **Graph layout on small screens:** Force simulation parameters may need tuning for narrow viewports.

---

## Backlog Decisions (2026-02-14, verbal session)

### AD-12: Three-tab navigation (Mix / Graph / Connections)
**Decision:** The results view becomes three tabs: Mix (curated playlist), Graph (influence map), and Connections (exploratory routes).
**Rationale:** The Mix is the hero content — a curated playlist experience. The Graph is a visual map. Connections is navigation — doorways to deeper exploration. These are fundamentally different modes and shouldn't be mixed together.

### AD-13: Subject-type-aware exploration
**Decision:** The Connections tab surfaces different exploratory routes depending on whether the subject is an artist/person vs. a work of culture, and what domain it's in.
**For a musical artist:** Origin/geography, discography, covers they perform, who covers them, instruments/gear, collaborators, band members.
**For a musical work (album/song):** Recording location/studio, full credits, covers of songs on this work, songs that are covers, instruments/gear used, producer/engineer details.
**For film/literature/etc.:** Domain-specific equivalents (TBD — start with music first).
**Rationale:** An artist has a career arc and body of work. A single work has contributors and a specific cultural moment. The exploration paths are structurally different.

### AD-14: Connections tab loads for free from mix data
**Decision:** The Connections tab's initial content is extracted from data already returned in the mix API call — collaborators mentioned in slot reasons, recording locations, covers references, etc. No additional API call fires when the user opens the tab.
**On-demand expansions** (deep gear research, full covers list, session musician deep-dive) fire separate API calls only when the user clicks into them. These are cached for 6 months.
**Rationale:** The mix call already contains rich metadata about the subject. Extracting and presenting it in a Connections tab costs zero additional API spend and zero latency. Heavy expansions are pay-as-you-go, only when the user actually wants them.

### AD-15: Start with music domain
**Decision:** Build the Connections tab for music first (artists + musical works), then extend to film, literature, etc.
**Rationale:** Music has the richest set of exploratory routes (covers, gear, recording locations, band members) and is the domain where the most user excitement was observed in the original product.

### AD-16: Covers as a signal
**Decision:** Covers (both "who covers this artist" and "who covered songs from this work") are a high-priority connection type. Users responded very positively to this in the original product.
**Rationale:** Covers are a concrete, verifiable signal of influence — more tangible than "this artist was inspired by." They work at both the artist level and the work level.

### AD-17: Instruments & gear
**Decision:** Understanding the tools used to create a work of culture is a distinct exploratory route. For music: specific instruments, amplifiers, pedals, recording equipment, production techniques. For an artist: their signature gear and how it shapes their sound.
**Rationale:** Users got excited about this in the original product. An artist's tools are inextricably linked to their identity — Eric Clapton's sound is inseparable from his guitar choices. This is a unique angle that most recommendation engines don't surface.
