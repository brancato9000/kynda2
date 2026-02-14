import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

// ─── DATA MODEL v2.0 ──────────────────────────────────────────

const MIX_SLOT_TYPES = [
  { id: "titan", label: "Key Influence", emoji: "◆", description: "A foundational work cited as a seminal influence" },
  { id: "ghost", label: "Hidden Thread", emoji: "◇", description: "An obscure or avant-garde influence not widely recognized" },
  { id: "geography", label: "Local Roots", emoji: "◈", description: "A connection rooted in shared geography or scene" },
  { id: "culture", label: "Beyond the Medium", emoji: "✦", description: "An influence from outside the subject's primary domain" },
  { id: "peer", label: "Peer", emoji: "◎", description: "A contemporary working in similar creative orbit" },
  { id: "essential", label: "From the Canon", emoji: "★", description: "A definitive work from the subject themselves" },
  { id: "legacy", label: "Legacy", emoji: "▹", description: "A successor carrying the creative torch forward" },
  { id: "collaborator", label: "Key Collaborator", emoji: "⊕", description: "A crucial creative partner who shaped the work" },
];

const SLOT_COLORS = {
  titan: { bg: "rgba(255,140,50,0.06)", border: "rgba(255,140,50,0.22)", text: "#ff8c32" },
  ghost: { bg: "rgba(148,163,184,0.04)", border: "rgba(148,163,184,0.15)", text: "#94a3b8" },
  geography: { bg: "rgba(56,189,248,0.05)", border: "rgba(56,189,248,0.18)", text: "#38bdf8" },
  culture: { bg: "rgba(168,85,247,0.05)", border: "rgba(168,85,247,0.18)", text: "#a855f7" },
  peer: { bg: "rgba(251,113,133,0.05)", border: "rgba(251,113,133,0.18)", text: "#fb7185" },
  essential: { bg: "rgba(250,204,21,0.05)", border: "rgba(250,204,21,0.18)", text: "#facc15" },
  legacy: { bg: "rgba(52,211,153,0.05)", border: "rgba(52,211,153,0.18)", text: "#34d399" },
  collaborator: { bg: "rgba(129,140,248,0.05)", border: "rgba(129,140,248,0.18)", text: "#818cf8" },
};

// ─── AI SERVICE — DISAMBIGUATE → RESOLVE → MIX ────────────────
// Call 1 (fast): Disambiguate — identify what they meant, with confidence
// Call 2 (full): KyndaMix — only fires once subject is resolved
//
// Three tiers:
//   "certain"  → one clear match, proceed immediately (fires mix in parallel)
//   "likely"   → dominant match + alternatives shown inline (proceeds, user can redirect)
//   "ambiguous" → no clear winner, user must choose before mix fires

const DISAMBIGUATE_SYSTEM_PROMPT = `You are a cultural encyclopedia specializing in disambiguation. Given a search query, determine what cultural entity the user most likely means.

RULES:
- Consider ALL cultural domains: music (artists, albums, songs), film, television, literature, art, design, architecture, theater.
- Search broadly. A query like "one battle after another" could be a film, a song, a book, a documentary — check all possibilities.
- Evaluate how well-known each possible match is. A globally famous entity always outranks an obscure one.
- CRITICAL: Every entry (primary and each alternative) must be ONE SPECIFIC work or artist with a SPECIFIC year. Never group multiple works together (e.g. NEVER "various songs" or "multiple films"). If you know of 3 songs with this title, list each as a separate alternative with its specific artist and year.
- If you cannot identify a specific work with a specific year and creator, do NOT include it.

CONFIDENCE TIERS:
- "certain": The query unambiguously refers to one entity. Examples: "Radiohead", "Frida Kahlo", "The Godfather". Only use this when there is truly NO other cultural work with this name.
- "likely": One interpretation is clearly dominant but other legitimate cultural works share the name. Use this whenever 2+ real cultural works share the name but one is significantly more famous.
- "ambiguous": Multiple interpretations have meaningful cultural weight, or the query is a common phrase that could refer to several works with no obvious frontrunner.

IMPORTANT: Err on the side of "likely" over "certain". If there is ANY other cultural work with the same or very similar name, do NOT use "certain" — use "likely" at minimum.

For the primary match and each alternative, provide: name, domain, year, and a brief distinguisher (10-15 words max). The distinguisher MUST include the creator/artist name.

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "confidence": "certain|likely|ambiguous",
  "primary": {
    "name": "Full canonical name",
    "domain": "Music|Film|Literature|Art|Television|Design|Architecture|Theater",
    "bio": "2-3 sentences on artistic significance. Be specific — mention key works, movements, and cultural impact.",
    "yearsActive": "YYYY-Present or YYYY-YYYY",
    "genres": ["genre1", "genre2", "genre3"],
    "distinguisher": "Brief 10-15 word identifier including creator name"
  },
  "alternatives": [
    {
      "name": "Full name — Creator Name",
      "domain": "Domain",
      "year": "YYYY",
      "distinguisher": "Brief 10-15 word identifier including creator name"
    }
  ]
}

If confidence is "certain", alternatives should be an empty array.
If confidence is "likely", include 1-3 alternatives — each a SPECIFIC work with a SPECIFIC year.
If confidence is "ambiguous", primary should be your best guess but alternatives must include ALL significant matches — each a SPECIFIC work.`;

const MIX_SYSTEM_PROMPT = `You are Kynda, a contextual recommendation engine. You map the influences, connections, and legacy of any work of culture — music, film, literature, art, design, television, architecture, and beyond.

Create a "KyndaMix": 8 connected works that illuminate the influences, peers, and legacy of a given subject. Each slot has a specific role:

1. titan — The KEY influence. A foundational work or artist explicitly cited as a major inspiration. Find documented evidence.
2. ghost — The HIDDEN thread. An obscure, avant-garde, or under-documented influence that most people wouldn't know about. This is the most important slot for discovery — dig deep and surprise.
3. geography — LOCAL ROOTS. A connection rooted in the same city, region, or cultural scene.
4. culture — BEYOND THE MEDIUM. An influence from OUTSIDE the subject's primary domain. If music → find film, literature, or art. If film → find music, literature, etc. MUST cross mediums.
5. peer — A CONTEMPORARY working in a similar orbit during the same era.
6. essential — FROM THE CANON. A definitive, essential work by the subject themselves. Creator = the subject.
7. legacy — A SUCCESSOR who carries the creative torch, citing the subject as influence.
8. collaborator — A KEY CREATIVE PARTNER (producer, co-writer, cinematographer, bandmate, etc.) who shaped the work.

CRITICAL RULES:
- Each item's "reason" MUST be 425-475 characters. This is a hard requirement — count carefully. The reason must contain SPECIFIC historical context: cite specific works, interviews, documented quotes, collaborations, or historical events. No generic descriptions.
- NEVER cite the subject as an influence on themselves. No work by the subject should appear in titan, ghost, geography, culture, peer, legacy, or collaborator slots. The ONLY slot where the subject's own work belongs is "essential."
- The "ghost" slot is the most important for discovery — find something genuinely surprising and obscure.
- The "culture" slot MUST be from a different medium than the subject's primary domain.
- For the "essential" slot, the creator field should be the subject themselves.
- Prioritize accuracy. If a connection is rumored or based on "vibes," exclude it.

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "intro": "2-3 sentences contextualizing this KyndaMix for the subject",
  "items": [
    {
      "slotType": "titan",
      "title": "Work title",
      "creator": "Creator name",
      "year": "YYYY",
      "reason": "425-475 characters of specific historical context with cited evidence"
    }
  ]
}

Emit items in EXACTLY this order: titan, ghost, geography, culture, peer, essential, legacy, collaborator.`;

