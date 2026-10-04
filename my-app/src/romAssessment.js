import { JOINT_INDICES } from './data/asanas';
import { getPixelCoords, calculateAngle } from './geometry';
import {
  SIDES, friendlyLabel, friendlyValue, loadHistory, recordSession,
} from './romProfile';
import armsUpImg from './assets/rom/arms_up.svg';
import elbowBendImg from './assets/rom/elbow_bend.svg';
import wideStanceImg from './assets/rom/wide_stance.svg';
import forwardFoldImg from './assets/rom/forward_fold.svg';
import squatImg from './assets/rom/squat.svg';

// ---------------------------------------------------------------- tuning constants
const VIS = 0.5;               // min landmark visibility to trust a reading
const MEDIAN_WINDOW = 5;       // frames used to smooth jitter
const MIN_SAMPLES = 10;        // readings needed before a metric counts
const MIN_TRAVEL = 25;         // default degrees the joint must move for a reading to count as a real attempt
const IMPROVE_DEG = 1.5;       // progress smaller than this counts as "holding still"
const SETTLE_MS = 1500;        // hold still this long to lock the result
const STALE_MS = 1000;         // a metric with no valid reading for this long is "not currently seen"
const POSITION_HOLD_MS = 1000; // must be correctly positioned this long before measuring starts
const TIMEOUT_MS = 30000;      // give up on a step after this long
const FRONT_MIN_RATIO = 0.55;  // shoulder-width / torso-length when facing the camera
const SIDE_MAX_RATIO = 0.4;    // ...and when side-on

// ---------------------------------------------------------------- step definitions
/*
 * Step   { id, title, view: 'front'|'side', image, require: [landmark ids], instructions[], moveCue, metrics[] }
 * Metric { key, joint, goal: 'min'|'max', minTravel?, guards? }
 * Guard  { type: 'angle', joint, minAngle, cue }   another joint must stay at least this open
 *      | { type: 'upright', maxTilt, cue }         trunk must stay within maxTilt degrees of vertical
 */
const forEachSide = (fn) => SIDES.flatMap((s) => fn(s));

