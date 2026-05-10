import type {
  Concept,
  ConceptId,
  DomainDefinition,
  DomainId,
  Edge,
  EdgeRelationType,
  Institution,
  InstitutionId,
  KnowledgeEntityId,
  Person,
  PersonId,
  SacredTimelineSeedData,
  SourceRecord,
  SourceId,
  TagDefinition,
  TagId,
  Text,
  TextId,
  Tradition,
  TraditionId,
} from "@/types";

export interface DriveIndexRecord {
  file_name?: string;
  drive_path?: string;
  calculi_id?: number | null;
  cognitive_tags?: string[];
  math_tags?: string[];
  scientific_domain_tags?: string[];
  schools?: string[];
  pipeline_flags?: string[];
  evidence_notes?: string;
  confidence?: string;
}

export interface DriveIndexPayload {
  schema_name?: string;
  schema_version?: string;
  generated_at?: string;
  index_records?: DriveIndexRecord[];
}

export interface DriveSemanticEntity {
  entity_id?: string;
  name?: string;
  entity_types?: string[];
  birth_year?: number | null;
  death_year?: number | null;
  country?: string | null;
  calculi_id?: number | null;
  schools?: string[];
  scientific_domains?: string[];
  cognitive_tags?: string[];
  math_tags?: string[];
  institutions?: string[];
  conferences?: string[];
  related_entities?: string[];
  embedding_cluster?: string;
  centrality_score?: number;
  summary?: string;
  source_files?: Array<string | number>;
  confidence?: string;
  evidence_type?: string;
}

export interface DriveSemanticRelationship {
  source?: string;
  target?: string;
  relation?: string;
  weight?: number;
  confidence?: number;
  evidence_type?: string;
}

export interface DriveSemanticEmbedding {
  embedding_id?: string;
  entity_name?: string;
  entity_type?: string;
  semantic_neighbors?: string[];
  centrality_score?: number;
  cluster_id?: string;
  vector_metadata?: Record<string, unknown>;
}

export interface DriveSemanticLineage {
  lineage_id?: string;
  name?: string;
  steps?: string[];
  nodes?: string[];
  description?: string;
  confidence?: string | number;
  source_file?: string;
  source_files?: Array<string | number>;
}

export interface DriveSemanticPayload {
  metadata?: Record<string, unknown>;
  entities?: DriveSemanticEntity[];
  embeddings?: DriveSemanticEmbedding[];
  relationships?: DriveSemanticRelationship[];
  lineages?: DriveSemanticLineage[];
}

export interface DriveTrialData {
  index?: DriveIndexPayload;
  semantic?: DriveSemanticPayload;
}

const DRIVE_DOMAIN_ID = "domain_drive_library" as DomainId;

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const unique = <T,>(values: T[]) => Array.from(new Set(values.filter(Boolean)));

const asArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(clean).filter(Boolean) : [];

const tagId = (kind: string, label: string) =>
  `tag_genesis_${kind}_${slugify(label)}` as TagId;

const traditionId = (label: string) => `tradition_${slugify(label)}` as TraditionId;

const conceptId = (label: string) => `concept_drive_${slugify(label)}` as ConceptId;

const personId = (label: string) => `person_drive_${slugify(label)}` as PersonId;

const institutionId = (label: string) => `institution_drive_${slugify(label)}` as InstitutionId;

const textId = (label: string, index: number) =>
  `text_drive_${String(index + 1).padStart(3, "0")}_${slugify(label)}` as TextId;

const hasSixthCalculusSignal = (record: {
  scientific_domains?: string[];
  cognitive_tags?: string[];
  math_tags?: string[];
  evidence_notes?: string;
  summary?: string;
}) => {
  const haystack = [
    ...(record.scientific_domains ?? []),
    ...(record.cognitive_tags ?? []),
    ...(record.math_tags ?? []),
    record.evidence_notes,
    record.summary,
  ].join(" ");

  return /\b(category theory|topos|sheaf|stack|categorical logic|semantic computation|distributed systems|machine learning|artificial intelligence|computational ontology)\b/i.test(
    haystack,
  );
};

