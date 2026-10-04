/** Convert a MediaPipe normalised landmark to pixel coordinates. */
export function getPixelCoords(landmark, width, height) {
  return { x: landmark.x * width, y: landmark.y * height };
}

/** Interior angle (0-180 degrees) at point b, between the rays b->a and b->c. */
export function calculateAngle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) angle = 360.0 - angle;
  return angle;
}