const STEPS = [
  {
    id: 'arms_up',
    title: 'Arms overhead',
    view: 'front',
    image: armsUpImg,
    require: [11, 12, 13, 14, 23, 24],
    instructions: [
      'Stand facing the camera so your whole body is in view.',
      'Keep your arms straight. Slowly lift them out to the sides and up overhead.',
      'Stop at a gentle stretch (never pain) and hold still for 2 seconds.',
    ],
    moveCue: 'Slowly raise both arms out to the sides and up.',
    metrics: forEachSide((s) => [{
      key: `${s}_shoulder_max`, joint: `${s}_shoulder`, goal: 'max',
      guards: [{ type: 'angle', joint: `${s}_elbow`, minAngle: 155, cue: 'Keep your arms straight.' }],
    }]),
  },
  {
    id: 'elbow_bend',
    title: 'Bend your elbows',
    view: 'front',
    image: elbowBendImg,
    require: [11, 12, 13, 14, 15, 16, 23, 24],
    instructions: [
      'Stay facing the camera with your arms relaxed by your sides.',
      'Slowly bend both elbows and bring your fingertips toward your shoulders.',
      'Go as far as is comfortable, then hold still for 2 seconds.',
    ],
    moveCue: 'Slowly bend both elbows toward your shoulders.',
    metrics: forEachSide((s) => [{ key: `${s}_elbow_min`, joint: `${s}_elbow`, goal: 'min' }]),
  },
  {
    id: 'wide_stance',
    title: 'Wide-leg stance',
    view: 'front',
    image: wideStanceImg,
    require: [11, 12, 23, 24, 25, 26, 27, 28],
    instructions: [
      'Face the camera with your feet together and your whole body in view, head to feet.',
      'Keep your legs straight and your upper body tall. Slowly step or slide your feet apart, as wide as is comfortable.',
      'Hold still for 2 seconds. Skip this step if it feels unsteady.',
    ],
    moveCue: 'Slowly widen your stance, keeping your legs straight.',
    metrics: forEachSide((s) => [{
      key: `${s}_hip_min_wide`, joint: `${s}_hip`, goal: 'min', minTravel: 12,
      guards: [
        { type: 'angle', joint: `${s}_knee`, minAngle: 160, cue: 'Keep your legs straight.' },
        { type: 'upright', maxTilt: 12, cue: 'Stand tall - keep your upper body upright.' },
      ],
    }]),
  },
  {
    id: 'forward_fold',
    title: 'Forward fold',
    view: 'side',
    image: forwardFoldImg,
    require: null, // side steps accept either full side chain (see positioning())
    instructions: [
      'Turn sideways to the camera (either side is fine) and stand tall.',
      'Keep your legs straight. Slowly fold forward from your hips and let your arms hang.',
      'Go only as far as is comfortable, then hold still for 2 seconds.',
    ],
    moveCue: 'Slowly fold forward from your hips.',
    metrics: forEachSide((s) => [{
      key: `${s}_hip_min_straight`, joint: `${s}_hip`, goal: 'min',
      guards: [{ type: 'angle', joint: `${s}_knee`, minAngle: 160, cue: 'Keep your legs straight.' }],
    }]),
  },
  {
    id: 'squat',
    title: 'Deep squat',
    view: 'side',
    image: squatImg,
    require: null,
    instructions: [
      'Stay sideways to the camera with your feet about shoulder-width apart.',
      'Slowly lower into a squat, as deep as is comfortable, keeping your heels down. Hold a chair or wall if you need to.',
      'Hold still for 2 seconds.',
    ],
    moveCue: 'Slowly lower into a squat.',
    metrics: forEachSide((s) => [
      { key: `${s}_knee_min`, joint: `${s}_knee`, goal: 'min' },
      { key: `${s}_hip_min_bent`, joint: `${s}_hip`, goal: 'min' },
    ]),
  },
];

export const ASSESSMENT_STEP_COUNT = STEPS.length;

// ---------------------------------------------------------------- helpers
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const jointAngle = (joint, pose, w, h) => {
  const idx = JOINT_INDICES[joint];
  if (!idx) return null;
  const pts = idx.map((i) => pose[i]);
  if (pts.some((p) => !p || (p.visibility ?? 1) < VIS)) return null;
  return calculateAngle(
    getPixelCoords(pts[0], w, h),
    getPixelCoords(pts[1], w, h),
    getPixelCoords(pts[2], w, h),
  );
};

const allVisible = (pose, ids) => ids.every((i) => pose[i] && (pose[i].visibility ?? 1) >= VIS);

/** ~1 when facing the camera, ~0 when side-on. */
const facingRatio = (pose, w, h) => {
  const [ls, rs, lh, rh] = [pose[11], pose[12], pose[23], pose[24]];
  const shoulderWidth = Math.abs(ls.x - rs.x) * w;
  const torso = Math.hypot(((ls.x + rs.x - lh.x - rh.x) / 2) * w, ((ls.y + rs.y - lh.y - rh.y) / 2) * h);
  return torso > 0 ? shoulderWidth / torso : 0;
};

/** Degrees the trunk (mid-hip -> mid-shoulder) leans away from vertical; null if not visible. */
const trunkTilt = (pose, w, h) => {
  if (!allVisible(pose, [11, 12, 23, 24])) return null;
  const dx = ((pose[11].x + pose[12].x - pose[23].x - pose[24].x) / 2) * w;
  const dy = ((pose[11].y + pose[12].y - pose[23].y - pose[24].y) / 2) * h;
  return (Math.abs(Math.atan2(dx, -dy)) * 180) / Math.PI;
};