const resolveCalculusStage = (
  input: number | null | undefined,
  record: Parameters<typeof hasSixthCalculusSignal>[0],
) => {
  if (hasSixthCalculusSignal(record)) {
    return 6;
  }

  return typeof input === "number" && input >= 0 && input <= 6 ? input : undefined;
};

const inferDomainIds = (record: {
  scientific_domain_tags?: string[];
  scientific_domains?: string[];
}) => {
  const labels = [...(record.scientific_domain_tags ?? []), ...(record.scientific_domains ?? [])];
  const domains = new Set<DomainId>([DRIVE_DOMAIN_ID, "domain_history" as DomainId]);
  if (labels.length > 0 || labels.some((label) => /math|logic|physics|computer|science/i.test(label))) {
    domains.add("domain_science" as DomainId);
  }
  return Array.from(domains);
};

const buildTagDefinitions = (data: DriveTrialData, existingIds: Set<TagId>): TagDefinition[] => {
  const candidates: Array<{ kind: string; label: string; category: TagDefinition["category"]; domainIds: DomainId[] }> = [];

  for (const record of data.index?.index_records ?? []) {
    for (const label of asArray(record.cognitive_tags)) {
      candidates.push({ kind: "cognitive", label, category: "theme", domainIds: [DRIVE_DOMAIN_ID] });
    }
    for (const label of asArray(record.math_tags)) {
      candidates.push({ kind: "math", label, category: "method", domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId] });
    }
    for (const label of asArray(record.scientific_domain_tags)) {
      candidates.push({ kind: "scientific", label, category: "discipline", domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId] });
    }
    for (const label of asArray(record.pipeline_flags)) {
      candidates.push({ kind: "pipeline", label, category: "theme", domainIds: [DRIVE_DOMAIN_ID] });
    }
  }

  for (const entity of data.semantic?.entities ?? []) {
    for (const label of asArray(entity.cognitive_tags)) {
      candidates.push({ kind: "cognitive", label, category: "theme", domainIds: [DRIVE_DOMAIN_ID] });
    }
    for (const label of asArray(entity.math_tags)) {
      candidates.push({ kind: "math", label, category: "method", domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId] });
    }
    for (const label of asArray(entity.scientific_domains)) {
      candidates.push({ kind: "scientific", label, category: "discipline", domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId] });
    }
  }

  const byId = new Map<TagId, TagDefinition>();
  for (const candidate of candidates) {
    const id = tagId(candidate.kind, candidate.label);
    if (existingIds.has(id) || byId.has(id)) continue;
    byId.set(id, {
      id,
      slug: slugify(candidate.label).replace(/_/g, "-"),
      label: candidate.label,
      description: `${candidate.label} from imported Gemini drive trial metadata.`,
      category: candidate.category,
      domainIds: unique(candidate.domainIds),
    });
  }
  return Array.from(byId.values());
};

const collectTagIds = (record: {
  cognitive_tags?: string[];
  math_tags?: string[];
  scientific_domain_tags?: string[];
  scientific_domains?: string[];
  pipeline_flags?: string[];
}) => [
  ...asArray(record.cognitive_tags).map((label) => tagId("cognitive", label)),
  ...asArray(record.math_tags).map((label) => tagId("math", label)),
  ...asArray(record.scientific_domain_tags).map((label) => tagId("scientific", label)),
  ...asArray(record.scientific_domains).map((label) => tagId("scientific", label)),
  ...asArray(record.pipeline_flags).map((label) => tagId("pipeline", label)),
];

