import type { Asana, JointTarget } from './data/asanas';

/**
 * All values are stored in the SAME convention your pose targets use:
 * the interior angle (in degrees) between the three landmarks in JOINT_INDICES.
 *   - shoulder (hip-shoulder-elbow): 0 = arm by the side, 180 = arm overhead  -> we store the MAX reached
 *   - hip      (shoulder-hip-knee):  180 = standing tall, smaller = folded    -> we store the MIN reached
 *   - knee     (hip-knee-ankle):     180 = straight,      smaller = bent      -> we store the MIN reached
 */
export type Side = 'left' | 'right';

export type RomKey =
  | 'left_shoulder_max' | 'right_shoulder_max'
  | 'left_hip_min_straight' | 'right_hip_min_straight'
  | 'left_hip_min_bent' | 'right_hip_min_bent'
  | 'left_knee_min' | 'right_knee_min';

export interface RomProfile {
  version: 1;
  measuredAt: string;
  values: Partial<Record<RomKey, number>>;
  /** Keys that were copied from the opposite side (far side not visible in a side-on view). */
  assumed: RomKey[];
}

const STORAGE_KEY = 'yoga_rom_profile_v1';

// A pose is never asked to sit right at the user's limit: stay this many degrees inside it...
const COMFORT_BUFFER = 8;
// ...but don't flag the user as "wrong" for going this far past what we measured (sensor noise).
const NOISE_SLACK = 5;

export const loadProfile = (): RomProfile | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RomProfile;
    return parsed?.version === 1 && parsed.values ? parsed : null;
  } catch {
    return null;
  }
};

export const saveProfile = (profile: RomProfile): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable (private mode etc.) - app still works with defaults */
  }
};

export const clearProfile = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const key = (side: string, suffix: string): RomKey => `${side}_${suffix}` as RomKey;

interface Limit {
  kind: 'min' | 'max'; // 'min': joint can't fold below this angle. 'max': joint can't open beyond this angle.
  value: number;
}

/** Which measured limit (if any) applies to this joint in this asana. */
const limitFor = (jointName: string, asana: Asana, profile: RomProfile): Limit | null => {
  const [side, joint] = jointName.split('_');
  if (!side || !joint) return null;
  const v = profile.values;

  switch (joint) {
    case 'shoulder': {
      const value = v[key(side, 'shoulder_max')];
      return value === undefined ? null : { kind: 'max', value };
    }
    case 'knee': {
      const value = v[key(side, 'knee_min')];
      return value === undefined ? null : { kind: 'min', value };
    }
    case 'hip': {
      // A bent-knee hip fold (squat-like) is easier than a straight-leg one (hamstring-limited),
      // so choose the limit that matches what this pose asks of the same-side knee.
      const kneeTarget = asana.targets[`${side}_knee`]?.target ?? 180;
      const value = v[key(side, kneeTarget < 150 ? 'hip_min_bent' : 'hip_min_straight')];
      return value === undefined ? null : { kind: 'min', value };
    }
    default:
      return null; // elbow etc. are not assessed -> keep the authored target
  }
};

const adjustTarget = (t: JointTarget, limit: Limit): JointTarget => {
  if (limit.kind === 'min' && t.target < limit.value) {
    const target = Math.min(180, limit.value + COMFORT_BUFFER);
    return {
      ...t,
      target,
      minBound: Math.max(0, limit.value - NOISE_SLACK),
      maxBound: Math.min(180, target + t.tolerance),
      adjusted: true,
    };
  }
  if (limit.kind === 'max' && t.target > limit.value) {
    const target = Math.max(0, limit.value - COMFORT_BUFFER);
    return {
      ...t,
      target,
      minBound: Math.max(0, target - t.tolerance),
      maxBound: Math.min(180, limit.value + NOISE_SLACK),
      adjusted: true,
    };
  }
  return t; // the pose already fits within this person's range
};

/**
 * Returns a copy of the asana whose targets are capped to the user's measured range.
 * Targets the user can already reach are left exactly as authored.
 */
export const personalizeAsana = (asana: Asana, profile: RomProfile | null): Asana => {
  if (!profile) return asana;
  const targets: Record<string, JointTarget> = {};
  for (const [name, t] of Object.entries(asana.targets)) {
    const limit = limitFor(name, asana, profile);
    targets[name] = limit ? adjustTarget(t, limit) : t;
  }
  return { ...asana, targets };
};