const SLOT_ALTS_PROMPT = `You generate alternative entries for a specific KyndaMix slot. Given a subject and a slot type, produce 2-4 additional entries that fit the same role.

SLOT DEFINITIONS:
- titan: Key influences explicitly cited as major inspirations
- ghost: Obscure, avant-garde, under-documented influences — dig deep
- geography: Connections rooted in the same city, region, or cultural scene
- culture: Influences from OUTSIDE the subject's primary domain — must cross mediums
- peer: Contemporaries working in a similar orbit during the same era
- essential: Definitive works by the subject themselves
- legacy: Successors who carry the creative torch
- collaborator: Crucial creative partners who shaped the work

RULES:
- Each "reason" MUST be 425-475 characters with SPECIFIC historical context
- Do NOT repeat any of the excluded entries
- NEVER cite the subject as an influence on themselves — no works by the subject unless the slot type is "essential"
- Prioritize accuracy over vibes

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "items": [
    {
      "slotType": "the_slot_type",
      "title": "Work title",
      "creator": "Creator name",
      "year": "YYYY",
      "reason": "425-475 characters of specific historical context"
    }
  ]
}`;

async function fetchSlotAlternatives(subjectName, slotType, excludeNames, subjectContext) {
  let userMessage = `Generate 2-4 more "${slotType}" entries for: "${subjectName}"\n\nExclude these (already shown): ${excludeNames.join(", ")}`;
  if (subjectContext?.domain) userMessage += `\nDomain: ${subjectContext.domain}`;
  const data = await callHaiku(SLOT_ALTS_PROMPT, userMessage);
  return (data.items || []).map((item) => ({ ...item, slotType }));
}

const GRAPH_SYSTEM_PROMPT = `You generate influence graphs for cultural works and creators. Given a subject, produce a JSON object with predecessors (influences), peers (contemporaries), and successors (legacy).

RULES:
- Generate 6-8 predecessors, 5-7 peers, and 5-7 successors — all within the subject's PRIMARY domain.
- Each node needs: name, year (debut/release), and significance (1-10 scale, where 10 = most culturally significant).
- significance determines node size in the visualization. Be thoughtful — The Godfather is a 10, a minor regional show is a 3.
- Predecessors are works/creators that directly influenced the subject.
- Peers are contemporaries working in the same era and domain.
- Successors are works/creators that cite the subject as an influence or clearly carry its legacy.
- Every node must be a SPECIFIC, real work or creator. No generic entries.

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "domain": "The primary domain label (e.g. TELEVISION, MUSIC, FILM, LITERATURE)",
  "predecessors": [
    { "name": "Work or Creator name", "year": "YYYY", "significance": 8 }
  ],
  "peers": [
    { "name": "Work or Creator name", "year": "YYYY", "significance": 7 }
  ],
  "successors": [
    { "name": "Work or Creator name", "year": "YYYY", "significance": 6 }
  ]
}`;

// ─── CACHE LAYER ──────────────────────────────────────────────
// In-memory cache for the prototype. In production, swap for Redis/Vercel KV.
// Keys are normalized query strings. Values include version for invalidation.

const CACHE_VERSION = 1;
const cache = new Map();

function cacheKey(prefix, query) {
  return `${prefix}:v${CACHE_VERSION}:${query.toLowerCase().trim()}`;
}