const buildTraditions = (
  data: DriveTrialData,
  existingByLabel: Map<string, Tradition>,
): Tradition[] => {
  const labels = new Set<string>();
  for (const record of data.index?.index_records ?? []) {
    asArray(record.schools).forEach((label) => labels.add(label));
  }
  for (const entity of data.semantic?.entities ?? []) {
    asArray(entity.schools).forEach((label) => labels.add(label));
  }

  return Array.from(labels)
    .filter((label) => !existingByLabel.has(label.toLowerCase()))
    .map((label) => ({
      id: traditionId(label),
      entityType: "tradition",
      slug: slugify(label).replace(/_/g, "-"),
      label,
      description: `${label} from imported Gemini drive trial metadata.`,
      domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId],
      tagIds: [],
      citationIds: [],
      relatedEntityIds: [],
      mediaAssetIds: [],
      traditionType: "intellectual",
      placeIds: [],
      institutionIds: [],
      conceptIds: [],
    }));
};

const resolveTraditionIds = (labels: string[], traditionsByLabel: Map<string, Tradition>) =>
  labels.map((label) => traditionsByLabel.get(label.toLowerCase())?.id ?? traditionId(label));

const toSourceRecord = (record: DriveIndexRecord, index: number): SourceRecord => {
  const title = clean(record.file_name) || `Drive source ${index + 1}`;
  const id = `source_drive_index_${String(index + 1).padStart(3, "0")}_${slugify(title)}` as SourceId;
  return {
    id,
    recordType: "source",
    slug: slugify(title).replace(/_/g, "-"),
    label: title,
    title,
    description: clean(record.evidence_notes) || `Imported drive index record for ${title}.`,
    sourceType: "book",
    authors: [],
    domainIds: inferDomainIds(record),
    tagIds: collectTagIds(record),
    relatedEntityIds: [],
    mediaAssetIds: [],
    metadata: {
      importedDriveTrial: true,
      drivePath: record.drive_path ?? null,
      confidence: record.confidence ?? null,
      calculiId: record.calculi_id ?? null,
      schools: record.schools ?? [],
    },
    embedding: {
      searchableText: [title, record.drive_path, record.evidence_notes, ...(record.schools ?? [])].filter(Boolean).join(" "),
      keywordText: [
        ...(record.cognitive_tags ?? []),
        ...(record.math_tags ?? []),
        ...(record.scientific_domain_tags ?? []),
        ...(record.pipeline_flags ?? []),
      ].join(" "),
      embeddingCandidate: true,
      descriptors: [],
      clusterIds: [`cluster_drive_calculus_${resolveCalculusStage(record.calculi_id, record) ?? "unknown"}`],
    },
  };
};

const toTextRecord = (
  record: DriveIndexRecord,
  index: number,
  sourceId: SourceId,
  traditionsByLabel: Map<string, Tradition>,
): Text => {
  const title = clean(record.file_name) || `Drive source ${index + 1}`;
  const calculusStage = resolveCalculusStage(record.calculi_id, record);
  return {
    id: textId(title, index),
    entityType: "text",
    slug: slugify(title).replace(/_/g, "-"),
    label: title,
    title,
    description: clean(record.evidence_notes) || `Imported drive index record for ${title}.`,
    domainIds: inferDomainIds(record),
    tagIds: collectTagIds(record),
    citationIds: [],
    relatedEntityIds: [],
    mediaAssetIds: [],
    textType: "book",
    authorIds: [],
    contributorIds: [],
    languageCodes: [],
    institutionIds: [],
    traditionIds: resolveTraditionIds(asArray(record.schools), traditionsByLabel),
    placeIds: [],
    conceptIds: [],
    metadata: {
      importedDriveTrial: true,
      sourceId,
      drivePath: record.drive_path ?? null,
      confidence: record.confidence ?? null,
      evidenceNotes: record.evidence_notes ?? null,
      originalCalculiId: record.calculi_id ?? null,
      ...(calculusStage !== undefined
        ? {
            editorial: {
            calculusStage,
            quantumStage: calculusStage,
            confidence: String(record.confidence ?? "").toLowerCase() === "high" ? 0.82 : 0.58,
            source: "derived",
            assignmentState: "provisional",
            notes: "Imported from Gemini drive_index_WIP trial metadata.",
          },
        }
        : {}),
    },
    embedding: {
      searchableText: [title, record.drive_path, record.evidence_notes, ...(record.schools ?? [])].filter(Boolean).join(" "),
      keywordText: [
        ...(record.cognitive_tags ?? []),
        ...(record.math_tags ?? []),
        ...(record.scientific_domain_tags ?? []),
        ...(record.pipeline_flags ?? []),
      ].join(" "),
      embeddingCandidate: true,
      descriptors: [],
      clusterIds: [`cluster_drive_calculus_${calculusStage ?? "unknown"}`],
    },
  };
};

