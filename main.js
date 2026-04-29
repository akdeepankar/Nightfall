// =============================================================================
// NIGHTFALL — main.js  (Zombie Survival Edition)
// Three.js r128 loaded globally as THREE. No bundler, no imports.
//
// Phone controller: run `node server.js`, then open the game at
// http://<your-local-IP>:3000 and scan the QR code with your iPhone.
// =============================================================================

// ═══════════════════════════════════════════════════════════════════════════════
// §1  GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════════════
let gameOver = false;
let isLocked = false;
let gameStarted = false; // true after "Start Game" command (enemies active)
let roomEntered = false; // true after first Enter/click to load empty room
let audioCtx = null;
let ambientStarted = false;
let score = 0; // zombies killed
let bestScore = parseInt(localStorage.getItem("nightfall_best_score") || "0");
let ammo = 10;
const MAX_AMMO = 10;
let isReloading = false;
let canFire = true;
let victory = false;

// --- 3D Model Loading ---
let ghostModel = null;
const gltfLoader = new THREE.GLTFLoader();
let isModelLoaded = false;
let startRequested = false;

gltfLoader.load("3dmodels/ghost.glb", (gltf) => {
  const model = gltf.scene;
  
  // Normalize scale and position
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 2.0 / size.y; // Standardized height
  model.scale.set(scale, scale, scale);
  
  // Align bottom to y=0
  model.position.y = -box.min.y * scale;
  
  ghostModel = new THREE.Group();
  ghostModel.add(model);

  ghostModel.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material) {
        node.material.transparent = true;
      }
    }
  });
  
  isModelLoaded = true;
  console.log("Ghost model loaded successfully from 3dmodels/ghost.glb");
  
  // If user already clicked "Enter", start now
  if (startRequested) {
    startGame();
  }
}, undefined, (error) => {
  console.error("Error loading ghost.glb:", error);
});

// ═══════════════════════════════════════════════════════════════════════════════
// §2  RENDERER & SCENE
// ═══════════════════════════════════════════════════════════════════════════════
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020513);
scene.fog = new THREE.FogExp2(0x020513, 0.002);

const starField = createStarField();
scene.add(starField);

const cometState = createComet();
scene.add(cometState.group);
scene.add(cometState.tailLine);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function createStarField() {
  const stars = 1200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(stars * 3);
  const colors = new Float32Array(stars * 3);

  for (let i = 0; i < stars; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 65 + Math.random() * 40;
    const x = Math.sin(phi) * Math.cos(theta) * radius;
    const y = 18 + Math.random() * 50;
    const z = Math.sin(phi) * Math.sin(theta) * radius;
    const brightness = 0.6 + Math.random() * 0.4;

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3 + 0] = brightness;
    colors[i * 3 + 1] = brightness;
    colors[i * 3 + 2] = brightness;
  }

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.4,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

function createComet() {
  const group = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xffffd3,
      emissive: 0xffffd3,
      transparent: true,
      opacity: 1,
    }),
  );
  group.add(head);

  const tailLength = 16;
  const tailPositions = new Float32Array(tailLength * 3);
  const tailColors = new Float32Array(tailLength * 3);
  for (let i = 0; i < tailLength; i++) {
    const t = i / (tailLength - 1);
    tailPositions[i * 3 + 0] = 0;
    tailPositions[i * 3 + 1] = 0;
    tailPositions[i * 3 + 2] = 0;
    tailColors[i * 3 + 0] = 1;
    tailColors[i * 3 + 1] = 0.9 - t * 0.7;
    tailColors[i * 3 + 2] = 0.5 - t * 0.4;
  }

  const tailGeometry = new THREE.BufferGeometry();
  tailGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(tailPositions, 3),
  );
  tailGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(tailColors, 3),
  );

  const tailLine = new THREE.Line(
    tailGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );

  const state = {
    group,
    head,
    tailLine,
    tailHistory: [],
    tailLength,
    velocity: new THREE.Vector3(0.14, -0.046, 0.16),
  };

  resetComet(state);
  return state;
}

function resetComet(state) {
  const startX = -28 - Math.random() * 8;
  const startY = 30 + Math.random() * 20;
  const startZ = -50 - Math.random() * 16;
  state.group.position.set(startX, startY, startZ);
  state.tailHistory.length = 0;
  for (let i = 0; i < state.tailLength; i++) {
    state.tailHistory.push(state.group.position.clone());
  }
  updateCometTrail(state);
}

function updateCometTrail(state) {
  const positions = state.tailLine.geometry.attributes.position.array;
  for (let i = 0; i < state.tailLength; i++) {
    const pos = state.tailHistory[i];
    positions[i * 3 + 0] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
  }
  state.tailLine.geometry.attributes.position.needsUpdate = true;
}

function updateComet(delta) {
  const speedFactor = delta / 16.67;
  const state = cometState;
  const velocity = state.velocity.clone().multiplyScalar(speedFactor);
  state.group.position.add(velocity);

  state.tailHistory.unshift(state.group.position.clone());
  if (state.tailHistory.length > state.tailLength) {
    state.tailHistory.pop();
  }

  updateCometTrail(state);
  state.group.lookAt(state.group.position.clone().sub(state.velocity));

  if (
    state.group.position.y < 10 ||
    state.group.position.x > 42 ||
    state.group.position.z > 40
  ) {
    resetComet(state);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3  FPS CONTROLS  (inline pointer-lock — no external module)
//
//   yawObject   → rotates on Y (left/right look), holds player world position
//     pitchObject → rotates on X (up/down look, clamped ±85°)
//       camera
// ═══════════════════════════════════════════════════════════════════════════════
const pitchObject = new THREE.Object3D();
pitchObject.add(camera);

const yawObject = new THREE.Object3D();
yawObject.position.set(5, 1.7, -3); // spawn in open north-east corridor
yawObject.add(pitchObject);
scene.add(yawObject);

const DEG85 = (85 * Math.PI) / 180;

// Camera look accumulators (mouse + iPhone as separate streams)
const LOOK_SENS_MOUSE = 0.002;
const LOOK_SENS_PHONE = 0.006;
let lookDeltaYawMouse = 0;
let lookDeltaPitchMouse = 0;
let lookDeltaYawPhone = 0;

// iPhone look stream watchdog (phone stream fades out only for phone input)
let phoneLookLastTs = 0;
let phoneLookWeight = 0;

document.addEventListener("mousemove", (e) => {
  if (!isLocked || gameOver) return;
  const dx = e.movementX || e.mozMovementX || 0;
  const dy = e.movementY || e.mozMovementY || 0;
  lookDeltaYawMouse += -dx * LOOK_SENS_MOUSE;
  lookDeltaPitchMouse += -dy * LOOK_SENS_MOUSE;
});

document.addEventListener("pointerlockchange", () => {
  isLocked = document.pointerLockElement === canvas;
});
document.addEventListener("pointerlockerror", () => {
  console.warn("[NIGHTFALL] Pointer lock failed");
});

function requestLock() {
  const fn = canvas.requestPointerLock || canvas.mozRequestPointerLock;
  if (fn) fn.call(canvas);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  INPUT
// ═══════════════════════════════════════════════════════════════════════════════
const keys = { w: false, a: false, s: false, d: false, shift: false };

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyW" || e.code === "ArrowUp") keys.w = true;
  if (e.code === "KeyA" || e.code === "ArrowLeft") keys.a = true;
  if (e.code === "KeyS" || e.code === "ArrowDown") keys.s = true;
  if (e.code === "KeyD" || e.code === "ArrowRight") keys.d = true;
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.shift = true;
  // R = reload (only when not already reloading and magazine not full)
  if (
    e.code === "KeyR" &&
    !isReloading &&
    ammo < MAX_AMMO &&
    isLocked &&
    !gameOver
  ) {
    startReload();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "KeyW" || e.code === "ArrowUp") keys.w = false;
  if (e.code === "KeyA" || e.code === "ArrowLeft") keys.a = false;
  if (e.code === "KeyS" || e.code === "ArrowDown") keys.s = false;
  if (e.code === "KeyD" || e.code === "ArrowRight") keys.d = false;
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.shift = false;
});

// Left mouse button → fire
document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && isLocked && !gameOver) fireGun();
});

