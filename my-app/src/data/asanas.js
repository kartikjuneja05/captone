/**
 * Pose definitions.
 *
 * Joint angles are interior angles in degrees between the three landmarks in JOINT_INDICES
 * (180 = fully straight / open, smaller = more bent / closed).
 *
 * For every joint:
 *   ideal      the angle of textbook-correct form (authored here)
 *   tolerance  how many degrees either side still count as correct
 *   weight     how important this joint is when choosing what to correct first
 * personalizeAsana() (romProfile.js) adds a `target`: the angle that is realistic for THIS user.
 * Anything between `target` and `ideal` (plus tolerance) is treated as correct form.
 *
 * plane: 'front' = judged facing the camera, 'side' = judged side-on (affects hip wording & ROM limit).
 */
// reference images
import mountainImg from '../assets/references/mountain.jpg';
import treeImg from '../assets/references/tree.jpg';
import warrior2Img from '../assets/references/warrior2.jpg';
import triangleImg from '../assets/references/triangle.jpg';
import cobraImg from '../assets/references/cobra.jpg';

export const JOINT_INDICES = {
    "left_knee": [23, 25, 27],
    "right_knee": [24, 26, 28],
    "left_hip": [11, 23, 25],
    "right_hip": [12, 24, 26],
    "left_shoulder": [13, 11, 23],
    "right_shoulder": [14, 12, 24],
    "left_elbow" : [11, 13, 15],
    "right_elbow" : [12, 14, 16]
};

export const ASANAS = {
    tadasana: {
        id: "tadasana",
        plane: "front",
        name: "Mountain Pose (Tadasana)",
        imageSrc: mountainImg,
        targets: {
            left_knee: { ideal: 175, tolerance: 5, weight: 0.6 },
            right_knee: { ideal: 175, tolerance: 5, weight: 0.6 },
            left_hip: { ideal: 175, tolerance: 5, weight: 0.7 },
            right_hip: { ideal: 175, tolerance: 5, weight: 0.7 },
            left_shoulder: { ideal: 170, tolerance: 10, weight: 0.5 },
            right_shoulder: { ideal: 170, tolerance: 10, weight: 0.5 },
            left_elbow : { ideal: 150, tolerance: 5, weight:0.7},
            right_elbow : { ideal: 150, tolerance: 5, weight:0.7}
        }
    },
    vrksasana: {
        id: "vrksasana",
        plane: "front",
        name: "Tree Pose (Vrksasana)",
        imageSrc: treeImg,
        targets: {
            left_knee: { ideal: 175, tolerance: 5, weight: 1.0 },
            right_knee: { ideal: 45, tolerance: 30, weight: 0.8 },
            left_hip: { ideal: 175, tolerance: 5, weight: 0.7 },
            right_hip: { ideal: 60, tolerance: 25, weight: 0.6 },
            left_shoulder: { ideal: 50, tolerance: 20, weight: 0.4 },
            right_shoulder: { ideal: 50, tolerance: 20, weight: 0.4 },
        }
    },
    virabhadrasana_ii: {
        id: "virabhadrasana_ii",
        plane: "front",
        name: "Warrior II (Virabhadrasana II)",
        imageSrc: warrior2Img,
        targets: {
            left_knee: { ideal: 105, tolerance: 15, weight: 1.0 },
            right_knee: { ideal: 170, tolerance: 10, weight: 0.6 },
            left_hip: { ideal: 100, tolerance: 20, weight: 0.7 },
            right_hip: { ideal: 160, tolerance: 20, weight: 0.5 },
            left_shoulder: { ideal: 90, tolerance: 15, weight: 0.8 },
            right_shoulder: { ideal: 90, tolerance: 15, weight: 0.8 },
            left_elbow : { ideal: 170, tolerance: 10, weight: 0.5},
            right_elbow : { ideal: 170, tolerance: 10, weight: 0.5}
        }
    },
    trikonasana: {
        id: "trikonasana",
        plane: "front",
        name: "Triangle Pose (Trikonasana)",
        imageSrc: triangleImg,
        targets: {
            left_knee: { ideal: 165, tolerance: 15, weight: 0.6 },
            right_knee: { ideal: 170, tolerance: 10, weight: 0.5 },
            left_hip: { ideal: 90, tolerance: 20, weight: 1.0 },
            right_hip: { ideal: 90, tolerance: 20, weight: 0.6 },
            left_shoulder: { ideal: 90, tolerance: 20, weight: 0.5 },
            right_shoulder: { ideal: 170, tolerance: 10, weight: 0.8 },
        }
    },
    bhujangasana: {
        id: "bhujangasana",
        plane: "side",
        name: "Cobra Pose (Bhujangasana)",
        imageSrc: cobraImg,
        targets: {
            left_hip: { ideal: 175, tolerance: 5, weight: 0.8 },
            right_hip: { ideal: 175, tolerance: 5, weight: 0.8 },
            left_knee: { ideal: 175, tolerance: 5, weight: 0.5 },
            right_knee: { ideal: 175, tolerance: 5, weight: 0.5 },
            left_shoulder: { ideal: 60, tolerance: 20, weight: 0.9 },
            right_shoulder: { ideal: 60, tolerance: 20, weight: 0.9 },
        }
    }
};