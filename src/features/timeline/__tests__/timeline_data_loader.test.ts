import { describe, expect, it } from "vitest";
import { getCalculusClassificationFromStartYear } from "../timeline_data_loader";

describe("getCalculusClassificationFromStartYear", () => {
  it("uses the current seven-calculi historical period thresholds", () => {
    expect(getCalculusClassificationFromStartYear(1599)).toEqual({
      calculusName: "Zeroth",
      calculusNumber: 0,
    });
    expect(getCalculusClassificationFromStartYear(1600)).toEqual({
      calculusName: "First",
      calculusNumber: 1,
    });
    expect(getCalculusClassificationFromStartYear(1750)).toEqual({
      calculusName: "Second",
      calculusNumber: 2,
    });
    expect(getCalculusClassificationFromStartYear(1850)).toEqual({
      calculusName: "Third",
      calculusNumber: 3,
    });
    expect(getCalculusClassificationFromStartYear(1900)).toEqual({
      calculusName: "Fourth",
      calculusNumber: 4,
    });
    expect(getCalculusClassificationFromStartYear(1950)).toEqual({
      calculusName: "Fifth",
      calculusNumber: 5,
    });
  });

  it("classifies semantic computation and categorical infrastructure contexts as Sixth", () => {
    expect(
      getCalculusClassificationFromStartYear(1945, {
        field: "Mathematics",
        scientific_domains: ["Category Theory"],
        summary: "Topos theory and sheaf-theoretic semantics.",
      }),
    ).toEqual({
      calculusName: "Sixth",
      calculusNumber: 6,
    });

    expect(
      getCalculusClassificationFromStartYear(1971, {
        field: "Computer Science",
        summary: "Artificial intelligence, machine learning, and distributed systems.",
      }),
    ).toEqual({
      calculusName: "Sixth",
      calculusNumber: 6,
    });
  });
});
