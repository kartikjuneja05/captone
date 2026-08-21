// reference images
import mountainImg from '../assets/references/mountain.jpg';
import treeImg from '../assets/references/tree.jpg';
import warrior2Img from '../assets/references/warrior2.jpg';
import triangleImg from '../assets/references/triangle.jpg';
import cobraImg from '../assets/references/cobra.jpg';

export interface JointTarget {
    target: number;
    tolerance: number;
    weight: number;
}

export interface Asana {
    id: string;
    name: string;
    imageSrc: string;
    targets: Record<string, JointTarget>;
}

export const JOINT_INDICES: Record<string, [number, number, number]> = {
    "left_knee": [23, 25, 27],
    "right_knee": [24, 26, 28],
    "left_hip": [11, 23, 25],
    "right_hip": [12, 24, 26],
    "left_shoulder": [13, 11, 23],
    "right_shoulder": [14, 12, 24],
    "left_elbow" : [11, 13, 15],
    "right_elbow" : [12, 14, 16]
};

export const ASANAS: Record<string, Asana> = {
    tadasana: {
        id: "tadasana",
        name: "Mountain Pose (Tadasana)",
        imageSrc: mountainImg,
        targets: {
            left_knee: { target: 175, tolerance: 5, weight: 0.6 },
            right_knee: { target: 175, tolerance: 5, weight: 0.6 },
            left_hip: { target: 175, tolerance: 5, weight: 0.7 },
            right_hip: { target: 175, tolerance: 5, weight: 0.7 },
            left_shoulder: { target: 170, tolerance: 10, weight: 0.5 },
            right_shoulder: { target: 170, tolerance: 10, weight: 0.5 },
            left_elbow : {target: 150, tolerance: 5, weight:0.7},
            right_elbow : {target: 150, tolerance: 5, weight:0.7}
        }
    },
    vrksasana: {
        id: "vrksasana",
        name: "Tree Pose (Vrksasana)",
        imageSrc: treeImg,
        targets: {
            left_knee: { target: 175, tolerance: 5, weight: 1.0 },
            right_knee: { target: 45, tolerance: 30, weight: 0.8 },
            left_hip: { target: 175, tolerance: 5, weight: 0.7 },
            right_hip: { target: 60, tolerance: 25, weight: 0.6 },
            left_shoulder: { target: 50, tolerance: 20, weight: 0.4 },
            right_shoulder: { target: 50, tolerance: 20, weight: 0.4 },
        }
    },
    virabhadrasana_ii: {
        id: "virabhadrasana_ii",
        name: "Warrior II (Virabhadrasana II)",
        imageSrc: warrior2Img,
        targets: {
            left_knee: { target: 105, tolerance: 15, weight: 1.0 },
            right_knee: { target: 170, tolerance: 10, weight: 0.6 },
            left_hip: { target: 100, tolerance: 20, weight: 0.7 },
            right_hip: { target: 160, tolerance: 20, weight: 0.5 },
            left_shoulder: { target: 90, tolerance: 15, weight: 0.8 },
            right_shoulder: { target: 90, tolerance: 15, weight: 0.8 },
            left_elbow : {target: 170, tolerance: 10, weight: 0.5},
            right_elbow : {target: 170, tolerance: 10, weight: 0.5}
        }
    },
    trikonasana: {
        id: "trikonasana",
        name: "Triangle Pose (Trikonasana)",
        imageSrc: triangleImg,
        targets: {
            left_knee: { target: 165, tolerance: 15, weight: 0.6 },
            right_knee: { target: 170, tolerance: 10, weight: 0.5 },
            left_hip: { target: 90, tolerance: 20, weight: 1.0 },
            right_hip: { target: 90, tolerance: 20, weight: 0.6 },
            left_shoulder: { target: 90, tolerance: 20, weight: 0.5 },
            right_shoulder: { target: 170, tolerance: 10, weight: 0.8 },
        }
    },
    bhujangasana: {
        id: "bhujangasana",
        name: "Cobra Pose (Bhujangasana)",
        imageSrc: cobraImg,
        targets: {
            left_hip: { target: 175, tolerance: 5, weight: 0.8 },
            right_hip: { target: 175, tolerance: 5, weight: 0.8 },
            left_knee: { target: 175, tolerance: 5, weight: 0.5 },
            right_knee: { target: 175, tolerance: 5, weight: 0.5 },
            left_shoulder: { target: 60, tolerance: 20, weight: 0.9 },
            right_shoulder: { target: 60, tolerance: 20, weight: 0.9 },
        }
    }
};