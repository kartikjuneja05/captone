import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type Point2D = { x: number, y: number };

export function getPixelCoords(landmark: NormalizedLandmark, width: number, height: number): Point2D {
  return { x: landmark.x * width, y: landmark.y * height };
}

export function calculateAngle(a: Point2D, b: Point2D, c: Point2D): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180.0) angle = 360.0 - angle;
  return angle;
}