// ═══════════════════════════════════════════════════════════════════════════════
// §5  LIGHTING  — DARK ROOM + TORCH VIEW
// ═══════════════════════════════════════════════════════════════════════════════

// Near-zero ambient — the room is almost pitch black
scene.add(new THREE.AmbientLight(0xffffff, 1.0));

// ── TORCH / FLASHLIGHT ──────────────────────────────────────────────────────
// SpotLight creates the classic flashlight cone
/*
const torch = new THREE.SpotLight(0xffe0a0, 3.5, 18, Math.PI / 6, 0.45, 1.6);
torch.position.set(0, -0.1, -0.3);
torch.castShadow = true;
torch.shadow.mapSize.set(1024, 1024);
torch.shadow.camera.near = 0.1;
torch.shadow.camera.far = 18;
torch.shadow.bias = -0.002;

const torchTarget = new THREE.Object3D();
torchTarget.position.set(0, -0.05, -5);
pitchObject.add(torchTarget);
torch.target = torchTarget;
pitchObject.add(torch);

const lantern = new THREE.PointLight(0xffd580, 0.4, 4);
lantern.position.set(0, -0.15, -0.4);
pitchObject.add(lantern);
*/

// Torch flicker state
const TORCH_BASE_INTENSITY = 3.5;
const TORCH_BASE_ANGLE = Math.PI / 6;
let torchFlickerSeed = 0;

// Static scene lights: reduced to barely-visible ember glows in the darkness
const staticLightDefs = [
  { color: 0xff2200, intensity: 0.25, range: 6, x: -8, z: -8, shadow: false },
  { color: 0xff6600, intensity: 0.20, range: 5, x: 10, z: 8, shadow: false },
  { color: 0xff4400, intensity: 0.12, range: 4, x: -5, z: 5, shadow: false },
  { color: 0xff4400, intensity: 0.12, range: 4, x: 7, z: -5, shadow: false },
  { color: 0xff4400, intensity: 0.12, range: 4, x: -12, z: 2, shadow: false },
  { color: 0xff4400, intensity: 0.12, range: 4, x: 3, z: 12, shadow: false },
  { color: 0xff4400, intensity: 0.12, range: 4, x: -3, z: -13, shadow: false },
];

const flickerLights = [];
const flickerBaseIntensity = [];

staticLightDefs.forEach(({ color, intensity, range, x, z, shadow }) => {
  const light = new THREE.PointLight(color, intensity, range);
  light.position.set(x, 2.0, z);
  if (shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
  }
  scene.add(light);
  flickerLights.push(light);
  flickerBaseIntensity.push(intensity);
});

// Muzzle-flash light — child of pitchObject, normally off (intensity 0)
const muzzleLight = new THREE.PointLight(0xffffaa, 0, 5);
muzzleLight.position.set(0, -0.18, -0.92);
pitchObject.add(muzzleLight);

// ═══════════════════════════════════════════════════════════════════════════════
// §6  MAZE GEOMETRY + COLLISION REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════
const wallBoxes = []; // flat AABB footprints used for all collision tests

const wallMat = new THREE.MeshStandardMaterial({
  color: 0x2a2a32,
  roughness: 1.0,
});
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a22,
  roughness: 1.0,
});
const ceilMat = new THREE.MeshStandardMaterial({
  color: 0x0e0e14,
  roughness: 1.0,
});

function makeBox(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Build a wall mesh AND register an AABB for collision
function addWall(cx, cz, w, d, h = 4) {
  makeBox(w, h, d, wallMat, cx, h / 2, cz);
  wallBoxes.push({
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
  });
}

// Floor & ceiling
makeBox(40, 0.3, 40, floorMat, 0, -0.15, 0);
makeBox(40, 0.3, 40, ceilMat, 0, 4.15, 0);

// Outer perimeter (40×40)
addWall(0, -20, 40, 1); // North
addWall(0, 20, 40, 1); // South
addWall(-20, 0, 1, 40); // West
addWall(20, 0, 1, 40); // East

// Inner maze walls (spawn is at x=5, z=-3 — all these are clear of that area)
addWall(0, 10, 1, 16); // south centre spine  (z = 2→18)
addWall(0, -9, 1, 10); // north centre spine  (z = -14→-4)
addWall(-10, -8, 10, 1); // NW horizontal bar
addWall(-5, -4, 1, 8); // NW vertical stub
addWall(14, -8, 1, 12); // NE pocket east wall
addWall(9, -13, 10, 1); // NE pocket top
addWall(-8, 8, 1, 12); // SW long divider
addWall(-13, 3, 10, 1); // SW cross-piece
addWall(5, 8, 10, 1); // SE passage blocker
addWall(13, 13, 1, 10); // SE east pocket
addWall(-3, -6, 6, 1); // west alcove stub

// ═══════════════════════════════════════════════════════════════════════════════
// §7  COLLISION HELPER
// ═══════════════════════════════════════════════════════════════════════════════
const PLAYER_RADIUS = 0.4;

function collidesWithWalls(x, z, r) {
  const radius = r !== undefined ? r : PLAYER_RADIUS;
  for (const b of wallBoxes) {
    if (
      x + radius > b.minX &&
      x - radius < b.maxX &&
      z + radius > b.minZ &&
      z - radius < b.maxZ
    )
      return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8  WEB AUDIO  (all sounds synthesised — zero external files)
// ═══════════════════════════════════════════════════════════════════════════════
function getAudioContext() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// Low 60/63 Hz sine pair — eerie beat frequency
function startAmbientDrone() {
  if (ambientStarted) return;
  ambientStarted = true;
  const ctx = getAudioContext();
  [60, 63].forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
  });
}

// Muffled thud for footsteps
function playFootstepSound() {
  const ctx = getAudioContext(),
    SR = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(SR * 0.08), SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 200;
  filt.Q.value = 1.5;
  const gain = ctx.createGain(),
    now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + 0.08);
  src.connect(filt);
  filt.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.1);
}

// Sharp cracking gunshot — exponentially decaying white noise
function playGunshot() {
  const ctx = getAudioContext(),
    SR = ctx.sampleRate;
  const len = Math.floor(SR * 0.18);
  const buf = ctx.createBuffer(1, len, SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.035));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain(),
    now = ctx.currentTime;
  gain.gain.setValueAtTime(1.0, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.2);
}

