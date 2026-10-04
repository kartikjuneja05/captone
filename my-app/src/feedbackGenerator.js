import { JOINT_INDICES } from './data/asanas';
import { getPixelCoords, calculateAngle } from './geometry';
import { acceptableRange } from './romProfile';

const MIN_VISIBILITY = 0.2;
const SMOOTHING = 0.35;     // 0..1, higher = reacts faster, lower = steadier messages
const MAX_CORRECTIONS = 2;  // never overwhelm: show only the most important fixes

// Angles are smoothed over time so the advice doesn't flicker with every jittery frame.
const smoothed = {};
export const resetFeedbackState = () => { for (const k of Object.keys(smoothed)) delete smoothed[k]; };

const smooth = (joint, raw) => {
  const prev = smoothed[joint];
  smoothed[joint] = prev === undefined || Math.abs(raw - prev) > 40 ? raw : prev + SMOOTHING * (raw - prev);
  return smoothed[joint];
};

// ---------------------------------------------------------------- wording
// All the human-readable text lives here, so you can reword it without touching any logic.
const hash = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
// Rotates slowly (every ~8 s) so encouragement feels varied but never flickers.
const pick = (list, seed) => list[(Math.floor(Date.now() / 8000) + hash(seed)) % list.length];

const PERFECT = [
  'Beautiful! Your form looks great. Hold it and breathe.',
  "That's it! Strong, steady and balanced. Keep breathing.",
  'Lovely alignment! Stay right here and breathe deeply.',
  "Yes! You've found the pose. Hold it and keep your breath smooth.",
];
const PERFECT_FOR_YOU = [
  "That's a great shape for your body today. Well done! Keep breathing.",
  'Wonderful. This is just right for your current flexibility. Hold and breathe.',
  "Lovely work. You're moving within your range, and it shows. Stay and breathe.",
];
const STARTING = [
  "Let's build the pose together. Start with this one:",
  'No rush. Take a breath, then try this:',
  "You're getting there. Here's the first thing to adjust:",
];

const SIZE_WORD = { small: 'a touch', medium: 'a little', large: 'quite a bit' };

// 'low' = the measured angle is BELOW the acceptable band, 'high' = ABOVE it.
const CUES = {
  shoulder: {
    low: (s, a) => ({ icon: '⬆️', text: `Lift your ${s} arm ${a} higher` }),
    high: (s, a) => ({ icon: '⬇️', text: `Lower your ${s} arm ${a}` }),
  },
  elbow: {
    low: (s, a) => ({ icon: '↔️', text: `Straighten your ${s} arm ${a}` }),
    high: (s, a) => ({ icon: '💪', text: `Bend your ${s} elbow ${a} more` }),
  },
  knee: {
    low: (s, a) => ({ icon: '↕️', text: `Straighten your ${s} knee ${a}` }),
    high: (s, a) => ({ icon: '🦵', text: `Bend your ${s} knee ${a} more` }),
  },
  hip: {
    front: {
      low: (s, a) => ({ icon: '🧍', text: `Ease your ${s} hip back ${a} and lift your chest` }),
      high: (s, a) => ({ icon: '↔️', text: `Open your ${s} hip ${a} wider` }),
    },
    side: {
      low: (s, a) => ({ icon: '🧘', text: `Lengthen through your ${s} hip ${a}` }),
      high: (s, a) => ({ icon: '🙇', text: `Fold ${a} deeper from your ${s} hip` }),
    },
  },
};

const NOUN = { shoulder: ['arm', 'arms'], elbow: ['elbow', 'elbows'], knee: ['knee', 'knees'], hip: ['hip', 'hips'] };

const sizeOf = (delta) => (delta <= 8 ? 'small' : delta <= 20 ? 'medium' : 'large');

const cueFor = (kind, side, plane, dir, delta) => {
  const table = kind === 'hip' ? CUES.hip[plane === 'side' ? 'side' : 'front'] : CUES[kind];
  return table[dir](side, SIZE_WORD[sizeOf(delta)]);
};