/** true = guard satisfied, false = violated, null = can't be evaluated this frame. */
const guardState = (g, pose, w, h) => {
  if (g.type === 'angle') {
    const a = jointAngle(g.joint, pose, w, h);
    return a === null ? null : a >= g.minAngle;
  }
  const t = trunkTilt(pose, w, h);
  return t === null ? null : t <= g.maxTilt;
};

const mirrorKey = (k) =>
  k.startsWith('left_') ? k.replace('left_', 'right_') : k.replace('right_', 'left_');

const prettyJoint = (joint) => {
  const [side, name] = joint.split('_');
  return `${side[0].toUpperCase()}${side.slice(1)} ${name}`;
};

// ---------------------------------------------------------------- per-metric tracker
class MetricTracker {
  constructor(metric) {
    this.metric = metric;
    this.best = null;
    this.current = null;
    this.guardCue = null;
    this.buf = [];
    this.baseline = null;
    this.anchor = 0;
    this.lastImprovedAt = 0;
    this.lastValidAt = -Infinity;
    this.samples = 0;
  }

  push(angle, now) {
    this.samples++;
    this.lastValidAt = now;
    this.buf.push(angle);
    if (this.buf.length > MEDIAN_WINDOW) this.buf.shift();
    if (this.buf.length < MEDIAN_WINDOW) return;

    const s = median(this.buf);
    this.current = s;
    if (this.baseline === null) {
      this.baseline = this.best = this.anchor = s;
      this.lastImprovedAt = now;
      return;
    }
    const sign = this.metric.goal === 'max' ? 1 : -1;
    if (sign * (s - this.best) > 0) this.best = s;
    if (sign * (this.best - this.anchor) >= IMPROVE_DEG) {
      this.anchor = this.best;
      this.lastImprovedAt = now;
    }
  }

  travel() {
    if (this.baseline === null || this.best === null || this.samples < MIN_SAMPLES) return 0;
    return this.metric.goal === 'max' ? this.best - this.baseline : this.baseline - this.best;
  }
  moved() { return this.travel() >= (this.metric.minTravel ?? MIN_TRAVEL); }
  fresh(now) { return now - this.lastValidAt < STALE_MS; }
  settled(now) { return this.moved() && this.fresh(now) && now - this.lastImprovedAt >= SETTLE_MS; }
}

// ---------------------------------------------------------------- the assessment
export class RomAssessment {
  constructor() { this.reset(); }

  reset() {
    this.stepIndex = 0;
    this.phase = 'intro'; // intro | positioning | measuring | result | failed | complete
    this.trackers = [];
    this.readySince = null;
    this.measureStart = 0;
    this.results = {};
    this.assumed = [];
    this.deltas = {};
    this.lastStep = { values: {}, assumed: [] };
  }

  getImage() { return STEPS[Math.min(this.stepIndex, STEPS.length - 1)].image; }

  /** What the on-screen buttons should currently show. */
  getControls() {
    switch (this.phase) {
      case 'intro': return { primary: "I'm ready", skip: true };
      case 'positioning':
      case 'measuring': return { primary: null, skip: true };
      case 'result': return { primary: this.stepIndex === STEPS.length - 1 ? 'Finish' : 'Next step', skip: false };
      case 'failed': return { primary: 'Try again', skip: true };
      default: return { primary: 'Back to menu', skip: false };
    }
  }

  /** Returns 'exit' when the assessment is over and the UI should return to the menu. */
  onPrimary() {
    switch (this.phase) {
      case 'intro':
        this.trackers = STEPS[this.stepIndex].metrics.map((m) => new MetricTracker(m));
        this.readySince = null;
        this.phase = 'positioning';
        break;
      case 'result': this.advance(); break;
      case 'failed': this.phase = 'intro'; break;
      case 'complete': return 'exit';
      default: break;
    }
    return undefined;
  }

  onSkip() {
    if (this.phase !== 'result' && this.phase !== 'complete') this.advance();
  }

  update(pose, w, h, now) {
    switch (this.phase) {
      case 'intro': return this.renderIntro();
      case 'positioning': return this.positioning(pose, w, h, now);
      case 'measuring': return this.measuring(pose, w, h, now);
      case 'result': return this.renderResult();
      case 'failed': return this.renderFailed();
      default: return this.renderComplete();
    }
  }