function cacheGet(prefix, query) {
  const key = cacheKey(prefix, query);
  const entry = cache.get(key);
  if (!entry) return null;
  // TTL: 6 months — influence data is stable
  const ttlMs = 180 * 86400000;
  if (Date.now() - entry.ts > ttlMs) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(prefix, query, data) {
  const key = cacheKey(prefix, query);
  cache.set(key, { data, ts: Date.now() });
  // Cap cache size at 500 entries (LRU would be better, but fine for prototype)
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// ─── TIERED AI SERVICE ────────────────────────────────────────
// Sonnet: mix generation, graph, connection context (quality matters)
// Haiku: disambiguation, slot alternatives (speed + cost)

const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";

const IS_ARTIFACT = typeof window !== "undefined" &&
  (window.location.hostname.includes("claude") || window.location.hostname === "localhost");
const API_ENDPOINT = IS_ARTIFACT
  ? "https://api.anthropic.com/v1/messages"
  : "/api/claude";

async function callModel(model, systemPrompt, userMessage) {
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await response.json();
  const text = data.content
    ?.map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("");
  if (!text) throw new Error("Empty response from AI");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// Convenience wrappers
const callSonnet = (sys, msg) => callModel(SONNET, sys, msg);
const callHaiku = (sys, msg) => callModel(HAIKU, sys, msg);

// ─── CACHED + TIERED FETCH FUNCTIONS ──────────────────────────

function fetchKynda(query, callbacks) {
  const { onSubject, onAlternatives, onIntro, onSlot, onError, onComplete, checkCancelled } = callbacks;

  // Check disambiguation cache first
  const cachedDisamb = cacheGet("disamb", query);
  const disambPromise = cachedDisamb
    ? Promise.resolve(cachedDisamb)
    : callHaiku(DISAMBIGUATE_SYSTEM_PROMPT, `Identify: "${query}"`)
        .then((data) => { cacheSet("disamb", query, data); return data; });

  disambPromise
    .then((data) => {
      if (checkCancelled()) return;

      const confidence = data.confidence || "certain";
      const subject = data.primary;

      if (confidence === "ambiguous") {
        onAlternatives({ confidence, primary: subject, alternatives: data.alternatives || [] });
        return;
      }

      onSubject(subject);

      if (confidence === "likely" && data.alternatives?.length > 0) {
        onAlternatives({ confidence, primary: subject, alternatives: data.alternatives });
      }

      fireMix(subject.name, callbacks, subject);
    })
    .catch((err) => {
      if (!checkCancelled()) onError(err.message || "Failed to identify subject");
    });
}

function fireMix(resolvedName, callbacks, subjectContext) {
  const { onIntro, onSlot, onError, onComplete, checkCancelled } = callbacks;

  let userMessage = `Create a KyndaMix for: "${resolvedName}"`;
  if (subjectContext) {
    const parts = [];
    if (subjectContext.domain) parts.push(`Domain: ${subjectContext.domain}`);
    if (subjectContext.year || subjectContext.yearsActive) parts.push(`Year: ${subjectContext.year || subjectContext.yearsActive}`);
    if (subjectContext.distinguisher) parts.push(`Description: ${subjectContext.distinguisher}`);
    if (subjectContext.bio) parts.push(`Bio: ${subjectContext.bio}`);
    if (parts.length > 0) {
      userMessage = `Create a KyndaMix for: "${resolvedName}"\n\nThis specifically refers to:\n${parts.join("\n")}`;
    }
  }

  // Check mix cache
  const cachedMix = cacheGet("mix", resolvedName);
  const mixPromise = cachedMix
    ? Promise.resolve(cachedMix)
    : callSonnet(MIX_SYSTEM_PROMPT, userMessage)
        .then((data) => { cacheSet("mix", resolvedName, data); return data; });

  mixPromise
    .then(async (data) => {
      if (checkCancelled()) return;
      if (data.intro) onIntro(data.intro);
      if (data.items && Array.isArray(data.items)) {
        for (let i = 0; i < data.items.length; i++) {
          if (checkCancelled()) return;
          await new Promise((r) => setTimeout(r, i === 0 ? 60 : 280));
          onSlot(data.items[i], i);
        }
      }
    })
    .catch((err) => {
      if (!checkCancelled()) onError(err.message || "Failed to generate KyndaMix");
    })
    .finally(() => {
      if (!checkCancelled()) onComplete();
    });
}

async function fetchGraph(resolvedName, subjectContext) {
  // Check graph cache
  const cachedGraph = cacheGet("graph", resolvedName);
  if (cachedGraph) return cachedGraph;

  let userMessage = `Generate an influence graph for: "${resolvedName}"`;
  if (subjectContext) {
    const parts = [];
    if (subjectContext.domain) parts.push(`Domain: ${subjectContext.domain}`);
    if (subjectContext.year || subjectContext.yearsActive) parts.push(`Year: ${subjectContext.year || subjectContext.yearsActive}`);
    if (subjectContext.bio) parts.push(`Bio: ${subjectContext.bio}`);
    if (parts.length > 0) userMessage += `\n\nThis specifically refers to:\n${parts.join("\n")}`;
  }
  const data = await callSonnet(GRAPH_SYSTEM_PROMPT, userMessage);
  cacheSet("graph", resolvedName, data);
  return data;
}

// Generate a simple initial-based placeholder
function placeholderImage(name, color = "#2a2b35") {
  const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="${color}"/>
    <text x="200" y="215" text-anchor="middle" font-family="sans-serif" font-size="120" fill="rgba(255,255,255,0.15)">${initials}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function fetchWikiImage(query, domain) {
  try {
    let sq = query;
    if (domain) {
      const d = domain.toLowerCase();
      if (d.includes("music")) sq = `${query} (musician)`;
      else if (d.includes("film")) sq = `${query} (film)`;
      else if (d.includes("art")) sq = `${query} (artist)`;
      else if (d.includes("liter")) sq = `${query} (author)`;
    }
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(sq)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=400`;
    const res = await fetch(url);
    if (!res.ok) return placeholderImage(query);
    const data = await res.json();
    if (!data.query?.pages) return placeholderImage(query);
    const page = Object.values(data.query.pages)[0];
    return page?.thumbnail?.source || placeholderImage(query);
  } catch { return placeholderImage(query); }
}

// ─── COMPONENTS ────────────────────────────────────────────────

// Disambiguation: full choice card when ambiguous (Tier 3)
function DisambiguationCard({ data, onSelect }) {
  const allOptions = [data.primary, ...(data.alternatives || [])];
  return (
    <div style={{
      animation: "fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      marginBottom: "28px",
    }}>
      <div style={{
        fontSize: "13px", color: "rgba(203,213,225,0.6)",
        fontFamily: "'DM Sans', sans-serif", marginBottom: "16px", lineHeight: 1.6,
      }}>
        There are a few things that could be. Which one are you looking for?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {allOptions.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSelect(opt)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 18px", borderRadius: "6px",
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              cursor: "pointer", transition: "all 0.2s",
              textAlign: "left", width: "100%",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(250,204,21,0.06)";
              e.currentTarget.style.borderColor = "rgba(250,204,21,0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.025)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            }}
          >
            <div>
              <div style={{
                fontSize: "16px", fontWeight: 400, color: "#f1f5f9",
                fontFamily: "'Instrument Serif', serif", marginBottom: "3px",
              }}>
                {opt.name}
              </div>
              <div style={{
                fontSize: "12px", color: "rgba(148,163,184,0.55)",
                fontFamily: "'DM Sans', sans-serif",
              }}>
                {opt.distinguisher}
              </div>
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: "8px", flexShrink: 0,
            }}>
              <span style={{
                fontSize: "10px", padding: "3px 8px", borderRadius: "3px",
                background: "rgba(255,255,255,0.04)", color: "rgba(148,163,184,0.5)",
                fontFamily: "'DM Mono', monospace", letterSpacing: "0.03em",
                border: "1px solid rgba(255,255,255,0.05)",
              }}>
                {opt.domain}
              </span>
              {opt.year && (
                <span style={{
                  fontSize: "10px", color: "rgba(148,163,184,0.35)",
                  fontFamily: "'DM Mono', monospace",
                }}>
                  {opt.year || opt.yearsActive}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Inline alternatives bar for "likely" confidence (Tier 2)
function AlternativesBar({ alternatives, onSelect }) {
  if (!alternatives || alternatives.length === 0) return null;
  return (
    <div style={{
      marginBottom: "24px", padding: "10px 14px", borderRadius: "5px",
      background: "rgba(255,255,255,0.015)",
      border: "1px solid rgba(255,255,255,0.03)",
      animation: "fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
      }}>
        <span style={{
          fontSize: "11px", color: "rgba(148,163,184,0.4)",
          fontFamily: "'DM Mono', monospace", letterSpacing: "0.03em",
          flexShrink: 0,
        }}>
          Not this one?
        </span>
        {alternatives.map((alt, i) => (
          <button
            key={i}
            onClick={() => onSelect(alt)}
            style={{
              padding: "4px 10px", borderRadius: "4px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              cursor: "pointer", transition: "all 0.2s",
              fontSize: "11px", color: "rgba(148,163,184,0.55)",
              fontFamily: "'DM Sans', sans-serif",
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = "rgba(250,204,21,0.2)";
              e.target.style.color = "rgba(250,204,21,0.7)";
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = "rgba(255,255,255,0.06)";
              e.target.style.color = "rgba(148,163,184,0.55)";
            }}
            title={alt.distinguisher}
          >
            {alt.name} <span style={{ opacity: 0.5 }}>({alt.domain}{alt.year ? `, ${alt.year}` : ""})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── INFLUENCE GRAPH ───────────────────────────────────────────

// Connection context prompt — explains the relationship between two nodes
const CONNECTION_CONTEXT_PROMPT = `You explain the connection between two cultural entities in 2-3 sentences (150-200 characters). Be specific — cite documented influences, shared collaborators, interviews, or historical events. No vague claims. Respond with ONLY the text, no JSON, no markdown.`;

async function fetchConnectionContext(subjectName, nodeName, relationship) {
  // Check cache
  const ckey = `${subjectName}::${nodeName}`.toLowerCase().trim();
  const cached = cacheGet("conn", ckey);
  if (cached) return cached;

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 300,
      system: CONNECTION_CONTEXT_PROMPT,
      messages: [{ role: "user", content: `Explain the ${relationship} connection between "${subjectName}" and "${nodeName}".` }],
    }),
  });
  const data = await response.json();
  const text = data.content?.map((b) => b.type === "text" ? b.text : "").join("") || "";
  if (text) cacheSet("conn", ckey, text);
  return text;
}

function InfluenceGraph({ graphData, subjectName, subjectImage, onNavigate }) {
  const containerRef = useRef(null);
  const simRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [connectionContext, setConnectionContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const clickTimerRef = useRef(null);

  // Handle single tap (context) vs double tap (navigate)
  const handleNodeInteraction = useCallback((d) => {
    if (d.type === "subject") return;

    if (clickTimerRef.current) {
      // Double click — navigate
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      setSelectedNode(null);
      setConnectionContext(null);
      onNavigate(d.name);
    } else {
      // Single click — show context (after delay to detect double)
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        setSelectedNode(d);
        setConnectionContext(null);
        setContextLoading(true);

        const relationship = d.type === "predecessor" ? "influence"
          : d.type === "successor" ? "legacy" : "peer";
        fetchConnectionContext(subjectName, d.name, relationship)
          .then((text) => setConnectionContext(text))
          .catch(() => setConnectionContext("Could not load connection details."))
          .finally(() => setContextLoading(false));
      }, 280);
    }
  }, [subjectName, onNavigate]);

  useEffect(() => {
    if (!graphData || !containerRef.current) return;

    const container = containerRef.current;
    // Clear previous SVG only (preserve React children like legend and tooltip)
    d3.select(container).selectAll("svg").remove();

    const w = container.clientWidth;
    const h = container.clientHeight;

    const nodes = [];
    const links = [];

    const subjectNode = {
      id: "subject", name: subjectName, type: "subject",
      significance: 10, r: 44, fx: w / 2, fy: h / 2,
    };
    nodes.push(subjectNode);

    const addGroup = (items, type, targetX) => {
      (items || []).forEach((item, i) => {
        const r = 16 + (item.significance / 10) * 24;
        nodes.push({
          id: `${type}-${i}`, name: item.name, type, year: item.year,
          significance: item.significance, r,
          x: targetX + (Math.random() - 0.5) * 120,
          y: h / 2 + (Math.random() - 0.5) * (h * 0.6),
        });
        if (type === "predecessor") links.push({ source: `${type}-${i}`, target: "subject", type });
        else if (type === "successor") links.push({ source: "subject", target: `${type}-${i}`, type });
      });
    };

    addGroup(graphData.predecessors, "predecessor", w * 0.18);
    addGroup(graphData.peers, "peer", w * 0.5);
    addGroup(graphData.successors, "successor", w * 0.82);

    const typeColors = {
      predecessor: { fill: "#a8c8d8", stroke: "rgba(168,200,216,0.3)" },
      peer: { fill: "#e04040", stroke: "rgba(224,64,64,0.3)" },
      successor: { fill: "#8844cc", stroke: "rgba(136,68,204,0.3)" },
      subject: { fill: "#1a1b22", stroke: "rgba(250,204,21,0.5)" },
    };

    const svg = d3.select(container)
      .append("svg")
      .attr("width", w)
      .attr("height", h)
      .style("background", "transparent")
      .style("position", "absolute")
      .style("top", 0)
      .style("left", 0);

    // Defs: arrowheads + clip path for subject image
    const defs = svg.append("defs");

    ["predecessor", "successor"].forEach((type) => {
      defs.append("marker")
        .attr("id", `arrow-${type}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 10).attr("refY", 0)
        .attr("markerWidth", 7).attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4")
        .attr("fill", typeColors[type].stroke);
    });

    // Clip path for subject image
    defs.append("clipPath")
      .attr("id", "subject-clip")
      .append("circle")
      .attr("r", subjectNode.r - 3);

    // Curved link paths instead of straight lines
    const linkGroup = svg.append("g");
    const link = linkGroup.selectAll("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", (d) => typeColors[d.type].stroke)
      .attr("stroke-width", 1.2)
      .attr("marker-end", (d) => `url(#arrow-${d.type})`);

    // Node groups
    const nodeGroup = svg.append("g");
    const node = nodeGroup.selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", (d) => d.type === "subject" ? "default" : "pointer");

    // Colored circles for non-subject nodes
    node.filter((d) => d.type !== "subject")
      .append("circle")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => typeColors[d.type].fill)
      .attr("opacity", (d) => 0.65 + (d.significance / 10) * 0.35)
      .attr("stroke", "none");

    // Subject node: image circle with gold border
    const subjectG = node.filter((d) => d.type === "subject");

    // Background circle
    subjectG.append("circle")
      .attr("r", subjectNode.r)
      .attr("fill", "#1a1b22")
      .attr("stroke", "rgba(250,204,21,0.5)")
      .attr("stroke-width", 3);

    // Subject image (clipped to circle)
    if (subjectImage) {
      subjectG.append("image")
        .attr("href", subjectImage)
        .attr("x", -subjectNode.r + 3)
        .attr("y", -subjectNode.r + 3)
        .attr("width", (subjectNode.r - 3) * 2)
        .attr("height", (subjectNode.r - 3) * 2)
        .attr("clip-path", "url(#subject-clip)")
        .attr("preserveAspectRatio", "xMidYMid slice");
    }

    // Labels
    node.append("text")
      .text((d) => d.name)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.r + 16)
      .attr("fill", "rgba(220,230,240,0.8)")
      .attr("font-size", (d) => d.type === "subject" ? "14px" : `${Math.max(10, 9 + d.significance * 0.4)}px`)
      .attr("font-weight", (d) => d.type === "subject" ? "600" : "400")
      .attr("font-family", "'DM Sans', sans-serif")
      .attr("pointer-events", "none");

    // Year labels
    node.filter((d) => d.year && d.type !== "subject")
      .append("text")
      .text((d) => d.year)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.r + 30)
      .attr("fill", "rgba(148,163,184,0.35)")
      .attr("font-size", "10px")
      .attr("font-family", "'DM Mono', monospace")
      .attr("pointer-events", "none");

    // Hover
    node.on("mouseenter", function (event, d) {
      if (d.type === "subject") return;
      d3.select(this).select("circle").transition().duration(150)
        .attr("opacity", 1).attr("stroke", typeColors[d.type].fill).attr("stroke-width", 2);
    });
    node.on("mouseleave", function (event, d) {
      if (d.type === "subject") return;
      d3.select(this).select("circle").transition().duration(200)
        .attr("opacity", 0.65 + (d.significance / 10) * 0.35)
        .attr("stroke", "none").attr("stroke-width", 0);
    });

    // Click — routed through the interaction handler
    node.on("click", (event, d) => handleNodeInteraction(d));

    // Force simulation
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(150).strength(0.25))
      .force("charge", d3.forceManyBody().strength((d) => d.type === "subject" ? -500 : -130))
      .force("collide", d3.forceCollide((d) => d.r + 16).strength(0.8))
      .force("x", d3.forceX((d) => {
        if (d.type === "subject") return w / 2;
        if (d.type === "predecessor") return w * 0.2;
        if (d.type === "peer") return w * 0.5;
        return w * 0.8;
      }).strength(0.12))
      .force("y", d3.forceY(h / 2).strength(0.06))
      .alphaDecay(0.02)
      .on("tick", () => {
        nodes.forEach((d) => {
          if (d.id !== "subject") {
            d.x = Math.max(d.r + 5, Math.min(w - d.r - 5, d.x));
            d.y = Math.max(d.r + 30, Math.min(h - d.r - 45, d.y));
          }
        });

        // Curved paths
        link.attr("d", (d) => {
          const sx = d.source.x, sy = d.source.y;
          const tx = d.target.x, ty = d.target.y;
          const dx = tx - sx, dy = ty - sy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          // End point shortened to stop at target node edge
          const ex = tx - (dx / dist) * (d.target.r + 6);
          const ey = ty - (dy / dist) * (d.target.r + 6);

          // Control point offset perpendicular to the line for curve
          const midX = (sx + ex) / 2;
          const midY = (sy + ey) / 2;
          const perpX = -(ey - sy) * 0.12;
          const perpY = (ex - sx) * 0.12;

          return `M${sx},${sy} Q${midX + perpX},${midY + perpY} ${ex},${ey}`;
        });

        node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      });

    simRef.current = simulation;

    // Drag
    const drag = d3.drag()
      .on("start", (event, d) => {
        if (d.type === "subject") return;
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        if (d.type === "subject") return;
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (d.type === "subject") return;
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });

    node.call(drag);

    // Domain watermark
    if (graphData.domain) {
      svg.append("text")
        .text(graphData.domain)
        .attr("x", w - 24).attr("y", h - 20)
        .attr("text-anchor", "end")
        .attr("fill", "rgba(255,255,255,0.04)")
        .attr("font-size", "72px")
        .attr("font-weight", "bold")
        .attr("font-family", "'DM Sans', sans-serif")
        .attr("pointer-events", "none");
    }

    return () => { simulation.stop(); };
  }, [graphData, subjectName, subjectImage, handleNodeInteraction]);

  if (!graphData) return null;

  return (
    <div ref={containerRef} style={{
      width: "100%", height: "100%", position: "relative",
      animation: "fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      {/* Connection context tooltip */}
      {selectedNode && (
        <div style={{
          position: "absolute", bottom: "60px", left: "50%",
          transform: "translateX(-50%)",
          maxWidth: "420px", width: "90%",
          padding: "14px 18px", borderRadius: "8px",
          background: "rgba(15,16,22,0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          animation: "fadeInUp 0.3s ease",
          zIndex: 10,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: "8px",
          }}>
            <div>
              <span style={{
                fontSize: "14px", fontWeight: 500, color: "#f1f5f9",
                fontFamily: "'Instrument Serif', serif",
              }}>
                {selectedNode.name}
              </span>
              <span style={{
                fontSize: "10px", marginLeft: "8px",
                color: selectedNode.type === "predecessor" ? "#a8c8d8"
                  : selectedNode.type === "peer" ? "#e04040" : "#8844cc",
                fontFamily: "'DM Mono', monospace", textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}>
                {selectedNode.type === "predecessor" ? "INFLUENCE"
                  : selectedNode.type === "peer" ? "PEER" : "SUCCESSOR"}
              </span>
            </div>
            <button
              onClick={() => { setSelectedNode(null); setConnectionContext(null); }}
              style={{
                background: "none", border: "none", color: "rgba(148,163,184,0.4)",
                cursor: "pointer", fontSize: "16px", padding: "0 4px",
              }}
            >×</button>
          </div>
          <div style={{
            fontSize: "13px", lineHeight: 1.6,
            color: "rgba(203,213,225,0.7)",
            fontFamily: "'DM Sans', sans-serif",
            minHeight: "40px",
          }}>
            {contextLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "rgba(250,204,21,0.5)",
                  animation: "breathe 1.2s ease-in-out infinite",
                }} />
                <span style={{ color: "rgba(250,204,21,0.4)", fontSize: "12px" }}>
                  Finding connection...
                </span>
              </div>
            ) : connectionContext ? (
              <RevealText
                text={connectionContext}
                delay={100}
                speed={40}
                style={{
                  fontSize: "13px", lineHeight: 1.6,
                  color: "rgba(203,213,225,0.7)",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              />
            ) : null}
          </div>
          <div style={{
            marginTop: "10px", paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            fontSize: "10px", color: "rgba(148,163,184,0.3)",
            fontFamily: "'DM Mono', monospace",
          }}>
            Double-click to explore {selectedNode.name}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: "16px", right: "24px",
        display: "flex", gap: "20px", alignItems: "center", zIndex: 2,
      }}>
        {[
          { label: "INFLUENCES", color: "#a8c8d8" },
          { label: "PEERS", color: "#e04040" },
          { label: "SUCCESSORS", color: "#8844cc" },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
            <span style={{
              fontSize: "10px", color: "rgba(148,163,184,0.5)",
              fontFamily: "'DM Mono', monospace", letterSpacing: "0.06em",
            }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MixSlotCard({ item, index, isVisible, onNavigate, onNext, altCount, altIndex, altLoading }) {
  const slotMeta = MIX_SLOT_TYPES.find((s) => s.id === item.slotType) || MIX_SLOT_TYPES[0];
  const colors = SLOT_COLORS[item.slotType] || SLOT_COLORS.titan;
  const [imageUrl, setImageUrl] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    setImageUrl(null); setImgLoaded(false);
    if (isVisible && item.creator) {
      fetchWikiImage(item.creator).then((url) => { if (url) setImageUrl(url); });
    }
  }, [isVisible, item.creator, item.title]);

  return (
    <div style={{
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "translateY(0)" : "translateY(20px)",
      transition: "all 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
      borderLeft: `2px solid ${colors.border}`,
      background: colors.bg,
      marginBottom: "14px",
      borderRadius: "6px",
      overflow: "hidden",
    }}>
      <div style={{ padding: "18px 20px" }}>
        {/* Slot type + year + next arrow */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "10px",
        }}>
          <span style={{
            fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase",
            color: colors.text, fontFamily: "'DM Mono', monospace", fontWeight: 500,
          }}>
            {slotMeta.emoji} {slotMeta.label}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Position dots */}
            {altCount > 1 && (
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                {Array.from({ length: altCount }, (_, i) => (
                  <div key={i} style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: i === altIndex ? colors.text : "rgba(148,163,184,0.15)",
                    transition: "background 0.2s",
                  }} />
                ))}
              </div>
            )}
            {item.year && (
              <span style={{
                fontSize: "10px", color: "rgba(148,163,184,0.4)",
                fontFamily: "'DM Mono', monospace",
              }}>
                {item.year}
              </span>
            )}
            {/* Next arrow */}
            <button
              onClick={(e) => { e.stopPropagation(); onNext(item.slotType); }}
              disabled={altLoading}
              style={{
                background: "rgba(255,255,255,0.03)", 
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "4px", padding: "5px 10px",
                color: altLoading ? "rgba(250,204,21,0.3)" : "rgba(148,163,184,0.5)",
                cursor: altLoading ? "wait" : "pointer",
                fontSize: "13px", lineHeight: 1, transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: "5px",
                fontFamily: "'DM Mono', monospace",
                letterSpacing: "0.03em",
              }}
              onMouseEnter={(e) => { if (!altLoading) { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.text; e.currentTarget.style.background = colors.bg; }}}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(148,163,184,0.5)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              title="See another"
            >
              {altLoading ? (
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "rgba(250,204,21,0.5)",
                  animation: "breathe 1.2s ease-in-out infinite",
                }} />
              ) : (
                <><span style={{ fontSize: "10px" }}>MORE</span> →</>
              )}
            </button>
          </div>
        </div>

        {/* Title + image */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "14px" }}>
          {imageUrl && (
            <div style={{
              width: 64, height: 64, borderRadius: "5px", overflow: "hidden", flexShrink: 0,
              background: "rgba(255,255,255,0.03)",
              opacity: imgLoaded ? 1 : 0, transition: "opacity 0.4s ease",
            }}>
              <img
                src={imageUrl} alt=""
                onLoad={() => setImgLoaded(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: "19px", fontWeight: 400, color: "#f1f5f9",
              fontFamily: "'Instrument Serif', serif",
              lineHeight: 1.25, marginBottom: "4px",
            }}>
              {item.title}
            </div>
            <span
              onClick={() => onNavigate(item.creator)}
              style={{
                fontSize: "13px", color: colors.text,
                fontFamily: "'DM Sans', sans-serif",
                cursor: "pointer",
                borderBottom: "1px solid transparent",
                transition: "border-color 0.2s", display: "inline",
              }}
              onMouseEnter={(e) => e.target.style.borderBottomColor = colors.text}
              onMouseLeave={(e) => e.target.style.borderBottomColor = "transparent"}
              title={`Explore ${item.creator}`}
            >
              {item.creator}
            </span>
          </div>
        </div>

        {/* Reason */}
        <div style={{
          fontSize: "13.5px", lineHeight: 1.72,
          color: "rgba(203,213,225,0.72)",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {item.reason}
        </div>
      </div>
    </div>
  );
}

function SlotSkeleton({ index }) {
  return (
    <div style={{
      height: "185px", borderRadius: "6px", marginBottom: "14px",
      background: "rgba(255,255,255,0.012)",
      borderLeft: "2px solid rgba(255,255,255,0.035)",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.018) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 2s ease-in-out infinite",
        animationDelay: `${index * 0.15}s`,
      }} />
      <div style={{ padding: "18px 20px" }}>
        <div style={{ width: 90, height: 10, borderRadius: 3, background: "rgba(255,255,255,0.035)", marginBottom: 14 }} />
        <div style={{ width: 210, height: 17, borderRadius: 3, background: "rgba(255,255,255,0.035)", marginBottom: 8 }} />
        <div style={{ width: 130, height: 12, borderRadius: 3, background: "rgba(255,255,255,0.025)", marginBottom: 18 }} />
        <div style={{ width: "100%", height: 10, borderRadius: 3, background: "rgba(255,255,255,0.02)", marginBottom: 7 }} />
        <div style={{ width: "92%", height: 10, borderRadius: 3, background: "rgba(255,255,255,0.018)", marginBottom: 7 }} />
        <div style={{ width: "78%", height: 10, borderRadius: 3, background: "rgba(255,255,255,0.015)" }} />
      </div>
    </div>
  );
}

// Progressive text reveal — words fade in sequentially
function RevealText({ text, style, delay = 0, speed = 28 }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const words = (text || "").split(/(\s+)/); // preserve whitespace tokens

  useEffect(() => {
    setVisibleCount(0);
    if (!text) return;
    const wordTokens = words.filter((w) => w.trim().length > 0);
    const totalWords = wordTokens.length;
    let count = 0;
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        count++;
        setVisibleCount(count);
        if (count >= totalWords) clearInterval(interval);
      }, speed);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [text]);

  if (!text) return null;

  let wordIndex = 0;
  return (
    <p style={style}>
      {words.map((token, i) => {
        if (token.trim().length === 0) {
          return <span key={i}>{token}</span>;
        }
        const thisIndex = wordIndex++;
        const isVisible = thisIndex < visibleCount;
        return (
          <span
            key={i}
            style={{
              opacity: isVisible ? 1 : 0,
              filter: isVisible ? "none" : "blur(2px)",
              transition: "opacity 0.25s ease, filter 0.25s ease",
              display: "inline",
            }}
          >
            {token}
          </span>
        );
      })}
      {/* Blinking cursor at the reveal edge */}
      {visibleCount > 0 && visibleCount < words.filter((w) => w.trim()).length && (
        <span style={{
          display: "inline-block", width: "2px", height: "1em",
          background: "rgba(250,204,21,0.5)", marginLeft: "2px",
          verticalAlign: "text-bottom",
          animation: "breathe 0.8s ease-in-out infinite",
        }} />
      )}
    </p>
  );
}

