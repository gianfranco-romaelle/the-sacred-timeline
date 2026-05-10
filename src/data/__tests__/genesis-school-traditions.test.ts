import { describe, expect, it } from "vitest";
import { GENESIS_SCHOOL_LABELS, genesisSchoolTraditions } from "../genesis-school-traditions";
import { sacredTimelineSeed } from "../sacred-timeline.seed";

describe("genesisSchoolTraditions", () => {
  it("imports the closed Schools vocabulary into tradition records", () => {
    expect(GENESIS_SCHOOL_LABELS).toHaveLength(265);
    expect(genesisSchoolTraditions).toHaveLength(265);
    expect(genesisSchoolTraditions.map((tradition) => tradition.label)).toEqual(
      expect.arrayContaining([
        "Vedic Strata",
        "Göttingen School",
        "Grothendieck School",
        "Platform Governance",
        "Computational Social Science",
      ]),
    );
  });

  it("populates the Sacred Timeline seed tradition section", () => {
    expect(sacredTimelineSeed.traditions.length).toBeGreaterThanOrEqual(266);
    expect(sacredTimelineSeed.traditions.some((tradition) => tradition.label === "RAND")).toBe(true);
    expect(sacredTimelineSeed.traditions.some((tradition) => tradition.label === "Deep Learning")).toBe(true);
  });
});