const declaredEntityNameByKey = (entities: DriveSemanticEntity[]) => {
  const map = new Map<string, DriveSemanticEntity>();
  for (const entity of entities) {
    if (entity.entity_id) map.set(entity.entity_id, entity);
    if (entity.name) map.set(entity.name.toLowerCase(), entity);
  }
  return map;
};

const looksLikePerson = (label: string) =>
  /^(?:[A-Z]\.|[A-Z][a-z]+)\s/.test(label) &&
  !/\b(Topos|Adjunction|Localization|Dynamics|Monoid|Sets|Quantity|Chaos|Continuum|Series|Seminar)\b/i.test(label);

const looksLikeInstitution = (label: string) => /\b(seminar|university|institute|laboratory|conference)\b/i.test(label);

const resolveSemanticEntityId = (
  labelOrId: string,
  declared: Map<string, DriveSemanticEntity>,
) => {
  const declaredEntity = declared.get(labelOrId) ?? declared.get(labelOrId.toLowerCase());
  if (declaredEntity?.entity_types?.some((type) => /person/i.test(type))) {
    return personId(declaredEntity.name ?? labelOrId);
  }
  if (declaredEntity) {
    return conceptId(declaredEntity.name ?? labelOrId);
  }
  if (looksLikeInstitution(labelOrId)) {
    return institutionId(labelOrId);
  }
  if (looksLikePerson(labelOrId)) {
    return personId(labelOrId);
  }
  return conceptId(labelOrId);
};

const toSemanticPerson = (
  entity: DriveSemanticEntity,
  traditionsByLabel: Map<string, Tradition>,
): Person => {
  const name = clean(entity.name) || clean(entity.entity_id) || "Unnamed semantic person";
  const calculusStage = resolveCalculusStage(entity.calculi_id, entity);
  return {
    id: personId(name),
    entityType: "person",
    slug: slugify(name).replace(/_/g, "-"),
    label: name,
    title: name,
    description: clean(entity.summary) || `Imported Gemini semantic entity ${name}.`,
    alternateLabels: entity.entity_id ? [entity.entity_id] : [],
    dateRange:
      typeof entity.birth_year === "number" || typeof entity.death_year === "number"
        ? {
            kind: "lifespan",
            start:
              typeof entity.birth_year === "number"
                ? { date: { year: entity.birth_year, precision: "year", qualifier: "exact" } }
                : undefined,
            end:
              typeof entity.death_year === "number"
                ? { date: { year: entity.death_year, precision: "year", qualifier: "exact" } }
                : undefined,
            certainty: "probable",
            displayLabel: `${entity.birth_year ?? "?"}-${entity.death_year ?? "?"}`,
            sortStartYear: entity.birth_year ?? entity.death_year ?? undefined,
            sortEndYear: entity.death_year ?? entity.birth_year ?? undefined,
          }
        : undefined,
    domainIds: inferDomainIds(entity),
    tagIds: collectTagIds(entity),
    citationIds: [],
    relatedEntityIds: [],
    mediaAssetIds: [],
    roles: ["mathematician"],
    institutionIds: asArray(entity.institutions).map(institutionId),
    traditionIds: resolveTraditionIds(asArray(entity.schools), traditionsByLabel),
    textIds: [],
    metadata: {
      importedDriveTrial: true,
      semanticEntityId: entity.entity_id ?? null,
      country: entity.country ?? null,
      conferences: entity.conferences ?? [],
      sourceFiles: entity.source_files ?? [],
      embeddingCluster: entity.embedding_cluster ?? null,
      centralityScore: entity.centrality_score ?? null,
      confidence: entity.confidence ?? null,
      evidenceType: entity.evidence_type ?? null,
      originalCalculiId: entity.calculi_id ?? null,
      ...(calculusStage !== undefined
        ? {
            editorial: {
            calculusStage,
            quantumStage: calculusStage,
            confidence: entity.confidence === "high" ? 0.84 : 0.62,
            source: "derived",
            assignmentState: "provisional",
            notes: "Imported from Gemini drive_semantic_embeddings_WIP trial metadata.",
          },
        }
        : {}),
    },
    embedding: {
      searchableText: [name, entity.summary, ...(entity.related_entities ?? [])].filter(Boolean).join(" "),
      keywordText: [...(entity.cognitive_tags ?? []), ...(entity.math_tags ?? []), ...(entity.scientific_domains ?? [])].join(" "),
      embeddingCandidate: true,
      descriptors: [],
      clusterIds: entity.embedding_cluster ? [`cluster_${slugify(entity.embedding_cluster)}`] : [],
    },
  };
};