/** "both knees", "left arm and right hip", ... */
const describeGood = (items) => {
  const byKind = {};
  for (const { kind, side } of items) (byKind[kind] ??= []).push(side);
  const parts = Object.entries(byKind).map(([kind, sides]) =>
    sides.length > 1 ? `both ${NOUN[kind][1]}` : `${sides[0]} ${NOUN[kind][0]}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
};

// ---------------------------------------------------------------- main entry
/**
 * @param asana   a personalised asana (see personalizeAsana) - each joint has ideal, target, tolerance, weight
 * @param pose    MediaPipe landmarks for one person
 * @param options { showAngles?: boolean }
 * @returns       HTML string for the feedback panel
 */
export const generateFeedback = (asana, pose, width, height, options = {}) => {
  const joints = [];
  const missing = [];

  for (const [name, t] of Object.entries(asana.targets)) {
    const idx = JOINT_INDICES[name];
    if (!idx) continue;
    const pts = idx.map((i) => pose[i]);
    if (pts.some((p) => !p || (p.visibility ?? 1) <= MIN_VISIBILITY)) { missing.push(name); continue; }

    const raw = calculateAngle(
      getPixelCoords(pts[0], width, height),
      getPixelCoords(pts[1], width, height),
      getPixelCoords(pts[2], width, height),
    );
    const angle = smooth(name, raw);
    const [lo, hi] = acceptableRange(t);
    const [side, kind] = name.split('_');
    const ok = angle >= lo && angle <= hi;
    const dir = angle < lo ? 'low' : 'high';
    const delta = ok ? 0 : dir === 'low' ? lo - angle : angle - hi;
    // "in range but short of the ideal": fine for this person, a nice stretch goal
    const shortOfIdeal = ok && t.adjusted && Math.abs(angle - t.ideal) > t.tolerance;
    joints.push({ name, side, kind, t, angle, lo, hi, ok, dir, delta, shortOfIdeal });
  }

  if (joints.length === 0) {
    return `<div class="fb-headline fb-neutral">Please step back a little so I can see you.</div>
      <div class="feedback-text" style="font-size:14px;color:#666;">Your whole body needs to be in the frame.</div>`;
  }

  const good = joints.filter((j) => j.ok);
  const bad = joints.filter((j) => !j.ok)
    .sort((a, b) => b.t.weight * b.delta - a.t.weight * a.delta);
  const anyAdjusted = joints.some((j) => j.t.adjusted);

  let html = '';

  if (bad.length === 0) {
    const personal = joints.some((j) => j.shortOfIdeal);
    html += `<div class="fb-headline fb-good">${pick(personal ? PERFECT_FOR_YOU : PERFECT, asana.id)}</div>`;
    if (personal) {
      html += `<div class="feedback-text" style="font-size:14px;color:#555;">
        You're within your own range. Over time you can ease toward the full pose, only when it feels good.</div>`;
    }
  } else {
    if (good.length > 0) {
      html += `<div class="fb-headline fb-good">Nice! Your ${describeGood(good)} look${good.length === 1 ? 's' : ''} great.</div>`;
      html += `<div class="feedback-text" style="font-size:15px;margin-top:4px;">Now, one thing to adjust:</div>`;
    } else {
      html += `<div class="fb-headline fb-neutral">${pick(STARTING, asana.id)}</div>`;
    }
    for (const j of bad.slice(0, MAX_CORRECTIONS)) {
      const cue = cueFor(j.kind, j.side, asana.plane, j.dir, j.delta);
      html += `<div class="fb-cue"><span class="fb-icon">${cue.icon}</span><span>${cue.text}</span></div>`;
    }
    if (bad.length > MAX_CORRECTIONS) {
      html += `<div class="feedback-text" style="font-size:14px;color:#666;">A few small tweaks left. We'll get to them once these feel right.</div>`;
    }
  }

  if (missing.length > 0) {
    const names = missing.map((m) => m.replace('_', ' ')).join(', ');
    html += `<div class="feedback-text" style="font-size:14px;color:#666;margin-top:12px;">
      <i>I can't clearly see your ${names}. Try stepping back or turning slightly toward the camera.</i></div>`;
  }
  if (anyAdjusted) {
    html += `<div class="feedback-text" style="font-size:13px;color:#666;margin-top:12px;">
      This pose is tailored to your flexibility profile.</div>`;
  }
  if (options.showAngles) {
    const rows = joints.map((j) => `<tr><td>${j.name.replace('_', ' ')}</td><td>${Math.round(j.angle)}°</td>
      <td>${Math.round(j.t.target)}°</td><td>${j.t.ideal}°</td><td>${Math.round(j.lo)}-${Math.round(j.hi)}°</td>
      <td>${j.ok ? '✓' : j.dir === 'low' ? '↓' : '↑'}</td></tr>`).join('');
    html += `<table class="fb-debug"><tr><th>joint</th><th>now</th><th>your target</th><th>ideal</th><th>correct band</th><th></th></tr>${rows}</table>`;
  }
  return html;
};
