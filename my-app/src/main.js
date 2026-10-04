import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { ASANAS } from './data/asanas';
import { generateFeedback, resetFeedbackState } from './feedbackGenerator';
import { RomAssessment } from './romAssessment';
import { loadProfile, clearProfile, loadHistory, personalizeAsana } from './romProfile';
import { initProgressView } from './progress';

// --- DOM Elements ---
const $ = (id) => document.getElementById(id);
const homeView = $('home-view');
const trackerView = $('tracker-view');
const progressView = $('progress-view');
const backBtn = $('back-btn');
const poseLinks = document.querySelectorAll('.pose-link');
const activePoseTitle = $('active-pose-name');
const feedbackLog = $('feedback-log');
const video = $('webcam');
const canvasElement = $('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const referenceImage = $('reference-image');
const referenceTitle = $('reference-title');
const assessBtn = $('assess-btn');
const clearProfileBtn = $('clear-profile-btn');
const progressBtn = $('progress-btn');
const profileStatus = $('profile-status');
const assessControls = $('assess-controls');
const assessPrimary = $('assess-primary');
const assessSkip = $('assess-skip');
const showAnglesBox = $('show-angles');

// --- State ---
let mode = 'pose'; // 'pose' | 'assessment'
let poseLandmarker = null;
let modelError = false;
let activeAsana = null;
const assessment = new RomAssessment();
let isTracking = false;
let lastVideoTime = -1;
let animationFrameId = 0;

// --- Views ---
const showView = (view) => {
  homeView.style.display = view === 'home' ? 'block' : 'none';
  trackerView.style.display = view === 'tracker' ? 'block' : 'none';
  progressView.style.display = view === 'progress' ? 'block' : 'none';
};

const refreshProfileStatus = () => {
  const profile = loadProfile();
  const checks = loadHistory().length;
  if (profile) {
    const date = new Date(profile.measuredAt).toLocaleDateString();
    profileStatus.textContent = `Profile active (last checked ${date}, ${checks} check${checks === 1 ? '' : 's'} so far). Pose targets are tailored to your range.`;
    assessBtn.textContent = 'Redo flexibility check';
    clearProfileBtn.style.display = 'inline-block';
  } else {
    profileStatus.textContent = 'Not set up yet. Poses use the standard (ideal) targets.';
    assessBtn.textContent = 'Start flexibility check (about 3 min)';
    clearProfileBtn.style.display = 'none';
  }
};

const progress = initProgressView({ onBack: () => showView('home') });

// --- MediaPipe Engine ---
const initializeMediaPipe = async () => {
  try {
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
  } catch (err) {
    console.error('Failed to load the pose model', err);
    modelError = true;
  }
};

const startCamera = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadeddata = () => resolve(true);
  });
};

const stopCamera = () => {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((track) => track.stop());
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
    feedbackLog.innerHTML = modelError
      ? `<div class="feedback-text error">Couldn't load the AI model. Check your internet connection and reload the page.</div>`
      : `<div class="feedback-text" style="color: #0284c7;">Downloading AI Model... Please wait a moment.</div>`;
    if (!modelError) animationFrameId = window.requestAnimationFrame(renderLoop);
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
      feedbackLog.innerHTML = generateFeedback(
        activeAsana, pose, canvasElement.width, canvasElement.height,
        { showAngles: showAnglesBox.checked },
      );
    } else {
      feedbackLog.innerHTML = `<div class="fb-headline fb-neutral">I can't see you yet. Step into the frame so your whole body is visible.</div>`;
    }
    canvasCtx.restore();
  }
  animationFrameId = window.requestAnimationFrame(renderLoop);
};

// --- Opening / closing the live camera view ---
const openTracker = async (nextMode) => {
  mode = nextMode;
  showView('tracker');
  feedbackLog.innerHTML = `<div class="feedback-text">Starting camera...</div>`;
  assessControls.style.display = nextMode === 'assessment' ? 'block' : 'none';
  $('angle-toggle').style.display = nextMode === 'pose' ? 'block' : 'none';
  referenceTitle.textContent = nextMode === 'assessment' ? 'How to do this step' : 'Reference Pose';

  try {
    await startCamera();
  } catch (err) {
    console.error(err);
    feedbackLog.innerHTML = `<div class="feedback-text error">Couldn't start the camera. Please allow camera access and try again.</div>`;
    return;
  }
  isTracking = true;
  lastVideoTime = -1;
  renderLoop();
};

const closeTracker = () => {
  isTracking = false;
  cancelAnimationFrame(animationFrameId);
  stopCamera();
  showView('home');
  refreshProfileStatus();
};

// --- UI Event Listeners ---
poseLinks.forEach((link) => {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const poseId = e.target.getAttribute('data-pose');
    if (!poseId || !ASANAS[poseId]) return;

    // Each joint gets an ideal angle plus a personal target based on the user's measured ROM
    activeAsana = personalizeAsana(ASANAS[poseId], loadProfile());
    resetFeedbackState();
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

progressBtn.addEventListener('click', () => {
  progress.open();
  showView('progress');
});

backBtn.addEventListener('click', closeTracker);

// Start MediaPipe download immediately on page load
refreshProfileStatus();
initializeMediaPipe();
