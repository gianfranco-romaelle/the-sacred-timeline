import { constellationRelationFamilies } from "./constellation-styles";

export function ConstellationLegend() {
  return (
    <div className="constellation-legend">
      <p className="eyebrow">Reading the field</p>
      <div className="constellation-legend__rows">
        <span><strong>P</strong> person</span>
        <span><strong>T</strong> text</span>
        <span><strong>C</strong> concept</span>
        <span><strong>I</strong> institution</span>
        <span><strong>L</strong> place</span>
      </div>
      <div className="constellation-legend__edges">
        {constellationRelationFamilies.map((family) => (
          <span className="constellation-legend__edge" key={family.id} title={family.description}>
            <i style={{ backgroundColor: family.color }} />
            {family.label}
          </span>
        ))}
      </div>
      <p className="constellation-legend__note">
        Warm and cool tones encode domain emphasis; the selected neighborhood brightens while the
        rest of the field quiets. Edge color follows relation family; selected edges use a darker
        reading line.
      </p>
    </div>
  );
}
