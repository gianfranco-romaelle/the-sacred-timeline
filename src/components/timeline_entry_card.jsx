import React from "react";
import tileTexture from "@/assets/timeline tile.png";
import "./timeline_entry_card.css";

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hexColor) {
  const normalized = String(hexColor || "#64748b").replace("#", "").padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function mixHex(baseHex, accentHex, ratio) {
  const base = hexToRgb(baseHex);
  const accent = hexToRgb(accentHex);
  const t = Math.max(0, Math.min(1, ratio));
  const r = clampChannel(base.r + (accent.r - base.r) * t);
  const g = clampChannel(base.g + (accent.g - base.g) * t);
  const b = clampChannel(base.b + (accent.b - base.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function TimelineEntryCard({
  accentColor = "#64748b",
  portraitSrc = "",
  portraitAlt = "",
  isFallbackPortrait = false,
  nameContent,
  datesContent,
  labelContent,
  className = "",
  style,
  onDoubleClick,
}) {
  const mergedStyle = {
    "--timeline-entry-card-bg": mixHex("#728198", accentColor, 0.18),
    "--timeline-entry-card-edge": mixHex("#3d4a5b", accentColor, 0.32),
    "--timeline-entry-card-rule-color": "rgba(246, 241, 232, 0.3)",
    "--timeline-entry-card-tile": `url(${tileTexture})`,
    "--timeline-entry-card-texture-opacity": 0.5,
    "--timeline-entry-card-tile-tint": "#ffffff",
    ...style,
  };

  return (
    <article className={`timeline-entry-card ${className}`.trim()} style={mergedStyle} onDoubleClick={onDoubleClick}>
      <div className="timeline-entry-card__portrait" aria-hidden={!portraitSrc}>
        {portraitSrc ? (
          isFallbackPortrait ? (
            <div className="timeline-entry-card__placeholder">
              <img src={portraitSrc} alt="" aria-hidden="true" />
            </div>
          ) : (
            <img src={portraitSrc} alt={portraitAlt} />
          )
        ) : (
          <div className="timeline-entry-card__placeholder" />
        )}
        <div className="timeline-entry-card__portrait-x" aria-hidden="true" />
      </div>

      <div className="timeline-entry-card__body">
        <div className="timeline-entry-card__name">{nameContent}</div>
        <div className="timeline-entry-card__dates">{datesContent}</div>
        <div className="timeline-entry-card__rule" />
        <div className="timeline-entry-card__label">{labelContent}</div>
      </div>
    </article>
  );
}