function SubjectCard({ subject, imageUrl, intro }) {
  if (!subject) return null;
  return (
    <div style={{ marginBottom: "32px", animation: "fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}>
      <div style={{ display: "flex", gap: "18px", alignItems: "flex-start" }}>
        {imageUrl && (
          <div style={{
            width: 88, height: 88, borderRadius: "6px", overflow: "hidden", flexShrink: 0,
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase",
            color: "rgba(250,204,21,0.5)", fontFamily: "'DM Mono', monospace", marginBottom: "6px",
          }}>
            {subject.domain} {subject.yearsActive && `· ${subject.yearsActive}`}
          </div>
          <h1 style={{
            fontSize: "34px", fontWeight: 400, color: "#f1f5f9",
            fontFamily: "'Instrument Serif', serif", margin: 0, lineHeight: 1.12,
          }}>
            {subject.name}
          </h1>
          {subject.genres?.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
              {subject.genres.map((g, i) => (
                <span key={i} style={{
                  fontSize: "10px", padding: "3px 9px", borderRadius: "3px",
                  background: "rgba(255,255,255,0.03)", color: "rgba(148,163,184,0.6)",
                  fontFamily: "'DM Mono', monospace", letterSpacing: "0.03em",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <RevealText
        text={subject.bio}
        delay={400}
        speed={55}
        style={{
          fontSize: "14px", lineHeight: 1.7, color: "rgba(203,213,225,0.65)",
          fontFamily: "'DM Sans', sans-serif", marginTop: "18px",
        }}
      />
      <RevealText
        text={intro}
        delay={900}
        speed={45}
        style={{
          fontSize: "13px", lineHeight: 1.65, color: "rgba(148,163,184,0.5)",
          fontFamily: "'DM Sans', sans-serif", marginTop: "10px", fontStyle: "italic",
        }}
      />
    </div>
  );
}

function SearchInput({ onSearch, isLoading }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const handleSubmit = () => { const q = value.trim(); if (q && !isLoading) onSearch(q); };

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text" value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="Map any creator or creation..."
        style={{
          width: "100%", padding: "14px 18px", paddingRight: "80px",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px", outline: "none", color: "#e2e8f0", fontSize: "15px",
          fontFamily: "'DM Sans', sans-serif", transition: "all 0.3s", boxSizing: "border-box",
        }}
        onFocus={(e) => { e.target.style.borderColor = "rgba(250,204,21,0.3)"; e.target.style.background = "rgba(255,255,255,0.05)"; }}
        onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.background = "rgba(255,255,255,0.03)"; }}
      />
      <button
        onClick={handleSubmit} disabled={!value.trim()}
        style={{
          position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)",
          padding: "8px 16px",
          background: "rgba(250,204,21,0.12)",
          border: "1px solid rgba(250,204,21,0.18)", borderRadius: "5px",
          color: "rgba(250,204,21,0.85)",
          fontSize: "12px", fontFamily: "'DM Mono', monospace",
          letterSpacing: "0.08em", cursor: !value.trim() ? "default" : "pointer", transition: "all 0.2s",
        }}
      >
        {isLoading ? "···" : "KYNDA"}
      </button>
    </div>
  );
}

function SlotLegend() {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: "22px",
      paddingBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.03)",
    }}>
      {MIX_SLOT_TYPES.map((slot) => {
        const colors = SLOT_COLORS[slot.id];
        return (
          <div key={slot.id} style={{
            display: "flex", alignItems: "center", gap: "5px",
            fontSize: "10px", color: "rgba(148,163,184,0.4)",
            fontFamily: "'DM Mono', monospace",
          }} title={slot.description}>
            <span style={{ color: colors.text, fontSize: "8px" }}>{slot.emoji}</span>
            {slot.label}
          </div>
        );
      })}
    </div>
  );
}

function HistoryBreadcrumb({ history, onNavigate }) {
  if (history.length <= 1) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap",
      marginBottom: "18px", fontSize: "11px", color: "rgba(148,163,184,0.4)",
      fontFamily: "'DM Mono', monospace",
    }}>
      {history.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {i > 0 && <span style={{ color: "rgba(148,163,184,0.15)" }}>→</span>}
          <span
            onClick={() => i < history.length - 1 && onNavigate(item)}
            style={{
              cursor: i < history.length - 1 ? "pointer" : "default",
              color: i === history.length - 1 ? "rgba(250,204,21,0.5)" : "rgba(148,163,184,0.4)",
              textDecoration: i < history.length - 1 ? "underline" : "none",
              textUnderlineOffset: "3px",
            }}
          >{item}</span>
        </span>
      ))}
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────

