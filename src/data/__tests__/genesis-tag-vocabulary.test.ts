import { describe, expect, it } from "vitest";
import {
  GENESIS_COGNITIVE_TAG_LABELS,
  GENESIS_MATH_TAG_LABELS,
  GENESIS_PIPELINE_FLAG_LABELS,
  GENESIS_SCIENTIFIC_DOMAIN_LABELS,
  genesisControlledTags,
} from "../genesis-tag-vocabulary";
import { sacredTimelineSeed } from "../sacred-timeline.seed";

describe("genesisControlledTags", () => {
  it("imports the closed controlled tag vocabularies into tag definitions", () => {
    expect(GENESIS_COGNITIVE_TAG_LABELS).toHaveLength(97);
    expect(GENESIS_MATH_TAG_LABELS).toHaveLength(146);
    expect(GENESIS_SCIENTIFIC_DOMAIN_LABELS).toHaveLength(95);
    expect(GENESIS_PIPELINE_FLAG_LABELS).toHaveLength(76);
    expect(genesisControlledTags).toHaveLength(414);
  });

  it("populates the Sacred Timeline seed tag section", () => {
    expect(sacredTimelineSeed.tags.length).toBeGreaterThanOrEqual(418);
    expect(sacredTimelineSeed.tags.some((tag) => tag.label === "Functoriality")).toBe(true);
    expect(sacredTimelineSeed.tags.some((tag) => tag.label === "Topos Logic")).toBe(true);
    expect(sacredTimelineSeed.tags.some((tag) => tag.label === "Low-Confidence-Tags")).toBe(true);
  });
});
