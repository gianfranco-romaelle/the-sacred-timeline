import type { Point2D } from "@/types/hegel-triangle";

export type TrianglePoints = [Point2D, Point2D, Point2D];
export type TriangleBranch = "root" | "top" | "left" | "right";

export interface TriangleGeometryNode {
  path: string;
  depth: number;
  branch: TriangleBranch;
  parentPath?: string;
  points: TrianglePoints;
  centroid: Point2D;
}

function point(x: number, y: number): Point2D {
  return { x, y };
}

function midpoint(left: Point2D, right: Point2D): Point2D {
  return point((left.x + right.x) / 2, (left.y + right.y) / 2);
}

function centroid([a, b, c]: TrianglePoints): Point2D {
  return point((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
}

export function lerpPoint(start: Point2D, end: Point2D, t: number): Point2D {
  return point(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
}

export function distanceBetween(left: Point2D, right: Point2D): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.hypot(dx, dy);
}

export function pushAwayFrom(origin: Point2D, target: Point2D, distance: number): Point2D {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy) || 1;
  return point(target.x + (dx / length) * distance, target.y + (dy / length) * distance);
}

export function rootTriangleGeometry(): TrianglePoints {
  return [point(500, 72), point(132, 704), point(868, 704)];
}

export function splitTriangle([anchor, left, right]: TrianglePoints): Record<Exclude<TriangleBranch, "root">, TrianglePoints> {
  const anchorLeft = midpoint(anchor, left);
  const anchorRight = midpoint(anchor, right);
  const baseMiddle = midpoint(left, right);

  return {
    top: [anchor, anchorLeft, anchorRight],
    left: [left, baseMiddle, anchorLeft],
    right: [right, anchorRight, baseMiddle],
  };
}

function walkFragments(
  points: TrianglePoints,
  depthLimit: number,
  depth: number,
  path: string,
  branch: TriangleBranch,
  parentPath: string | undefined,
  output: TriangleGeometryNode[],
) {
  output.push({
    path,
    depth,
    branch,
    parentPath,
    points,
    centroid: centroid(points),
  });

  if (depth >= depthLimit) {
    return;
  }

  const children = splitTriangle(points);
  walkFragments(children.top, depthLimit, depth + 1, `${path}.top`, "top", path, output);
  walkFragments(children.left, depthLimit, depth + 1, `${path}.left`, "left", path, output);
  walkFragments(children.right, depthLimit, depth + 1, `${path}.right`, "right", path, output);
}

export function generateTriangleGeometry(depthLimit: number): TriangleGeometryNode[] {
  const output: TriangleGeometryNode[] = [];
  walkFragments(rootTriangleGeometry(), depthLimit, 0, "root", "root", undefined, output);
  return output;
}