// Dry click when firing with empty magazine
function playEmptyClick() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 1400;
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.03);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

// Two metallic clacks for reload
function playReloadSound() {
  const ctx = getAudioContext(),
    SR = ctx.sampleRate;
  [0, 0.35].forEach((offset) => {
    const buf = ctx.createBuffer(1, Math.floor(SR * 0.05), SR);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.012));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const t = ctx.currentTime + offset;
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.06);
  });
}

// Descending sawtooth — zombie death rattle
function playZombieDeath() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(30, ctx.currentTime + 0.45);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
}

// Slow rising-then-falling sawtooth moan
function playZombieGroan() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.linearRampToValueAtTime(115, now + 0.35);
  osc.frequency.linearRampToValueAtTime(55, now + 0.9);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.13, now + 0.1);
  gain.gain.linearRampToValueAtTime(0, now + 0.9);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 1.0);
}

// Eerie high-pitched sliding sine groan
function playGhostGroan(volume = 0.5) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  const now = ctx.currentTime;

  // Slide from mid-high to low-mid
  osc.frequency.setValueAtTime(500, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 1.5);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.15, now + 0.4);
  gain.gain.linearRampToValueAtTime(0, now + 1.5);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 1.6);
}

// High-to-low sweeping death wail
function playGhostDeath() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  const now = ctx.currentTime;

  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 1.2);

  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 1.3);
}

// Loud white-noise jumpscare burst
function playJumpscare() {
  const ctx = getAudioContext(),
    SR = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(SR * 0.5), SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain(),
    now = ctx.currentTime;
  gain.gain.setValueAtTime(1.0, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.5);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.55);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9  GUN MESH  (3-D pistol attached to pitchObject)
// ═══════════════════════════════════════════════════════════════════════════════
function buildGunMesh() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x3a3a44,
    roughness: 0.25,
    metalness: 0.9,
    emissive: 0x1a1a22,
    emissiveIntensity: 0.8,
  });
  const grip = new THREE.MeshStandardMaterial({
    color: 0x4a2a12,
    roughness: 0.95,
    metalness: 0.0,
    emissive: 0x1a0e04,
    emissiveIntensity: 0.7,
  });

  // Dedicated gun illumination light — ensures the weapon is always visible
  const gunLight = new THREE.PointLight(0xffeedd, 0.6, 1.2);
  gunLight.position.set(0, 0.0, -0.15);
  g.add(gunLight);

  // Slide — upper receiver
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.068, 0.3), metal);
  slide.position.set(0, 0.02, -0.14);
  g.add(slide);

  // Barrel extension
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.036, 0.2),
    metal,
  );
  barrel.position.set(0, 0.022, -0.37);
  g.add(barrel);

  // Frame — lower receiver
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.064, 0.044, 0.22),
    metal,
  );
  frame.position.set(0, -0.02, -0.1);
  g.add(frame);

  // Grip / handle
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.155, 0.088),
    grip,
  );
  handle.position.set(0, -0.103, -0.016);
  handle.rotation.x = 0.18;
  g.add(handle);

  // Trigger guard
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.038, 0.07),
    metal,
  );
  guard.position.set(0, -0.048, -0.083);
  g.add(guard);

  // Make the gun always render on top (never clipped by walls)
  g.traverse((child) => {
    if (!child.isMesh) return;
    child.renderOrder = 999;
    child.material = child.material.clone();
    child.material.depthTest = false;
  });

  // Rest position: lower-right of the player's view
  g.position.set(0.22, -0.2, -0.38);
  return g;
}

const gunGroup = buildGunMesh();
pitchObject.add(gunGroup);

let gunSwayTimer = 0;
let gunKickTimer = 0; // countdown ms for recoil animation
let muzzleFlashTimer = 0; // countdown ms for muzzle flash

// ═══════════════════════════════════════════════════════════════════════════════
// §10  ZOMBIE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const ZOMBIE_SPEED = 0.028; // world units per frame at 60 fps
const ZOMBIE_DETECT_DIST = 22; // aggro range (units)
const ZOMBIE_ATTACK_DIST = 1.1; // game-over contact range
const ZOMBIE_MAX_HP = 3; // shots to kill
const MAX_ZOMBIES = 10;
const SPAWN_INTERVAL_MS = 12000; // ms between automatic new spawns

// Spawn positions — all far from player start (5, -3)
const SPAWN_POINTS = [
  [-15, -15],
  [-15, 15],
  [15, 15],
  [15, -15],
  [-10, 0],
  [10, 0],
  [0, 15],
  [0, -15],
  [-5, 10],
  [10, -8],
];

const zombies = [];
let zombieSpawnTimer = 0;

// Build a complete zombie mesh group with fresh materials per instance
function buildZombieMesh() {
  const g = new THREE.Group();
  // Fresh materials per zombie — so hit-flash only affects the one zombie
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2d4a22,
    roughness: 0.9,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x6a7a50,
    roughness: 0.9,
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // always glows red

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.82, 0.4), bodyMat);
  torso.position.y = 0.99;
  g.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), skinMat);
  head.position.y = 1.66;
  g.add(head);

  // Eyes — glowing red dots on the front face of the head
  [-0.12, 0.12].forEach((ex) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.02), eyeMat);
    eye.position.set(ex, 1.685, 0.252);
    g.add(eye);
  });

  // Arms — outstretched forward (classic zombie pose)
  [
    { x: -0.44, rz: 0.15 },
    { x: 0.44, rz: -0.15 },
  ].forEach(({ x, rz }) => {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.65, 0.22),
      bodyMat,
    );
    arm.position.set(x, 1.18, -0.14);
    arm.rotation.x = -0.6;
    arm.rotation.z = rz;
    g.add(arm);
  });

  // Legs
  [-0.19, 0.19].forEach((lx) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.8, 0.28), bodyMat);
    leg.position.set(lx, 0.4, 0);
    g.add(leg);
  });

  // Store materials on userData so hit-flash can modify only this zombie
  g.userData.bodyMat = bodyMat;
  g.userData.skinMat = skinMat;

  return g;
}

function spawnZombie(x, z) {
  if (zombies.length >= MAX_ZOMBIES) return;
  const mesh = buildZombieMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  zombies.push({
    mesh,
    hp: ZOMBIE_MAX_HP,
    dying: false,
    deathTimer: 0,
    walkTimer: Math.random() * Math.PI * 2,
    groanTimer: 1500 + Math.random() * 3000,
    detected: false,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderTimer: 0,
  });
}

// Spawn the first wave only after the game is explicitly started.
function spawnInitialWave() {
  if (zombies.length > 0) return;
  SPAWN_POINTS.slice(0, 4).forEach(([x, z]) => spawnZombie(x, z));
}

// Flash zombie white on hit, then restore colour
function hitZombie(zombie) {
  if (zombie.dying) return;
  zombie.hp--;

  const bm = zombie.mesh.userData.bodyMat;
  const sm = zombie.mesh.userData.skinMat;
  const origBody = bm.color.getHex();
  const origSkin = sm.color.getHex();
  bm.color.set(0xffffff);
  sm.color.set(0xffffff);
  setTimeout(() => {
    bm.color.setHex(origBody);
    sm.color.setHex(origSkin);
  }, 80);

  if (zombie.hp <= 0) killZombie(zombie);
}