  // ------------------------------------------------------------ phase logic
  advance() {
    this.stepIndex++;
    this.trackers = [];
    if (this.stepIndex < STEPS.length) { this.phase = 'intro'; return; }

    this.stepIndex = STEPS.length - 1;
    this.phase = 'complete';
    if (Object.keys(this.results).length === 0) return;

    // compare with the previous session (before saving this one) so we can celebrate improvement
    const history = loadHistory();
    const last = history[history.length - 1];
    if (last) {
      for (const [k, v] of Object.entries(this.results)) {
        if (last.values[k] !== undefined) this.deltas[k] = friendlyValue(k, v) - friendlyValue(k, last.values[k]);
      }
    }
    recordSession(this.results, this.assumed);
  }

  positioning(pose, w, h, now) {
    const step = STEPS[this.stepIndex];
    let msg = null;

    if (!pose) {
      msg = 'No person detected. Step back so your whole body is in view.';
    } else {
      const inView = step.view === 'front'
        ? allVisible(pose, step.require)
        : allVisible(pose, [11, 23, 25, 27]) || allVisible(pose, [12, 24, 26, 28]);
      const torsoSeen = allVisible(pose, [11, 23]) || allVisible(pose, [12, 24]);
      const ratio = facingRatio(pose, w, h);
      // Orientation is checked before visibility: side-on, the far side always has low visibility,
      // and "step back" would be misleading advice.
      if (!torsoSeen) msg = 'Step back until your whole body, head to feet, is in view.';
      else if (step.view === 'front' && ratio < FRONT_MIN_RATIO) msg = 'Turn to face the camera.';
      else if (step.view === 'side' && ratio > SIDE_MAX_RATIO) msg = 'Turn sideways to the camera.';
      else if (!inView) msg = 'Step back until your whole body, head to feet, is in view.';
    }

    if (msg) {
      this.readySince = null;
    } else {
      this.readySince ??= now;
      if (now - this.readySince >= POSITION_HOLD_MS) {
        this.phase = 'measuring';
        this.measureStart = now;
        return this.measuring(pose, w, h, now);
      }
    }
    return this.header() +
      `<div class="feedback-text" style="color:#0284c7;font-weight:bold;">${msg ?? 'Good - hold that position...'}</div>`;
  }

  measuring(pose, w, h, now) {
    const step = STEPS[this.stepIndex];

    if (pose) {
      for (const t of this.trackers) {
        t.guardCue = null;
        const angle = jointAngle(t.metric.joint, pose, w, h);
        if (angle === null) continue;
        let blocked = false;
        for (const g of t.metric.guards ?? []) {
          const ok = guardState(g, pose, w, h);
          if (ok === null) { blocked = true; break; }
          if (!ok) { t.guardCue = g.cue; blocked = true; break; }
        }
        if (!blocked) t.push(angle, now);
      }
    }

    // Lock when at least one metric has settled and nothing still visible & moving is still improving.
    const moved = this.trackers.filter((t) => t.moved());
    const settled = moved.filter((t) => t.settled(now));
    const lock = settled.length > 0 && moved.every((t) => t.settled(now) || !t.fresh(now));
    if (lock || now - this.measureStart > TIMEOUT_MS) {
      this.finalizeStep();
      return this.update(pose, w, h, now);
    }

    const failing = this.trackers.find((t) => t.guardCue)?.guardCue;
    const cue = failing ?? (moved.length > 0 ? 'Hold still at your comfortable limit...' : step.moveCue);
    const rows = this.trackers
      .filter((t) => t.current !== null && t.fresh(now))
      .map((t) => `<div class="feedback-text" style="font-size:15px;">${prettyJoint(t.metric.joint)}: ${Math.round(t.current)}°
        <span style="color:#666;">(best ${Math.round(t.best)}°)</span></div>`)
      .join('');
    return this.header() +
      `<div class="feedback-text ${failing ? 'error' : ''}" style="${failing ? '' : 'color:#0284c7;font-weight:bold;'}">${cue}</div>${rows}`;
  }