const toSemanticConcept = (
  nameOrEntity: string | DriveSemanticEntity,
  traditionsByLabel: Map<string, Tradition>,
): Concept => {
  const entity = typeof nameOrEntity === "string" ? undefined : nameOrEntity;
  const name = typeof nameOrEntity === "string" ? nameOrEntity : clean(nameOrEntity.name) || clean(nameOrEntity.entity_id);
  const calculusStage = entity ? resolveCalculusStage(entity.calculi_id, entity) : undefined;
  return {
    id: conceptId(name),
    entityType: "concept",
    slug: slugify(name).replace(/_/g, "-"),
    label: name,
    description: clean(entity?.summary) || `Imported Gemini semantic concept ${name}.`,
    domainIds: inferDomainIds(entity ?? {}),
    tagIds: collectTagIds(entity ?? {}),
    citationIds: [],
    relatedEntityIds: [],
    mediaAssetIds: [],
    conceptType: "theory",
    traditionIds: resolveTraditionIds(asArray(entity?.schools), traditionsByLabel),
    textIds: [],
    metadata: {
      importedDriveTrial: true,
      semanticEntityId: entity?.entity_id ?? null,
      embeddingCluster: entity?.embedding_cluster ?? null,
      centralityScore: entity?.centrality_score ?? null,
      confidence: entity?.confidence ?? null,
      evidenceType: entity?.evidence_type ?? null,
      originalCalculiId: entity?.calculi_id ?? null,
      ...(calculusStage !== undefined
        ? {
            editorial: {
            calculusStage,
            quantumStage: calculusStage,
            confidence: entity?.confidence === "high" ? 0.84 : 0.58,
            source: "derived",
            assignmentState: "provisional",
            notes: "Imported from Gemini drive_semantic_embeddings_WIP trial metadata.",
          },
        }
        : {}),
    },
    embedding: {
      searchableText: [name, entity?.summary].filter(Boolean).join(" "),
      keywordText: [...(entity?.cognitive_tags ?? []), ...(entity?.math_tags ?? []), ...(entity?.scientific_domains ?? [])].join(" "),
      embeddingCandidate: true,
      descriptors: [],
      clusterIds: entity?.embedding_cluster ? [`cluster_${slugify(entity.embedding_cluster)}`] : [],
    },
  };
};

const toPlaceholderPerson = (name: string): Person => ({
  id: personId(name),
  entityType: "person",
  slug: slugify(name).replace(/_/g, "-"),
  label: name,
  description: `Referenced by imported Gemini semantic relationships.`,
  domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  roles: ["mathematician"],
  institutionIds: [],
  traditionIds: [],
  textIds: [],
  metadata: { importedDriveTrial: true, placeholder: true },
});

