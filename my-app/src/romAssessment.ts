import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { JOINT_INDICES } from './data/asanas';
import { getPixelCoords, calculateAngle } from './geometry';
import { saveProfile, type RomKey, type RomProfile } from './romProfile';
import armsUpImg from './assets/rom/arms_up.svg';
import forwardFoldImg from './assets/rom/forward_fold.svg';
import squatImg from './assets/rom/squat.svg';

// ---------------------------------------------------------------- tuning constants
const VIS = 0.5;               // min landmark visibility to trust a reading
const MEDIAN_WINDOW = 5;       // frames used to smooth jitter
const MIN_SAMPLES = 10;        // readings needed before a metric counts
const MIN_TRAVEL = 25;         // degrees the joint must move for the reading to count as a real attempt
const IMPROVE_DEG = 1.5;       // progress smaller than this counts as "holding still"
const SETTLE_MS = 1500;        // hold still this long to lock the result
const STALE_MS = 1000;         // a metric with no valid reading for this long is "not currently seen"
const POSITION_HOLD_MS = 1000; // must be correctly positioned this long before measuring starts
const TIMEOUT_MS = 30000;      // give up on a step after this long
const FRONT_MIN_RATIO = 0.55;  // shoulder-width / torso-length when facing the camera
const SIDE_MAX_RATIO = 0.4;    // ...and when side-on

// ---------------------------------------------------------------- step definitions
interface Guard { joint: string; minAngle: number; cue: string }
interface Metric { key: RomKey; joint: string; goal: 'min' | 'max'; guard?: Guard }
interface Step {
  id: string;
  title: string;
  view: 'front' | 'side';
  image: string;
  instructions: string[];
  moveCue: string;
  metrics: Metric[];
}

const SIDES = ['left', 'right'] as const;

const STEPS: Step[] = [
  {
    id: 'arms_up',
    title: 'Arms overhead',
    view: 'front',
    image: armsUpImg,
    instructions: [
      'Stand facing the camera so your whole body is in view.',
      'Keep your arms straight. Slowly lift them out to the sides and up overhead.',
      'Stop at a gentle stretch (never pain) and hold still for 2 seconds.',
    ],
    moveCue: 'Slowly raise both arms out to the sides and up.',
    metrics: SIDES.map((s): Metric => ({
      key: `${s}_shoulder_max`,
      joint: `${s}_shoulder`,
      goal: 'max',
      guard: { joint: `${s}_elbow`, minAngle: 155, cue: 'Keep your arms straight.' },
    })),
  },
  {
    id: 'forward_fold',
    title: 'Forward fold',
    view: 'side',
    image: forwardFoldImg,
    instructions: [
      'Turn sideways to the camera (either side is fine) and stand tall.',
      'Keep your legs straight. Slowly fold forward from your hips and let your arms hang.',
      'Go only as far as is comfortable, then hold still for 2 seconds.',
    ],
    moveCue: 'Slowly fold forward from your hips.',
    metrics: SIDES.map((s): Metric => ({
      key: `${s}_hip_min_straight`,
      joint: `${s}_hip`,
      goal: 'min',
      guard: { joint: `${s}_knee`, minAngle: 160, cue: 'Keep your legs straight.' },
    })),
  },
  {
    id: 'squat',
    title: 'Deep squat',
    view: 'side',
    image: squatImg,
    instructions: [
      'Stay sideways to the camera with your feet about shoulder-width apart.',
      'Slowly lower into a squat, as deep as is comfortable, keeping your heels down. Hold a chair or wall if you need to.',
      'Hold still for 2 seconds.',
    ],
    moveCue: 'Slowly lower into a squat.',
    metrics: SIDES.flatMap((s): Metric[] => [
      { key: `${s}_knee_min`, joint: `${s}_knee`, goal: 'min' },
      { key: `${s}_hip_min_bent`, joint: `${s}_hip`, goal: 'min' },
    ]),
  },
];

