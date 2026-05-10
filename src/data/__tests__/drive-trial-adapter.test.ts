import { describe, expect, it } from "vitest";
import { extendSeedWithDriveTrialData, type DriveTrialData } from "../drive-trial-adapter";
import { sacredTimelineSeed } from "../sacred-timeline.seed";

const trialData: DriveTrialData = {
  index: {
    index_records: [
      {
        file_name: "Functorial Semantics.pdf",
        drive_path: "Mathematics/Functorial Semantics.pdf",
        calculi_id: 5,
        schools: ["Buffalo Geometry Seminar"],
        scientific_domain_tags: ["Category Theory"],
        math_tags: ["Topos"],
        cognitive_tags: ["Structure"],
        pipeline_flags: ["Tagging-Complete"],
        evidence_notes: "Category theory and topos semantics.",
        confidence: "High",
      },
    ],
  },
  semantic: {
    entities: [
      {
        entity_id: "P001",
        name: "F. William Lawvere",
        entity_types: ["Person"],
        birth_year: 1937,
        death_year: 2023,
        schools: ["Buffalo Geometry Seminar"],
        scientific_domains: ["Category Theory"],
        math_tags: ["Topos"],
        cognitive_tags: ["Formalization"],
        summary: "Central category theorist.",
        confidence: "high",
      },
      {
        entity_id: "M001",
        name: "Topos",
        entity_types: ["Mathematical Object"],
        scientific_domains: ["Category Theory"],
        math_tags: ["Topos"],
        summary: "Categorical universe of discourse.",
        confidence: "high",
      },
    ],
    relationships: [
      {
        source: "P001",
        target: "M001",
        relation: "formalized_by",
        weight: 0.95,
        confidence: 1,
      },
    ],
  },
};

describe("extendSeedWithDriveTrialData", () => {
  it("projects Gemini drive trial records into visible timeline entities and graph edges", () => {
    const seed = extendSeedWithDriveTrialData(sacredTimelineSeed, trialData);

    expect(seed.texts.some((text) => text.label === "Functorial Semantics.pdf")).toBe(true);
    expect(seed.people.some((person) => person.label === "F. William Lawvere")).toBe(true);
    expect(seed.concepts.some((concept) => concept.label === "Topos")).toBe(true);
    expect(seed.edges.some((edge) => edge.metadata?.importedDriveTrial === true)).toBe(true);
    expect(seed.traditions.some((tradition) => tradition.label === "Buffalo Geometry Seminar")).toBe(true);
    expect(seed.tags.some((tag) => tag.label === "Category Theory")).toBe(true);
  });
});