function killZombie(zombie) {
  zombie.dying = true;
  zombie.deathTimer = 500; // ms for sink animation
  playZombieDeath();
  score++;
  updateHUD();
  // Also keep the jumpscare final-score span up to date
  const el = document.getElementById("scareFinalScore");
  if (el) el.textContent = score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §11  SHOOTING / RAYCASTER
// ═══════════════════════════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
const FIRE_COOLDOWN_MS = 300;

function fireGun() {
  if (!canFire || isReloading || gameOver || !isLocked) return;

  // Empty magazine
  if (ammo <= 0) {
    playEmptyClick();
    return;
  }

  ammo--;
  canFire = false;
  setTimeout(() => {
    canFire = true;
  }, FIRE_COOLDOWN_MS);

  playGunshot();
  updateHUD();
  syncAmmoToController();

  // Muzzle flash
  muzzleLight.intensity = 5.0;
  muzzleFlashTimer = 70;

  // Recoil kick
  gunKickTimer = 130;

  // Raycast from exact centre of screen (crosshair)
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Collect every mesh from living ghosts
  const ghostTargets = [];
  ghosts.forEach((g) => {
    if (g.state === "hunting") {
      g.mesh.traverse((child) => {
        if (child.isMesh) ghostTargets.push({ mesh: child, ghost: g });
      });
    }
  });

  const allShootable = ghostTargets.map((gt) => gt.mesh);
  const hits = raycaster.intersectObjects(allShootable);
  if (hits.length > 0) {
    const hitObj = hits[0].object;
    const gEntry = ghostTargets.find((gt) => gt.mesh === hitObj);
    if (gEntry) hitGhost(gEntry.ghost);
  }

  // Gunshot also spikes noise
  noiseLevel = Math.min(1, noiseLevel + 0.3);

  // Auto-reload on empty
  if (ammo === 0) startReload();
}

function startReload() {
  if (isReloading) return;
  isReloading = true;
  showWarning("RELOADING...");
  playReloadSound();
  setTimeout(() => {
    ammo = MAX_AMMO;
    isReloading = false;
    updateHUD();
    syncAmmoToController();
    if (warningEl) warningEl.classList.remove("active");
  }, 1500);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §12  HUD / DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const hudEl = document.getElementById("hud");
const ammoHudEl = document.getElementById("ammoHud");
const scoreValEl = document.getElementById("scoreVal");
const ammoValEl = document.getElementById("ammoVal");
const warningEl = document.getElementById("warning");
const crosshairEl = document.getElementById("crosshair");
const overlayEl = document.getElementById("overlay");
const enterBtnEl = document.getElementById("enterBtn");
const jumpscareEl = document.getElementById("jumpscare");
const victoryEl = document.getElementById("victory");

let warningTimer = null;

function showWarning(text) {
  if (!warningEl) return;
  warningEl.textContent = text;
  warningEl.classList.add("active");
  if (warningTimer) clearTimeout(warningTimer);
  warningTimer = setTimeout(() => warningEl.classList.remove("active"), 3000);
}

function updateHUD() {
  if (scoreValEl) scoreValEl.textContent = score;
  if (ammoValEl) {
    ammoValEl.textContent = ammo + " / " + MAX_AMMO;
    // Colour shift: yellow → red when low on ammo
    ammoValEl.style.color = ammo <= 3 ? "#ff3300" : "#ffcc00";
    ammoValEl.style.textShadow =
      "0 0 10px " + (ammo <= 3 ? "rgba(255,50,0,0.7)" : "rgba(255,200,0,0.6)");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §13  FOOTSTEP SYSTEM + NOISE LEVEL
// ═══════════════════════════════════════════════════════════════════════════════
let isMoving = false;
let isSprinting = false;
let footstepTimer = 0;
const FOOTSTEP_INTERVAL_WALK = 400; // ms
const FOOTSTEP_INTERVAL_SPRINT = 220; // ms — faster steps when sprinting

// Noise level: 0 = silent, 1 = max noise
let noiseLevel = 0;
let displayedNoiseLevel = 0; // smoothed for display
const NOISE_WALK = 0.35;
const NOISE_SPRINT = 0.85;
const NOISE_DECAY_RATE = 2.5; // per second — how fast noise fades when still
const NOISE_RISE_RATE = 4.0;  // per second — how fast noise rises

const noiseMeterEl = document.getElementById("noiseMeter");
const noiseFillEl = document.getElementById("noiseFill");
const noiseLabelEl = document.getElementById("noiseLabel");
const noiseIconEl = document.getElementById("noiseIcon");

function tickFootsteps(delta) {
  const dt = delta / 1000; // seconds

  if (!isMoving) {
    footstepTimer = 0;
    // Decay noise level when standing still
    noiseLevel = Math.max(0, noiseLevel - NOISE_DECAY_RATE * dt);
  } else {
    const targetNoise = isSprinting ? NOISE_SPRINT : NOISE_WALK;
    // Rise toward target noise
    if (noiseLevel < targetNoise) {
      noiseLevel = Math.min(targetNoise, noiseLevel + NOISE_RISE_RATE * dt);
    } else {
      noiseLevel = Math.max(targetNoise, noiseLevel - NOISE_DECAY_RATE * dt);
    }

    const interval = isSprinting ? FOOTSTEP_INTERVAL_SPRINT : FOOTSTEP_INTERVAL_WALK;
    footstepTimer += delta;
    if (footstepTimer >= interval) {
      footstepTimer -= interval;
      playFootstepSound();
    }
  }

  // Smooth the displayed value
  displayedNoiseLevel += (noiseLevel - displayedNoiseLevel) * Math.min(1, dt * 8);

  updateNoiseMeter();
}

function updateNoiseMeter() {
  if (!noiseFillEl || !noiseLabelEl) return;

  const pct = Math.round(displayedNoiseLevel * 100);
  noiseFillEl.style.width = pct + "%";

  // Color: green → yellow → orange → red based on level
  let color, label;
  if (displayedNoiseLevel < 0.01) {
    color = "#2a6e2a";
    label = "SILENT";
  } else if (displayedNoiseLevel < 0.25) {
    color = "#4a9e3a";
    label = "QUIET";
  } else if (displayedNoiseLevel < 0.5) {
    color = "#c8b800";
    label = "MODERATE";
  } else if (displayedNoiseLevel < 0.7) {
    color = "#e08a00";
    label = "LOUD";
  } else {
    color = "#dd2a00";
    label = "DANGER";
  }

  noiseFillEl.style.background = color;
  noiseFillEl.style.boxShadow = `0 0 8px ${color}, 0 0 2px ${color}`;
  noiseLabelEl.textContent = label;
  noiseLabelEl.style.color = color;

  // Pulse the icon when loud
  if (noiseIconEl) {
    noiseIconEl.style.opacity = displayedNoiseLevel < 0.01 ? "0.3" : "1";
    noiseIconEl.style.filter = displayedNoiseLevel > 0.6
      ? `drop-shadow(0 0 4px ${color})` : "none";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §14  PLAYER MOVEMENT + COLLISION
// ═══════════════════════════════════════════════════════════════════════════════
const MOVE_SPEED = 0.09;
const SPRINT_MULTIPLIER = 1.8;

function processMovement() {
  const moving = keys.w || keys.a || keys.s || keys.d;
  isMoving = moving;
  isSprinting = moving && keys.shift;
  if (!moving) return;

  const speed = isSprinting ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;

  const yaw = yawObject.rotation.y;
  const fwdX = -Math.sin(yaw),
    fwdZ = -Math.cos(yaw);
  const strX = Math.cos(yaw),
    strZ = -Math.sin(yaw);

  let dx = 0,
    dz = 0;
  if (keys.w) {
    dx += fwdX * speed;
    dz += fwdZ * speed;
  }
  if (keys.s) {
    dx -= fwdX * speed;
    dz -= fwdZ * speed;
  }
  if (keys.a) {
    dx -= strX * speed;
    dz -= strZ * speed;
  }
  if (keys.d) {
    dx += strX * speed;
    dz += strZ * speed;
  }

  const cx = yawObject.position.x,
    cz = yawObject.position.z;
  // Per-axis collision so player slides along walls instead of stopping dead
  const fullBlocked = collidesWithWalls(cx + dx, cz + dz);
  const xBlocked = collidesWithWalls(cx + dx, cz);
  const zBlocked = collidesWithWalls(cx, cz + dz);

  if (!fullBlocked) {
    yawObject.position.x += dx;
    yawObject.position.z += dz;
  } else if (!xBlocked) {
    yawObject.position.x += dx;
    // Sliding along wall — partial collision noise
    wallSlamNoise(0.4);
  } else if (!zBlocked) {
    yawObject.position.z += dz;
    // Sliding along wall — partial collision noise
    wallSlamNoise(0.4);
  } else {
    // Fully blocked — slamming directly into wall
    wallSlamNoise(1.0);
  }
}

// Wall slam noise burst — scales with impact severity and sprint state
const WALL_SLAM_COOLDOWN = 250; // ms between slam sounds
let lastWallSlamTime = 0;

function wallSlamNoise(severity) {
  const slamNoise = isSprinting ? 0.5 * severity : 0.3 * severity;
  noiseLevel = Math.min(1, noiseLevel + slamNoise);

  const now = performance.now();
  if (now - lastWallSlamTime > WALL_SLAM_COOLDOWN) {
    lastWallSlamTime = now;
    playWallSlam(severity);
  }
}

// Deep thud sound for wall impact
function playWallSlam(severity) {
  const ctx = getAudioContext(), SR = ctx.sampleRate;
  const duration = 0.12 + severity * 0.06;
  const buf = ctx.createBuffer(1, Math.floor(SR * duration), SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.025));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 150 + severity * 80;
  filt.Q.value = 1.0;
  const gain = ctx.createGain(), now = ctx.currentTime;
  const vol = isSprinting ? 0.5 * severity : 0.3 * severity;
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filt);
  filt.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + duration + 0.01);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §15  ZOMBIE AI  — called every frame with frame-delta in ms
// ═══════════════════════════════════════════════════════════════════════════════
function updateZombies(delta) {
  const px = yawObject.position.x;
  const pz = yawObject.position.z;

  for (let i = zombies.length - 1; i >= 0; i--) {
    const zomb = zombies[i];

    // ── Death animation: sink into floor over 500 ms, then remove ────────────
    if (zomb.dying) {
      zomb.deathTimer -= delta;
      const t = Math.max(0, zomb.deathTimer / 500);
      zomb.mesh.scale.set(1, t, 1);
      zomb.mesh.position.y = -(1 - t) * 0.6;
      if (zomb.deathTimer <= 0) {
        scene.remove(zomb.mesh);
        zombies.splice(i, 1);
      }
      continue;
    }

    const ddx = px - zomb.mesh.position.x;
    const ddz = pz - zomb.mesh.position.z;
    const dist = Math.sqrt(ddx * ddx + ddz * ddz);

    // ── Contact → game over ───────────────────────────────────────────────────
    if (dist < ZOMBIE_ATTACK_DIST) {
      triggerGameOver();
      return;
    }

    // ── Aggro detection ───────────────────────────────────────────────────────
    if (dist < ZOMBIE_DETECT_DIST) zomb.detected = true;

    // ── Groan when chasing ────────────────────────────────────────────────────
    if (zomb.detected) {
      zomb.groanTimer -= delta;
      if (zomb.groanTimer <= 0) {
        playZombieGroan();
        zomb.groanTimer = 3000 + Math.random() * 4000;
      }
    }

    zomb.walkTimer += delta * 0.004;

    if (zomb.detected) {
      // ── Chase mode ───────────────────────────────────────────────────────────
      const spd = ZOMBIE_SPEED * (delta / 16.67); // normalise to 60 fps
      const nx = (ddx / dist) * spd;
      const nz = (ddz / dist) * spd;
      const zx = zomb.mesh.position.x;
      const zz = zomb.mesh.position.z;

      // Same axis-sliding collision as the player, smaller radius
      if (!collidesWithWalls(zx + nx, zz + nz, 0.3)) {
        zomb.mesh.position.x += nx;
        zomb.mesh.position.z += nz;
      } else if (!collidesWithWalls(zx + nx, zz, 0.3)) {
        zomb.mesh.position.x += nx;
      } else if (!collidesWithWalls(zx, zz + nz, 0.3)) {
        zomb.mesh.position.z += nz;
      }

      // Always face the player
      zomb.mesh.rotation.y = Math.atan2(ddx, ddz);

      // Walking bob
      zomb.mesh.position.y = Math.abs(Math.sin(zomb.walkTimer)) * 0.07;
    } else {
      // ── Wander mode ──────────────────────────────────────────────────────────
      zomb.wanderTimer -= delta;
      if (zomb.wanderTimer <= 0) {
        zomb.wanderAngle += (Math.random() - 0.5) * 1.4;
        zomb.wanderTimer = 1500 + Math.random() * 2000;
      }
      const wx = Math.sin(zomb.wanderAngle) * 0.008;
      const wz = Math.cos(zomb.wanderAngle) * 0.008;
      const zx = zomb.mesh.position.x;
      const zz = zomb.mesh.position.z;

      if (!collidesWithWalls(zx + wx, zz + wz, 0.3)) {
        zomb.mesh.position.x += wx;
        zomb.mesh.position.z += wz;
        zomb.mesh.rotation.y = zomb.wanderAngle;
      } else {
        zomb.wanderAngle += Math.PI * 0.6; // turn away from wall
      }

      zomb.mesh.position.y = Math.abs(Math.sin(zomb.walkTimer * 0.5)) * 0.03;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §16  CAMERA SHAKE  (scales with proximity to nearest zombie)
// ═══════════════════════════════════════════════════════════════════════════════
function applyCameraShake() {
  let minDist = Infinity;
  for (const g of ghosts) {
    if (g.state !== "hunting") continue;
    const dx = yawObject.position.x - g.mesh.position.x;
    const dz = yawObject.position.z - g.mesh.position.z;
    minDist = Math.min(minDist, Math.sqrt(dx * dx + dz * dz));
  }
  if (minDist > 8) return;
  const mag = ((8 - minDist) / 8) * 2;
  pitchObject.rotation.x += (Math.random() * 2 - 1) * 0.002 * mag;
  yawObject.rotation.y += (Math.random() * 2 - 1) * 0.002 * mag;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §17  LIGHT FLICKER + TORCH FLICKER
// ═══════════════════════════════════════════════════════════════════════════════
function flickerLightsUpdate(delta) {
  // Static ember lights — subtle random flicker
  flickerLights.forEach((light, i) => {
    light.intensity = Math.max(
      0,
      flickerBaseIntensity[i] + (Math.random() * 2 - 1) * 0.04,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §18  GUN ANIMATION  (idle sway + walk bob + recoil kick + muzzle flash)
// ═══════════════════════════════════════════════════════════════════════════════
function updateGunAnimation(delta) {
  gunSwayTimer += delta * 0.003;

  const swayX = Math.sin(gunSwayTimer) * 0.003;
  const swayY = Math.cos(gunSwayTimer * 1.3) * 0.0025;
  const bobY = isMoving ? Math.sin(gunSwayTimer * 3.5) * 0.007 : 0;

  // Recoil: push gun back then return
  let kickZ = 0;
  if (gunKickTimer > 0) {
    gunKickTimer -= delta;
    kickZ = Math.sin((Math.max(0, gunKickTimer) / 130) * Math.PI) * 0.05;
  }

  // Muzzle flash decay
  if (muzzleFlashTimer > 0) {
    muzzleFlashTimer -= delta;
    muzzleLight.intensity = Math.max(0, (muzzleFlashTimer / 70) * 5.0);
    if (muzzleFlashTimer <= 0) muzzleLight.intensity = 0;
  }

  gunGroup.position.set(0.22 + swayX, -0.2 + swayY + bobY, -0.38 + kickZ);
}

function updateGhosts(delta) {
  if (ghosts.length === 0) return;

  const px = yawObject.position.x;
  const pz = yawObject.position.z;

  let allDead = true;

  ghosts.forEach((g) => {
    if (g.state === "dead") return;
    allDead = false;

    const gx = g.mesh.position.x;
    const gz = g.mesh.position.z;
    const ddx = px - gx;
    const ddz = pz - gz;
    const dist = Math.sqrt(ddx * ddx + ddz * ddz);

    // Bobbing float animation
    g.bobTimer += delta * 0.003;
    const floatY = 0.15 + Math.sin(g.bobTimer) * 0.12;
    g.mesh.position.y = floatY;

    // --- DYING: fade out and shrink ---
    if (g.state === "dying") {
      g.deathTimer -= delta;
      const t = Math.max(0, g.deathTimer / 1200);
      g.mesh.userData.ghostMat.opacity = 0.55 * t;
      g.mesh.userData.eyeMat.opacity = 0.9 * t;
      g.mesh.userData.ghostLight.intensity = 1.5 * t;
      g.mesh.scale.set(1 + (1 - t) * 0.3, t, 1 + (1 - t) * 0.3);
      if (g.deathTimer <= 0) {
        g.state = "dead";
        scene.remove(g.mesh);
      }
      return;
    }

    // --- HUNTING ---
    // Contact → game over
    if (dist < GHOST_ATTACK_DIST) {
      triggerGameOver();
      return;
    }

    // Proximity-based ghost sound
    g.groanTimer -= delta;
    if (g.groanTimer <= 0) {
      const volume = Math.max(0.05, Math.min(1, (15 - dist) / 15));
      playGhostGroan(volume);
      // Closer = more frequent groans
      g.groanTimer =
        dist < 5 ? 800 + Math.random() * 1200 : 2000 + Math.random() * 3000;
    }

    // Ghost light pulses with proximity
    g.mesh.userData.ghostLight.intensity =
      0.5 + Math.max(0, (12 - dist) / 12) * 2.0;

    // Movement: chase player with wall avoidance
    const spd = GHOST_SPEED * (delta / 16.67);
    const nx = (ddx / dist) * spd;
    const nz = (ddz / dist) * spd;

    if (!collidesWithWalls(gx + nx, gz + nz, 0.35)) {
      g.mesh.position.x += nx;
      g.mesh.position.z += nz;
    } else if (!collidesWithWalls(gx + nx, gz, 0.35)) {
      g.mesh.position.x += nx;
    } else if (!collidesWithWalls(gx, gz + nz, 0.35)) {
      g.mesh.position.z += nz;
    } else {
      // Try to go around — pick a random angle if stuck
      g.wanderTimer -= delta;
      if (g.wanderTimer <= 0) {
        g.wanderAngle = Math.random() * Math.PI * 2;
        g.wanderTimer = 300 + Math.random() * 400;
      }
      const wx = Math.sin(g.wanderAngle) * spd;
      const wz = Math.cos(g.wanderAngle) * spd;
      if (!collidesWithWalls(gx + wx, gz + wz, 0.35)) {
        g.mesh.position.x += wx;
        g.mesh.position.z += wz;
      }
    }

    // Face the player
    g.mesh.rotation.y = Math.atan2(ddx, ddz);
  });

  if (allDead && gameStarted && !victory) {
    triggerVictory();
  }
}

function triggerVictory() {
  if (gameOver || victory) return;
  victory = true;
  if (document.exitPointerLock) document.exitPointerLock();
  isLocked = false;

  if (victoryEl) victoryEl.classList.add("visible");
  syncStateToController("victory");
}

function nextLevel() {
  if (!victory) return;
  victory = false;
  if (victoryEl) victoryEl.classList.remove("visible");

  currentLevel++;
  // Reset player position for fresh start
  yawObject.position.set(5, 1.7, -3);
  pitchObject.rotation.set(0, 0, 0);
  yawObject.rotation.set(0, 0, 0);

  // Clear ghosts and spawn more
  ghosts.forEach((g) => scene.remove(g.mesh));
  ghosts = [];
  spawnGhosts(currentLevel);

  requestLock();
  showWarning(`LEVEL ${currentLevel}: ${currentLevel} GHOSTS ACTIVE`);
  syncStateToController("playing");
}

if (document.getElementById("nextLevelBtn")) {
  document.getElementById("nextLevelBtn").addEventListener("click", nextLevel);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §19  GHOST SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const GHOST_HP = 2;
const GHOST_SPEED = 0.022;
const GHOST_ATTACK_DIST = 1.3;
const GHOST_WANDER_SPEED = 0.012;

let currentLevel = 1;
let ghosts = []; // Array of ghost objects

function buildGhostMesh() {
  if (ghostModel) {
    const g = ghostModel.clone();

    // Ghost light for proximity effect
    const ghostLight = new THREE.PointLight(0x33ffaa, 0, 6);
    ghostLight.position.set(0, 1.4, 0);
    g.add(ghostLight);

    // Find materials for the updateGhosts loop to control
    let mainMat = null;
    g.traverse((node) => {
      if (node.isMesh && !mainMat) {
        mainMat = node.material;
      }
    });

    // Mock eyeMat if the model doesn't have separate eyes we can easily target
    const eyeMat = { opacity: 0.9 };

    g.userData.ghostMat = mainMat || new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8 });
    g.userData.eyeMat = eyeMat;
    g.userData.ghostLight = ghostLight;

    return g;
  }

  // FALLBACK: Simple cube if GLB isn't loaded yet (so user knows it's working)
  console.warn("Ghost model not loaded yet, using placeholder");
  const g = new THREE.Group();
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.8, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xff0000, wireframe: true })
  );
  placeholder.position.y = 0.9;
  g.add(placeholder);
  
  g.userData.ghostMat = placeholder.material;
  g.userData.eyeMat = { opacity: 1 };
  g.userData.ghostLight = new THREE.PointLight(0xff0000, 0, 4);
  
  return g;
}

function spawnGhosts(count) {
  for (let i = 0; i < count; i++) {
    const mesh = buildGhostMesh();
    
    // Attempt to spawn in a non-colliding spot
    let spawned = false;
    let attempts = 0;
    while (!spawned && attempts < 30) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 1.5);
      const dist = 12 + Math.random() * 8;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      
      if (!collidesWithWalls(tx, tz, 0.5)) {
        mesh.position.set(tx, 0, tz);
        spawned = true;
      }
      attempts++;
    }
    
    // Fallback if all random spots are blocked
    if (!spawned) {
      mesh.position.set(5 + Math.random() * 5, 0, 5 + Math.random() * 5);
    }
    
    scene.add(mesh);

    ghosts.push({
      mesh,
      hp: GHOST_HP,
      state: "hunting", // Start hunting immediately
      wanderAngle: Math.random() * Math.PI * 2,
      wanderTimer: 0,
      groanTimer: 2000 + Math.random() * 3000,
      bobTimer: Math.random() * 1000,
      flashTimer: 0,
      deathTimer: 0,
    });

    // Full hunting visuals immediately
    mesh.userData.eyeMat.opacity = 0.9;
    mesh.userData.ghostLight.intensity = 1.5;
    mesh.userData.ghostMat.opacity = 0.55;
  }
}


function hitGhost(g) {
  if (!g || g.state === "dying" || g.state === "dead") return;
  g.hp--;
  g.flashTimer = 120;

  // Flash white on hit
  const mat = g.mesh.userData.ghostMat;
  const origColor = mat.emissive.getHex();
  mat.emissive.set(0xffffff);
  mat.emissiveIntensity = 2.0;
  setTimeout(() => {
    mat.emissive.setHex(origColor);
    mat.emissiveIntensity = 0.6;
  }, 100);

  if (g.hp <= 0) {
    g.state = "dying";
    g.deathTimer = 1200;
    playGhostDeath();
    score++;
    updateHUD();
  }
}

function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  playJumpscare();
  if (document.exitPointerLock) document.exitPointerLock();
  isLocked = false;

  // Update high score
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem("nightfall_best_score", bestScore.toString());
  }

  const bestEl = document.getElementById("bestScore");
  if (bestEl) bestEl.textContent = bestScore;

  if (jumpscareEl) jumpscareEl.classList.add("visible");
  syncStateToController("gameover");
}

function resetGame() {
  // Reset game state
  gameOver = false;
  victory = false;
  score = 0;
  ammo = MAX_AMMO;
  currentLevel = 1;
  isReloading = false;
  canFire = true;
  noiseLevel = 0;
  displayedNoiseLevel = 0;

  // Clear ghosts
  ghosts.forEach((g) => scene.remove(g.mesh));
  ghosts.length = 0;

  // Reset player position
  yawObject.position.set(5, 1.7, -3);
  pitchObject.rotation.set(0, 0, 0);
  yawObject.rotation.set(0, 0, 0);

  // Update HUD
  updateHUD();
  syncAmmoToController();

  // Hide overlays
  if (jumpscareEl) jumpscareEl.classList.remove("visible");
  if (victoryEl) victoryEl.classList.remove("visible");
  if (warningEl) warningEl.classList.remove("active");

  // Spawn initial enemies
  spawnGhosts(currentLevel);

  showWarning("GAME RESTARTED");
  requestLock();
  syncStateToController("playing");
}

if (document.getElementById("restartBtn")) {
  document.getElementById("restartBtn").addEventListener("click", resetGame);
}


// ═══════════════════════════════════════════════════════════════════════════════
// §20  GAME START
// ═══════════════════════════════════════════════════════════════════════════════
function startGame() {
  if (gameOver) return;
  if (gameStarted) return;

  if (!isModelLoaded) {
    startRequested = true;
    if (enterBtnEl) {
      enterBtnEl.textContent = "LOADING MODEL...";
      enterBtnEl.style.opacity = "0.6";
      enterBtnEl.style.pointerEvents = "none";
    }
    return;
  }

  roomEntered = true;
  gameStarted = true;
  getAudioContext();
  startAmbientDrone();

  if (overlayEl) overlayEl.style.display = "none";
  if (hudEl) hudEl.classList.add("active");
  if (ammoHudEl) ammoHudEl.classList.add("active");
  if (crosshairEl) crosshairEl.classList.add("active");
  if (noiseMeterEl) noiseMeterEl.classList.add("active");

  updateHUD();
  requestLock();

  spawnGhosts(currentLevel);

  showWarning("THE HUNT BEGINS...");
  syncStateToController("playing");
}

if (enterBtnEl) enterBtnEl.addEventListener("click", startGame);

// Re-acquire pointer lock if player accidentally presses Escape mid-game
document.addEventListener("click", () => {
  if (overlayEl && overlayEl.style.display !== "none") return;
  if (gameOver) return;
  if (!isLocked) {
    getAudioContext();
    startAmbientDrone();
    requestLock();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// §22  PHONE CONTROLLER  (WebSocket client)
//
// Connects to the local relay server (server.js).
// Receives "fire" and "reload" messages forwarded from the iPhone controller.
// Gracefully does nothing when the server is not running (file:// mode).
// ═══════════════════════════════════════════════════════════════════════════════

const qrPanelEl = document.getElementById("qrPanel");
const qrCloseEl = document.getElementById("qrClose");
const qrContainerEl = document.getElementById("qrContainer");
const qrUrlEl = document.getElementById("qrUrl");
const phoneBtnEl = document.getElementById("phoneBtn");
const ctrlStatusDotEl = document.getElementById("ctrlStatusDot");

let controllerWS = null;
let controllerConnected = false;
let qrGenerated = false;

// Build the QR code image via Google Charts API (no extra library needed)
function showQRCode(url) {
  if (!qrContainerEl || !qrUrlEl) return;

  if (!qrGenerated) {
    qrGenerated = true;
    const encoded = encodeURIComponent(url);
    const img = document.createElement("img");
    img.src =
      "https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=ffffff&bgcolor=0a0a0f&data=" +
      encoded;
    img.alt = "QR code";
    img.style.cssText =
      "width:220px;height:220px;border:2px solid rgba(200,0,10,0.5);border-radius:8px;";
    qrContainerEl.innerHTML = "";
    qrContainerEl.appendChild(img);

    // Also populate startup QR in the overlay
    const startupQR = document.getElementById("startupQR");
    if (startupQR) {
      startupQR.innerHTML = "";
      startupQR.appendChild(img.cloneNode(true));
    }
  }

  if (qrUrlEl) qrUrlEl.textContent = url;
}

// Update the small status dot next to the phone button
function setControllerStatus(on) {
  controllerConnected = on;
  if (ctrlStatusDotEl) {
    ctrlStatusDotEl.style.background = on ? "#00e676" : "#555";
    ctrlStatusDotEl.style.boxShadow = on ? "0 0 6px #00e676" : "none";
  }
}

// Broadcast current ammo to all connected controllers so their dots update
function syncAmmoToController() {
  if (controllerWS && controllerWS.readyState === WebSocket.OPEN) {
    controllerWS.send(
      JSON.stringify({ type: "ammoSync", ammo, maxAmmo: MAX_AMMO }),
    );
  }
}

function syncStateToController(state) {
  if (controllerWS && controllerWS.readyState === WebSocket.OPEN) {
    controllerWS.send(JSON.stringify({ type: "stateUpdate", state }));
  }
}

function connectToServer() {
  // Only attempt when the page is served via HTTP (not file://)
  if (window.location.protocol === "file:") return;

  const wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
  const wsUrl = wsProtocol + window.location.host;

  try {
    controllerWS = new WebSocket(wsUrl);
  } catch (e) {
    return; // WebSocket not available
  }

  controllerWS.onopen = () => {
    // Identify ourselves as the game client
    controllerWS.send(JSON.stringify({ type: "register", role: "game" }));
    
    // Sync initial status immediately
    setControllerStatus(true);
    syncAmmoToController();
    syncStateToController(gameStarted ? "playing" : "waiting");
  };

  controllerWS.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    // Server tells us our own IP so we can build the controller URL
    if (msg.type === "serverInfo") {
      // Build controller URL from current origin first (preserves HTTPS secure context),
      // with server-provided IP/port fallback.
      const originBasedControllerUrl = window.location.origin + "/controller";
      const fallbackControllerUrl =
        "http://" + msg.ip + ":" + msg.port + "/controller";
      const controllerUrl =
        window.location.protocol === "https:"
          ? originBasedControllerUrl
          : fallbackControllerUrl;
      showQRCode(controllerUrl);
      // Show the phone button now that the server is confirmed running
      if (phoneBtnEl) phoneBtnEl.style.display = "flex";
    }

    // A phone connected / disconnected
    if (msg.type === "controllerConnected") {
      setControllerStatus(true);
      showWarning("📱 Controller connected!");
      syncAmmoToController();

      // Toggle startup UI
      const startupQR = document.getElementById("startupQRContainer");
      const enterBtn = document.getElementById("enterBtn");
      if (startupQR) startupQR.style.display = "none";
      if (enterBtn) enterBtn.style.display = "block";
    }
    if (msg.type === "controllerDisconnected") {
      const remaining = msg.count || 0;
      setControllerStatus(remaining > 0);
      
      if (remaining === 0) {
        const startupQR = document.getElementById("startupQRContainer");
        const enterBtn = document.getElementById("enterBtn");
        if (startupQR) startupQR.style.display = "flex";
        if (enterBtn) enterBtn.style.display = "none";
      }
    }

    // ── Actions forwarded from the iPhone ────────────────────────────────
    if (msg.type === "start") {
      if (gameOver) {
        resetGame();
      } else if (victory) {
        nextLevel();
      } else if (!gameStarted) {
        startGame();
      }
    }
    if (msg.type === "fire") fireGun();
    if (msg.type === "reload") startReload();
    if (msg.type === "move") {
      if (msg.direction === "w") keys.w = true;
      if (msg.direction === "a") keys.a = true;
      if (msg.direction === "s") keys.s = true;
      if (msg.direction === "d") keys.d = true;
    }
    if (msg.type === "stop") {
      if (msg.direction === "w") keys.w = false;
      if (msg.direction === "a") keys.a = false;
      if (msg.direction === "s") keys.s = false;
      if (msg.direction === "d") keys.d = false;
    }

    // iPhone camera-look stream (DeviceOrientation-derived deltas)
    if (msg.type === "look") {
      if (typeof msg.yawDelta === "number" && Number.isFinite(msg.yawDelta)) {
        lookDeltaYawPhone += msg.yawDelta * LOOK_SENS_PHONE;
      }
      // Phone up/down look intentionally ignored: camera moves sideways only.
      phoneLookLastTs = performance.now();
      phoneLookWeight = 1;
    }

    // Optional controller calibrate action: reset accumulated phone-look deltas.
    // This prevents stale orientation drift from carrying over after recalibration.
    if (msg.type === "calibrate") {
      lookDeltaYawPhone = 0;
      phoneLookLastTs = performance.now();
      phoneLookWeight = 0;
      showWarning("Controller recalibrated");
    }
  };

  controllerWS.onclose = () => {
    setControllerStatus(false);
    // Retry after a delay
    setTimeout(connectToServer, 3000);
  };

  controllerWS.onerror = () => {
    // onclose fires right after — reconnect logic lives there
  };
}

// QR panel open / close
if (phoneBtnEl) {
  phoneBtnEl.addEventListener("click", () => {
    if (qrPanelEl) qrPanelEl.classList.toggle("visible");
  });
}
if (qrCloseEl) {
  qrCloseEl.addEventListener("click", () => {
    if (qrPanelEl) qrPanelEl.classList.remove("visible");
  });
}

// Kick off the WebSocket connection attempt
connectToServer();

// ═══════════════════════════════════════════════════════════════════════════════
// §23  MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min(now - lastTime, 100); // cap delta to avoid spiral-of-death
  lastTime = now;

  if (!gameOver) {
    // Blend camera look from mouse + iPhone stream each frame
    const sincePhone = now - phoneLookLastTs;
    if (sincePhone > 250) {
      phoneLookWeight = Math.max(0, phoneLookWeight - 0.08);
    }

    // Full mouse sensitivity always preserved
    yawObject.rotation.y += lookDeltaYawMouse;
    pitchObject.rotation.x = Math.max(
      -DEG85,
      Math.min(DEG85, pitchObject.rotation.x + lookDeltaPitchMouse),
    );

    // Phone stream is additive on yaw only (sideways camera movement).
    yawObject.rotation.y += lookDeltaYawPhone * phoneLookWeight;

    // consume frame deltas
    lookDeltaYawMouse = 0;
    lookDeltaPitchMouse = 0;
    lookDeltaYawPhone = 0;

    // Empty room phase (entered but not started): movement + gun animation only.
    if (roomEntered && !gameStarted) {
      if (isLocked) {
        processMovement();
        tickFootsteps(delta);
      } else {
        isMoving = false;
      }
      flickerLightsUpdate(delta);
      updateGunAnimation(delta);
    }

    // Full gameplay phase after Start Game command.
    if (gameStarted) {
      if (isLocked) {
        processMovement();
        tickFootsteps(delta);
      } else {
        isMoving = false;
      }

      updateGhosts(delta);
      applyCameraShake();
      flickerLightsUpdate(delta);
      updateGunAnimation(delta);
    }

    updateComet(delta);
  }

  renderer.render(scene, camera);
}

animate();
