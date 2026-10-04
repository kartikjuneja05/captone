/**
 * ROM profile, session history and per-pose personalization.
 *
 * Stored values use the SAME convention as the pose angles: the interior angle (degrees) between the
 * three landmarks in JOINT_INDICES (180 = straight/open, smaller = more bent).
 *   shoulder_max : largest hip-shoulder-elbow angle reached (arm lifted overhead = ~180)
 *   *_min        : smallest angle reached (deeper bend / wider opening = smaller number)
 *
 * For display and charts we convert to friendly "how far can you go" degrees (see friendlyValue),
 * where a BIGGER number always means MORE range.
 */

export const SIDES = ['left', 'right'];

/** One entry per measured movement. `suffix` is appended to the side to form the storage key. */
export const ROM_GROUPS = [
  { id: 'shoulder',     label: 'Shoulder lift',            suffix: 'shoulder_max',     kind: 'max' },
  { id: 'elbow',        label: 'Elbow bend',               suffix: 'elbow_min',        kind: 'min' },
  { id: 'knee',         label: 'Knee bend',                suffix: 'knee_min',         kind: 'min' },
  { id: 'hip_straight', label: 'Hip bend (legs straight)', suffix: 'hip_min_straight', kind: 'min' },
  { id: 'hip_bent',     label: 'Hip bend (knees bent)',    suffix: 'hip_min_bent',     kind: 'min' },
  { id: 'hip_wide',     label: 'Hip opening (legs apart)', suffix: 'hip_min_wide',     kind: 'min' },
];

export const romKey = (side, group) => `${side}_${group.suffix}`;
export const groupForKey = (key) => ROM_GROUPS.find((g) => key.endsWith(g.suffix));

/** Interior angle -> friendly range of motion in degrees (bigger = more flexible). */
export const friendlyValue = (key, interior) =>
  groupForKey(key)?.kind === 'max' ? interior : 180 - interior;

export const friendlyLabel = (key) => {
  const side = key.startsWith('left') ? 'Left' : 'Right';
  return `${side} ${groupForKey(key).label.toLowerCase()}`;
};

// ---------------------------------------------------------------- storage
const PROFILE_KEY = 'yoga_rom_profile_v1';
const HISTORY_KEY = 'yoga_rom_history_v1';
const MAX_HISTORY = 60;

const readJSON = (k) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeJSON = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode etc.) - app still works with default targets */
  }
};

/** The current profile: the latest measurement of every joint the user has ever completed. */
export const loadProfile = () => {
  const p = readJSON(PROFILE_KEY);
  return p && p.version === 1 && p.values ? p : null;
};
export const clearProfile = () => {
  try { localStorage.removeItem(PROFILE_KEY); } catch { /* ignore */ }
};

/** Every completed assessment, oldest first: [{ measuredAt, values, assumed }]. */
export const loadHistory = () => {
  const h = readJSON(HISTORY_KEY);
  return Array.isArray(h) ? h : [];
};
export const clearHistory = () => {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
};

/**
 * Save the result of one assessment run: appends it to the history (for the progress charts) and
 * merges it into the profile (a joint the user skipped this time keeps its previous measurement).
 */
export const recordSession = (values, assumed) => {
  const measuredAt = new Date().toISOString();
  const prev = loadProfile();
  const profile = {
    version: 1,
    measuredAt,
    values: { ...(prev?.values ?? {}), ...values },
    assumed: [...(prev?.assumed ?? []).filter((k) => !(k in values)), ...assumed],
  };
  writeJSON(PROFILE_KEY, profile);
  writeJSON(HISTORY_KEY, [...loadHistory(), { measuredAt, values, assumed }].slice(-MAX_HISTORY));
  return profile;
};

// ---------------------------------------------------------------- personalization
// A pose target is never placed right at the user's limit: stay this many degrees inside it.
const COMFORT_BUFFER = 8;

/** Which measured limit (if any) applies to this joint in this asana. */
const limitFor = (jointName, asana, profile) => {
  const [side, joint] = jointName.split('_');
  const v = profile.values;
  let key;
  let kind = 'min';
  switch (joint) {
    case 'shoulder': key = `${side}_shoulder_max`; kind = 'max'; break;
    case 'elbow': key = `${side}_elbow_min`; break;
    case 'knee': key = `${side}_knee_min`; break;
    case 'hip': {
      if (asana.plane === 'front') {
        key = `${side}_hip_min_wide`; // legs-apart opening
      } else {
        // A bent-knee hip fold is easier than a straight-leg one (hamstrings), so match the pose's knee.
        const kneeIdeal = asana.targets[`${side}_knee`]?.ideal ?? 180;
        key = `${side}_hip_min_${kneeIdeal < 150 ? 'bent' : 'straight'}`;
      }
      break;
    }
    default: return null;
  }
  return v[key] === undefined ? null : { kind, value: v[key] };
};

const adjustTarget = (t, limit) => {
  if (limit.kind === 'min' && t.ideal < limit.value) {
    return { ...t, target: Math.min(180, limit.value + COMFORT_BUFFER), adjusted: true };
  }
  if (limit.kind === 'max' && t.ideal > limit.value) {
    return { ...t, target: Math.max(0, limit.value - COMFORT_BUFFER), adjusted: true };
  }
  return { ...t, target: t.ideal, adjusted: false }; // the user can already reach the ideal
};

/**
 * Returns a copy of the asana in which every joint has a personal `target`:
 *   - the ideal angle, if the user's measured ROM can reach it
 *   - otherwise a point just inside their measured limit
 * With no profile, target === ideal everywhere.
 */
export const personalizeAsana = (asana, profile) => {
  const targets = {};
  for (const [name, t] of Object.entries(asana.targets)) {
    const limit = profile ? limitFor(name, asana, profile) : null;
    targets[name] = limit ? adjustTarget(t, limit) : { ...t, target: t.ideal, adjusted: false };
  }
  return { ...asana, targets };
};

/**
 * The band of angles that counts as correct form: everything from the personal target to the ideal,
 * widened by the tolerance on both ends. (When target === ideal this is the usual ideal +/- tolerance.)
 */
export const acceptableRange = (t) => {
  const lo = Math.min(t.ideal, t.target) - t.tolerance;
  const hi = Math.max(t.ideal, t.target) + t.tolerance;
  return [Math.max(0, lo), Math.min(180, hi)];
};