export default function KyndaApp() {
  const [currentQuery, setCurrentQuery] = useState("");
  const [subject, setSubject] = useState(null);
  const [subjectImage, setSubjectImage] = useState(null);
  const [intro, setIntro] = useState(null);
  const [slots, setSlots] = useState([]);
  const [visibleSlots, setVisibleSlots] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [disambiguation, setDisambiguation] = useState(null);
  const [viewMode, setViewMode] = useState("mix"); // "mix" | "graph"
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [slotAlts, setSlotAlts] = useState({}); // { slotType: [item, item, ...] }
  const [slotAltIndex, setSlotAltIndex] = useState({}); // { slotType: currentIndex }
  const [slotAltLoading, setSlotAltLoading] = useState({}); // { slotType: bool }
  const requestIdRef = useRef(0);
  const contentRef = useRef(null);
  const callbacksRef = useRef(null); // store callbacks for deferred mix fire

  const handleSearch = useCallback((query) => {
    const thisId = ++requestIdRef.current;
    const checkCancelled = () => requestIdRef.current !== thisId;

    setCurrentQuery(query);
    setSubject(null); setSubjectImage(null); setIntro(null);
    setSlots([]); setVisibleSlots(new Set());
    setIsLoading(true); setError(null);
    setDisambiguation(null);
    setGraphData(null); setGraphLoading(false); setViewMode("mix");
    setSlotAlts({}); setSlotAltIndex({}); setSlotAltLoading({});
    setHistory((prev) => {
      const idx = prev.indexOf(query);
      if (idx !== -1) return prev.slice(0, idx + 1);
      return [...prev, query];
    });

    if (contentRef.current) contentRef.current.scrollTo({ top: 0, behavior: "smooth" });

    const callbacks = {
      checkCancelled,
      onSubject: (data) => {
        setSubject(data);
        fetchWikiImage(data.name, data.domain).then((url) => {
          if (!checkCancelled() && url) setSubjectImage(url);
        });
      },
      onAlternatives: (data) => {
        setDisambiguation(data);
        // If ambiguous, we're waiting — stop the loading indicator
        if (data.confidence === "ambiguous") setIsLoading(false);
      },
      onIntro: (text) => setIntro(text),
      onSlot: (item, index) => {
        setSlots((prev) => [...prev, item]);
        setTimeout(() => {
          if (!checkCancelled()) setVisibleSlots((prev) => new Set([...prev, index]));
        }, 60);
      },
      onError: (msg) => setError(msg),
      onComplete: () => setIsLoading(false),
    };
    callbacksRef.current = callbacks;

    fetchKynda(query, callbacks);
  }, []);

  // User selects from disambiguation choices
  const handleDisambiguationSelect = useCallback((selected) => {
    const thisId = ++requestIdRef.current;
    const checkCancelled = () => requestIdRef.current !== thisId;

    // Reset for fresh results
    setSubject(null); setSubjectImage(null); setIntro(null);
    setSlots([]); setVisibleSlots(new Set());
    setIsLoading(true); setError(null);
    setDisambiguation(null);

    // If the selection has full bio data (it's the primary), use it directly
    if (selected.bio) {
      setSubject(selected);
      fetchWikiImage(selected.name, selected.domain).then((url) => {
        if (!checkCancelled() && url) setSubjectImage(url);
      });
    } else {
      // It's an alternative with minimal data — do a fresh lookup
      callHaiku(DISAMBIGUATE_SYSTEM_PROMPT, `Identify specifically: "${selected.name}" (${selected.domain}, ${selected.year || ""}) — ${selected.distinguisher}`)
        .then((data) => {
          if (checkCancelled()) return;
          if (data.primary) {
            setSubject(data.primary);
            fetchWikiImage(data.primary.name, data.primary.domain).then((url) => {
              if (!checkCancelled() && url) setSubjectImage(url);
            });
          }
        })
        .catch(() => {});
    }

    // Update history with resolved name
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === currentQuery) {
        return [...prev.slice(0, -1), selected.name];
      }
      return [...prev, selected.name];
    });

    // Fire mix
    const callbacks = {
      checkCancelled,
      onIntro: (text) => setIntro(text),
      onSlot: (item, index) => {
        setSlots((prev) => [...prev, item]);
        setTimeout(() => {
          if (!checkCancelled()) setVisibleSlots((prev) => new Set([...prev, index]));
        }, 60);
      },
      onError: (msg) => setError(msg),
      onComplete: () => setIsLoading(false),
    };

    fireMix(selected.name, callbacks, selected);
  }, [currentQuery]);

  // Cycle to next alternative for a slot type
  const handleSlotNext = useCallback((slotType) => {
    const currentIdx = slotAltIndex[slotType] || 0;
    const alts = slotAlts[slotType];

    if (!alts) {
      // First tap — fetch alternatives
      setSlotAltLoading((prev) => ({ ...prev, [slotType]: true }));
      const currentItem = slots.find((s) => s.slotType === slotType);
      const excludeNames = [currentItem?.creator, currentItem?.title].filter(Boolean);

      fetchSlotAlternatives(subject?.name || currentQuery, slotType, excludeNames, subject)
        .then((items) => {
          if (items.length > 0) {
            // Store originals + alternatives together: [original, alt1, alt2, ...]
            setSlotAlts((prev) => ({ ...prev, [slotType]: [currentItem, ...items] }));
            setSlotAltIndex((prev) => ({ ...prev, [slotType]: 1 }));
            // Swap the displayed slot
            setSlots((prev) => prev.map((s) => s.slotType === slotType ? items[0] : s));
          }
        })
        .catch(() => {})
        .finally(() => setSlotAltLoading((prev) => ({ ...prev, [slotType]: false })));
    } else {
      // Already fetched — cycle through
      const nextIdx = (currentIdx + 1) % alts.length;
      setSlotAltIndex((prev) => ({ ...prev, [slotType]: nextIdx }));
      setSlots((prev) => prev.map((s) => s.slotType === slotType ? alts[nextIdx] : s));
    }
  }, [slotAlts, slotAltIndex, slots, subject, currentQuery]);

  const showWelcome = !currentQuery && !isLoading;

  const exampleSearches = [
    "Radiohead", "Get Out", "Frida Kahlo", "The Sopranos",
    "Kendrick Lamar", "Hayao Miyazaki", "Virgil Abloh", "Joni Mitchell",
  ];

  return (
    <div style={{
      width: "100vw", height: "100vh", overflow: "hidden",
      background: "#0a0b0f", display: "flex", flexDirection: "column",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap');
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes breathe { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
        input::placeholder { color: rgba(148,163,184,0.3); }
      `}</style>

      {/* Header */}
      <header style={{
        padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid rgba(255,255,255,0.03)", flexShrink: 0,
      }}>
        <div
          onClick={() => {
            requestIdRef.current++;
            setCurrentQuery(""); setSubject(null); setSlots([]);
            setHistory([]); setError(null); setIsLoading(false);
            setIntro(null); setSubjectImage(null); setDisambiguation(null);
            setGraphData(null); setGraphLoading(false); setViewMode("mix");
            setSlotAlts({}); setSlotAltIndex({}); setSlotAltLoading({});
          }}
          style={{ cursor: "pointer", display: "flex", alignItems: "baseline", gap: "3px" }}
        >
          <span style={{
            fontSize: "20px", fontWeight: 400, color: "#f1f5f9",
            fontFamily: "'Instrument Serif', serif",
          }}>Kynda</span>
          <span style={{
            fontSize: "7px", color: "rgba(250,204,21,0.45)",
            fontFamily: "'DM Mono', monospace", letterSpacing: "0.08em",
            verticalAlign: "super", marginLeft: "1px",
          }}>BETA</span>
        </div>
        <div style={{
          fontSize: "9px", color: "rgba(148,163,184,0.25)",
          fontFamily: "'DM Mono', monospace", letterSpacing: "0.06em",
        }}>CONTEXTUAL RECOMMENDATION ENGINE</div>
      </header>

      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* Welcome */}
        {showWelcome && (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center",
            padding: "0 28px", maxWidth: "640px", width: "100%",
            animation: "fadeInUp 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
          }}>
            <h2 style={{
              fontSize: "44px", fontWeight: 400, color: "#f1f5f9",
              fontFamily: "'Instrument Serif', serif",
              textAlign: "center", lineHeight: 1.12, marginBottom: "6px",
            }}>
              Kynda
            </h2>
            <div style={{
              fontSize: "13px", color: "rgba(250,204,21,0.5)",
              fontFamily: "'Instrument Serif', serif",
              fontStyle: "italic", textAlign: "center", marginBottom: "20px",
            }}>
              (KIN-duh): Old Norse for "to light up"
            </div>
            <p style={{
              fontSize: "15px", color: "rgba(148,163,184,0.45)",
              textAlign: "center", lineHeight: 1.6, marginBottom: "36px", maxWidth: "480px",
            }}>
              Discover the connections between your favorite works of culture, and the creators behind them.
            </p>
            <div style={{ width: "100%", maxWidth: "500px" }}>
              <SearchInput onSearch={handleSearch} isLoading={isLoading} />
            </div>
            <div style={{
              display: "flex", flexWrap: "wrap", justifyContent: "center",
              gap: "8px", marginTop: "28px",
            }}>
              {exampleSearches.map((ex) => (
                <button
                  key={ex} onClick={() => handleSearch(ex)}
                  style={{
                    padding: "6px 14px", borderRadius: "20px",
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                    color: "rgba(148,163,184,0.45)", fontSize: "12px",
                    fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { e.target.style.borderColor = "rgba(250,204,21,0.18)"; e.target.style.color = "rgba(250,204,21,0.65)"; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.05)"; e.target.style.color = "rgba(148,163,184,0.45)"; }}
                >{ex}</button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {(currentQuery || isLoading) && (
          <div style={{ flex: 1, width: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Search bar + view toggle */}
            <div style={{
              padding: "14px 28px", borderBottom: "1px solid rgba(255,255,255,0.03)",
              display: "flex", alignItems: "center", gap: "16px",
              maxWidth: "900px", width: "100%", margin: "0 auto",
            }}>
              <div style={{ flex: 1 }}>
                <SearchInput onSearch={handleSearch} isLoading={isLoading} />
              </div>
              {/* View toggle — only show when we have a subject */}
              {subject && (
                <div style={{
                  display: "flex", gap: "2px", flexShrink: 0,
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: "5px", padding: "2px",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {[
                    { id: "mix", label: "MIX" },
                    { id: "graph", label: "GRAPH" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setViewMode(tab.id);
                        // Lazy-load graph data on first switch
                        if (tab.id === "graph" && !graphData && !graphLoading && subject) {
                          setGraphLoading(true);
                          fetchGraph(subject.name, subject)
                            .then((data) => { setGraphData(data); setGraphLoading(false); })
                            .catch(() => setGraphLoading(false));
                        }
                      }}
                      style={{
                        padding: "5px 14px", borderRadius: "3px", border: "none",
                        background: viewMode === tab.id ? "rgba(250,204,21,0.12)" : "transparent",
                        color: viewMode === tab.id ? "rgba(250,204,21,0.8)" : "rgba(148,163,184,0.4)",
                        fontSize: "10px", fontFamily: "'DM Mono', monospace",
                        letterSpacing: "0.08em", cursor: "pointer", transition: "all 0.2s",
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Mix view */}
            {viewMode === "mix" && (
              <div ref={contentRef} style={{ flex: 1, overflow: "auto", padding: "28px" }}>
                <div style={{ maxWidth: "660px", margin: "0 auto" }}>
                  <HistoryBreadcrumb history={history} onNavigate={handleSearch} />

                  {error && (
                    <div style={{
                      padding: "14px 18px", borderRadius: "6px",
                      background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
                      color: "rgba(239,68,68,0.75)", fontSize: "13px",
                      fontFamily: "'DM Sans', sans-serif", marginBottom: "20px",
                    }}>{error}</div>
                  )}

                  {disambiguation?.confidence === "ambiguous" && !subject && (
                    <DisambiguationCard
                      data={disambiguation}
                      onSelect={handleDisambiguationSelect}
                    />
                  )}

                  <SubjectCard subject={subject} imageUrl={subjectImage} intro={intro} />

                  {disambiguation?.confidence === "likely" && subject && (
                    <AlternativesBar
                      alternatives={disambiguation.alternatives}
                      onSelect={handleDisambiguationSelect}
                    />
                  )}

                  {isLoading && !subject && (
                    <div style={{ animation: "fadeInUp 0.3s ease", marginBottom: "28px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: "rgba(250,204,21,0.55)",
                          animation: "breathe 1.4s ease-in-out infinite",
                        }} />
                        <span style={{
                          fontSize: "12px", color: "rgba(250,204,21,0.45)",
                          fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em",
                        }}>Mapping influences for "{currentQuery}"...</span>
                      </div>
                    </div>
                  )}

                  {subject && slots.length === 0 && isLoading && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      marginBottom: "20px", animation: "fadeInUp 0.4s ease",
                    }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: "rgba(250,204,21,0.55)",
                        animation: "breathe 1.4s ease-in-out infinite",
                      }} />
                      <span style={{
                        fontSize: "12px", color: "rgba(250,204,21,0.4)",
                        fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em",
                      }}>Building KyndaMix...</span>
                    </div>
                  )}

                  {(slots.length > 0 || (isLoading && subject)) && (
                    <div>
                      <div style={{
                        display: "flex", alignItems: "baseline", justifyContent: "space-between",
                        marginBottom: "16px",
                      }}>
                        <h2 style={{
                          fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase",
                          color: "rgba(250,204,21,0.45)", fontFamily: "'DM Mono', monospace", fontWeight: 500,
                        }}>KyndaMix</h2>
                        <span style={{
                          fontSize: "10px", color: "rgba(148,163,184,0.25)",
                          fontFamily: "'DM Mono', monospace",
                        }}>{slots.length < 8 && isLoading ? `${slots.length}/8` : "8 slots"}</span>
                      </div>

                      <SlotLegend />

                      {slots.map((item, i) => (
                        <MixSlotCard key={`${item.slotType}-${item.creator}-${i}`} item={item} index={i}
                          isVisible={visibleSlots.has(i)} onNavigate={handleSearch}
                          onNext={handleSlotNext}
                          altCount={slotAlts[item.slotType]?.length || 0}
                          altIndex={slotAltIndex[item.slotType] || 0}
                          altLoading={!!slotAltLoading[item.slotType]}
                        />
                      ))}

                      {isLoading && Array.from({ length: Math.max(0, 8 - slots.length) }, (_, i) => (
                        <SlotSkeleton key={`sk-${i}`} index={slots.length + i} />
                      ))}
                    </div>
                  )}

                  <div style={{ height: "80px" }} />
                </div>
              </div>
            )}

            {/* Graph view */}
            {viewMode === "graph" && (
              <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
                {graphLoading && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex",
                    alignItems: "center", justifyContent: "center", zIndex: 2,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: "rgba(250,204,21,0.55)",
                        animation: "breathe 1.4s ease-in-out infinite",
                      }} />
                      <span style={{
                        fontSize: "12px", color: "rgba(250,204,21,0.45)",
                        fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em",
                      }}>Building influence graph...</span>
                    </div>
                  </div>
                )}
                {graphData && (
                  <InfluenceGraph
                    graphData={graphData}
                    subjectName={subject?.name || currentQuery}
                    subjectImage={subjectImage}
                    onNavigate={handleSearch}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
