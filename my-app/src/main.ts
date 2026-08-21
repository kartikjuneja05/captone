import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { ASANAS, type Asana } from './data/asanas';
import { generateFeedback } from './feedbackGenerator';

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

// --- State ---
let poseLandmarker: PoseLandmarker;
let activeAsana: Asana | null = null;
let isTracking = false;
let lastVideoTime = -1;
let animationFrameId = 0;

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

// --- Detection & Evaluation Loop ---
const drawingUtils = new DrawingUtils(canvasCtx);

const renderLoop = () => {
  if (!isTracking || !activeAsana) return;

  // --- NEW: Safety check for the AI model ---
  if (!poseLandmarker) {
    feedbackLog.innerHTML = `<div class="feedback-text" style="color: #0284c7;">
      Downloading AI Model... Please wait a moment.
    </div>`;
    animationFrameId = window.requestAnimationFrame(renderLoop);
    return;
  }
  // ------------------------------------------

  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (result.landmarks && result.landmarks.length > 0) {
      const pose = result.landmarks[0];
      
      drawingUtils.drawLandmarks(pose, { radius: 3, color: '#FF0000' });
      drawingUtils.drawConnectors(pose, PoseLandmarker.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });

      feedbackLog.innerHTML = generateFeedback(activeAsana.id, pose, canvasElement.width, canvasElement.height);
      
    } else {
      feedbackLog.innerHTML = `<div class="feedback-text">No person detected...</div>`;
    }
    canvasCtx.restore();
  }
  animationFrameId = window.requestAnimationFrame(renderLoop);
};

// --- UI Event Listeners ---
poseLinks.forEach(link => {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const poseId = (e.target as HTMLElement).getAttribute('data-pose');
    if (!poseId || !ASANAS[poseId]) return;

    activeAsana = ASANAS[poseId];
    activePoseTitle.innerText = activeAsana.name;
    
    // Update the reference image
    referenceImage.src = activeAsana.imageSrc;
    
    // Switch UI
    homeView.style.display = 'none';
    trackerView.style.display = 'block';
    
    // Clear old feedback
    feedbackLog.innerHTML = `<div class="feedback-text">Starting camera...</div>`;
    
    await startCamera();
    isTracking = true;
    renderLoop();
  });
});

backBtn.addEventListener('click', () => {
  isTracking = false;
  cancelAnimationFrame(animationFrameId);
  stopCamera();
  
  // Switch UI
  trackerView.style.display = 'none';
  homeView.style.display = 'block';
});

// Start MediaPipe download immediately on page load
initializeMediaPipe();