import { createFragmentDustSnapshot } from "./fragment-dust-generator";

export {
  findExposedConnectionPoints,
  findNeighboringFragments,
  fragmentDepthSummary,
  fragmentSceneSpan,
  generateFragmentDust,
  getFragmentRecord,
  selectLocalGraphNeighborhood,
  traverseAncestors,
  traverseDescendants,
} from "./fragment-dust-generator";

export function createSampleHegelTriangleSnapshot() {
  return createFragmentDustSnapshot({
    depth: 3,
    seed: "hegel-fragment-mvp",
  });
}
