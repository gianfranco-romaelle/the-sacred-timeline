import { motion } from "motion/react";
import type {
  FaceAtlasGroup as FaceAtlasGroupShape,
  FaceAtlasItem,
} from "@/data/adapters/face-atlas-adapter";
import type { EditorialScopeMode } from "@/editorial/types";
import { FaceAtlasCard } from "./face-atlas-card";

interface FaceAtlasGroupProps {
  group: FaceAtlasGroupShape;
  editorialMode: boolean;
  editorialScopeMode: EditorialScopeMode;
  onSelect: (item: FaceAtlasItem) => void;
}

export function FaceAtlasGroup({
  group,
  editorialMode,
  editorialScopeMode,
  onSelect,
}: FaceAtlasGroupProps) {
  return (
    <motion.section className="face-atlas-group" layout>
      <div className="face-atlas-group__header">
        <div>
          <p className="eyebrow">{group.itemCount} portraits</p>
          <h3>{group.label}</h3>
        </div>
        {group.featuredCount > 0 ? (
          <span className="face-atlas-group__note">{group.featuredCount} highlighted records</span>
        ) : null}
      </div>

      <div className="face-atlas-group__grid">
        {group.items.map((item) => (
          <FaceAtlasCard
            item={item}
            key={item.portraitAssetId}
            editorialMode={editorialMode}
            editorialScopeMode={editorialScopeMode}
            onSelect={onSelect}
          />
        ))}
      </div>
    </motion.section>
  );
}
