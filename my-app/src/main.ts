import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { ASANAS, type Asana } from './data/asanas';
import { generateFeedback } from './feedbackGenerator';
import { RomAssessment } from './romAssessment';
import { loadProfile, clearProfile, personalizeAsana } from './romProfile';

// --- DOM Elements ---
const homeView = document.getElementById('home-view')!;
const trackerView = document.getElementById('tracker-view')!;
const backBtn = document.getElementById('back-btn')!;
const poseLinks = document.querySelectorAll('.pose-link');
const activePoseTitle = document.getElementById('active-pose-name')!;
const feedbackLog = document.getElementById('feedback-log')!;
const video = document.getElementById('webcam') as HTMLVideoElement;
const canvasElement = document.getElementById('output_canvas') as HTMLCanvasElement;
const canvasCtx = canvasElement.getContext('2d')!;
const referenceImage = document.getElementById('reference-image') as HTMLImageElement;
const referenceTitle = document.getElementById('reference-title')!;
const assessBtn = document.getElementById('assess-btn')!;
const clearProfileBtn = document.getElementById('clear-profile-btn')!;
const profileStatus = document.getElementById('profile-status')!;
const assessControls = document.getElementById('assess-controls')!;
const assessPrimary = document.getElementById('assess-primary')!;
const assessSkip = document.getElementById('assess-skip')!;

// --- State ---
type Mode = 'pose' | 'assessment';
let mode: Mode = 'pose';
let poseLandmarker: PoseLandmarker;
let activeAsana: Asana | null = null;
const assessment = new RomAssessment();
let isTracking = false;
let lastVideoTime = -1;
let animationFrameId = 0;

// --- Profile status on the home screen ---
const refreshProfileStatus = () => {
  const profile = loadProfile();
  if (profile) {
    const date = new Date(profile.measuredAt).toLocaleDateString();
    profileStatus.textContent = `Profile active (measured ${date}). Pose targets are adjusted to your range.`;
    assessBtn.textContent = 'Redo flexibility check';
    clearProfileBtn.style.display = 'inline-block';
  } else {
    profileStatus.textContent = 'Not set up yet. Poses use standard targets.';
    assessBtn.textContent = 'Start 2-minute flexibility check';
    clearProfileBtn.style.display = 'none';
  }
};

// --- MediaPipe Engine ---
const initializeMediaPipe = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1
  });
};

const startCamera = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadeddata = () => resolve(true);
  });
};

const stopCamera = () => {
  const stream = video.srcObject as MediaStream;
  if (stream) stream.getTracks().forEach(track => track.stop());
  video.srcObject = null;
};

// --- Assessment UI helpers ---
const syncAssessmentControls = () => {
  const c = assessment.getControls();
  assessPrimary.style.display = c.primary ? 'inline-block' : 'none';
  if (c.primary && assessPrimary.textContent !== c.primary) assessPrimary.textContent = c.primary;
  assessSkip.style.display = c.skip ? 'inline-block' : 'none';
  const img = assessment.getImage();
  if (referenceImage.getAttribute('src') !== img) referenceImage.src = img;
};

// --- Detection & Evaluation Loop ---
const drawingUtils = new DrawingUtils(canvasCtx);

const renderLoop = () => {
  if (!isTracking) return;
  if (mode === 'pose' && !activeAsana) return;

  // --- Safety check for the AI model ---
  if (!poseLandmarker) {
    feedbackLog.innerHTML = `<div class="feedback-text" style="color: #0284c7;">
      Downloading AI Model... Please wait a moment.
    </div>`;
    animationFrameId = window.requestAnimationFrame(renderLoop);
    return;
  }

  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    const pose = result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (pose) {
      drawingUtils.drawLandmarks(pose, { radius: 3, color: '#FF0000' });
      drawingUtils.drawConnectors(pose, PoseLandmarker.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    }

    if (mode === 'assessment') {
      feedbackLog.innerHTML = assessment.update(pose, canvasElement.width, canvasElement.height, performance.now());
      syncAssessmentControls();
    } else if (pose && activeAsana) {
      feedbackLog.innerHTML = generateFeedback(activeAsana, pose, canvasElement.width, canvasElement.height);
    } else {
      feedbackLog.innerHTML = `<div class="feedback-text">No person detected...</div>`;
    }
    canvasCtx.restore();
  }
  animationFrameId = window.requestAnimationFrame(renderLoop);
};

// --- View switching ---
const openTracker = async (nextMode: Mode) => {
  mode = nextMode;
  homeView.style.display = 'none';
  trackerView.style.display = 'block';
  feedbackLog.innerHTML = `<div class="feedback-text">Starting camera...</div>`;
  assessControls.style.display = nextMode === 'assessment' ? 'block' : 'none';
  referenceTitle.textContent = nextMode === 'assessment' ? 'How to do this step' : 'Reference Pose';

  await startCamera();
  isTracking = true;
  lastVideoTime = -1;
  renderLoop();
};

const closeTracker = () => {
  isTracking = false;
  cancelAnimationFrame(animationFrameId);
  stopCamera();
  trackerView.style.display = 'none';
  homeView.style.display = 'block';
  refreshProfileStatus();
};

// --- UI Event Listeners ---
poseLinks.forEach(link => {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const poseId = (e.target as HTMLElement).getAttribute('data-pose');
    if (!poseId || !ASANAS[poseId]) return;

    // Cap this asana's targets to the user's measured ROM (no-op if no profile yet)
    activeAsana = personalizeAsana(ASANAS[poseId], loadProfile());
    activePoseTitle.innerText = activeAsana.name;
    referenceImage.src = activeAsana.imageSrc;

    await openTracker('pose');
  });
});

assessBtn.addEventListener('click', async () => {
  assessment.reset();
  activeAsana = null;
  activePoseTitle.innerText = 'Flexibility check';
  referenceImage.src = assessment.getImage();
  await openTracker('assessment');
});

assessPrimary.addEventListener('click', () => {
  if (assessment.onPrimary() === 'exit') closeTracker();
});
assessSkip.addEventListener('click', () => assessment.onSkip());

clearProfileBtn.addEventListener('click', () => {
  clearProfile();
  refreshProfileStatus();
});

backBtn.addEventListener('click', closeTracker);

// Start MediaPipe download immediately on page load
refreshProfileStatus();
initializeMediaPipe();
