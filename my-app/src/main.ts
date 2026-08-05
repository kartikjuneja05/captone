import './style.css';
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from '@mediapipe/tasks-vision';

// 1. Grab DOM Elements
const video = document.getElementById('webcam') as HTMLVideoElement;
const canvasElement = document.getElementById('output_canvas') as HTMLCanvasElement;
const canvasCtx = canvasElement.getContext('2d') as CanvasRenderingContext2D;

let poseLandmarker: PoseLandmarker;
let lastVideoTime = -1;

// 2. Initialize MediaPipe
const initializeMediaPipe = async () => {
  // Load WASM files directly from CDN to bypass Vite bundler config requirements
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

  startWebcam();
};

// 3. Request Webcam Access
const startWebcam = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error("Browser API navigator.mediaDevices.getUserMedia not available");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  
  // Wait until the video starts playing before running detections
  video.addEventListener('loadeddata', predictWebcam);
};

// 4. Detection and Rendering Loop
const drawingUtils = new DrawingUtils(canvasCtx);

const predictWebcam = () => {
  // Sync canvas dimensions to the incoming video resolution
  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;

  // Only run prediction when a new video frame is available
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    
    const startTimeMs = performance.now();
    const result = poseLandmarker.detectForVideo(video, startTimeMs);

    // Clear previous frame drawing
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Draw the skeleton if a pose is detected
    if (result.landmarks) {
      for (const landmark of result.landmarks) {
        drawingUtils.drawLandmarks(landmark, {
          radius: 3,
          color: '#FF0000'
        });
        drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, {
          color: '#00FF00',
          lineWidth: 2
        });
      }
    }
    canvasCtx.restore();
  }

  // Continuously request the next animation frame to create a loop
  window.requestAnimationFrame(predictWebcam);
};

// Kick off the initialization process
initializeMediaPipe();