import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { JOINT_INDICES, type Asana } from './data/asanas';
import { getPixelCoords, calculateAngle } from './geometry';

export const generateFeedback = (asana: Asana, pose: NormalizedLandmark[], width: number, height: number): string => {
  let feedbackHTML = "";
  let anyAdjusted = false;
  let allPerfect = true;
  let evaluatedCount = 0;
  let missingJoints: string[] = [];

  for (const [jointName, targetData] of Object.entries(asana.targets)) {
    const indices = JOINT_INDICES[jointName];
    if (!indices) continue;

    const ptA = pose[indices[0]];
    const ptB = pose[indices[1]];
    const ptC = pose[indices[2]];

    const visA = ptA.visibility ?? 1;
    const visB = ptB.visibility ?? 1;
    const visC = ptC.visibility ?? 1;

    // Check if joints are visible
    if (visA > 0.2 && visB > 0.2 && visC > 0.2) {
      evaluatedCount++;
      const p1 = getPixelCoords(ptA, width, height);
      const p2 = getPixelCoords(ptB, width, height);
      const p3 = getPixelCoords(ptC, width, height);

      const angle = calculateAngle(p1, p2, p3);
      
      // Calculate acceptable range
      // Personalised targets carry explicit bounds; otherwise fall back to target +/- tolerance
      const minBound = targetData.minBound ?? targetData.target - targetData.tolerance;
      const maxBound = targetData.maxBound ?? Math.min(180, targetData.target + targetData.tolerance);
      if (targetData.adjusted) anyAdjusted = true;

      const isSafe = angle >= minBound && angle <= maxBound;

      if (!isSafe) {
        allPerfect = false;
        feedbackHTML += `<div class="feedback-text error">
          Adjust ${jointName.replace('_', ' ')}: ~${Math.round(angle)}° (Target: ${targetData.target}°${targetData.adjusted ? ', adjusted to your range' : ''})
        </div>`;
      }
    } else {
      missingJoints.push(jointName.replace('_', ' '));
    }
  }

  // --- Final Output Formatting ---
  if (evaluatedCount === 0) {
    feedbackHTML = `<div class="feedback-text" style="color: #d97706; font-weight: bold;">
      Please step back. Cannot see enough of your body.
    </div>`;
  } else if (missingJoints.length > 0) {
    if (allPerfect) {
      feedbackHTML = `<div class="feedback-text success">Visible joints look perfect!</div>` + feedbackHTML;
    }
    feedbackHTML += `<div class="feedback-text" style="font-size: 14px; color: #666; margin-top: 15px;">
      <i>(Note: Couldn't clearly see ${missingJoints.join(', ')}.)</i>
    </div>`;
  } else if (allPerfect) {
    feedbackHTML = `<div class="feedback-text success">Perfect form! Hold the pose.</div>`;
  }
  
  if (anyAdjusted) {
    feedbackHTML += `<div class="feedback-text" style="font-size: 13px; color: #666; margin-top: 15px;">
      Targets are adjusted to your flexibility profile.
    </div>`;
  }

  return feedbackHTML;
};