const toPlaceholderInstitution = (name: string): Institution => ({
  id: institutionId(name),
  entityType: "institution",
  slug: slugify(name).replace(/_/g, "-"),
  label: name,
  description: `Referenced by imported Gemini semantic relationships.`,
  domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  institutionType: "school",
  placeIds: [],
  founderIds: [],
  traditionIds: [],
  metadata: { importedDriveTrial: true, placeholder: true },
});

const mapRelationType = (relation: string | undefined): EdgeRelationType => {
  switch (relation) {
    case "precursor_to":
    case "philosophical_descendant_of":
    case "influenced_by":
    case "reacted_against":
      return "influenced";
    case "formalized_by":
    case "operationalized_by":
      return "developed_concept";
    case "mathematical_generalization_of":
      return "mathematical_generalization_of";
    case "collaborated_with":
    case "institutionalized_by":
    default:
      return "associated_with";
  }
};

const buildSemanticEntities = (
  data: DriveSemanticPayload | undefined,
  traditionsByLabel: Map<string, Tradition>,
) => {
  const people = new Map<PersonId, Person>();
  const concepts = new Map<ConceptId, Concept>();
  const institutions = new Map<InstitutionId, Institution>();
  const declared = declaredEntityNameByKey(data?.entities ?? []);

  for (const entity of data?.entities ?? []) {
    if (entity.entity_types?.some((type) => /person/i.test(type))) {
      people.set(personId(entity.name ?? entity.entity_id ?? "unknown"), toSemanticPerson(entity, traditionsByLabel));
    } else {
      concepts.set(conceptId(entity.name ?? entity.entity_id ?? "unknown"), toSemanticConcept(entity, traditionsByLabel));
    }
  }

  for (const relationship of data?.relationships ?? []) {
    for (const endpoint of [relationship.source, relationship.target]) {
      const label = clean(endpoint);
      if (!label || declared.has(label) || declared.has(label.toLowerCase())) continue;
      if (looksLikeInstitution(label)) {
        institutions.set(institutionId(label), toPlaceholderInstitution(label));
      } else if (looksLikePerson(label)) {
        people.set(personId(label), toPlaceholderPerson(label));
      } else {
        concepts.set(conceptId(label), toSemanticConcept(label, traditionsByLabel));
      }
    }
  }

  for (const lineage of data?.lineages ?? []) {
    const labels = [...(lineage.steps ?? []), ...(lineage.nodes ?? [])].map(clean).filter(Boolean);
    for (const label of labels) {
      if (!people.has(personId(label)) && !institutions.has(institutionId(label))) {
        concepts.set(conceptId(label), toSemanticConcept(label, traditionsByLabel));
      }
    }
  }

  return { people, concepts, institutions, declared };
};

