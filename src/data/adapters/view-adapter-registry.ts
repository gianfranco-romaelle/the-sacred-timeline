import {
  timelineProjectionAdapter,
  type TimelineProjection,
} from "@/data/adapters/timeline-adapter";
import {
  graphProjectionAdapter,
  type GraphProjection,
} from "@/data/adapters/graph-adapter";
import {
  mapProjectionAdapter,
  type MapProjection,
} from "@/data/adapters/map-adapter";
import {
  faceAtlasProjectionAdapter,
  type FaceAtlasProjection,
  type FaceAtlasProjectionInput,
} from "@/data/adapters/face-atlas-adapter";
export { riverLaneProjectionAdapter } from "@/historical/projections/river-lane-functor";
import type { ExplorerView } from "@/state/explorer-store";
import type { ProjectionInput, ViewProjectionAdapter } from "@/types/projections";

export interface ViewProjectionRegistry {
  river: ViewProjectionAdapter<TimelineProjection>;
  constellation: ViewProjectionAdapter<GraphProjection>;
  atlas: ViewProjectionAdapter<MapProjection>;
  "face-atlas": ViewProjectionAdapter<FaceAtlasProjection, FaceAtlasProjectionInput>;
}

export const viewProjectionRegistry: ViewProjectionRegistry = {
  river: timelineProjectionAdapter,
  constellation: graphProjectionAdapter,
  atlas: mapProjectionAdapter,
  "face-atlas": faceAtlasProjectionAdapter,
};

export const standardProjectionViews = [
  "river",
  "constellation",
  "atlas",
] as const satisfies readonly ExplorerView[];

export const buildStandardProjection = (
  view: (typeof standardProjectionViews)[number],
  input: ProjectionInput,
) => viewProjectionRegistry[view](input);
