import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

// Particle shapes and gesture logic are based on the user's supplied script.js.
// The IDs are adapted to the existing minimal Orb Gesture Visualizer UI.
const canvas = document.querySelector('#scene');
const trailCanvas = document.querySelector('#trail');
const trailCtx = trailCanvas.getContext('2d');
const video = document.querySelector('#camera');
const startBtn = document.querySelector('#start');
const welcome = document.querySelector('#welcome');
const errorEl = document.querySelector('#error');

let landmarker = null, stream = null, lastVideoTime = -1;
let activeMode = 'free', particleCount = 1500, lastGesture = '', gestureSince = 0, lastModeChange = 0;
let handSeen = false, fingerPoint = null, noHandSince = 0, pinchRadius = .24;
let pendingGesture = '', pendingFrames = 0;
let plusArmed = true, plusCandidateFrames = 0, plusReleaseAt = 0;
const loveStory = { active: false, startedAt: 0, stage: -1, saved: null, confettiCount: 0, risingCount: 0, swirlCount: 0 };
let W = innerWidth, H = innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(W, H); renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
camera.position.z = 15;
const geometry = new THREE.BufferGeometry();
let positions = new Float32Array(particleCount * 3);
let targets = new Float32Array(particleCount * 3);
const velocities = new Float32Array(particleCount * 3);
const phases = new Float32Array(particleCount);
let colors = new Float32Array(particleCount * 3);
const material = new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
const points = new THREE.Points(geometry, material); scene.add(points);
const colorPink = new THREE.Color('#ff4caa'), colorBlue = new THREE.Color('#5c9dff'), colorOrange = new THREE.Color('#ff9c48'), colorWhite = new THREE.Color('#fff0fa');
const rand = (a, b) => a + Math.random() * (b - a);
for (let i = 0; i < particleCount; i++) phases[i] = rand(0, Math.PI * 2);

