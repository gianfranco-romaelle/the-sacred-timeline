import backgroundTexture from "@/assets/background.png";

const RESPONSIVE_TEXTURE_SIZE = "clamp(180px, 28vw, 420px) clamp(180px, 28vw, 420px)";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getGraphTextureBackgroundStyle(opacity = 0.9) {
  return {
    backgroundColor: "#f8fafc",
    backgroundImage: `linear-gradient(180deg, rgba(248,250,252,0.88), rgba(255,255,255,0.92)), url(${backgroundTexture})`,
    backgroundSize: `100% 100%, ${RESPONSIVE_TEXTURE_SIZE}`,
    backgroundPosition: "center, center",
    backgroundRepeat: "no-repeat, repeat",
    backgroundBlendMode: "normal, multiply",
    opacity: clamp(opacity, 0, 1),
  };
}

export function hexToRgba(hexColor, alpha) {
  const hex = (hexColor || "#64748b").replace("#", "").padEnd(6, "0");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getStructuralGraphNodeGeometry(node, isCalculusMode) {
  if (isCalculusMode && node.group === "data") {
    return { x: node.x - 108, y: node.y - 28, width: 216, height: 56 };
  }

  const width = isCalculusMode && node.group === "classification" ? 172 : 196;
  const height = isCalculusMode && node.group === "classification" ? 56 : 52;
  return { x: node.x - width / 2, y: node.y - height / 2, width, height };
}

export function makeSelectionRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function getStructuralGraphSeedLayout(graph, isCalculusMode) {
  if (!isCalculusMode) {
    const groups = [
      { key: "widget", title: "Widgets", x: 220 },
      { key: "data", title: "Timeline Data", x: 610 },
      { key: "classification", title: "Relations", x: 1000 },
    ];

    const nodes = groups.flatMap((group) =>
      graph.nodes
        .filter((node) => node.group === group.key)
        .map((node, index) => ({ ...node, x: group.x, y: 90 + index * 86 }))
    );

    return {
      width: 1280,
      height: Math.max(780, Math.max(...nodes.map((node) => node.y), 0) + 120),
      nodes,
      clusterHalos: [],
      groupLabels: groups.map((group) => ({ key: group.key, title: group.title, x: group.x })),
    };
  }

  const clusterSeeds = new Map([
    ["Zeroth", { x: 500, y: 190 }],
    ["First", { x: 810, y: 190 }],
    ["Second", { x: 1120, y: 190 }],
    ["Third", { x: 500, y: 490 }],
    ["Fourth", { x: 810, y: 490 }],
    ["Fifth", { x: 1120, y: 490 }],
    ["Unclassified", { x: 810, y: 760 }],
  ]);
  const nodes = [];
  const clusterHalos = [];
  const classificationNodes = graph.nodes
    .filter((node) => node.group === "classification")
    .sort((a, b) => (a.clusterIndex ?? Number.MAX_SAFE_INTEGER) - (b.clusterIndex ?? Number.MAX_SAFE_INTEGER));
  const dataNodes = graph.nodes.filter((node) => node.group === "data");
  const centerByCluster = new Map();

  classificationNodes.forEach((node, index) => {
    const seed = clusterSeeds.get(node.clusterKey || node.title) || { x: 1120, y: 760 + index * 70 };
    centerByCluster.set(node.clusterKey || node.title, { x: seed.x, y: seed.y, color: node.color || "#94a3b8" });
    nodes.push({ ...node, x: seed.x, y: seed.y });
  });

  const dataByCluster = new Map();
  dataNodes.forEach((node) => {
    const key = node.clusterKey || "Unclassified";
    if (!dataByCluster.has(key)) dataByCluster.set(key, []);
    dataByCluster.get(key).push(node);
  });

  dataByCluster.forEach((clusterNodes, key) => {
    const center = centerByCluster.get(key) || { x: 1120, y: 760, color: "#94a3b8" };
    const nodesPerRing = 14;
    const baseRadius = 82;
    const ringGap = 34;
    const ringCount = Math.max(1, Math.ceil(clusterNodes.length / nodesPerRing));
    const haloRadius = baseRadius + Math.max(0, ringCount - 1) * ringGap + 30;

    clusterHalos.push({ key, x: center.x, y: center.y, radius: haloRadius, color: center.color });

    clusterNodes.forEach((node, index) => {
      const ringIndex = Math.floor(index / nodesPerRing);
      const ringOffset = index % nodesPerRing;
      const ringSize = Math.min(nodesPerRing, clusterNodes.length - ringIndex * nodesPerRing);
      const angle = -Math.PI / 2 + (Math.PI * 2 * ringOffset) / Math.max(1, ringSize) + ringIndex * 0.22;
      const radius = baseRadius + ringIndex * ringGap;
      nodes.push({ ...node, x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    });
  });

  return {
    width: 1460,
    height: 920,
    nodes,
    clusterHalos,
    groupLabels: [{ key: "clusters", title: "Calculus Clusters", x: 810 }],
  };
}
