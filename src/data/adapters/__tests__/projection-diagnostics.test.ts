import { describe, expect, it } from "vitest";
import { buildProjectionDiagnostics } from "@/data/adapters/projection-diagnostics";

describe("projection diagnostics", () => {
  it("stays silent for small projections", () => {
    expect(
      buildProjectionDiagnostics({
        projectionKind: "river",
        itemCount: 25,
        groupCount: 4,
      }),
    ).toEqual([]);
  });

  it("warns when a projection crosses scale thresholds", () => {
    const diagnostics = buildProjectionDiagnostics({
      projectionKind: "constellation",
      nodeCount: 900,
      edgeCount: 1800,
    });

    expect(diagnostics.map((item) => item.code)).toEqual([
      "constellation.dense-nodes",
      "constellation.dense-edges",
    ]);
    expect(diagnostics.every((item) => item.severity === "warning")).toBe(true);
  });
});