function setParticleColor(i, c) {
  colors[i * 3] = c.r * rand(.75, 1.1);
  colors[i * 3 + 1] = c.g * rand(.75, 1.1);
  colors[i * 3 + 2] = c.b * rand(.75, 1.1);
}
function makeTargets(mode, textValue = 'I LOVE YOU') {
  const textCanvas = document.createElement('canvas');
  const ctx = textCanvas.getContext('2d');
  const textPixels = [];
  if (mode === 'text') {
    textCanvas.width = 1000; textCanvas.height = 320;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fontSize = textValue.length > 14 ? 72 : textValue.length > 8 ? 94 : 130;
    ctx.font = `800 ${fontSize}px Arial`;
    ctx.fillText(textValue.toUpperCase(), 500, 160, 940);
    const data = ctx.getImageData(0, 0, 1000, 320).data;
    for (let y = 0; y < 320; y += 3) for (let x = 0; x < 1000; x += 3) {
      if (data[(y * 1000 + x) * 4 + 3] > 100) textPixels.push([(x - 500) / 70, -(y - 160) / 70]);
    }
  }
  const nextTargets = new Float32Array(particleCount * 3);
  const nextColors = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    let x = 0, y = 0, z = 0, c;
    if (mode === 'heart') {
      const t = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      x = .16 * 16 * Math.pow(Math.sin(t), 3) * r;
      y = .13 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * r;
      z = rand(-.65, .65); c = colorPink;
    } else if (mode === 'orb') {
      const u = rand(-1, 1), theta = rand(0, Math.PI * 2), r = 2.8 * Math.cbrt(Math.random()), s = Math.sqrt(1 - u * u);
      x = r * s * Math.cos(theta); y = r * u; z = r * s * Math.sin(theta); c = colorOrange;
    } else if (mode === 'text' && textPixels.length) {
      const p = textPixels[(Math.random() * textPixels.length) | 0];
      x = p[0] + rand(-.04, .04); y = p[1] + rand(-.04, .04); z = rand(-.18, .18); c = colorWhite;
    } else if (mode === 'chayma') {
      // A bold CHAYMA particle formation, using the same text renderer as the love gesture.
      if (!textPixels.length) {
        textCanvas.width = 1000; textCanvas.height = 320;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '800 130px Arial'; ctx.fillText('CHAYMA', 500, 160, 940);
        const data = ctx.getImageData(0, 0, 1000, 320).data;
        for (let yy = 0; yy < 320; yy += 3) for (let xx = 0; xx < 1000; xx += 3) if (data[(yy * 1000 + xx) * 4 + 3] > 100) textPixels.push([(xx - 500) / 70, -(yy - 160) / 70]);
      }
      const p = textPixels[(Math.random() * Math.max(1, textPixels.length)) | 0] || [rand(-3,3), rand(-1,1)];
      x = p[0] + rand(-.04, .04); y = p[1] + rand(-.04, .04); z = rand(-.18, .18); c = colorPink;
    } else if (mode === 'swirl' || mode === 'thumbsup' || mode === 'thumbsdown' || mode === 'rock' || mode === 'middle' || mode === 'threealt' || mode === 'claw' || mode === 'indexring') {
      const a = i * 2.399, r = Math.sqrt(i / particleCount) * 4.6;
      if (mode === 'thumbsup' || mode === 'thumbsdown') { const u = i / particleCount; x = Math.cos(a) * (.35 + u * 1.15); y = (mode === 'thumbsup' ? 1 : -1) * (u * 5 - 2.5); z = Math.sin(a) * (.35 + u * 1.15); }
      else if (mode === 'rock') { const u = i / particleCount; x = Math.cos(a + u * 5) * (u * 4); y = Math.sin(a + u * 5) * (u * 2.4); z = (u - .5) * 2; }
      else if (mode === 'middle') { const u = i / particleCount; x = (u - .5) * 5; y = 1.1 + Math.sin(u * Math.PI) * 1.5; z = Math.sin(a) * .25; }
      else if (mode === 'threealt') { const u = i / particleCount; x = Math.cos(a) * (1 + u * 3); y = Math.sin(a) * (1 + u * 2); z = Math.sin(u * Math.PI * 5) * .35; }
      else if (mode === 'claw') { const u = i / particleCount; x = Math.cos(a) * (1.2 + u * 2); y = Math.sin(a) * (1.2 + u * 2); z = (u - .5) * 1.2; }
      else if (mode === 'indexring') { const u = i / particleCount, ring = i % 2; x = Math.cos(a) * (1.1 + ring * 1.3); y = Math.sin(a) * (1.1 + ring * 1.3); z = Math.sin(u * 12) * .35; }
      else { x = Math.cos(a) * r; y = Math.sin(a) * r * .7; z = rand(-1.5, 1.5); }
      c = mode === 'thumbsup' || mode === 'thumbsdown' ? colorOrange : colorPink;
    } else {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 5;
      x = Math.cos(a) * r; y = Math.sin(a) * r * .7; z = rand(-2.5, 2.5);
      c = Math.random() > .5 ? colorBlue : colorPink;
    }
    nextTargets.set([x, y, z], i * 3);
    nextColors[i * 3] = c.r * rand(.75, 1.1); nextColors[i * 3 + 1] = c.g * rand(.75, 1.1); nextColors[i * 3 + 2] = c.b * rand(.75, 1.1);
  }
  // Keep the current positions so the next formation eases into place smoothly.
  targets = nextTargets; colors = nextColors;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.attributes.position.needsUpdate = true;
}
function setMode(mode) { if (activeMode === mode) return; activeMode = mode; makeTargets(mode); }
function distance2D(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function isTwoHandPlus(hands) {
  if (!hands || hands.length !== 2) return false;
  const palm = lm => ({ x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5 });
  const axes = hands.map(lm => {
    const dx = lm[9].x - lm[0].x, dy = lm[9].y - lm[0].y, length = Math.hypot(dx, dy);
    return { x: dx / Math.max(length, 1e-4), y: dy / Math.max(length, 1e-4), width: distance2D(lm[5], lm[17]), center: palm(lm) };
  });
  const dot = Math.abs(axes[0].x * axes[1].x + axes[0].y * axes[1].y);
  const centerDistance = distance2D(axes[0].center, axes[1].center);
  const center = { x: (axes[0].center.x + axes[1].center.x) / 2, y: (axes[0].center.y + axes[1].center.y) / 2 };
  const closeEnough = centerDistance < Math.min(.28, (axes[0].width + axes[1].width) * 1.25 + .05);
  return axes[0].width > .025 && axes[1].width > .025 && dot < .38 && closeEnough && center.x > .16 && center.x < .84 && center.y > .14 && center.y < .86;
}
function drawStoryPerson(ctx, cx, baseline, kind, pose = 'standing', surprised = false) {
  const woman = kind === 'woman';
  const glow = woman ? '#ff8ecb' : '#ffd58b';
  const shadow = woman ? '#b83e91' : '#c27b36';
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = glow; ctx.shadowBlur = 18;
  const fill = ctx.createLinearGradient(cx - 45, baseline - 310, cx + 45, baseline);
  fill.addColorStop(0, woman ? '#fff2fa' : '#fff3cf'); fill.addColorStop(.48, glow); fill.addColorStop(1, shadow);
  const stroke = (points, width = 14) => { ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]); ctx.strokeStyle = fill; ctx.lineWidth = width; ctx.stroke(); };
  const headY = pose === 'kneeling' ? baseline - 190 : baseline - 300;
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, headY, 24, 0, Math.PI * 2); ctx.fill();
  if (woman) { ctx.beginPath(); ctx.arc(cx, headY - 2, 27, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(cx + 25, headY + 32); ctx.quadraticCurveTo(cx + 12, headY + 16, cx + 10, headY + 2); ctx.fill(); }
  if (pose === 'kneeling') {
    stroke([[cx - 5, headY + 25], [cx + 30, headY + 65], [cx + 40, headY + 112]], 28);
    stroke([[cx + 3, headY + 46], [cx - 38, headY + 92], [cx - 72, headY + 88]], 11);
    stroke([[cx + 38, headY + 108], [cx + 5, headY + 145], [cx - 35, headY + 145]], 15);
    stroke([[cx + 38, headY + 108], [cx + 65, headY + 150], [cx + 97, headY + 150]], 15);
    stroke([[cx - 22, headY + 65], [cx - 58, headY + 45]], 11);
  } else {
    if (woman) {
      ctx.beginPath(); ctx.moveTo(cx - 30, headY + 36); ctx.lineTo(cx + 30, headY + 36); ctx.lineTo(cx + 58, baseline - 16); ctx.quadraticCurveTo(cx, baseline + 3, cx - 58, baseline - 16); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(cx - 31, headY + 34); ctx.lineTo(cx + 31, headY + 34); ctx.lineTo(cx + 29, baseline - 125); ctx.lineTo(cx - 29, baseline - 125); ctx.closePath(); ctx.fill();
    }
    stroke([[cx - 17, baseline - 128], [cx - 24, baseline - 47], [cx - 30, baseline - 8]], 13);
    stroke([[cx + 17, baseline - 128], [cx + 24, baseline - 47], [cx + 30, baseline - 8]], 13);
    if (surprised) {
      stroke([[cx - 30, headY + 54], [cx - 54, headY + 3], [cx - 43, headY - 23]], 11);
      stroke([[cx + 30, headY + 54], [cx + 48, headY + 24]], 11);
    } else {
      stroke([[cx - 27, headY + 56], [cx - 60, headY + 101], [cx - 22, headY + 140]], 11);
      stroke([[cx + 27, headY + 56], [cx + 60, headY + 101], [cx + 22, headY + 140]], 11);
    }
  }
  ctx.restore();
}
function drawHeart(ctx, cx, cy, size, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(size / 100, size / 100); ctx.beginPath();
  ctx.moveTo(0, 34); ctx.bezierCurveTo(-90, -22, -43, -78, 0, -37); ctx.bezierCurveTo(43, -78, 90, -22, 0, 34);
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.shadowColor = color; ctx.shadowBlur = 22; ctx.stroke(); ctx.restore();
}
function makeStoryTargets(stage) {
  const storyCanvas = document.createElement('canvas'); storyCanvas.width = 720; storyCanvas.height = 480;
  const ctx = storyCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 720, 480); loveStory.confettiCount = 0; loveStory.risingCount = 0; loveStory.swirlCount = 0;
  if (stage === 0) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,205,143,.45)'; ctx.lineWidth = 2; ctx.setLineDash([3, 10]); ctx.beginPath(); ctx.ellipse(360, 270, 190, 95, -.1, .1, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.ellipse(360, 270, 145, 70, .25, Math.PI, Math.PI * 2.8); ctx.stroke(); ctx.restore();
    drawStoryPerson(ctx, 275, 420, 'man'); drawStoryPerson(ctx, 465, 420, 'woman', 'standing', true); loveStory.swirlCount = 180;
  } else if (stage === 1) {
    drawStoryPerson(ctx, 245, 425, 'man', 'kneeling'); drawStoryPerson(ctx, 470, 425, 'woman', 'standing', true);
    ctx.save(); ctx.strokeStyle = '#ffe3a0'; ctx.lineWidth = 6; ctx.shadowColor = '#ffd46c'; ctx.shadowBlur = 24; ctx.beginPath(); ctx.ellipse(354, 266, 23, 18, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(354, 266, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff8d8'; ctx.fill(); ctx.restore();
    for (let i = 0; i < 5; i++) drawHeart(ctx, 330 + i * 16, 210 - i * 28, 16 + (i % 2) * 6, i % 2 ? '#ff9ccc' : '#ffe4a0');
    ctx.save(); ctx.fillStyle = '#fff4c9'; ctx.shadowColor = '#ffe090'; ctx.shadowBlur = 24; ctx.beginPath(); ctx.arc(354, 266, 38, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    loveStory.risingCount = 80;
  } else if (stage === 2) {
    ctx.save(); ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = 5; ctx.shadowColor = '#ffb75b'; ctx.shadowBlur = 24; ctx.beginPath(); ctx.moveTo(155, 300); ctx.bezierCurveTo(140, 35, 580, 35, 565, 300); ctx.stroke(); ctx.restore();
    for (let i = 0; i < 13; i++) { const a = Math.PI + i * Math.PI / 12; ctx.beginPath(); ctx.arc(360 + Math.cos(a) * 205, 286 + Math.sin(a) * 190, 6 + i % 3, 0, Math.PI * 2); ctx.fillStyle = i % 2 ? '#ff9dc9' : '#ffe4a0'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; ctx.fill(); }
    drawStoryPerson(ctx, 315, 425, 'man'); drawStoryPerson(ctx, 420, 425, 'woman');
    ctx.save(); ctx.strokeStyle = '#ffe39b'; ctx.lineWidth = 7; ctx.shadowColor = '#ffd05d'; ctx.shadowBlur = 24; ctx.beginPath(); ctx.ellipse(365, 292, 24, 17, -.2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.fillStyle = '#fff4cc'; ctx.font = 'bold 19px Georgia'; ctx.textAlign = 'center'; ctx.shadowColor = '#ffca72'; ctx.shadowBlur = 14; ctx.fillText('VOWS', 360, 367); ctx.restore();
    loveStory.confettiCount = 100;
  } else {
    drawHeart(ctx, 360, 100, 130, '#ff8ecb');
    ctx.save(); ctx.strokeStyle = 'rgba(173,155,255,.9)'; ctx.lineWidth = 3; ctx.shadowColor = '#b6a0ff'; ctx.shadowBlur = 15; ctx.beginPath(); ctx.ellipse(360, 300, 250, 115, -.08, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    drawStoryPerson(ctx, 320, 420, 'man'); drawStoryPerson(ctx, 405, 420, 'woman');
    ctx.save(); ctx.fillStyle = '#fff4e7'; ctx.font = 'bold 29px Georgia'; ctx.textAlign = 'center'; ctx.shadowColor = '#ff9ecf'; ctx.shadowBlur = 20; ctx.fillText('FOREVER TOGETHER', 360, 466); ctx.restore();
    loveStory.confettiCount = 100;
  }
  const image = ctx.getImageData(0, 0, 720, 480).data, lit = [];
  for (let y = 0; y < 480; y += 2) for (let x = 0; x < 720; x += 2) { const k = (y * 720 + x) * 4; if (image[k + 3] > 70) lit.push(k); }
  const nextTargets = new Float32Array(particleCount * 3), nextColors = new Float32Array(particleCount * 3);
  const frustumHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const worldWidth = Math.min(10.5, frustumHeight * (W / Math.max(1, H)) * .82), worldHeight = Math.min(7.2, frustumHeight * .8);
  for (let i = 0; i < particleCount; i++) {
    const j = i * 3;
    if (i < loveStory.confettiCount) {
      const seed = Math.sin(i * 127.1 + stage * 311.7) * 43758.5453, unit = seed - Math.floor(seed);
      nextTargets[j] = (unit - .5) * worldWidth * .9; nextTargets[j + 1] = worldHeight * .42; nextTargets[j + 2] = -.35 + unit * .7;
      nextColors[j] = .95; nextColors[j + 1] = .76 + unit * .2; nextColors[j + 2] = 1;
      continue;
    }
    if (i < loveStory.risingCount) {
      const seed = Math.sin(i * 127.1 + 91.7) * 43758.5453, unit = seed - Math.floor(seed);
      nextTargets[j] = (unit - .5) * 1.8; nextTargets[j + 1] = -.9; nextTargets[j + 2] = -.2 + unit * .4;
      nextColors[j] = 1; nextColors[j + 1] = .45 + unit * .38; nextColors[j + 2] = .82 + unit * .18;
      continue;
    }
    if (stage === 0 && i < loveStory.swirlCount) {
      const angle = i * 2.399, radius = 1.6 + i / loveStory.swirlCount * 2.1;
      nextTargets[j] = Math.cos(angle) * radius; nextTargets[j + 1] = Math.sin(angle) * radius * .62; nextTargets[j + 2] = Math.sin(angle * .7) * .5;
      nextColors[j] = .95; nextColors[j + 1] = .63 + (i % 5) * .05; nextColors[j + 2] = .92;
      continue;
    }
    const k = lit.length ? lit[Math.min(lit.length - 1, Math.floor((i / particleCount) * lit.length))] : 0;
    const px = (k / 4) % 720, py = Math.floor(k / 4 / 720), seed = Math.sin(i * 78.233 + stage * 19.19) * 43758.5453;
    nextTargets[j] = (px / 720 - .5) * worldWidth;
    nextTargets[j + 1] = (.5 - py / 480) * worldHeight;
    nextTargets[j + 2] = (seed - Math.floor(seed) - .5) * .7;
    nextColors[j] = image[k] / 255; nextColors[j + 1] = image[k + 1] / 255; nextColors[j + 2] = image[k + 2] / 255;
  }
  targets = nextTargets; colors = nextColors;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.attributes.position.needsUpdate = true; loveStory.stage = stage;
}
function endLoveStory() {
  if (!loveStory.active) return;
  const saved = loveStory.saved; loveStory.active = false; loveStory.stage = -1; loveStory.confettiCount = 0;
  if (saved) { activeMode = saved.mode; targets = saved.targets; colors = saved.colors; geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.attributes.position.needsUpdate = true; }
  loveStory.confettiCount = 0; loveStory.risingCount = 0; loveStory.swirlCount = 0;
  material.size = .055; material.opacity = .95; loveStory.saved = null;
}
function startLoveStory(now) {
  if (loveStory.active) return;
  loveStory.saved = { mode: activeMode === 'draw' || activeMode === 'pinch' ? 'free' : activeMode, targets: targets.slice(), colors: colors.slice() };
  loveStory.active = true; loveStory.startedAt = now; loveStory.stage = -1; activeMode = 'love-story'; fingerPoint = null;
  advanceLoveStory(now);
}
function advanceLoveStory(now) {
  if (!loveStory.active) return;
  const elapsed = (now - loveStory.startedAt) / 1000;
  const stage = elapsed < 3.4 ? 0 : elapsed < 6.9 ? 1 : elapsed < 10.4 ? 2 : elapsed < 14.8 ? 3 : 4;
  if (stage === 4) { endLoveStory(); return; }
  try { if (stage !== loveStory.stage) makeStoryTargets(stage); }
  catch (error) { console.error('Love story particle sequence failed:', error); endLoveStory(); return; }
  const proposalTime = elapsed - 3.4, pulse = stage === 1 ? Math.exp(-Math.pow((proposalTime - 1.8) / .42, 2)) : 0;
  material.size = .055 + pulse * .024; material.opacity = .95;
}
function updatePlusGesture(hands, now, confidenceOkay = true) {
  const pose = confidenceOkay && isTwoHandPlus(hands);
  if (pose) {
    plusReleaseAt = 0; plusCandidateFrames++;
    if (plusArmed && plusCandidateFrames >= 5) { plusArmed = false; startLoveStory(now); }
  } else {
    plusCandidateFrames = 0;
    if (!plusArmed) {
      if (!plusReleaseAt) plusReleaseAt = now;
      if (now - plusReleaseAt >= 700) { plusArmed = true; plusReleaseAt = 0; }
    }
  }
}
function fingerUp(lm, tip, pip) { return lm[tip].y < lm[pip].y; }
function classify(lm) {
  const index = fingerUp(lm, 8, 6), middle = fingerUp(lm, 12, 10), ring = fingerUp(lm, 16, 14), pinky = fingerUp(lm, 20, 18);
  const count = [index, middle, ring, pinky].filter(Boolean).length;
  const d = (a,b) => Math.hypot(lm[a].x-lm[b].x,lm[a].y-lm[b].y);
  const thumbExtended = d(4,5) > d(3,5) * 1.12;
  // Preserve the original two-, three-, four-finger mappings before checking new poses.
  if (count === 2 && index && middle && !ring && !pinky) return 'love';
  if (count === 3 && index && middle && ring && !pinky) return 'chayma';
  if (count === 4 && !thumbExtended) return 'bigheart';
  if (count === 4 && thumbExtended) return 'open';
  const pinch = d(4,8) < d(5,9) * .32;
  if (pinch && !middle && !ring && !pinky) return 'pinch';
  if (count === 0 && thumbExtended) {
    const thumbDy = lm[4].y - lm[2].y;
    if (thumbDy < -.11) return 'thumbsup';
    if (thumbDy > .11) return 'thumbsdown';
  }
  if (count === 1 && index) return 'point';
  if (count === 1 && middle && !thumbExtended) return 'middle';
  if (count === 2 && index && ring && !middle && !pinky) return 'indexring';
  if (index && pinky && !middle && !ring) return 'rock';
  if (count === 3 && index && !middle && ring && pinky) return 'threealt';
  if (count === 3 && !index && middle && ring && pinky) return 'claw';
  return count === 0 ? 'fist' : 'hand';
}
function onGesture(gesture, lm) {
  const now = performance.now();
  if (gesture !== pendingGesture) { pendingGesture = gesture; pendingFrames = 1; }
  else pendingFrames++;
  if (pendingFrames < 3) return;
  if (gesture !== lastGesture) { lastGesture = gesture; gestureSince = now; }
  if (gesture === 'point') {
    const p = lm[8];
    fingerPoint = { x: (0.5 - p.x) * 12, y: (0.5 - p.y) * 7 };
    // Pointing gathers particles around the fingertip; no trace is drawn.
    if (activeMode !== 'draw') activeMode = 'draw';
    return;
  }
  if (gesture === 'pinch') {
    const midX = (lm[4].x + lm[8].x) * .5, midY = (lm[4].y + lm[8].y) * .5;
    const pinchRatio = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / Math.max(.001, Math.hypot(lm[5].x - lm[9].x, lm[5].y - lm[9].y));
    pinchRadius = .08 + Math.min(pinchRatio, .32) * 1.2;
    fingerPoint = { x: (0.5 - midX) * 12, y: (0.5 - midY) * 7 };
    activeMode = 'pinch';
    return;
  }
  fingerPoint = null;
  if (now - gestureSince < 180 || now - lastModeChange < 450) return;
  let next = null;
  if (gesture === 'love') next = 'text';
  else if (gesture === 'chayma') next = 'chayma';
  else if (gesture === 'bigheart') next = 'heart';
  else if (gesture === 'fist') next = 'orb';
  else if (gesture === 'thumbsup') next = 'thumbsup';
  else if (gesture === 'thumbsdown') next = 'thumbsdown';
  else if (gesture === 'rock') next = 'rock';
  else if (gesture === 'middle') next = 'middle';
  else if (gesture === 'threealt') next = 'threealt';
  else if (gesture === 'claw') next = 'claw';
  else if (gesture === 'indexring') next = 'indexring';
  else if (gesture === 'hand' || gesture === 'open') next = 'free';
  if (next && activeMode !== next) {
    activeMode = next;
    makeTargets(next, next === 'text' ? 'I LOVE YOU' : next === 'chayma' ? 'CHAYMA' : 'I LOVE YOU');
    lastModeChange = now;
  }
}
async function startCamera() {
  startBtn.disabled = true; startBtn.textContent = 'Connecting…'; errorEl.textContent = '';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost. Use VS Code Live Server.');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play();
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 2
    });
    welcome.style.display = 'none';
  } catch (err) {
    console.error(err); errorEl.textContent = err.message || 'Could not start camera. Check permissions and try again.';
    startBtn.disabled = false; startBtn.textContent = 'Try again';
  }
}
startBtn.addEventListener('click', startCamera);
function trackHand() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, performance.now());
  const now = performance.now(), hands = result.landmarks || [];
  const confidence = result.handedness || result.handednesses;
  const confidenceOkay = !Array.isArray(confidence) || confidence.length < 2 || confidence.slice(0, 2).every(hand => {
    const category = Array.isArray(hand) ? hand[0] : hand;
    return typeof category?.score !== 'number' || category.score >= .65;
  });
  updatePlusGesture(hands, now, confidenceOkay);
  if (hands.length) { handSeen = true; noHandSince = 0; if (!loveStory.active) onGesture(classify(hands[0]), hands[0]); }
  else {
    handSeen = false; fingerPoint = null;
    pendingGesture = ''; pendingFrames = 0;
    if (!noHandSince) noHandSince = now;
    // Return to the default free-particle state after the hand has been absent briefly.
    if (!loveStory.active && now - noHandSince > 350 && activeMode !== 'free') {
      activeMode = 'free'; makeTargets('free'); lastGesture = ''; lastModeChange = now;
    }
  }
}
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate); trackHand();
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  advanceLoveStory(performance.now());
  const storyElapsed = loveStory.active ? (performance.now() - loveStory.startedAt) / 1000 : 0;
  const arr = geometry.attributes.position.array;
  const damping = Math.exp(-5.8 * dt);
  for (let i = 0; i < particleCount; i++) {
    const j = i * 3;
    if ((activeMode === 'draw' || activeMode === 'pinch') && fingerPoint) {
      // The reference behavior: gather the whole cloud into one point under the index fingertip.
      const a = phases[i] + t * (activeMode === 'draw' ? 1.8 : .75), r = activeMode === 'draw' ? .07 + (i % 12) * .018 : pinchRadius + (i % 24) * pinchRadius * .18;
      const tx = fingerPoint.x + Math.cos(a) * r, ty = fingerPoint.y + Math.sin(a) * r, tz = Math.sin(a * .6) * r;
      for (let axis = 0; axis < 3; axis++) { const target = axis === 0 ? tx : axis === 1 ? ty : tz; velocities[j + axis] += (target - arr[j + axis]) * 20 * dt; velocities[j + axis] *= damping; arr[j + axis] += velocities[j + axis] * dt; }
    } else {
      const phase = phases[i], wave = activeMode === 'free' ? 1 : .42;
      let tx = targets[j] + Math.sin(t * .52 + phase) * .12 * wave;
      let ty = targets[j + 1] + Math.cos(t * .43 + phase * 1.31) * .11 * wave;
      if (loveStory.active && i < loveStory.confettiCount) ty = targets[j + 1] - ((storyElapsed * .85 + phase * 2) % 3.2);
      else if (loveStory.active && i < loveStory.risingCount) ty = -.9 + ((storyElapsed * .32 + phase * 3) % 1) * 3.6;
      else if (loveStory.active && loveStory.stage === 0 && i < loveStory.swirlCount) {
        const angle = storyElapsed * .42, baseX = targets[j], baseY = targets[j + 1];
        tx = baseX * Math.cos(angle) - baseY * Math.sin(angle); ty = baseX * Math.sin(angle) + baseY * Math.cos(angle);
      }
      const tz = targets[j + 2] + Math.sin(t * .37 + phase * .73) * .14 * wave;
      for (let axis = 0; axis < 3; axis++) { const target = axis === 0 ? tx : axis === 1 ? ty : tz; velocities[j + axis] += (target - arr[j + axis]) * 16 * dt; velocities[j + axis] *= damping; arr[j + axis] += velocities[j + axis] * dt; }
    }
  }
  geometry.attributes.position.needsUpdate = true;
  points.rotation.y += (Math.sin(t * .22) * .12 - points.rotation.y) * .025;
  points.rotation.x += (Math.cos(t * .19) * .06 - points.rotation.x) * .025;
  if (activeMode === 'swirl' && !fingerPoint) { points.rotation.y += .002; points.rotation.z += .001; }
  renderer.render(scene, camera);

}
function resize() {
  W = innerWidth; H = innerHeight;
  camera.aspect = W / H; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(W, H);
  if (trailCanvas) { trailCanvas.width = Math.round(W * Math.min(devicePixelRatio || 1, 2)); trailCanvas.height = Math.round(H * Math.min(devicePixelRatio || 1, 2)); trailCanvas.style.width = W + 'px'; trailCanvas.style.height = H + 'px'; trailCtx.setTransform(Math.min(devicePixelRatio || 1, 2), 0, 0, Math.min(devicePixelRatio || 1, 2), 0, 0); }
}
positions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i++) { positions[i * 3] = rand(-8, 8); positions[i * 3 + 1] = rand(-5, 5); positions[i * 3 + 2] = rand(-3, 3); }
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
makeTargets('free');
resize(); window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => stream?.getTracks().forEach(track => track.stop()));
requestAnimationFrame(animate);
