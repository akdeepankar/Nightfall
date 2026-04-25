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
let ammo = 10;
const MAX_AMMO = 10;
let isReloading = false;
let canFire = true;

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
scene.background = new THREE.Color(0x0a0a0f);
scene.fog = new THREE.FogExp2(0x0a0a0f, 0.022);

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
const keys = { w: false, a: false, s: false, d: false };

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyW" || e.code === "ArrowUp") keys.w = true;
  if (e.code === "KeyA" || e.code === "ArrowLeft") keys.a = true;
  if (e.code === "KeyS" || e.code === "ArrowDown") keys.s = true;
  if (e.code === "KeyD" || e.code === "ArrowRight") keys.d = true;
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
});

// Left mouse button → fire
document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && isLocked && !gameOver) fireGun();
});

// ═══════════════════════════════════════════════════════════════════════════════
// §5  LIGHTING
// ═══════════════════════════════════════════════════════════════════════════════

// Ambient — dim blue-gray so walls are always readable
scene.add(new THREE.AmbientLight(0x303040, 2.5));

// Player lantern — warm light that follows the camera
const lantern = new THREE.PointLight(0xffd580, 2.2, 12);
lantern.position.set(0, -0.15, -0.4);
pitchObject.add(lantern);

// Static scene lights: eerie red/orange deep in the maze
const staticLightDefs = [
  { color: 0xff2200, intensity: 3.5, range: 20, x: -8, z: -8, shadow: true },
  { color: 0xff6600, intensity: 3.0, range: 18, x: 10, z: 8, shadow: true },
  { color: 0xff4400, intensity: 1.8, range: 10, x: -5, z: 5, shadow: false },
  { color: 0xff4400, intensity: 1.8, range: 10, x: 7, z: -5, shadow: false },
  { color: 0xff4400, intensity: 1.8, range: 10, x: -12, z: 2, shadow: false },
  { color: 0xff4400, intensity: 1.8, range: 10, x: 3, z: 12, shadow: false },
  { color: 0xff4400, intensity: 1.8, range: 10, x: -3, z: -13, shadow: false },
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
  color: 0x4a4a5a,
  roughness: 1.0,
});
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x2a2a35,
  roughness: 1.0,
});
const ceilMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a22,
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
    color: 0x1c1c1c,
    roughness: 0.25,
    metalness: 0.9,
  });
  const grip = new THREE.MeshStandardMaterial({
    color: 0x2e1a0a,
    roughness: 0.95,
    metalness: 0.0,
  });

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

  // Collect every mesh from living zombies, map back to their zombie object
  const targets = [];
  zombies.forEach((zomb) => {
    if (zomb.dying) return;
    zomb.mesh.traverse((child) => {
      if (child.isMesh) targets.push({ mesh: child, zombie: zomb });
    });
  });

  const hits = raycaster.intersectObjects(targets.map((t) => t.mesh));
  if (hits.length > 0) {
    const entry = targets.find((t) => t.mesh === hits[0].object);
    if (entry) hitZombie(entry.zombie);
  }

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
// §13  FOOTSTEP SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
let isMoving = false;
let footstepTimer = 0;
const FOOTSTEP_INTERVAL = 400; // ms