// ---------------------------------------------------------------- helpers
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const jointAngle = (joint: string, pose: NormalizedLandmark[], w: number, h: number): number | null => {
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

const allVisible = (pose: NormalizedLandmark[], ids: number[]): boolean =>
  ids.every((i) => pose[i] && (pose[i].visibility ?? 1) >= VIS);

/** ~1 when facing the camera, ~0 when side-on. */
const facingRatio = (pose: NormalizedLandmark[], w: number, h: number): number => {
  const [ls, rs, lh, rh] = [pose[11], pose[12], pose[23], pose[24]];
  const shoulderWidth = Math.abs(ls.x - rs.x) * w;
  const torso = Math.hypot(((ls.x + rs.x - lh.x - rh.x) / 2) * w, ((ls.y + rs.y - lh.y - rh.y) / 2) * h);
  return torso > 0 ? shoulderWidth / torso : 0;
};

const mirrorKey = (k: RomKey): RomKey =>
  (k.startsWith('left_') ? k.replace('left_', 'right_') : k.replace('right_', 'left_')) as RomKey;

const prettyJoint = (joint: string): string => {
  const [side, name] = joint.split('_');
  return `${side[0].toUpperCase()}${side.slice(1)} ${name}`;
};

// Friendly numbers for the summary screen (bend/lift amounts, like clinical ROM).
const friendlyLabel = (k: RomKey): string => {
  const side = k.startsWith('left') ? 'Left' : 'Right';
  if (k.endsWith('shoulder_max')) return `${side} arm lift`;
  if (k.endsWith('hip_min_straight')) return `${side} hip bend, legs straight`;
  if (k.endsWith('hip_min_bent')) return `${side} hip bend, knees bent`;
  return `${side} knee bend`;
};
const friendlyValue = (k: RomKey, interior: number): number =>
  k.endsWith('shoulder_max') ? interior : 180 - interior;

// ---------------------------------------------------------------- per-metric tracker
class MetricTracker {
  best: number | null = null;
  current: number | null = null;
  guardFailing = false;
  private buf: number[] = [];
  private baseline: number | null = null;
  private anchor = 0;
  private lastImprovedAt = 0;
  private lastValidAt = -Infinity;
  private samples = 0;

  readonly metric: Metric;

  constructor(metric: Metric) {
    this.metric = metric;
  }

  push(angle: number, now: number): void {
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
    if (sign * (s - (this.best as number)) > 0) this.best = s;
    if (sign * ((this.best as number) - this.anchor) >= IMPROVE_DEG) {
      this.anchor = this.best as number;
      this.lastImprovedAt = now;
    }
  }

  travel(): number {
    if (this.baseline === null || this.best === null || this.samples < MIN_SAMPLES) return 0;
    return this.metric.goal === 'max' ? this.best - this.baseline : this.baseline - this.best;
  }
  moved(): boolean { return this.travel() >= MIN_TRAVEL; }
  fresh(now: number): boolean { return now - this.lastValidAt < STALE_MS; }
  settled(now: number): boolean {
    return this.moved() && this.fresh(now) && now - this.lastImprovedAt >= SETTLE_MS;
  }
}

// ---------------------------------------------------------------- the assessment
type Phase = 'intro' | 'positioning' | 'measuring' | 'result' | 'failed' | 'complete';

export interface Controls { primary: string | null; skip: boolean }

export class RomAssessment {
  private stepIndex = 0;
  private phase: Phase = 'intro';
  private trackers: MetricTracker[] = [];
  private readySince: number | null = null;
  private measureStart = 0;
  private results: Partial<Record<RomKey, number>> = {};
  private assumed: RomKey[] = [];
  private lastStep: { values: Partial<Record<RomKey, number>>; assumed: RomKey[] } = { values: {}, assumed: [] };
  private profile: RomProfile | null = null;

  reset(): void {
    this.stepIndex = 0;
    this.phase = 'intro';
    this.trackers = [];
    this.readySince = null;
    this.results = {};
    this.assumed = [];
    this.profile = null;
  }

  getImage(): string { return STEPS[Math.min(this.stepIndex, STEPS.length - 1)].image; }

  getControls(): Controls {
    switch (this.phase) {
      case 'intro': return { primary: "I'm ready", skip: true };
      case 'positioning':
      case 'measuring': return { primary: null, skip: true };
      case 'result': return { primary: this.stepIndex === STEPS.length - 1 ? 'Finish' : 'Next step', skip: false };
      case 'failed': return { primary: 'Try again', skip: true };
      case 'complete': return { primary: 'Back to menu', skip: false };
    }
  }

  /** Returns 'exit' when the assessment is over and the UI should return to the menu. */
  onPrimary(): 'exit' | void {
    switch (this.phase) {
      case 'intro':
        this.trackers = STEPS[this.stepIndex].metrics.map((m) => new MetricTracker(m));
        this.readySince = null;
        this.phase = 'positioning';
        break;
      case 'result': this.advance(); break;
      case 'failed': this.phase = 'intro'; break;
      case 'complete': return 'exit';
    }
  }

  onSkip(): void {
    if (this.phase !== 'result' && this.phase !== 'complete') this.advance();
  }

  update(pose: NormalizedLandmark[] | null, w: number, h: number, now: number): string {
    switch (this.phase) {
      case 'intro': return this.renderIntro();
      case 'positioning': return this.positioning(pose, w, h, now);
      case 'measuring': return this.measuring(pose, w, h, now);
      case 'result': return this.renderResult();
      case 'failed': return this.renderFailed();
      case 'complete': return this.renderComplete();
    }
  }

  // ------------------------------------------------------------ phase logic
  private advance(): void {
    this.stepIndex++;
    this.trackers = [];
    if (this.stepIndex >= STEPS.length) {
      this.stepIndex = STEPS.length - 1;
      this.phase = 'complete';
      if (Object.keys(this.results).length > 0) {
        this.profile = {
          version: 1,
          measuredAt: new Date().toISOString(),
          values: { ...this.results },
          assumed: [...this.assumed],
        };
        saveProfile(this.profile);
      }
    } else {
      this.phase = 'intro';
    }
  }

  private positioning(pose: NormalizedLandmark[] | null, w: number, h: number, now: number): string {
    const step = STEPS[this.stepIndex];
    let msg: string | null = null;

    if (!pose) {
      msg = 'No person detected. Step back so your whole body is in view.';
    } else {
      const inView = step.view === 'front'
        ? allVisible(pose, [11, 12, 13, 14, 23, 24])
        : allVisible(pose, [11, 23, 25, 27]) || allVisible(pose, [12, 24, 26, 28]);
      const torsoSeen = allVisible(pose, [11, 23]) || allVisible(pose, [12, 24]);
      const ratio = facingRatio(pose, w, h);
      // Check orientation before visibility: when side-on, the far side always has low visibility,
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

  private measuring(pose: NormalizedLandmark[] | null, w: number, h: number, now: number): string {
    const step = STEPS[this.stepIndex];

    if (pose) {
      for (const t of this.trackers) {
        t.guardFailing = false;
        const angle = jointAngle(t.metric.joint, pose, w, h);
        if (angle === null) continue;
        const g = t.metric.guard;
        if (g) {
          const ga = jointAngle(g.joint, pose, w, h);
          if (ga === null) continue;
          if (ga < g.minAngle) { t.guardFailing = true; continue; }
        }
        t.push(angle, now);
      }
    }

    // Lock when at least one metric has settled and nothing that is still visible & moving is still improving.
    const moved = this.trackers.filter((t) => t.moved());
    const settled = moved.filter((t) => t.settled(now));
    const lock = settled.length > 0 && moved.every((t) => t.settled(now) || !t.fresh(now));
    if (lock || now - this.measureStart > TIMEOUT_MS) {
      this.finalizeStep();
      return this.update(pose, w, h, now);
    }

    const failing = this.trackers.find((t) => t.guardFailing)?.metric.guard?.cue;
    const cue = failing ?? (moved.length > 0 ? 'Hold still at your comfortable limit...' : step.moveCue);
    const rows = this.trackers
      .filter((t) => t.current !== null && t.fresh(now))
      .map((t) => `<div class="feedback-text" style="font-size:15px;">${prettyJoint(t.metric.joint)}: ${Math.round(t.current as number)}°
        <span style="color:#666;">(best ${Math.round(t.best as number)}°)</span></div>`)
      .join('');
    return this.header() +
      `<div class="feedback-text ${failing ? 'error' : ''}" style="${failing ? '' : 'color:#0284c7;font-weight:bold;'}">${cue}</div>${rows}`;
  }

  private finalizeStep(): void {
    const step = STEPS[this.stepIndex];
    const real: Partial<Record<RomKey, number>> = {};
    for (const t of this.trackers) {
      if (t.moved() && t.best !== null) real[t.metric.key] = Math.round(t.best);
    }
    if (Object.keys(real).length === 0) { this.phase = 'failed'; return; }

    const values = { ...real };
    const assumed: RomKey[] = [];
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
  private header(): string {
    const step = STEPS[this.stepIndex];
    return `<h4 style="margin:0 0 10px 0;">Step ${this.stepIndex + 1} of ${STEPS.length}: ${step.title}</h4>`;
  }

  private renderIntro(): string {
    const step = STEPS[this.stepIndex];
    const safety = this.stepIndex === 0
      ? `<div class="feedback-text" style="font-size:14px;color:#666;">Move slowly and stop at a gentle stretch.
         Skip any step that causes pain. This takes about 2 minutes.</div>` : '';
    return this.header() + safety +
      `<ol style="padding-left:20px;margin:8px 0;">${step.instructions.map((i) => `<li class="feedback-text" style="font-size:16px;">${i}</li>`).join('')}</ol>` +
      `<div class="feedback-text" style="font-size:14px;color:#666;">Press <b>I'm ready</b> when you're set.</div>`;
  }

  private renderResult(): string {
    const { values, assumed } = this.lastStep;
    const rows = (Object.keys(values) as RomKey[]).map((k) =>
      `<div class="feedback-text success" style="font-size:16px;">${friendlyLabel(k)}: ${friendlyValue(k, values[k] as number)}°` +
      `${assumed.includes(k) ? ' <span style="color:#666;font-weight:normal;">(copied from your other side)</span>' : ''}</div>`).join('');
    return this.header() + `<div class="feedback-text success">Got it!</div>${rows}`;
  }

  private renderFailed(): string {
    return this.header() +
      `<div class="feedback-text error">We couldn't get a clear reading.</div>
       <div class="feedback-text" style="font-size:15px;">Make sure your whole body is in view with good lighting, then try again - or skip this step.</div>`;
  }

  private renderComplete(): string {
    const keys = Object.keys(this.results) as RomKey[];
    if (keys.length === 0) {
      return `<h4 style="margin:0 0 10px 0;">Flexibility check finished</h4>
        <div class="feedback-text">No measurements were captured, so poses will use their standard targets.</div>`;
    }
    const rows = keys.map((k) =>
      `<div class="feedback-text" style="font-size:16px;">${friendlyLabel(k)}: <b>${friendlyValue(k, this.results[k] as number)}°</b></div>`).join('');
    return `<h4 style="margin:0 0 10px 0;">Your flexibility profile is saved</h4>${rows}
      <div class="feedback-text" style="font-size:14px;color:#666;margin-top:12px;">
      Pose targets will now be adjusted so you're never asked to go beyond your comfortable range.</div>`;
  }
}
