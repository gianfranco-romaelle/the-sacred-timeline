# Sacred Timeline

A knowledge-graph explorer for the intellectual history of science, religion, and their overlap — from Antiquity to the present. The project exposes a normalized seed dataset through five purpose-built views that can each be filtered, focused, and re-organized along both historical and editorial axes.

> **Screenshots** — add images to `docs/screenshots/` and swap the placeholder `img` tags below.

---

## Table of Contents

1. [Research Ontology](#1-research-ontology)
2. [Editorial Framework — The Calculus Stages](#2-editorial-framework--the-calculus-stages)
3. [Architecture](#3-architecture)
4. [Functional Modules](#4-functional-modules)
   - [App Shell & Global Controls](#41-app-shell--global-controls)
   - [River of Time](#42-river-of-time)
   - [Constellation](#43-constellation)
   - [Atlas](#44-atlas)
   - [Face Atlas](#45-face-atlas)
   - [Scriptorium](#46-scriptorium)
   - [Inspector / Details Panel](#47-inspector--details-panel)
5. [Data Pipeline](#5-data-pipeline)
6. [AI & Semantic Layer](#6-ai--semantic-layer)
7. [Admin Mode](#7-admin-mode)
8. [Test Coverage](#8-test-coverage)
9. [Tech Stack](#9-tech-stack)
10. [Development Setup](#10-development-setup)
11. [TODO & Roadmap](#11-todo--roadmap)

---

## 1. Research Ontology

The seed dataset is fully typed and normalized around seven **canonical entity types** that together cover the primary categories of intellectual history:

| Entity Type   | Key Fields                                                               | Role in the graph                                             |
|---------------|--------------------------------------------------------------------------|---------------------------------------------------------------|
| `Person`      | roles, birth/death place, institutionIds, traditionIds, textIds          | Agents — scientists, theologians, philosophers, monks, etc.   |
| `Text`        | textType, authorIds, languageCodes, conceptIds, sourceTextId             | Works — treatises, commentaries, translations, trial records  |
| `Concept`     | conceptType, broaderConceptId, traditionIds, textIds                     | Ideas — doctrines, theories, disciplines, controversies       |
| `Event`       | eventType, participantIds, placeIds, institutionIds, textIds             | Happenings — councils, debates, publications, observations    |
| `Place`       | placeType, geometry (lat/lon/bbox), parentPlaceId                        | Geographic anchors — cities, monasteries, observatories       |
| `Institution` | institutionType, placeIds, founderIds, traditionIds                      | Organizations — universities, academies, libraries, courts    |
| `Tradition`   | traditionType, parentTraditionId, placeIds, institutionIds, conceptIds   | Lineages — intellectual schools, religious orders, movements  |

All entities share a common base: `slug`, `label`, `description`, `alternateLabels`, `dateRange`, `domainIds`, `tagIds`, `citationIds`, `relatedEntityIds`, `mediaAssetIds`, and an optional `embedding`.

### Domains

Three orthogonal knowledge domains color every entity:

| Domain         | Token         | Meaning                                               |
|----------------|---------------|-------------------------------------------------------|
| `Science`      | `science`     | Scientific inquiry and natural knowledge              |
| `Religion`     | `religion`    | Doctrine, institutions, and practice                  |
| `Transmission` | `transmission`| Translation, commentary, and movement of knowledge   |

An entity can belong to multiple domains simultaneously (e.g., an Arabic translation of a Greek text is both `transmission` and `science`).

### Edges

Relations between any two entities are typed with an `EdgeRelationType`:

```
influenced · taught · commented_on · translated · debated · founded
discovered · published · corresponded_with · associated_with · member_of
cited_in · published_by · developed_concept · mathematical_generalization_of
philosophical_transformation_of · symbolic_analogue_of · preserved_in_tradition
part_of_series · opposed · located_at · active_during
```

Each edge carries `direction` (directed/undirected/bidirectional), `certainty` (certain/probable/possible/disputed), an optional `weight`, and an `assertionLayer` from the provenance model.

### Provenance Layers

Every assertion in the graph is tagged with one of three layers:

| Layer            | Meaning                                                          |
|------------------|------------------------------------------------------------------|
| `canonical`      | Core historiographic record, vetted by hand                     |
| `editorial`      | Author's interpretive lens — stage assignments, thematic tags   |
| `ai_hypothesis`  | AI-generated suggestions, shown only when the flag is enabled   |

### Controlled Vocabularies

Two large controlled tag vocabularies are defined in code:

- **Genesis Cognitive Tags** (`genesis-tag-vocabulary.ts`) — ~110 philosophical and cognitive concepts: Intentionality, Noema, Epoché, Sublation, Becoming, Functoriality, Invariance, Phase Transition, Simulation, Computation, Encoding, Feedback, etc.
- **Genesis Math Tags** — mathematical objects from Point and Set through Manifold, Scheme, Stack, Topos, n-Category, Sheaf, Bundle, Lattice, and beyond.
- **Genesis School Traditions** (`genesis-school-traditions.ts`) — ~200+ named traditions spanning: Vedic strata → Pre-Socratic schools → Alexandrian synthesis → Islamic Golden Age → Scholasticism → Renaissance Hermeticism → Scientific Revolution → Enlightenment → German Idealism → Naturphilosophie → Göttingen / Hilbert / Noether schools → Vienna Circle → Bourbaki → Grothendieck / EGA-SGA → Topos Theory → Cybernetics → Category-Theoretic Semantics → AI and platform infrastructure.

---

## 2. Editorial Framework — The Calculus Stages

Alongside the historical timeline, every entity can be assigned to one or more **Calculus Stages** — a seven-epoch periodization of mathematical / scientific cognition authored as an editorial lens over the entire dataset.

| Stage | Short | Date Window             | Epoch Label                    | Structural Themes                                           |
|-------|-------|-------------------------|--------------------------------|-------------------------------------------------------------|
| 0     | 0     | Antiquity – ~1600       | Antiquity-Late Renaissance     | Sacred Geometry · Ritual Astronomy · Euclidean Geometry     |
| I     | I     | 1600 – 1750             | Scientific Revolution          | Mechanics · Fluxions · Newton-Leibniz Calculus              |
| II    | II    | 1750 – 1850             | Analysis & Energy              | PDE · Variational Methods · Energy Concept · Thermodynamics |
| III   | III   | 1850 – 1900             | Fields & Structures            | Riemannian Geometry · Field Theory · Projective Geometry    |
| IV    | IV    | 1900 – 1950             | Abstraction & Foundations      | Symmetry · Topology · Hilbert / Banach Spaces               |
| V     | V     | 1950 – present          | Cold War Applied Mathematics   | Operations Research · Control Systems · Signal Processing   |
| VI    | VI    | 1980 – present          | Semantic Computation           | Category Theory · Topos · Distributed Systems · AI          |

Each stage profile carries:
- **Structural themes** — the dominant mathematical forms of the epoch
- **Characteristic forms** — the document/artefact types that manifest the paradigm
- **Mental modes** — the cognitive dispositions in use
- **Ontological focus** — the primary objects of inquiry
- **Chemical epoch** — the corresponding regime of chemistry / pharmacology
- **Drug epoch** — associated pharmacological / entheogenic milieu
- **Summary** — a prose synthesis

**Quantum Stages** (0–6) are currently aligned 1:1 with Calculus Stages as a compatibility lens; the architecture supports divergence.

**Crosswalk dimensions** allow filtering and grouping across six analytical axes simultaneously: `structural-theme`, `mental-mode`, `characteristic-form`, `chemical-epoch`, `drug-epoch`, `ontological-focus`.

**Editorial scope modes** available in the UI: `standard-chronology`, `calculus-stages`, `quantum-stages`, `crosswalk`.

---

## 3. Architecture

```
src/
├── types/                  Fully-typed schema (entities, relations, seed, projections, provenance, scriptorium…)
├── data/
│   ├── sacred-timeline.seed.ts   Master in-memory seed dataset
│   ├── entity-index.ts           SeedIndex + query helpers
│   ├── filtering.ts              Entity & edge filter predicates
│   ├── time-grouping.ts          Century / era bucketing, chronological sort
│   ├── focus-context.ts          FocusContext: selected entity → neighborhood → context reasons
│   ├── relation-helpers.ts       Neighborhood expansion, edge traversal
│   ├── filter-controls.ts        UI option builders, active filter summaries
│   └── adapters/
│       ├── timeline-adapter.ts   → River (era/century/editorial grouping)
│       ├── graph-adapter.ts      → Constellation (nodes, edges, clusters)
│       ├── map-adapter.ts        → Atlas (MapPoints, MapHubs, MapConnections)
│       ├── face-atlas-adapter.ts → Face Atlas (portrait items, groups)
│       ├── scriptorium-adapter.ts→ Scriptorium (gallery, nodes, exhibits)
│       ├── view-adapter-registry.ts
│       └── projection-diagnostics.ts
├── editorial/
│   ├── types.ts                  CalculusStage, QuantumStage, EditorialCrosswalk…
│   ├── stage-framework.seed.ts   The seven stage profiles
│   ├── stage-profiles.ts         Lookup maps by stage / id
│   ├── mapping.ts                resolveEditorialMetadata, groupEntitiesByEditorialStage…
│   ├── stage-lens.ts             Public re-export surface
│   └── visual-encoding.ts        Color / style tokens for editorial rendering
├── historical/
│   ├── types.ts                  CanonicalEntity, EffectiveCanonicalEntity, HistoricalEntityGraphSnapshot…
│   ├── unified-runtime.ts        React hook; loads seed + snapshot + Drive data; merges overrides
│   ├── runtime-context.tsx       HistoricalRuntimeProvider / useHistoricalRuntime
│   └── projections/
│       └── river-lane-functor.ts Tradition-lane projection over the River
├── state/
│   ├── explorer-store.ts         Zustand store: view, selection, filters, panels, saved scopes
│   ├── admin-store.ts            Admin mode state
│   └── selectors.ts              Filter signal counts, hasActiveFilters, hasSharedContext
├── features/
│   ├── river/                    River of Time view
│   ├── constellation/            Constellation graph view
│   ├── atlas/                    Geographic Atlas view
│   ├── face-atlas/               Portrait gallery view
│   ├── scriptorium/              Authoring canvas view
│   ├── timeline/                 Legacy timeline module (JSX)
│   ├── library/                  Library / research workspace (JSX)
│   ├── graph/                    Structural graph (Cytoscape / JSX, legacy)
│   ├── activity/                 Activity center (JSX)
│   └── shared/                   use-view-coordination, view-shell
├── components/
│   ├── shell/                    AppShell, AppHeader, FilterBar, EditorialControlsBar,
│   │                             ContextRibbon, MainStage, ViewNavigation, CommandPalette,
│   │                             EditorialCrosswalkPanel
│   ├── inspector/                DetailsPanel
│   ├── admin/                    AdminModeToggle, EditorialAssignmentPanel, HistoricalAdminPanel
│   └── ui/                       Radix + shadcn primitives (Badge, Button, Card, Tabs…)
└── ai/
    ├── semantic-search-contracts.ts   Interfaces: EmbeddingMetadataRepository, VectorSearchAdapter…
    ├── semantic-search-service.ts     Orchestrating service
    ├── mock-semantic-index.ts         In-memory stub for development
    ├── placeholder-vector-search-adapter.ts
    └── seed-embedding-repository.ts
```

**State management**: a single Zustand store (`explorer-store`) persisted to `localStorage`. Selection, filters, view, panels, and up to 8 saved local scopes all survive page refresh.

**Projection pattern**: every view receives a `ProjectionInput` (`seed + index + filters + selectedEntityId + selectionSourceView`) and returns a fully typed `ViewProjection` specific to that view. No view reads the store directly; all data flows through adapters.

**Focus Context**: when an entity is selected, `buildFocusContext` derives the neighborhood (direct graph neighbors that pass current filters), related places, traditions, and a `timeAnchorYear`. Each other visible entity then receives a `ContextReason` — `selected | neighbor | same-era | shared-tradition | shared-domain | related-place` — which drives dimming and highlighting across all views simultaneously.

---

## 4. Functional Modules

### 4.1 App Shell & Global Controls

The outer shell wraps all views with a consistent control surface:

**FilterBar** — unified filter across all views:
- Time: presets (`All`, `Ancient`, `Medieval`, `Early Modern`, `Modern`) or custom year range; include/exclude undated entities
- Entity types: Person · Text · Concept · Event · Place · Institution · Tradition
- Domains: Science · Religion · Transmission
- Traditions: any Genesis School Tradition
- Tags: any Genesis Cognitive or Math tag
- Relation types: filter the visible edge set
- Geography: filter to entities active in specific places

**EditorialControlsBar** — engaged when Editorial Mode is on:
- Calculus Stage selector (0–VI) with multi-select
- Quantum Stage selector (parallel axis)
- Scope mode: Standard Chronology / Calculus Stages / Quantum Stages / Crosswalk
- Chronology mode: Historical / Editorial
- Crosswalk dimension toggles
- Show editorial labels toggle

**ContextRibbon** — appears when an entity is selected; shows which context reasons are active (neighbor, same-era ≤120 yr, shared-tradition, shared-domain).

**CommandPalette** — global keyboard-driven command surface.

**ViewNavigation** — tab bar switching between the five primary views.

**Saved Local Scopes** — save and restore complete filter snapshots (up to 8); useful for pinning recurring research contexts.

![App Shell](docs/screenshots/app-shell.png)

---

### 4.2 River of Time

The default and primary chronological view.

**Grouping modes:**
- **Era** — broad named historical eras (Antiquity, Medieval, Early Modern, Modern)
- **Century** — entities bucketed by century using `Math.floor((|year|-1)/100)+1`
- **Tradition** — one horizontal lane per Tradition; entities positioned by primary year (River Lane Functor)
- **Editorial** — Calculus Stage grouping; Quantum Stage grouping also available

**Item cards** show label, entity type, date, domain color, context reason badge, portrait thumbnail when available, and relation/citation counts.

**Hover card** surfaces a quick summary without requiring full selection.

**Editorial mode** recolors cards by stage, shows stage labels, and can re-order by editorial rather than historical chronology.

![River of Time — Era mode](docs/screenshots/river-era.png)
![River of Time — Tradition Lane mode](docs/screenshots/river-lanes.png)

---

### 4.3 Constellation

A force-directed and circle-layout graph view powered by **Sigma.js** and **Graphology** with ForceAtlas2.

**Layout modes:** `circle` (cluster rings) · `force` (ForceAtlas2)

**View modes:** `regions` (cluster-colored) · `list` (sidebar entity list)

**Density:** `readable` · `dense`

**Cluster kinds** (toggleable):
- `embedding_cluster` — semantic similarity groups derived from vector embeddings
- `school` — Genesis School Tradition membership
- `math_tag` — Genesis Math tag groupings
- `scientific_domain` — domain-level scientific clusters
- `cognitive_tag` — Genesis Cognitive tag groupings
- `calculus` — Calculus Stage groupings
- `domain` — Science / Religion / Transmission
- `entity_type` — Person / Text / Concept / etc.

**Neighborhood depth** — expand selection neighborhood 1–N hops. **Isolate neighborhood** hides everything outside it.

**Relation family visibility** — show/hide entire families of edge types.

**Node visual encoding**: size by degree; color by domain tone (`science` / `religion` / `hybrid` / `neutral`); dimming for entities with no context reason when a selection is active.

![Constellation — regions mode](docs/screenshots/constellation-regions.png)
![Constellation — force layout, neighborhood isolate](docs/screenshots/constellation-force.png)

---

### 4.4 Atlas

A geographic map view powered by **deck.gl**, rendering place-anchored entities across a real basemap.

**MapPoints** — individual entity-place pins, sized by weight, colored by domain tone.

**MapHubs** — aggregated place clusters showing entity count, relation count, and domain tone when multiple entities share a place.

**MapConnections** — arcs between places representing active relations between entities (filtered by active relation types).

**Time scrubber** — slide to a year; the map progressively reveals only entities active up to that year. Useful for watching the geographic spread of a tradition or scientific school across time.

**Relation type filter** — show only specific relation families on the arcs.

**Entity selection** syncs with all other views: selecting a point on the Atlas selects the entity globally.

> Atlas canvas is lazy-loaded.

![Atlas — full world view](docs/screenshots/atlas-world.png)
![Atlas — time scrubber active](docs/screenshots/atlas-time-scrub.png)

---

### 4.5 Face Atlas

A portrait gallery view displaying entities (primarily Persons) with their associated portrait assets.

**Grouping modes:** `era` · `tradition` · `domain`

**Sort modes:** `prominence` (by semantic centrality / degree) · `chronological` · `alphabetical`

**Portrait rendering**: SVG placeholder portraits are generated per entity with palette-matched backgrounds when no image asset is available. Portraits carry `depictedEntityIds` enabling multi-entity portraits.

**Context highlighting**: selected entity and neighbors receive emphasis; distant entities are visually dimmed.

Animated layout transitions via **Motion** (`LayoutGroup`).

![Face Atlas — era grouping](docs/screenshots/face-atlas-era.png)

---

### 4.6 Scriptorium

A structured authoring and curation canvas built on **xyflow** (React Flow).

**Modes:**
- **Gallery** — card-per-entity browser filtered by entity type (Text, Person, Tradition, Institution, Concept) and review state (all / suggested / approved)
- **Map** — force-directed node canvas for relationship authoring
- **Exhibits** — curated multi-section narrative documents linking entities, media, and text
- **Review** — queue for approving or rejecting AI / Drive-sourced relationship suggestions

**Authoring overlay** (`ScriptoriumAuthoringOverlay`):
- **Instagram references** — embed or permissioned IG posts linked to entities; review state: suggested / approved / rejected
- **Exhibits** — multi-section documents with pinned entities, pinned media, and IG reference blocks
- **Relationship suggestions** — AI or Drive-sourced edge proposals with rationale, evidence snippets, confidence score, and review state

**Scriptorium node** types: `text`, `school`, `person`, `concept` — each with zone-based positioning.

**Source provenance** per item: `drive` · `instagram` · `manual` · `ai`

![Scriptorium — gallery mode](docs/screenshots/scriptorium-gallery.png)
![Scriptorium — canvas with suggestions](docs/screenshots/scriptorium-canvas.png)

---

### 4.7 Inspector / Details Panel

A side panel (collapsible, detachable, draggable) that opens on any entity selection.

Surfaces:
- Entity type, date label, description
- Domain labels, tradition labels, tag labels (capped display with overflow)
- Portrait asset (primary portrait for the entity)
- All relations (incoming + outgoing), with jump-to-entity links
- Citations with source records
- Related entities
- Editorial stage assignment (stage label, window label, crosswalk summary)
- Context reason badge (why this entity is highlighted)
- "Jump to view" buttons — navigate directly to the selected entity in River / Constellation / Atlas / Face Atlas from any starting view

**Admin sub-panel** (admin mode only): historical canonical entity data, effective field resolution, source record list with precedence, editorial assignment overrides.

![Inspector panel](docs/screenshots/inspector.png)

---

## 5. Data Pipeline

```
scripts/build-historical-snapshot.ts
  → ingest:historical (tsx)
  → /generated/historical-entity-graph.snapshot.json

/generated/drive_index_WIP.json          (Google Drive file index, WIP)
/generated/drive_semantic_embeddings_WIP.json (Drive embedding payloads, WIP)
```

**Unified Historical Runtime** (`src/historical/unified-runtime.ts`):
1. Loads the in-memory `sacredTimelineSeed` (always available, zero latency)
2. Polls `/generated/historical-entity-graph.snapshot.json` every 20 seconds; merges canonical entity overrides into the seed with a field-precedence model
3. Optionally loads Drive index and semantic embedding payloads
4. Exposes `effectiveCanonicalEntitiesById` — entities with all overrides applied according to `FieldPrecedence`
5. Falls back gracefully to seed-only if the snapshot is unavailable

**Drive Trial Adapter** (`src/data/drive-trial-adapter.ts`): extends the seed with entities discovered from Google Drive file scanning; imports `DriveIndexPayload` and `DriveSemanticPayload`.

---

## 6. AI & Semantic Layer

The semantic layer is fully architected behind contracts; the current implementation uses in-memory stubs pending a vector store backend.

**Contracts** (`src/ai/semantic-search-contracts.ts`):

| Interface                    | Responsibility                                                     |
|------------------------------|--------------------------------------------------------------------|
| `EmbeddingMetadataRepository`| Read / write embedding metadata per entity; list clusters & scores|
| `EmbeddingGenerationGateway` | Queue embedding generation requests                               |
| `VectorSearchAdapter`        | `searchSimilar`, `searchMultimodal`, `describeCapabilities`       |
| `SemanticSearchService`      | Orchestrates: get context, find nearby faces, find related concepts|

**Current adapters:**
- `mock-semantic-index.ts` — flat in-memory mock
- `placeholder-vector-search-adapter.ts` — stub returning empty results

**`showAiHypotheses` filter flag** (in `ExplorerFilters`) — when disabled, edges tagged `ai_hypothesis` are hidden across all views.

**Embedding metadata** is stored on entities as `EmbeddingMetadata` (model, vector dimensions, cluster assignments, similarity results). Constellation clusters of kind `embedding_cluster` are derived from these.

---

## 7. Admin Mode

Toggled via `AdminModeToggle`. When active:

- **HistoricalAdminPanel** appears in the Inspector showing the effective canonical entity, contributing source records, and field-level provenance
- **EditorialAssignmentPanel** — manually override a Calculus Stage or Quantum Stage assignment for any entity; set confidence, notes, and assignment state (curated / derived / provisional)
- **ProvenanceBadgeList** — inline display of assertion layers on edges and entities
- **EditorialCrosswalkPanel** — view the full crosswalk table for the focused Calculus Stage

---

## 8. Test Coverage

**264 tests · 17 test files · TypeScript clean** (as of 2026-05-09)

| Module | Tests |
|--------|-------|
| `src/data/filtering.ts` | matchesTimeFilter, matchesEntityTypeFilters, matchesDomainFilters, matchesEdgeFilters, filterKnowledgeEntities, matchesTraditionFilters, matchesTagFilters, matchesGeographyFilters, filterVisibleEdges |
| `src/data/time-grouping.ts` | getCenturyLabel, getEraBucket, getPrimaryYearFromDateRange, getRangeEndYear, sortEntitiesChronologically, groupEntitiesByCentury, groupEntitiesByEra |
| `src/data/relation-helpers.ts` | expandRelationsForEntity, deriveEntityNeighborhood |
| `src/state/selectors.ts` | countBaseFilterSignals, countEditorialFilterSignals, hasActiveEditorialControls, hasActiveFilters, selectActiveFilterCount, hasSharedContext |
| `src/data/filter-controls.ts` | getTimePresetOptions, getEntityTypeOptions, getRelationTypeOptions, getDomainOptions, getGeographyOptions, getExpandedActiveFilterTokens, getCondensedActiveFilterSummary, getFilterScopeLabel |
| `src/data/focus-context.ts` | buildFocusContext, getContextReasonForEntity (same-era ≤120 yr boundary), getContextReasonForPlace, getContextLabel |
| `src/data/adapters/timeline-adapter.ts` | buildTimelineProjection, era/century/editorial grouping |
| `src/data/adapters/graph-adapter.ts` | graphProjectionAdapter, cluster kinds, node/edge projection |
| `src/data/adapters/map-adapter.ts` | mapProjectionAdapter, MapPoints, MapHubs, MapConnections; place-entity self-pin |
| `src/data/adapters/face-atlas-adapter.ts` | faceAtlasProjectionAdapter, grouping, sort (within groups) |
| `src/data/adapters/view-adapter-registry.ts` | adapter dispatch |
| `src/data/adapters/projection-diagnostics.ts` | diagnostic generation |
| `src/historical/projections/river-lane-functor.ts` | buildRiverLaneProjection, lane assignment, undated bucket |
| `constellationFunctor.test.ts` (root) | Integration test: full constellation projection |
| `src/data/__tests__/genesis-school-traditions.test.ts` | School tradition vocabulary |
| `src/data/__tests__/genesis-tag-vocabulary.test.ts` | Cognitive & math tag vocabulary |
| `src/features/timeline/` (legacy) | timeline_filters, timeline_projection |

**Known boundary conditions:**
- `getCenturyLabel`: year 1200 = 12th century (last year); year 1201 = 13th century (first year). Formula: `Math.floor((|year|−1)/100)+1`. Always appends "th" (not ordinal-aware).
- `getContextReasonForEntity`: "same-era" fires when `|entityYear − anchorYear| ≤ 120`. Dimming tests must use entities ≥121 years apart.
- `face-atlas sort scope`: sort only applies within `result.groups[n].items`; `result.items` is flat and unsorted.
- `Edge.sourceId / targetId`: typed as `RecordId`, not plain `string`. Test fixtures must cast.
- `place` entities: `getEntityPlaceIds` returns `[entity.id]` — place entities become their own MapPoint.

**Not yet covered (next targets):**
- `src/data/entity-index.ts` — `buildSeedIndex`, `getPortraitsForEntity`, `getDomainLabels`, all index query helpers
- `src/editorial/mapping.ts`, `visual-encoding.ts`
- `src/editorial/stage-lens.ts` (public surface)

---

## 9. Tech Stack

| Layer | Library / Tool |
|-------|----------------|
| UI framework | React 19 |
| Language | TypeScript 5.9, JSX (mixed migration) |
| State | Zustand 5 (persisted to localStorage) |
| Build | Vite 8 (beta) |
| Styling | Tailwind CSS 4, tw-animate-css, CVA |
| Components | Radix UI (ScrollArea, Select, Tabs, Slot), shadcn |
| Animations | Motion (motion/react) |
| Graph | Sigma.js 3, Graphology, graphology-layout-forceatlas2 |
| Flow canvas | @xyflow/react 12 |
| Geo map | deck.gl 9 |
| Cytoscape (legacy) | cytoscape 3 |
| React Flow (legacy) | @xyflow/react |
| Timeline (legacy) | react-chrono |
| Icons | lucide-react |
| Testing | Vitest 3 |
| Runtime scripts | tsx |
| Type checking | tsc --noEmit |

---

## 10. Development Setup

```bash
npm install

# Run tests
npm run test:frontend

# Type check
npm run typecheck

# Rebuild historical snapshot
npm run ingest:historical

# Lean API server
npm run lean:api
```

**Dev server**: launched via the VS Code **Run & Debug** menu → available at `http://127.0.0.1:4173`.

Vitest discovers `src/**/*.test.ts` and root-level `*.test.ts`; `scriptorium-adapter.test.ts` is excluded from the default run.

Path alias `@` resolves to `./src/` in both Vite and Vitest configs.

---

## 11. TODO & Roadmap

### Immediate — test coverage

- [ ] `src/data/entity-index.ts` — cover `buildSeedIndex`, `getPortraitsForEntity`, `getDomainLabels`, `getEntityTypeLabel`, `getEntityDateLabel`, `getEdgesForEntity`, `getRelatedEntities`, `getTagLabels`, `getTraditionsForEntity`, `getCitationsForEntity`
- [ ] `src/editorial/mapping.ts` — cover `resolveEditorialMetadata`, `resolveEditorialStageProfile`, `groupEntitiesByEditorialStage`, `groupEntitiesByQuantumStage`, `inferEditorialStageProfilesFromYear`, `buildEditorialCrosswalk`
- [ ] `src/editorial/visual-encoding.ts` — color/style token mapping per stage and domain
- [ ] `src/state/admin-store.ts` — editorial override CRUD operations

### Near-term features

- [ ] **Lifelines view** — a planned sixth view (`src/features/lifelines/lifespan-adapter.ts` referenced but not yet scaffolded) rendering overlapping lifespan arcs for a filtered cohort of Persons; adapts `buildLifelinesProjection`
- [ ] **Library / Research Workspace** — the existing `src/features/library/` module (JSX) needs TypeScript migration, seed integration, and promotion to a navigation tab
- [ ] **Activity Center** — `src/features/activity/` needs wiring into the shell and real data
- [ ] **Scriptorium exhibits editor** — full multi-section exhibit authoring with rich text, pinned entities, and media
- [ ] **Instagram reference ingestion pipeline** — automated scrape → review queue flow backed by `ScriptoriumAuthoringOverlay`

### AI & semantic search

- [ ] **Vector store backend** — plug PostgreSQL + pgvector (or equivalent) into `VectorSearchAdapter` without changing UI contracts
- [ ] **Backend embedding worker** — materialize embeddings, update `EmbeddingMetadataRepository`, maintain audit trail
- [ ] **Multimodal retrieval** — implement `searchMultimodal` for image + text co-embedding queries
- [ ] **Semantic cluster computation** — real clustering over embedding vectors to replace the mock `embedding_cluster` kind in Constellation
- [ ] **AI hypothesis review queue** — dedicated UI for approving / rejecting `ai_hypothesis` edges; currently hidden behind `showAiHypotheses` flag

### Data & editorial

- [ ] **Drive integration** — complete `DriveIndexPayload` / `DriveSemanticPayload` pipeline; move from WIP JSONs to live sync
- [ ] **Snapshot polling refinement** — smarter invalidation (ETag / Last-Modified) instead of fixed 20 s interval
- [ ] **Ordinal-aware century labels** — fix `getCenturyLabel` to emit "1st", "2nd", "3rd" etc. rather than always "th"
- [ ] **Relationship suggestion batch review** — bulk approve/reject in the Scriptorium Review mode
- [ ] **Quantum Stage divergence** — build out independent Quantum Stage profiles when the editorial framework separates from the seven Calculi alignment
- [ ] **Crosswalk narrative documents** — per-stage prose synthesis surfaced in the EditorialCrosswalkPanel

### Infrastructure

- [ ] **Backend lean API** — `server/run-lean-api.ts` scaffolded; needs route implementation for snapshot serving, embedding writes, and Drive sync
- [ ] **Saved scope sharing** — serialize and share a saved scope as a URL / deep-link
- [ ] **Command palette commands** — bind filter presets, view switches, and editorial stage jumps to the CommandPalette
- [ ] **Keyboard navigation** — River item cards, Constellation nodes, Face Atlas cards all navigable by keyboard
- [ ] **Export** — CSV / JSON export of the current filtered entity set and edge set

### Ideas in progress (discussed during development)

- Entity "importance" promotion: a `featured` flag on `TimelineItem` exists; define the editorial criteria for promotion and implement an admin UI for it
- Stage-to-stage "influence flow" visualization — a Sankey or chord diagram showing how entities / ideas migrate across Calculus Stages
- Tradition genealogy tree — a dedicated hierarchical view exploiting `parentTraditionId` and `parentConceptId` recursively
- Temporal density heatmap — a mini-chart in the FilterBar showing entity count by century across the current filter state, to guide time range selection
- "Teach me" mode — guided walks through the knowledge graph using editorial stage crosswalk summaries as narration
- Multi-seed federation — load additional specialized seed files (e.g., a dedicated Alchemy seed, a Cold War science seed) and merge them into the unified runtime at runtime