function tickFootsteps(delta) {
  if (!isMoving) {
    footstepTimer = 0;
    return;
  }
  footstepTimer += delta;
  if (footstepTimer >= FOOTSTEP_INTERVAL) {
    footstepTimer -= FOOTSTEP_INTERVAL;
    playFootstepSound();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §14  PLAYER MOVEMENT + COLLISION
// ═══════════════════════════════════════════════════════════════════════════════
const MOVE_SPEED = 0.09;

function processMovement() {
  const moving = keys.w || keys.a || keys.s || keys.d;
  isMoving = moving;
  if (!moving) return;

  const yaw = yawObject.rotation.y;
  const fwdX = -Math.sin(yaw),
    fwdZ = -Math.cos(yaw);
  const strX = Math.cos(yaw),
    strZ = -Math.sin(yaw);

  let dx = 0,
    dz = 0;
  if (keys.w) {
    dx += fwdX * MOVE_SPEED;
    dz += fwdZ * MOVE_SPEED;
  }
  if (keys.s) {
    dx -= fwdX * MOVE_SPEED;
    dz -= fwdZ * MOVE_SPEED;
  }
  if (keys.a) {
    dx -= strX * MOVE_SPEED;
    dz -= strZ * MOVE_SPEED;
  }
  if (keys.d) {
    dx += strX * MOVE_SPEED;
    dz += strZ * MOVE_SPEED;
  }

  const cx = yawObject.position.x,
    cz = yawObject.position.z;
  // Per-axis collision so player slides along walls instead of stopping dead
  if (!collidesWithWalls(cx + dx, cz + dz)) {
    yawObject.position.x += dx;
    yawObject.position.z += dz;
  } else if (!collidesWithWalls(cx + dx, cz)) {
    yawObject.position.x += dx;
  } else if (!collidesWithWalls(cx, cz + dz)) {
    yawObject.position.z += dz;
  }
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

  // ── Periodic new-zombie spawn ─────────────────────────────────────────────
  zombieSpawnTimer += delta;
  if (zombieSpawnTimer >= SPAWN_INTERVAL_MS) {
    zombieSpawnTimer = 0;
    const pt = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    spawnZombie(pt[0], pt[1]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §16  CAMERA SHAKE  (scales with proximity to nearest zombie)
// ═══════════════════════════════════════════════════════════════════════════════
function applyCameraShake() {
  let minDist = Infinity;
  for (const zomb of zombies) {
    if (zomb.dying) continue;
    const dx = yawObject.position.x - zomb.mesh.position.x;
    const dz = yawObject.position.z - zomb.mesh.position.z;
    minDist = Math.min(minDist, Math.sqrt(dx * dx + dz * dz));
  }
  if (minDist > 8) return;
  const mag = ((8 - minDist) / 8) * 2;
  pitchObject.rotation.x += (Math.random() * 2 - 1) * 0.002 * mag;
  yawObject.rotation.y += (Math.random() * 2 - 1) * 0.002 * mag;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §17  LIGHT FLICKER
// ═══════════════════════════════════════════════════════════════════════════════
function flickerLightsUpdate() {
  flickerLights.forEach((light, i) => {
    light.intensity = Math.max(
      0,
      flickerBaseIntensity[i] + (Math.random() * 2 - 1) * 0.08,
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

// ═══════════════════════════════════════════════════════════════════════════════
// §19  GAME OVER
// ═══════════════════════════════════════════════════════════════════════════════
function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  playJumpscare();
  if (document.exitPointerLock) document.exitPointerLock();
  isLocked = false;
  const el = document.getElementById("scareFinalScore");
  if (el) el.textContent = score;
  if (jumpscareEl) jumpscareEl.classList.add("visible");
}

// ═══════════════════════════════════════════════════════════════════════════════
// §20  GAME START
// ═══════════════════════════════════════════════════════════════════════════════
function startGame() {
  if (gameOver) return;

  // First call enters empty room only.
  if (!roomEntered) {
    roomEntered = true;
    getAudioContext();
    startAmbientDrone();

    if (overlayEl) overlayEl.style.display = "none";
    if (hudEl) hudEl.classList.add("active");
    if (ammoHudEl) ammoHudEl.classList.add("active");
    if (crosshairEl) crosshairEl.classList.add("active");

    updateHUD();
    requestLock();
    showWarning("Empty room loaded. Press Start Game on controller to begin.");
    return;
  }

  // Second call (controller Start command) begins enemies.
  if (gameStarted) return;
  gameStarted = true;
  spawnInitialWave();
  showWarning("Game started. Enemies are coming...");
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
    }
    if (msg.type === "controllerDisconnected") {
      setControllerStatus(msg.count > 0);
    }

    // ── Actions forwarded from the iPhone ────────────────────────────────
    if (msg.type === "start") {
      // If room isn't entered yet, first start opens empty room.
      // If already entered, second start begins enemy gameplay.
      startGame();
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

    // iPhone absolute orientation for accurate, lag-free camera control
    if (msg.type === "orientation") {
      if (typeof msg.yaw === "number" && Number.isFinite(msg.yaw)) {
        yawObject.rotation.y = msg.yaw;
      }
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
      flickerLightsUpdate();
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

      updateZombies(delta);
      applyCameraShake();
      flickerLightsUpdate();
      updateGunAnimation(delta);
    }
  }

  renderer.render(scene, camera);
}

animate();