const buildEdges = (
  data: DriveSemanticPayload | undefined,
  declared: Map<string, DriveSemanticEntity>,
): Edge[] => {
  const edges: Edge[] = [];
  let edgeIndex = 0;
  for (const relationship of data?.relationships ?? []) {
    const sourceLabel = clean(relationship.source);
    const targetLabel = clean(relationship.target);
    if (!sourceLabel || !targetLabel) continue;
    const relationType = mapRelationType(relationship.relation);
    edges.push({
      id: `edge_drive_semantic_${String(edgeIndex + 1).padStart(3, "0")}_${slugify(sourceLabel)}_${slugify(targetLabel)}`,
      recordType: "edge",
      relationType,
      label: relationship.relation?.replaceAll("_", " ") ?? relationType.replaceAll("_", " "),
      description: `Gemini semantic relationship: ${sourceLabel} ${relationship.relation ?? relationType} ${targetLabel}.`,
      sourceId: resolveSemanticEntityId(sourceLabel, declared),
      targetId: resolveSemanticEntityId(targetLabel, declared),
      direction: relationship.relation === "collaborated_with" ? "undirected" : "directed",
      domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId],
      tagIds: [],
      citationIds: [],
      relatedEntityIds: [],
      mediaAssetIds: [],
      certainty:
        typeof relationship.confidence === "number" && relationship.confidence >= 0.9
          ? "probable"
          : "possible",
      weight: relationship.weight ?? relationship.confidence ?? 0.6,
      metadata: {
        importedDriveTrial: true,
        originalRelation: relationship.relation ?? null,
        confidence: relationship.confidence ?? null,
        evidenceType: relationship.evidence_type ?? null,
      },
      assertionLayer: "ai_hypothesis",
    });
    edgeIndex += 1;
  }

  for (const lineage of data?.lineages ?? []) {
    const labels = [...(lineage.steps ?? []), ...(lineage.nodes ?? [])].map(clean).filter(Boolean);
    for (let i = 0; i < labels.length - 1; i += 1) {
      edges.push({
        id: `edge_drive_lineage_${slugify(lineage.lineage_id ?? String(edges.length))}_${i}`,
        recordType: "edge",
        relationType: "influenced",
        label: "lineage step",
        description: clean(lineage.description) || `${labels[i]} precedes ${labels[i + 1]} in ${lineage.name ?? "imported lineage"}.`,
        sourceId: conceptId(labels[i]),
        targetId: conceptId(labels[i + 1]),
        direction: "directed",
        domainIds: [DRIVE_DOMAIN_ID, "domain_science" as DomainId],
        tagIds: [],
        citationIds: [],
        relatedEntityIds: [],
        mediaAssetIds: [],
        certainty: "possible",
        weight: typeof lineage.confidence === "number" ? lineage.confidence : 0.72,
        metadata: {
          importedDriveTrial: true,
          lineageId: lineage.lineage_id ?? null,
          lineageName: lineage.name ?? null,
          confidence: lineage.confidence ?? null,
          sourceFile: lineage.source_file ?? null,
          sourceFiles: lineage.source_files ?? [],
        },
        assertionLayer: "ai_hypothesis",
      });
    }
  }

  return edges;
};

const ensureDriveDomain = (domains: DomainDefinition[]) =>
  domains.some((domain) => domain.id === DRIVE_DOMAIN_ID)
    ? domains
    : [
        ...domains,
        {
          id: DRIVE_DOMAIN_ID,
          slug: "drive-library",
          label: "Drive Library",
          description: "Imported Gemini trial index and semantic embedding records.",
          kind: "history" as const,
          colorToken: "teal",
        },
      ];

export const extendSeedWithDriveTrialData = (
  seed: SacredTimelineSeedData,
  data: DriveTrialData,
): SacredTimelineSeedData => {
  if (!data.index && !data.semantic) {
    return seed;
  }

  const existingTagIds = new Set(seed.tags.map((tag) => tag.id));
  const existingTraditionsByLabel = new Map(seed.traditions.map((tradition) => [tradition.label.toLowerCase(), tradition]));
  const importedTraditions = buildTraditions(data, existingTraditionsByLabel);
  const traditions = [...seed.traditions, ...importedTraditions];
  const traditionsByLabel = new Map(traditions.map((tradition) => [tradition.label.toLowerCase(), tradition]));
  const importedTags = buildTagDefinitions(data, existingTagIds);
  const sources = (data.index?.index_records ?? []).map(toSourceRecord);
  const texts = (data.index?.index_records ?? []).map((record, index) =>
    toTextRecord(record, index, sources[index].id, traditionsByLabel),
  );
  const semanticEntities = buildSemanticEntities(data.semantic, traditionsByLabel);
  const semanticEdges = buildEdges(data.semantic, semanticEntities.declared);

  return {
    ...seed,
    domains: ensureDriveDomain(seed.domains),
    tags: [...seed.tags, ...importedTags],
    sources: [...seed.sources, ...sources],
    people: [...seed.people, ...semanticEntities.people.values()],
    texts: [...seed.texts, ...texts],
    concepts: [...seed.concepts, ...semanticEntities.concepts.values()],
    institutions: [...seed.institutions, ...semanticEntities.institutions.values()],
    traditions,
    edges: [...seed.edges, ...semanticEdges],
    meta: {
      ...seed.meta,
      description: `${seed.meta.description} Includes imported Gemini drive trial data.`,
    },
  };
};