  finalizeStep() {
    const step = STEPS[this.stepIndex];
    const real = {};
    for (const t of this.trackers) {
      if (t.moved() && t.best !== null) real[t.metric.key] = Math.round(t.best);
    }
    if (Object.keys(real).length === 0) { this.phase = 'failed'; return; }

    const values = { ...real };
    const assumed = [];
    if (step.view === 'side') {
      // Side-on, the far side of the body is estimated poorly: copy the near side across.
      for (const m of step.metrics) {
        const other = real[mirrorKey(m.key)];
        if (real[m.key] === undefined && other !== undefined) { values[m.key] = other; assumed.push(m.key); }
      }
    }
    Object.assign(this.results, values);
    this.assumed.push(...assumed);
    this.lastStep = { values, assumed };
    this.phase = 'result';
  }

  // ------------------------------------------------------------ rendering
  header() {
    const step = STEPS[this.stepIndex];
    return `<h4 style="margin:0 0 10px 0;">Step ${this.stepIndex + 1} of ${STEPS.length}: ${step.title}</h4>`;
  }

  renderIntro() {
    const step = STEPS[this.stepIndex];
    const safety = this.stepIndex === 0
      ? `<div class="feedback-text" style="font-size:14px;color:#666;">Move slowly and stop at a gentle stretch.
         Skip any step that causes pain. This takes about 3 minutes.</div>` : '';
    return this.header() + safety +
      `<ol style="padding-left:20px;margin:8px 0;">${step.instructions.map((i) => `<li class="feedback-text" style="font-size:16px;">${i}</li>`).join('')}</ol>` +
      `<div class="feedback-text" style="font-size:14px;color:#666;">Press <b>I'm ready</b> when you're set.</div>`;
  }

  renderResult() {
    const { values, assumed } = this.lastStep;
    const rows = Object.keys(values).map((k) =>
      `<div class="feedback-text success" style="font-size:16px;">${friendlyLabel(k)}: ${friendlyValue(k, values[k])}°` +
      `${assumed.includes(k) ? ' <span style="color:#666;font-weight:normal;">(copied from your other side)</span>' : ''}</div>`).join('');
    return this.header() + `<div class="feedback-text success">Got it!</div>${rows}`;
  }

  renderFailed() {
    return this.header() +
      `<div class="feedback-text error">We couldn't get a clear reading.</div>
       <div class="feedback-text" style="font-size:15px;">Make sure your whole body is in view with good lighting, then try again - or skip this step.</div>`;
  }

  renderComplete() {
    const keys = Object.keys(this.results);
    if (keys.length === 0) {
      return `<h4 style="margin:0 0 10px 0;">Flexibility check finished</h4>
        <div class="feedback-text">No measurements were captured, so poses will use their standard targets.</div>`;
    }
    const rows = keys.map((k) => {
      const d = this.deltas[k];
      let note = '';
      if (d !== undefined) {
        note = d > 0.5 ? ` <span style="color:green;">&#9650; +${Math.round(d)}° since last time</span>`
          : d < -0.5 ? ` <span style="color:#666;">&#9660; ${Math.round(d)}° (day-to-day changes are normal)</span>`
            : ' <span style="color:#666;">same as last time</span>';
      }
      return `<div class="feedback-text" style="font-size:16px;">${friendlyLabel(k)}: <b>${friendlyValue(k, this.results[k])}°</b>${note}</div>`;
    }).join('');
    return `<h4 style="margin:0 0 10px 0;">Your flexibility profile is saved</h4>${rows}
      <div class="feedback-text" style="font-size:14px;color:#666;margin-top:12px;">
      Pose targets are now tailored to your range, and this check has been added to your progress history.</div>`;
  }
}
