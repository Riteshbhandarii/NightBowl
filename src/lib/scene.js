/* ============================================================
   nightbowl — the ramen stall scene (three.js, no globals)

   Everything here is drawn from primitives except the cook:
   if /models/chef.glb exists it is loaded and animated, otherwise
   a hand-built stand-in is used so the scene always works.

   initScene(canvas, onHotspot) -> { setBookOpen, dispose }
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function initScene(canvas, onHotspot, opts = {}) {
  const CHATTER = opts.chatter || { cook: [], diner: [] };
  const LABELS = {
    siteName: 'nightbowl',
    siteInitial: 'N',
    mainSignLine: 'OPEN LATE  ·  RAMEN',
    menuSignTitle: 'MENU',
    menuSignFooter: 'tap to open the menu',
    logSignTitle: 'KITCHEN LOG',
    logSignItems: [],
    logSignFooter: 'fresh batches inside',
    specialsHotspot: 'Specials',
    seatHotspot: 'Take a seat',
    seatPrompt: 'take a seat',
    seatAria: 'Take the empty seat at the counter',
    youLabel: 'you',
    navigation: { menu: 'Menu', guide: 'The Guide', log: 'Kitchen Log', bill: 'The Bill' },
    ...(opts.labels || {}),
  };
  const MENU_ITEMS = Array.isArray(opts.menuItems) ? opts.menuItems.slice(0, 8) : [];
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Under ?nbtest=1 every draw from the scene's own generator comes from a fixed
  // sequence, so a pose sampled on one machine is the pose sampled on another.
  // Ordinary visits keep real randomness: this is only about making the audit
  // and the CI assertions reproducible.
  const TESTING = /[?&]nbtest=1/.test(window.location.search);
  let auditSeed = 0x2f6e2b1 >>> 0;
  function random() {
    if (!TESTING) return Math.random();
    auditSeed = (Math.imul(auditSeed, 1664525) + 1013904223) >>> 0;
    return auditSeed / 0x100000000;
  }
  let bookOpen = false;
  let raf = 0;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  scene.background = textTexture((g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0c1230');
    grd.addColorStop(0.48, '#241d3d');
    grd.addColorStop(0.8, '#3f2438');
    grd.addColorStop(1, '#552c35');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,240,220,0.5)';
    for (let i = 0; i < 46; i++) {
      g.globalAlpha = 0.15 + random() * 0.5;
      g.fillRect(random() * w, random() * h * 0.46, 1.5, 1.5);
    }
    g.globalAlpha = 1;
  }, 16, 512);
  scene.fog = new THREE.Fog(0x201a30, 10, 36);

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  // pin audit scratch objects; kept out of the render path
  const _pinV = new THREE.Vector3();
  const _pinCorner = new THREE.Vector3();
  const _pinBox = new THREE.Box3();
  const _frameTarget = new THREE.Vector3();
  const _visBox = new THREE.Box3();
  // World-space bounds of what is actually drawn under `root`. THREE's
  // Box3.setFromObject includes children with visible === false, which for a
  // character means whatever they are not currently holding.
  function visibleBox(root, out) {
    out.makeEmpty();
    if (!root || root.visible === false) return out;
    root.updateWorldMatrix(true, true);
    const walk = (n) => {
      if (n.visible === false) return;
      if (n.isMesh && n.geometry) {
        if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
        if (n.isInstancedMesh && !n.boundingBox) n.computeBoundingBox();
        _visBox.copy(n.isInstancedMesh ? n.boundingBox : n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
        out.union(_visBox);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
  }
  const clock = new THREE.Clock();
  let auditSkipRender = false;

  const hotspots = [];
  const steamGroups = [];
  const ramenBowls = [];
  let ramenAssetCache = null;
  const _emptyFoodMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let steamTexture = null;
  const lanternMats = [];
  const lanterns = [];
  const norenFlaps = [];
  const diners = [];
  const walkers = [];
  const birds = [];
  const streetTrees = [];
  let activeTurnover = null;
  const DINER_SPECS = [
    { x: -1.92, facing: -0.2, hair: 0x2a1c12, shirt: 0x6b4a2f, scale: 1.0, build: 1.08, headScale: 0.97 },
    { x: -1.06, facing: 0.16, hair: 0x14100c, shirt: 0x394a5e, scale: 0.92, build: 0.94, headScale: 1.03 },
    { x: 1.78, facing: 0.24, hair: 0x3a2a1a, shirt: 0x5a5560, scale: 0.97, build: 1.0, headScale: 1.0 },
  ];
  const CUSTOMER_PALETTE = [
    { shirt: 0x3f5568, hair: 0x17120e },
    { shirt: 0x704839, hair: 0x302015 },
    { shirt: 0x4f6044, hair: 0x191513 },
    { shirt: 0x59456b, hair: 0x3a2417 },
    { shirt: 0x665b3f, hair: 0x16110e },
  ];
  // the one stool that is never taken, and the ring that advertises it
  const SEAT = { x: 0.1, z: 1.52 };
  const CUSTOMER_Z = 1.52;
  const TURNOVER_WALK = { depthSeconds: 2.4, lateralSeconds: 4 };
  const WALK_STRIDE = 0.56;
  // Top face of a stool seat. buildStool and the seated pose both read this, so
  // the two cannot drift apart.
  const SEAT_TOP_Y = 0.69;
  const STOOL_STYLES = [
    { height: -0.01, rotation: -0.055, color: 0xa83f38 },
    { height: 0.012, rotation: 0.035, color: 0xb4473e },
    { height: -0.004, rotation: 0.07, color: 0x9e3b35 },
    { height: 0, rotation: -0.025, color: 0xad433a },
  ];
  // Physical action targets start on the object they name, travel through
  // world space, then land in the character's torso frame used by reachArm.
  // The small offsets below describe grip/posture; they do not duplicate the
  // bowl, face, pot or counter placement.
  const _ikWorld = new THREE.Vector3();
  const _ikBowl = new THREE.Vector3(), _ikMouth = new THREE.Vector3();
  const _ikGrip = new THREE.Vector3(), _ikCounter = new THREE.Vector3();
  const _ikPot = new THREE.Vector3(), _ikFreeHand = new THREE.Vector3();
  const _potStationWorld = new THREE.Vector3(), _guideStationWorld = new THREE.Vector3();
  const BOWL_BITE_POINT = new THREE.Vector3(0, 0.24, -0.16);
  const MOUTH_POINT = new THREE.Vector3(0, -0.03, 0);
  const CUP_DRINK_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, Math.PI, 0));
  const POT_BROTH_POINT = new THREE.Vector3(0, 0.575, 0);
  // The bright left end is the working station; the right end stays quieter.
  const WORK_POT_X = -2.52;
  const COOK_HOME_X = WORK_POT_X + 0.58;
  const CHOPSTICK_GRIP_AT_BOWL = new THREE.Vector3(0.27, 0.12, 0.15);
  const CHOPSTICK_GRIP_AT_MOUTH = new THREE.Vector3(0.24, 0, 0.13);
  const POT_STIR_GRIP_OFFSET = new THREE.Vector3(0, 0.14, -0.23);
  const POT_BRACE_OFFSET = new THREE.Vector3(0, 0.14, -0.10);
  const LAP_HAND_POINT = new THREE.Vector3(0, 0.12, 0.08);
  // During service the carried bowl is positioned from the two hands, so this
  // is intentionally a body-relative carry posture rather than an object reach.
  const SERVICE_CARRY_HAND = new THREE.Vector3(0, 0.58, 0.48);
  let seatGlowMat = null;
  let seatHitArea = null;
  let you = null;          // the figure that takes the stool once you sit
  let youMats = [];        // their materials, so they can fade in
  let youReveal = 0;
  let youPin = null;       // the small "you" tag over their head
  // intro state: 'street' = first person on the pavement, 'sitting' = the walk-in
  // and sit move, 'seated' = the scene exactly as it has always behaved.
  // the walk in plays on every load; only reduced motion skips it.
  let phase = REDUCED ? 'seated' : 'street';
  let guide = null;
  let guideMixer = null;
  let guideRig = null;
  let cookingPot = null;
  // Kept so the audit can measure against the furniture that is actually in the
  // scene rather than against numbers copied out of this file.
  let counterTop = null, counterFront = null, counterShelf = null;
  let counterCondiments = null;
  const stoolSeats = [];
  const stoolStyles = [];
  let stoolLegs = null;
  let auditVisibility = null;
  let service = null;
  let serviceBowl = null;
  let serviceAudit = { started: false, lifted: false, filledCarry: false, completed: false };
  // Visitor meals stay outside the diner AI/refill/departure loop.
  const visitorOrder = { status: 'choosing', dish: null, dismissed: false, firstBite: false, carrying: false, startedAt: 0, biteAt: 0 };
  const orderPanel = document.getElementById('visitorOrder');
  const orderTitle = document.getElementById('visitorOrderTitle');
  const orderChoices = document.getElementById('visitorOrderChoices');
  const orderStatus = document.getElementById('visitorOrderStatus');
  const orderSkip = document.getElementById('visitorOrderSkip');
  const orderComplete = document.getElementById('visitorOrderComplete');
  const orderAgain = document.getElementById('visitorOrderAgain');
  const orderDone = document.getElementById('visitorOrderDone');
  const orderReopenPanel = document.getElementById('visitorOrderReopenPanel');
  const orderReopen = document.getElementById('visitorOrderReopen');
  const _visitorSeat = new THREE.Vector3(SEAT.x, 1.09, 1.0);
  const _visitorPrep = new THREE.Vector3(COOK_HOME_X, 1.09, 0.6);

  function objectPointInTorso(npc, object, point, out) {
    if (!npc?.userData?.rig?.torso || !object) return null;
    out.copy(point);
    object.localToWorld(out);
    npc.userData.rig.torso.worldToLocal(out);
    return out;
  }

  function mouthPointInTorso(npc, out) {
    return objectPointInTorso(npc, npc?.userData?.rig?.face, MOUTH_POINT, out);
  }

  // Find the counter edge directly in front of this character. Geometry
  // dimensions and transforms stay live, while clearance remains an explicit
  // hand/prop posture choice.
  function counterPointInTorso(npc, clearance, out) {
    if (!counterTop || !npc?.userData?.rig?.torso) return null;
    npc.getWorldPosition(out);
    counterTop.worldToLocal(out);
    const { height, depth } = counterTop.geometry.parameters;
    out.y = height * 0.5 + clearance;
    out.z = Math.sign(out.z || 1) * depth * 0.5;
    counterTop.localToWorld(out);
    npc.userData.rig.torso.worldToLocal(out);
    return out;
  }

  /* ---------- helpers ---------- */
  function m(color, o = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
    });
  }
  const box = (w, h, d, color, o) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color, o));
  const cyl = (rt, rb, h, color, o, seg = 22) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m(color, o));
  const sph = (r, color, o, s = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, s, s - 4), m(color, o));
  const mug = (rt, rb, h, color) => {
    const g = new THREE.Group();
    g.add(cyl(rt, rb, h, color, { rough: 0.86 }, 14));
    const drink = cyl(rt * 0.78, rt * 0.78, 0.004, 0x39251a, { rough: 0.72 }, 14);
    drink.position.y = h * 0.5 + 0.003;
    g.add(drink);
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(h * 0.27, 0.008, 6, 14),
      m(color, { rough: 0.86 })
    );
    handle.rotation.y = Math.PI / 2;
    handle.position.x = rt + h * 0.16;
    g.add(handle);
    g.userData.rimPoint = new THREE.Vector3(0, h * 0.5, rt);
    // Fingers hook over the top of the handle, not its empty centre.
    g.userData.gripPoint = new THREE.Vector3(handle.position.x, h * 0.27, 0);
    return g;
  };
  // total height of a capsule is len + 2r; callers pass the total they want
  const cap = (r, total, color, o, seg = 14) =>
    new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, total - r * 2), 5, seg), m(color, o));
  const pos = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

  function textTexture(draw, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ---------- lights ---------- */
  scene.add(new THREE.AmbientLight(0x3f3a5c, 0.85));
  scene.add(new THREE.HemisphereLight(0x59608c, 0x2a1c18, 0.5));
  const key = new THREE.DirectionalLight(0xffd7a6, 0.3);
  key.position.set(-5, 7, 6);
  scene.add(key);
  // rim: sits behind the subjects relative to camera, so it catches the outline of
  // heads and shoulders. cool, to read against the warm lanterns.
  const rim = new THREE.DirectionalLight(0x9db4ec, 0.95);
  rim.position.set(2.5, 5, -7);
  scene.add(rim);

  let _faceShut = null, _faceOpen = null;  // read by buildPerson during construction
  let _blobTex = null;
  function blobTexture() {
    if (_blobTex) return _blobTex;
    _blobTex = textTexture((g, w, h) => {
      const r = w / 2;
      const grd = g.createRadialGradient(r, r, 0, r, r, r);
      grd.addColorStop(0, 'rgba(0,0,0,0.9)');
      grd.addColorStop(0.5, 'rgba(0,0,0,0.4)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.clearRect(0, 0, w, h);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, 128, 128);
    return _blobTex;
  }
  const _blobGeo = new THREE.PlaneGeometry(1, 1);
  function addBlobShadow(parent, radius, opacity = 0.5, y = 0.012) {
    const blob = new THREE.Mesh(
      _blobGeo,
      new THREE.MeshBasicMaterial({
        map: blobTexture(), transparent: true, opacity,
        depthWrite: false, color: 0xffffff,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = y;
    blob.scale.set(radius * 2, radius * 2, 1);
    blob.renderOrder = -1;
    parent.add(blob);
    return blob;
  }

  /* ---------- stall ---------- */
  buildStall();
  buildCounterItems();
  buildDiners();
  buildEmptySeat();
  buildStreet();
  buildGround();
  loadCook();

  function buildStall() {
    const s = new THREE.Group();
    s.add(pos(box(6.6, 3.0, 0.16, 0x48342a, { rough: 0.96 }), 0, 1.5, -1.2));
    s.add(pos(box(0.16, 3.0, 2.6, 0x3d2c22, { rough: 0.96 }), -3.3, 1.5, 0));
    s.add(pos(box(0.16, 3.0, 2.6, 0x3d2c22, { rough: 0.96 }), 3.3, 1.5, 0));
    s.add(pos(cyl(0.09, 0.11, 3.25, 0x2c1f18, {}, 12), -3.2, 1.6, 1.15));
    s.add(pos(cyl(0.09, 0.11, 3.25, 0x2c1f18, {}, 12), 3.2, 1.6, 1.15));

    const roof = pos(box(7.3, 0.18, 3.1, 0x221a17, { rough: 1 }), 0, 3.2, -0.05);
    roof.rotation.x = -0.055; s.add(roof);
    s.add(pos(box(7.5, 0.38, 0.16, 0x1a1310, { rough: 1 }), 0, 3.05, 1.52));

    const signTex = textTexture((g, w, h) => {
      g.fillStyle = '#1c1512'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0f0d0c'; g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7);
      g.fillStyle = '#f0d9a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = "700 150px 'Zilla Slab', Georgia, serif";
      g.fillText(LABELS.siteName, w / 2, h / 2 - 8, w - 120);
      g.fillStyle = '#d1663a'; g.font = "400 40px 'Space Mono', monospace";
      g.fillText(LABELS.mainSignLine, w / 2, h - 50, w - 120);
    }, 2048, 340);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.06), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(0, 2.74, 1.46); sign.rotation.x = -0.02;
    s.add(sign);

    const norenTex = textTexture((g, w, h) => {
      g.fillStyle = '#a5341d'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 0, w, 12);
      g.strokeStyle = '#f0d9a8'; g.lineWidth = 8;
      g.beginPath(); g.arc(w / 2, h * 0.5, h * 0.26, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f0d9a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = "700 96px 'Zilla Slab', serif"; g.fillText(LABELS.siteInitial, w / 2, h * 0.5 + 4);
    }, 256, 256);
    const norenMat = new THREE.MeshStandardMaterial({ map: norenTex, roughness: 1, side: THREE.DoubleSide });
    for (let i = -1; i <= 1; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.95, 4, 3), norenMat);
      f.position.set(i * 1.6, 2.4, 1.42);
      norenFlaps.push(f); s.add(f);
    }

    const menuTex = textTexture((g, w, h) => {
      g.fillStyle = '#221b16'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#5a4327'; g.lineWidth = 16; g.strokeRect(12, 12, w - 24, h - 24);
      g.fillStyle = '#d1663a'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.font = "700 104px 'Zilla Slab', serif"; g.fillText(LABELS.menuSignTitle, 74, 56);
      g.strokeStyle = '#463625'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(74, 188); g.lineTo(w - 74, 188); g.stroke();
      g.textBaseline = 'middle';
      MENU_ITEMS.forEach((item, k) => {
        const y = 262 + k * 84;
        g.fillStyle = '#e8d7b0'; g.font = "500 44px 'Hanken Grotesk', sans-serif"; g.textAlign = 'left';
        g.fillText(item.name, 78, y, 650);
        g.fillStyle = '#997c48'; g.font = "400 32px 'Space Mono', monospace"; g.textAlign = 'right';
        g.fillText(item.tag, w - 78, y, 250);
      });
      g.fillStyle = '#6b5636'; g.textAlign = 'left'; g.font = "400 28px 'Space Mono', monospace";
      g.fillText(LABELS.menuSignFooter, 78, h - 48, w - 156);
    }, 1024, 1320);
    const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.6), new THREE.MeshStandardMaterial({ map: menuTex, roughness: 0.9 }));
    menuBoard.position.set(-1.75, 1.62, -1.1);
    s.add(menuBoard);
    registerHotspot('menu', LABELS.navigation.menu, menuBoard, new THREE.Vector3(-1.75, 2.6, -1.05));

    const posterTex = textTexture((g, w, h) => {
      g.fillStyle = '#e8dbbf'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#a5341d'; g.fillRect(0, 0, w, 96);
      g.fillStyle = '#e8dbbf'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = "700 56px 'Zilla Slab', serif"; g.fillText(LABELS.logSignTitle, w / 2, 48, w - 50);
      g.fillStyle = '#3a2f22'; g.textAlign = 'left'; g.font = "400 34px 'Hanken Grotesk', sans-serif";
      LABELS.logSignItems.slice(0, 6).forEach((t, k) => {
        g.fillText(t, 42, 168 + k * 60);
      });
      g.fillStyle = '#8a6a3c'; g.font = "400 26px 'Space Mono', monospace";
      g.fillText(LABELS.logSignFooter, 42, h - 42, w - 84);
    }, 512, 640);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.95 }));
    poster.position.set(1.8, 1.75, -1.09);
    s.add(pos(box(1.36, 1.66, 0.06, 0x2a2018), 1.8, 1.75, -1.14));
    s.add(poster);
    registerHotspot('log', LABELS.navigation.log, poster, new THREE.Vector3(1.8, 2.56, -1.03));

    [
      { x: -2.42, y: 2.61, color: 0xff9c42, intensity: 1.78, size: 1.04 },
      { x: -0.08, y: 2.53, color: 0xffad58, intensity: 1.42, size: 0.96 },
      { x: 2.21, y: 2.58, color: 0xffc184, intensity: 1.08, size: 1 },
    ].forEach(({ x, y, color, intensity, size }) => {
      const lg = new THREE.Group();
      lg.add(pos(cyl(0.012, 0.012, 0.62, 0x0f0f0f, {}, 6), 0, 0.31, 0));
      const b = sph(0.25, 0xffb066, { emissive: 0xff7326, emissiveIntensity: 1.35, rough: 0.6 }, 20);
      b.scale.set(size, 1.28 * size, size); b.position.y = -0.1; lg.add(b);
      lanternMats.push(b.material);
      lg.add(pos(cyl(0.07, 0.09, 0.06, 0x281b13, {}, 10), 0, 0.13, 0));
      const light = new THREE.PointLight(color, intensity, 7.5, 2);
      light.position.y = -0.1; lg.add(light);
      lg.position.set(x, y, 0.6);
      lanterns.push({ group: lg, light });
      scene.add(lg);
    });

    scene.add(s);
  }

  function buildCounterItems() {
    const g = new THREE.Group();
    // Leave the right wall a breathing gap while keeping every seat and bowl
    // on the run. Move furniture, not its group of independently placed props.
    counterTop = pos(box(6.0, 0.14, 1.05, 0x7a5334, { rough: 0.66 }), -0.22, 1.02, 0.6);
    // Recess the solid cabinet behind the counter overhang so seated knees have
    // real clearance instead of being forced through the front panel.
    counterFront = pos(box(6.0, 0.95, 0.12, 0x5c3d26, { rough: 0.86 }), -0.22, 0.52, 0.82);
    counterShelf = pos(box(5.7, 0.08, 0.9, 0x452f1f, { rough: 0.9 }), -0.22, 0.55, 0.2);
    g.add(counterTop);
    g.add(counterFront);
    g.add(counterShelf);

    const potG = new THREE.Group();
    const potWall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.38, 0.5, 28, 1, true),
      m(0x3d4248, { metal: 0.55, rough: 0.36 })
    );
    potWall.position.y = 0.35;
    potG.add(potWall);
    potG.add(pos(cyl(0.38, 0.38, 0.035, 0x33383d, { metal: 0.45, rough: 0.42 }, 28), 0, 0.11, 0));
    const rim = pos(new THREE.Mesh(
      new THREE.TorusGeometry(0.415, 0.028, 8, 28),
      m(0x697078, { metal: 0.7, rough: 0.28 })
    ), 0, 0.605, 0);
    rim.rotation.x = Math.PI / 2;
    potG.add(rim);
    potG.add(pos(cyl(0.35, 0.35, 0.024, 0x6c2d14, { rough: 0.48, emissive: 0x2a0b03, emissiveIntensity: 0.45 }, 28), 0, 0.575, 0));
    const garnish = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      m(0xffffff, { rough: 0.8 }),
      3,
    );
    const garnishMatrix = new THREE.Matrix4();
    [[-0.12, 0.08, 0xd8b46d], [0.13, -0.07, 0x6b8b53], [0.04, 0.14, 0xe6d1a0]]
      .forEach(([x, z, color], index) => {
        garnishMatrix.makeTranslation(x, 0.6, z);
        garnish.setMatrixAt(index, garnishMatrix);
        garnish.setColorAt(index, new THREE.Color(color));
      });
    potG.add(garnish);
    potG.scale.setScalar(0.52);
    potG.position.set(WORK_POT_X, 1.01, 0.2);
    cookingPot = potG;
    g.add(potG);
    addSteam(new THREE.Vector3(WORK_POT_X, 1.43, 0.2), 0.2, 7);
    registerHotspot('menu', LABELS.specialsHotspot, potG, new THREE.Vector3(WORK_POT_X, 1.64, 0.2));

    DINER_SPECS.forEach(({ x }, k) => {
      const z = 1.0 + rnd(-0.025, 0.025);
      const bowl = buildRamenBowl(k === 1, k === 2);
      bowl.position.set(x, 1.09, z);
      bowl.rotation.y = rnd(-0.22, 0.22);
      bowl.userData.seatX = x;
      setBowlFill(bowl, [0.34, 0.62, 0.88][k]);
      const cup = pos(mug(0.07, 0.055, 0.13, 0xd8c8a5), 0.24, 0.11, 0.01);
      bowl.userData.counterCup = cup;
      bowl.add(cup);
      ramenBowls.push(bowl);
      g.add(bowl);
      bowl.userData.steam = addSteam(new THREE.Vector3(x, 1.37, z), 0.13, 4);
    });

    // This bowl is the physical prop the cook carries when replacing an empty
    // one. It is intentionally not part of ramenBowls: that array is the three
    // meals permanently assigned to the three seats.
    serviceBowl = buildRamenBowl(false);
    serviceBowl.visible = false;
    scene.add(serviceBowl);

    const boxG = new THREE.Group();
    boxG.add(pos(box(0.34, 0.3, 0.34, 0xcbb083, { rough: 0.95 }), 0, 0.15, 0));
    const fa = pos(box(0.34, 0.02, 0.16, 0xd8bd90), 0, 0.3, 0.09); fa.rotation.x = -0.5;
    const fb = pos(box(0.34, 0.02, 0.16, 0xbfa478), 0, 0.3, -0.09); fb.rotation.x = 0.5;
    boxG.add(fa); boxG.add(fb);
    boxG.position.set(2.55, 1.09, 0.6); boxG.rotation.y = 0.4;
    g.add(boxG);
    registerHotspot('bill', LABELS.navigation.bill, boxG, new THREE.Vector3(2.55, 1.36, 0.6));

    const condiments = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.07, 0.34, 12),
      m(0x2f6f5e, { rough: 0.4, metal: 0.1 }),
      3,
    );
    // Keep the existing instanced jars, now on the worktop rather than hidden
    // below it. Irregular positions collect the clutter around the hot pot.
    [[-3.03, 0.18], [-2.84, 0.43], [-2.28, 0.55]].forEach(([x, z], index) => {
      condiments.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, 1.26, z));
    });
    counterCondiments = condiments;
    g.add(condiments);

    scene.add(g);
  }

  function ramenAssets() {
    if (ramenAssetCache) return ramenAssetCache;
    const geo = {
      bowl: new THREE.LatheGeometry([
        [0.09, 0], [0.145, 0.025], [0.2, 0.13], [0.215, 0.18],
        [0.19, 0.19], [0.17, 0.145], [0.125, 0.045], [0.09, 0.018],
      ].map(([r, y]) => new THREE.Vector2(r, y)), 28),
      broth: new THREE.CylinderGeometry(0.184, 0.184, 0.012, 28),
      noodle: new THREE.TorusGeometry(0.105, 0.009, 6, 26, Math.PI * 1.7),
      eggWhite: new THREE.SphereGeometry(1, 14, 10),
      yolk: new THREE.SphereGeometry(1, 12, 8),
      nori: new THREE.PlaneGeometry(0.12, 0.15),
      chashu: new THREE.CylinderGeometry(0.065, 0.065, 0.014, 18),
      onion: new THREE.TorusGeometry(0.018, 0.0045, 5, 12),
      chopstick: new THREE.BoxGeometry(0.52, 0.012, 0.012),
      tofu: new THREE.BoxGeometry(0.065, 0.025, 0.055),
    };
    const mat = {
      ceramic: m(0xe8dfcf, { rough: 0.42 }),
      broth: m(0xb96a2f, { rough: 0.24, emissive: 0x351407, emissiveIntensity: 0.16 }),
      noodle: m(0xf0cf82, { rough: 0.72 }),
      eggWhite: m(0xfff4d6, { rough: 0.56 }),
      yolk: m(0xf2a51f, { rough: 0.38, emissive: 0x3a1600, emissiveIntensity: 0.12 }),
      nori: m(0x173c2b, { rough: 0.9 }),
      chashu: m(0xb86650, { rough: 0.72 }),
      onion: m(0x62a84f, { rough: 0.8 }),
      wood: m(0x7a4227, { rough: 0.78 }),
      tofu: m(0xf1deb0, { rough: 0.8 }),
      mushroom: m(0x63402a, { rough: 0.8 }),
    };
    ramenAssetCache = { geo, mat };
    return ramenAssetCache;
  }

  function buildRamenBowl(hero = false, restsAcrossRim = false, dish = null) {
    const { geo, mat } = ramenAssets();
    const bowl = new THREE.Group();
    bowl.userData.hero = hero;
    bowl.userData.dish = dish;
    bowl.userData.ingredients = ['bowl', 'broth', 'noodles', 'egg', 'nori', 'chashu', 'spring-onion', 'chopsticks'];

    const shell = new THREE.Mesh(geo.bowl, mat.ceramic);
    shell.name = 'bowl';
    bowl.add(shell);
    const broth = pos(new THREE.Mesh(geo.broth, mat.broth), 0, 0.168, 0);
    bowl.userData.broth = broth;
    bowl.userData.foodParts = [];
    bowl.add(broth);

    const noodleCount = hero ? 4 : 3;
    const noodles = new THREE.InstancedMesh(geo.noodle, mat.noodle, noodleCount);
    noodles.name = 'noodles';
    bowl.add(noodles);
    for (let i = 0; i < noodleCount; i++) {
      const noodle = pos(new THREE.Object3D(), (i - 1.5) * 0.018, 0.18 + i * 0.002, (i % 2) * 0.018 - 0.01);
      noodle.rotation.x = Math.PI / 2;
      noodle.rotation.z = i * 0.75;
      noodle.updateMatrix();
      bowl.userData.foodParts.push({ mesh: noodles, index: i, matrix: noodle.matrix.clone(), threshold: 0.12 + i * 0.13 });
    }

    const eggWhite = pos(new THREE.Mesh(geo.eggWhite, mat.eggWhite), -0.085, 0.195, 0.035);
    eggWhite.scale.set(0.075, 0.018, 0.057);
    eggWhite.name = 'egg';
    bowl.userData.foodParts.push({ mesh: eggWhite, threshold: 0.38, recipe: dish ? 'house' : null });
    bowl.add(eggWhite);
    const yolk = pos(new THREE.Mesh(geo.yolk, mat.yolk), -0.085, 0.211, 0.035);
    yolk.scale.set(0.032, 0.014, 0.027);
    yolk.name = 'egg-yolk';
    bowl.userData.foodParts.push({ mesh: yolk, threshold: 0.38, recipe: dish ? 'house' : null });
    bowl.add(yolk);

    const nori = pos(new THREE.Mesh(geo.nori, mat.nori), 0.105, 0.245, -0.085);
    nori.rotation.y = -0.25;
    nori.name = 'nori';
    bowl.userData.foodParts.push({ mesh: nori, threshold: 0.16 });
    bowl.add(nori);
    const pork = pos(new THREE.Mesh(geo.chashu, mat.chashu), 0.06, 0.195, 0.04);
    pork.rotation.z = 0.1;
    pork.name = 'chashu';
    bowl.userData.foodParts.push({ mesh: pork, threshold: 0.56, recipe: dish ? 'house' : null });
    bowl.add(pork);

    if (dish) {
      const tofu = pos(new THREE.Mesh(geo.tofu, mat.tofu), 0.065, 0.201, 0.04);
      tofu.rotation.y = 0.35;
      tofu.name = 'tofu';
      const mushroom = pos(new THREE.Mesh(geo.eggWhite, mat.mushroom), -0.08, 0.202, 0.03);
      mushroom.scale.set(0.07, 0.024, 0.055);
      mushroom.name = 'mushroom';
      for (const mesh of [tofu, mushroom]) {
        bowl.add(mesh);
        bowl.userData.foodParts.push({ mesh, threshold: 0.38, recipe: 'veggie' });
      }
    }

    const onionCount = hero || dish ? 4 : 2;
    const onions = new THREE.InstancedMesh(geo.onion, mat.onion, onionCount);
    onions.name = 'spring-onion';
    bowl.add(onions);
    for (let i = 0; i < onionCount; i++) {
      const onion = pos(new THREE.Object3D(), -0.01 + i * 0.023, 0.202 + i * 0.002, -0.055 + (i % 2) * 0.025);
      onion.rotation.x = Math.PI / 2;
      onion.updateMatrix();
      bowl.userData.foodParts.push({ mesh: onions, index: i, matrix: onion.matrix.clone(), threshold: 0.22 + i * 0.08 });
    }

    const chopstickAngle = restsAcrossRim ? rnd(0.2, 0.34) : rnd(-0.28, 0.08);
    const chopstickZ = rnd(-0.025, 0.025);
    const chopstickY = restsAcrossRim ? 0.255 : rnd(0.222, 0.24);
    const sticks = new THREE.InstancedMesh(geo.chopstick, mat.wood, 2);
    sticks.name = 'chopsticks';
    [-0.018, 0.018].forEach((offset, index) => {
      const stick = pos(new THREE.Object3D(), 0, chopstickY, chopstickZ + offset);
      stick.rotation.y = chopstickAngle;
      stick.updateMatrix();
      sticks.setMatrixAt(index, stick.matrix);
    });
    bowl.userData.restingChopsticks = [sticks];
    bowl.add(sticks);
    if (dish === 'veggie') bowl.userData.ingredients = ['bowl', 'broth', 'noodles', 'tofu', 'mushroom', 'nori', 'spring-onion', 'chopsticks'];
    setBowlFill(bowl, 1);
    return bowl;
  }

  function setBowlFill(bowl, value) {
    if (!bowl) return;
    const fill = Math.max(0, Math.min(1, value));
    bowl.userData.fill = fill;
    if (bowl.userData.broth) {
      bowl.userData.broth.visible = fill > 0.02;
      bowl.userData.broth.position.y = 0.13 + fill * 0.038;
      bowl.userData.broth.scale.setScalar(0.82 + fill * 0.18);
    }
    for (const part of bowl.userData.foodParts || []) {
      const visible = fill > part.threshold && (!part.recipe || part.recipe === bowl.userData.dish);
      if (part.index === undefined) part.mesh.visible = visible;
      else {
        part.mesh.setMatrixAt(part.index, visible ? part.matrix : _emptyFoodMatrix);
        part.mesh.instanceMatrix.needsUpdate = true;
        part.mesh.computeBoundingBox();
        part.mesh.computeBoundingSphere();
      }
    }
    if (bowl.userData.steam) bowl.userData.steam.visible = fill > 0.08;
  }

  function setBowlVisible(bowl, visible) {
    if (!bowl) return;
    bowl.visible = visible;
    if (bowl.userData.steam) {
      bowl.userData.steam.visible = visible && bowl.userData.fill > 0.08;
    }
  }

  function addSteam(p, spread, count) {
    const grp = new THREE.Group();
    grp.position.copy(p);
    grp.userData.style = 'curling-ribbon';
    if (!steamTexture) {
      steamTexture = textTexture((c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.lineCap = 'round';
        c.lineWidth = 13;
        c.shadowColor = 'rgba(255,245,225,0.62)';
        c.shadowBlur = 12;
        c.strokeStyle = 'rgba(255,248,232,0.55)';
        c.beginPath();
        c.moveTo(w * 0.52, h);
        c.bezierCurveTo(w * 0.15, h * 0.72, w * 0.88, h * 0.48, w * 0.42, h * 0.2);
        c.bezierCurveTo(w * 0.25, h * 0.1, w * 0.62, h * 0.04, w * 0.54, 0);
        c.stroke();
      }, 128, 256);
    }
    const geometry = new THREE.PlaneGeometry(spread * 1.15, spread * 3.4);
    for (let i = 0; i < count; i++) {
      const q = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          map: steamTexture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          roughness: 1,
          color: 0xffead0,
          emissive: 0x2a1608,
          emissiveIntensity: 0.2,
        })
      );
      q.userData.seed = random();
      q.userData.spread = spread;
      grp.add(q);
    }
    steamGroups.push(grp);
    scene.add(grp);
    return grp;
  }

  /* ---------- articulated stand-in person ---------- */
  function faceTexture(open) {
    if (open && _faceOpen) return _faceOpen;
    if (!open && _faceShut) return _faceShut;
    const tex = textTexture((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#20140c';
      g.beginPath(); g.arc(w * 0.38, h * 0.46, 7, 0, 7); g.fill();
      g.beginPath(); g.arc(w * 0.62, h * 0.46, 7, 0, 7); g.fill();
      g.strokeStyle = '#20140c'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w * 0.33, h * 0.36); g.lineTo(w * 0.43, h * 0.34); g.stroke();
      g.beginPath(); g.moveTo(w * 0.57, h * 0.34); g.lineTo(w * 0.67, h * 0.36); g.stroke();
      if (open) {
        g.beginPath();
        g.ellipse(w * 0.5, h * 0.645, w * 0.055, h * 0.05, 0, 0, 7);
        g.fill();
      } else {
        g.beginPath();
        g.moveTo(w * 0.42, h * 0.62);
        g.quadraticCurveTo(w * 0.5, h * 0.68, w * 0.58, h * 0.62);
        g.stroke();
      }
    }, 128, 128);
    if (open) _faceOpen = tex; else _faceShut = tex;
    return tex;
  }

  function buildPerson(opt = {}) {
    const sc = opt.scale || 1;
    const bw = opt.build || 1;   // shoulder / torso width
    const hs = opt.headScale || 1;
    const skin = opt.skin || 0xcf9264;
    const shirt = opt.shirt || 0x39506b;
    const p = new THREE.Group();

    const hip = new THREE.Group();
    hip.position.y = 0.8;
    p.add(hip);
    const pelvis = pos(sph(0.135 * bw, shirt, { rough: 0.9 }, 16), 0, 0, 0);
    pelvis.scale.set(1, 0.66, 0.82);
    hip.add(pelvis);

    const torso = new THREE.Group();
    torso.position.y = 0.12;
    hip.add(torso);
    // lathed profile: waist in, chest out, shoulders back in. a real silhouette
    // rather than a cylinder, for the same handful of triangles.
    const prof = [
      [0.115, 0.00], [0.142, 0.07], [0.163, 0.16], [0.172, 0.25],
      [0.168, 0.33], [0.150, 0.40], [0.112, 0.45], [0.055, 0.475],
    ].map(([r, y]) => new THREE.Vector2(r * bw, y));
    const trunk = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), m(shirt, { rough: 0.9 }));
    trunk.scale.z = 0.84;
    torso.add(trunk);
    const traps = pos(sph(0.155 * bw, shirt, { rough: 0.9 }, 14), 0, 0.4, 0);
    traps.scale.set(1, 0.42, 0.8);
    torso.add(traps);
    if (opt.apron) {
      // a curved panel wrapping the front of the torso. as a flat box it read as a
      // slab bolted to his chest once the trunk stopped being a cylinder.
      const ap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15 * bw, 0.182 * bw, 0.44, 18, 1, true, -1.15, 2.3),
        m(0xe7dcc5, { rough: 1 })
      );
      ap.material.side = THREE.DoubleSide;
      ap.position.set(0, 0.17, 0);
      ap.scale.z = 0.86;
      torso.add(ap);
    }
    torso.add(pos(cap(0.043, 0.13, skin, { rough: 1 }, 12), 0, 0.5, 0));

    const head = new THREE.Group();
    head.position.y = 0.585;
    torso.add(head);
    head.add(pos(sph(0.105 * hs, skin, { rough: 1 }, 18), 0, 0, 0));
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.163, 0.163),
      new THREE.MeshBasicMaterial({ map: faceTexture(false), transparent: true })
    );
    face.position.set(0, 0.008, 0.099 * hs);
    head.add(face);
    const hair = pos(sph(0.111 * hs, opt.hair || 0x1c1510, { rough: 1 }, 16), 0, 0.024, -0.008);
    head.add(hair);
    if (opt.longHair) {
      const backHair = pos(cap(0.09 * hs, 0.42, opt.hair || 0x1c1510, { rough: 1 }, 12), 0, -0.17, -0.055);
      backHair.scale.set(1.05, 1, 0.72);
      head.add(backHair);
    }
    if (opt.coat) {
      const coat = pos(cyl(0.19 * bw, 0.145 * bw, 0.62, opt.coat, { rough: 0.95 }, 14), 0, -0.05, -0.005);
      coat.scale.z = 0.86;
      torso.add(coat);
    }
    if (opt.bag) {
      // A compact backpack sits flush against the spine. The previous side bag
      // was a hard box offset from the body, so even though it inherited the
      // torso transform it looked like a prop floating beside the walker.
      const backpack = pos(sph(0.13, opt.bag, { rough: 0.95 }, 12), 0, 0.13, -0.13);
      backpack.scale.set(0.86, 1.28, 0.46);
      torso.add(backpack);
    }
    if (opt.cap != null) {
      head.add(pos(cyl(0.115 * hs, 0.115 * hs, 0.05, opt.cap, { rough: 1 }, 14), 0, 0.057, 0));
      head.add(pos(box(0.196 * hs, 0.017, 0.017, opt.cap), 0, 0.04, 0));
    }
    if (opt.toque) {
      const toque = pos(cyl(0.131, 0.123, 0.115, 0xf3efe6, { rough: 1 }, 18), 0, 0.106, 0);
      const puff = pos(sph(0.139, 0xf3efe6, { rough: 1 }, 14), 0, 0.196, 0);
      puff.scale.y = 0.7;
      head.add(toque); head.add(puff);
    }

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.185 * bw, 0.36, 0);
      sh.add(pos(sph(0.056 * bw, shirt, { rough: 0.9 }, 14), 0, 0, 0)); // deltoid
      sh.add(pos(cap(0.044, 0.25, shirt, { rough: 0.9 }), 0, -0.12, 0));
      const elbow = new THREE.Group(); elbow.position.y = -0.24;
      elbow.add(pos(sph(0.04, skin, { rough: 1 }, 12), 0, 0, 0)); // elbow joint
      elbow.add(pos(cap(0.037, 0.23, skin, { rough: 1 }), 0, -0.11, 0));
      const hand = pos(sph(0.045, skin, { rough: 1 }, 12), 0, -0.245, 0);
      hand.scale.set(0.78, 1.25, 0.6);
      elbow.add(hand);
      // Props need one joint beyond the forearm. Without it, a cup, pair of
      // chopsticks, cloth or ladle inherits the forearm angle and cannot stay
      // aligned with the object it is meant to touch.
      const wrist = new THREE.Group();
      hand.add(wrist);
      sh.add(elbow);
      torso.add(sh);
      return { sh, elbow, hand, wrist };
    };
    const armL = arm(-1), armR = arm(1);

    const leg = (side) => {
      const hp = new THREE.Group();
      hp.position.set(side * 0.09, 0, 0);
      hp.add(pos(sph(0.075, 0x2c2c34, { rough: 0.9 }, 12), 0, 0, 0)); // hip joint
      hp.add(pos(cap(0.066, 0.42, 0x2c2c34, { rough: 0.9 }), 0, -0.2, 0));
      const knee = new THREE.Group(); knee.position.y = -0.4;
      knee.add(pos(sph(0.056, 0x2c2c34, { rough: 0.9 }, 12), 0, 0, 0)); // knee joint
      knee.add(pos(cap(0.052, 0.4, 0x2c2c34, { rough: 0.9 }), 0, -0.19, 0));
      const shoe = pos(cap(0.05, 0.19, 0x161616, { rough: 0.9 }, 12), 0, -0.375, 0.03);
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.set(0.86, 1, 0.7);
      knee.add(shoe);
      hp.add(knee);
      hip.add(hp);
      return { hp, knee, shoe };
    };
    const legL = leg(-1), legR = leg(1);

    p.userData.rig = { hip, torso, head, armL, armR, legL, legR, face, pelvis };
    p.userData.appearance = {
      shirt: [pelvis.material, trunk.material, traps.material],
      hair: hair.material,
    };
    p.userData.streetStyle = { longHair: !!opt.longHair, coat: !!opt.coat };
    p.scale.setScalar(sc);
    return p;
  }

  /* ================= NPC acting =================
     A pose is a flat set of joint targets. An action writes one; the rig eases
     toward it every frame. That means any action blends into any other for free,
     with no explicit crossfade code and no snapping.
     ============================================== */

  // Stool heights and bodies both vary, so the hip height that puts a pelvis
  // on the seat is per person. Without this the smaller diners sit through it.
  function seatedPose(npc) {
    const p = {
      hipY: npc?.userData?.seatHipY ?? 0.74, torsoX: 0.08, torsoY: 0, torsoZ: 0,
      headX: 0, headY: 0, headZ: 0,
      lShX: -0.5, lShZ: 0, lElX: 0,
      rShX: -0.7, rShZ: 0, rElX: -1.0,
      lElZ: 0, rElZ: 0,
      lWrX: 0, lWrY: 0, lWrZ: 0,
      rWrX: 0, rWrY: 0, rWrZ: 0,
      mouth: 0,
    };
    // Hover the hands above the actual near edge. The clearance leaves fingers
    // clear of the worktop and follows changes to counter height or depth.
    const counter = counterPointInTorso(npc, 0.30, _ikCounter);
    if (counter) {
      reachArm(p, 'r', counter.y, counter.z, -0.06);
      reachArm(p, 'l', counter.y, counter.z, 0.06);
    }
    return p;
  }
  function standingPose() {
    return {
      hipY: 0.8, torsoX: 0.07, torsoY: 0, torsoZ: 0,
      headX: 0.15, headY: 0, headZ: 0,
      // Reaching forward from behind the counter put the forearms inside it.
      // At rest the arms hang by his sides, which is also what a cook does
      // between jobs.
      lShX: -0.30, lShZ: 0.85, lElX: -0.35,
      rShX: -0.34, rShZ: -0.12, rElX: -0.30,
      lElZ: 0, rElZ: 0,
      lWrX: 0, lWrY: 0, lWrZ: 0,
      rWrX: 0, rWrY: 0, rWrZ: 0,
      mouth: 0,
    };
  }

  function easePose(cur, tgt, k) {
    for (const key in tgt) cur[key] += (tgt[key] - cur[key]) * k;
  }

  function applyPose(rig, c) {
    rig.hip.position.y = c.hipY;
    rig.torso.rotation.set(c.torsoX, c.torsoY, c.torsoZ);
    rig.head.rotation.set(c.headX, c.headY, c.headZ);
    rig.armL.sh.rotation.x = c.lShX; rig.armL.sh.rotation.z = c.lShZ;
    rig.armL.elbow.rotation.x = c.lElX;
    rig.armL.elbow.rotation.z = c.lElZ;
    rig.armL.wrist.rotation.set(c.lWrX, c.lWrY, c.lWrZ);
    rig.armR.sh.rotation.x = c.rShX; rig.armR.sh.rotation.z = c.rShZ;
    rig.armR.elbow.rotation.x = c.rElX;
    rig.armR.elbow.rotation.z = c.rElZ;
    rig.armR.wrist.rotation.set(c.rWrX, c.rWrY, c.rWrZ);
    const open = c.mouth > 0.5;
    const f = rig.face;
    if (f && f.userData.open !== open) {
      f.userData.open = open;
      f.material.map = faceTexture(open);
      f.material.needsUpdate = true;
    }
  }

  // mouth flap: fast, irregular, and only while a line is actually up
  const flap = (tl, phase) => (
    Math.sin(tl * 17 + phase) + Math.sin(tl * 26.3 + phase * 1.37) > 0.1 ? 1 : 0
  );
  const ease01 = (v) => {
    const u = Math.max(0, Math.min(1, v));
    return u * u * (3 - 2 * u);
  };
  const mix = (a, b, u) => a + (b - a) * u;

  // Two-link arm solver in the character's local Y/Z plane. Actions name a
  // physical destination (bowl, mouth, pot, counter); they never invent a
  // shoulder angle and hope the hand happens to land somewhere useful.
  function reachArm(p, side, targetY, targetZ, shoulderZ = 0, targetX = null, shoulderX = 0) {
    const l1 = 0.24, l2 = 0.245;
    const dy = targetY - 0.36;
    const dz = targetZ;
    const dx = targetX == null ? 0 : targetX - shoulderX;
    const distance = Math.min(l1 + l2 - 0.002, Math.max(0.06, Math.hypot(dx, dy, dz)));
    const elbow = -Math.acos(Math.max(-1, Math.min(1,
      (distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2)
    )));
    const reach = l1 + l2 * Math.cos(elbow);
    const solvedZ = targetX == null ? shoulderZ
      : Math.asin(Math.max(-1, Math.min(1, dx / Math.max(0.001, reach))));
    const planeY = Math.cos(solvedZ) * reach;
    const planeZ = l2 * Math.sin(elbow);
    const shoulder = Math.atan2(dz, dy) - Math.atan2(-planeZ, -planeY);
    p[`${side}ShX`] = Math.atan2(Math.sin(shoulder), Math.cos(shoulder));
    p[`${side}ElX`] = elbow;
    p[`${side}ShZ`] = solvedZ;
  }

  function restArmInLap(p, side) {
    reachArm(p, side, LAP_HAND_POINT.y, LAP_HAND_POINT.z, side === 'l' ? 0.14 : -0.14);
  }

  function updateMeal(npc, at) {
    const ai = npc.userData.ai;
    const bowl = npc.userData.table?.bowl;
    ai.biting = false;
    ai.biteT = 0;
    if (ai.act !== 'eat' || !bowl) return;
    if (bowl.userData.fill <= 0.01) {
      if (!ai.emptyCounted) {
        ai.emptyCounted = true;
        ai.mealsFinished++;
      }
      ai.readyToLeave = ai.mealsFinished >= 2;
      ai.needsService = !ai.readyToLeave;
      setAct(npc, 'pause', 30);
      return;
    }
    if (!ai.nextBiteAt) ai.nextBiteAt = at + rnd(0.25, 1.1);
    if (at < ai.nextBiteAt) return;
    const biteT = at - ai.nextBiteAt;
    if (biteT >= 4.25) {
      setBowlFill(bowl, bowl.userData.fill - rnd(0.14, 0.2));
      ai.nextBiteAt = at + rnd(0.8, 2.2);
      return;
    }
    ai.biting = true;
    ai.biteT = biteT;
  }

  function placeHeldChopsticks(held, tip, grip) {
    if (!held) return;
    held.position.copy(tip);
    held.rotation.set(0, 0, 0);
    const direction = held.userData.direction;
    direction.copy(grip).sub(tip);
    const length = direction.length();
    held.userData.normalized.copy(direction).normalize();
    held.userData.grip.position.copy(direction);
    for (const stick of held.userData.sticks) {
      stick.position.copy(direction).multiplyScalar(0.5);
      stick.position.x += stick.userData.pairOffset;
      stick.scale.set(1, 1, length);
      stick.quaternion.setFromUnitVectors(held.userData.axis, held.userData.normalized);
    }
  }

  function syncChopstickGrip(npc) {
    const table = npc.userData.table;
    if (!table?.heldChopsticks || !table.chopstickTip) return;
    npc.userData.rig.armR.hand.getWorldPosition(_ikWorld);
    npc.userData.rig.torso.worldToLocal(_ikWorld);
    placeHeldChopsticks(table.heldChopsticks, table.chopstickTip, _ikWorld);
  }

  // ---- seated actions ----
  const SEATED_ACTS = {
    eat(p, _tl, npc) {
      const ai = npc.userData.ai || npc.userData.visitorMeal;
      const held = npc.userData.table?.heldChopsticks;
      const t = ai.biting ? ai.biteT : 0;
      let lift = 0;
      if (!ai.biting || t < 0.4 || t >= 3.5) lift = 0;
      else if (t < 1.35) lift = ease01((t - 0.4) / 0.95);
      else if (t < 3.0) lift = 1;
      else lift = 1 - ease01((t - 3.0) / 0.5);

      // The free hand rests in the diner's lap. The chopstick hand starts below
      // the rim and approaches the mouth from below; lifting it past the face
      // made the diner look as though they were eating over their own head.
      restArmInLap(p, 'l');
      // Animate the chopstick tips between the bowl and mouth, then send the
      // hand to the grip end. Keeping the prop under the torso instead of the
      // wrist prevents a bent forearm from turning the sticks through the
      // diner's neck or straight up over their head.
      // The tips start in the bowl while the grip stays back by the diner's
      // shoulder. At the mouth the grip drops below the tips. The previous
      // pair pointed from the bowl farther across the counter, forcing the arm
      // to full extension and through the worktop before every bite.
      const bowl = npc.userData.table?.bowl;
      const bowlTip = objectPointInTorso(npc, bowl, BOWL_BITE_POINT, _ikBowl);
      const mouth = mouthPointInTorso(npc, _ikMouth);
      const tip = bowlTip && mouth ? _ikWorld.copy(bowlTip).lerp(mouth, lift) : _ikWorld.set(0, 0.5, 0.3);
      let tipX = tip.x, tipY = tip.y, tipZ = tip.z;
      _ikGrip.copy(CHOPSTICK_GRIP_AT_BOWL).lerp(CHOPSTICK_GRIP_AT_MOUTH, lift).add(tip);
      let gripX = _ikGrip.x;
      // The grip stays on the diner's side of the bowl throughout both strokes.
      // Dropping it toward the rim during the return was the remaining frame
      // where the hand cut through the ceramic.
      let gripY = _ikGrip.y;
      let gripZ = _ikGrip.z;
      if (!ai.biting) {
        const counter = counterPointInTorso(npc, 0.30, _ikCounter);
        if (counter) {
          gripX = counter.x; gripY = counter.y; gripZ = counter.z;
          tipX = gripX - 0.19; tipY = gripY - 0.07; tipZ = gripZ + 0.04;
        }
      }
      const tipPoint = npc.userData.table.chopstickTip.set(tipX, tipY, tipZ);
      placeHeldChopsticks(held, tipPoint, _ikGrip.set(gripX, gripY, gripZ));
      // Chopstick studies show small shoulder-abduction changes: keep the elbow
      // tucked instead of flaring it sideways like a wing.
      if (ai.biting) {
        reachArm(p, 'r', gripY, gripZ, 0, gripX, npc.userData.rig.armR.sh.position.x);
        p.rElZ = -0.34;
      } else {
        const counter = counterPointInTorso(npc, 0.30, _ikCounter);
        if (counter) reachArm(p, 'r', counter.y, counter.z, -0.06);
      }
      p.rWrX = 0;
      p.torsoX = 0.1 - lift * 0.02;
      p.headX = 0.16 - lift * 0.12;
      p.mouth = ai.biting && t >= 1.2 && t < 2.8 ? 1 : 0;
    },
    pause(p, tl) {
      p.torsoX = 0.06 + Math.sin(tl * 0.9) * 0.02;
      p.headX = 0.05;
      p.headY = Math.sin(tl * 0.5) * 0.3;
    },
    drink(p, tl, npc) {
      restArmInLap(p, 'r');
      if (tl <= 0.4) {
        restArmInLap(p, 'l');
        p.torsoX = 0.1;
        return;
      }
      const up = tl < 1.2 ? ease01((tl - 0.4) / 0.8)
        : tl < 1.85 ? 1
          : 1 - ease01((tl - 1.85) / 0.85);
      const table = npc.userData.table;
      const cup = table?.heldCup;
      const counterCup = table?.bowl?.userData.counterCup;
      const cupStart = objectPointInTorso(npc, counterCup, _ikWorld.set(0, 0, 0), _ikBowl);
      const mouth = mouthPointInTorso(npc, _ikMouth);
      if (!cup || !mouth || !cupStart) return;
      // Place the near rim at the live mouth, accounting for the tilted cup.
      const cupEnd = _ikGrip.copy(cup.userData.rimPoint)
        .applyQuaternion(CUP_DRINK_ROTATION).multiplyScalar(-1).add(mouth);
      if (tl >= 2.7) {
        if (cup && cupStart) {
          cup.position.copy(cupStart);
          cup.rotation.set(0, Math.PI, 0);
        }
        restArmInLap(p, 'l');
        p.torsoX = 0.1;
        return;
      }
      // Lift over the counter lip on both the outward and return strokes.
      const cupPoint = _ikCounter.copy(cupStart || cupEnd).lerp(cupEnd, up);
      cupPoint.y += Math.sin(Math.PI * up) * 0.16;
      if (cup) {
        cup.position.copy(cupPoint);
        // Face the handle toward the left hand. The old orientation put the
        // handle against the diner's cheek while the fist grabbed bare ceramic.
        cup.rotation.set(mix(0, 0.5, up), Math.PI, 0);
      }
      const grip = _ikFreeHand.copy(cup.userData.gripPoint)
        .applyQuaternion(cup.quaternion).add(cupPoint);
      reachArm(p, 'l', grip.y, grip.z, 0, grip.x, npc.userData.rig.armL.sh.position.x);
      p.lWrX = 0;
      p.torsoX = 0.1 - up * 0.03;
      p.headX = -up * 0.05;
      p.mouth = 0;
    },
    talk(p, tl, npc) {
      p.torsoY = npc.userData.ai.face * 0.5;
      p.headY = npc.userData.ai.face * 0.7;
      p.headX = Math.sin(tl * 3.1) * 0.06;
      const counter = counterPointInTorso(npc, 0.30, _ikCounter);
      if (counter) reachArm(p, 'r', counter.y + 0.06 + Math.sin(tl * 2.2) * 0.05,
        counter.z - 0.02 + Math.sin(tl * 2.9) * 0.03, -0.06);
      p.mouth = flap(tl, npc.userData.ai.mouthPhase);
    },
    listen(p, tl, npc) {
      p.torsoY = npc.userData.ai.face * 0.4;
      p.headY = npc.userData.ai.face * 0.65;
      // a nod every couple of seconds
      p.headX = Math.max(0, Math.sin(tl * 1.4)) * 0.16;
    },
    lookUp(p, tl) {
      p.headX = -0.16;
      p.torsoX = 0.02;
    },
  };

  // ---- cook actions ----
  const COOK_ACTS = {
    stir(p, tl, npc) {
      // The hand stays above and behind the hot rim while the ladle reaches
      // down into the pot. Keeping the utensil in torso space prevents the
      // bent wrist from rotating its scoop upward through the cook's face.
      const circle = tl * 2.0;
      const pot = objectPointInTorso(npc, cookingPot, POT_BROTH_POINT, _ikPot);
      const ladle = npc?.userData.tools?.ladle;
      if (ladle) ladle.userData.setStir(circle);
      const grip = objectPointInTorso(npc, ladle?.userData.grip, _ikWorld.set(0, 0, 0), _ikGrip)
        || _ikGrip.copy(pot).add(POT_STIR_GRIP_OFFSET).setX(npc.userData.rig.armR.sh.position.x);
      reachArm(p, 'r', grip.y, grip.z, 0, grip.x, npc.userData.rig.armR.sh.position.x);
      // The free hand braces the near handle instead of vanishing beside the
      // apron. It stays outside the hot rim while remaining visible front-on.
      _ikFreeHand.copy(pot).add(POT_BRACE_OFFSET);
      reachArm(p, 'l', _ikFreeHand.y, _ikFreeHand.z, 0.28);
      p.lElZ = -0.12;
      p.torsoX = 0.10;
      p.torsoY = -0.13;
      p.headX = 0.16;
      p.headY = -0.14;
    },
    chat(p, tl, npc) {
      p.torsoX = 0.02;
      p.torsoY = Math.sin(tl * 0.7) * 0.12;
      p.headX = -0.05 + Math.sin(tl * 2.6) * 0.05;
      p.headY = Math.sin(tl * 0.9) * 0.16;
      const counter = counterPointInTorso(npc, 0.22, _ikCounter);
      if (counter) reachArm(p, 'r', counter.y + 0.05 + Math.sin(tl * 2.4) * 0.05,
        counter.z + 0.05 + Math.sin(tl * 3.1) * 0.04, -0.2 + Math.cos(tl * 1.7) * 0.16);
      p.mouth = flap(tl, npc.userData.ai.mouthPhase);
    },
    wipe(p, tl, npc) {
      p.torsoX = 0.24;
      p.torsoY = -0.12;
      p.headX = 0.34;
      const counter = counterPointInTorso(npc, 0.22, _ikCounter);
      if (counter) reachArm(p, 'r', counter.y + 0.065, counter.z + 0.05,
        Math.sin(tl * 1.7) * 0.18);
      p.rWrX = 2.20;
    },
    serve(p) {
      // Keep each hand on its own side of the bowl and below the face. The old
      // pose crossed both arms onto the same point and lifted the bowl over
      // the cook's eyes.
      reachArm(p, 'l', SERVICE_CARRY_HAND.y, SERVICE_CARRY_HAND.z, -0.32);
      reachArm(p, 'r', SERVICE_CARRY_HAND.y, SERVICE_CARRY_HAND.z, 0.52);
      p.lElZ = 0.48;
      p.rElZ = -0.74;
      p.torsoX = 0.12;
      p.headX = 0.18;
    },
  };

  // ---- per-NPC state machine ----
  // Each NPC picks its own next action on a timer. The director can lock one out
  // of self-selection while a scripted beat is using it.
  const DINER_PLAN = [
    { act: 'eat', w: 5, dur: [28, 42] },
    { act: 'pause', w: 2, dur: [2.5, 4.5] },
    { act: 'drink', w: 1, dur: [2.6, 3.4] },
  ];
  const COOK_PLAN = [
    { act: 'stir', w: 5, dur: [5, 10] },
    { act: 'wipe', w: 2, dur: [3.5, 5.5] },
  ];
  // function declaration, not a const arrow: initAI calls this during scene
  // construction, which happens above this line.
  function rnd(a, b) { return a + random() * (b - a); }
  // wall clock in seconds, for anything that schedules rather than eases
  function nowSec() { return performance.now() / 1000; }
  function pickPlan(plan) {
    let total = 0;
    for (const e of plan) total += e.w;
    let r = random() * total;
    for (const e of plan) { r -= e.w; if (r <= 0) return e; }
    return plan[0];
  }

  function initAI(npc, kind, base) {
    const tempo = rnd(0.82, 1.18);
    npc.userData.ai = {
      kind, cur: base(), tgt: base(),
      act: kind === 'cook' ? 'stir' : 'eat',
      startedAt: nowSec() - random() * 3, dur: rnd(3, 7) * tempo,
      tempo,
      locked: false, face: 0, needsService: false,
      mouthPhase: random() * Math.PI * 2,
      nextBiteAt: kind === 'diner' ? nowSec() + rnd(0.2, 1.2) : 0,
      biting: false, biteT: 0,
      mealsFinished: 0, emptyCounted: false, readyToLeave: false,
      customerGeneration: 0, turnover: null,
    };
  }
  function setAct(npc, act, dur) {
    const ai = npc.userData.ai;
    if (!ai) return;
    ai.act = act; ai.startedAt = nowSec(); ai.dur = dur * ai.tempo;
    if (act === 'eat') ai.nextBiteAt = nowSec() + rnd(0.25, 1.2);
  }

  function tickNPC(npc, dt) {
    const ai = npc.userData.ai;
    if (!ai) return;
    let tl = nowSec() - ai.startedAt;
    if (!ai.locked && tl >= ai.dur) {
      const plan = pickPlan(ai.kind === 'cook' ? COOK_PLAN : DINER_PLAN);
      setAct(npc, ai.needsService ? 'pause' : plan.act, ai.needsService ? 30 : rnd(plan.dur[0], plan.dur[1]));
      tl = 0;
    }
    if (ai.kind === 'diner') updateMeal(npc, nowSec());
    const base = ai.kind === 'cook' ? standingPose() : seatedPose(npc);
    const fn = (ai.kind === 'cook' ? COOK_ACTS : SEATED_ACTS)[ai.act];
    if (fn) fn(base, tl, npc);
    ai.tgt = base;
    // exponential smoothing, framerate independent
    easePose(ai.cur, ai.tgt, 1 - Math.exp(-dt * 7));
    applyPose(npc.userData.rig, ai.cur);
    if (ai.kind === 'diner') {
      const table = npc.userData.table;
      const eating = ai.act === 'eat';
      const drinking = ai.act === 'drink';
      if (table) {
        table.heldChopsticks.visible = eating;
        table.noodleLift.visible = eating && ai.biting && ai.biteT >= 0.45 && ai.biteT < 2.85;
        table.heldCup.visible = drinking;
        if (table.bowl) {
          for (const stick of table.bowl.userData.restingChopsticks || []) stick.visible = !eating;
          if (table.bowl.userData.counterCup) table.bowl.userData.counterCup.visible = !drinking;
        }
        if (eating) syncChopstickGrip(npc);
      }
    } else if (npc.userData.tools) {
      npc.userData.tools.ladle.visible = ai.act === 'stir';
      npc.userData.tools.cloth.visible = ai.act === 'wipe';
    }
  }

  function beginService(diner) {
    if (!guideRig || !serviceBowl || service || beat) return;
    const bowl = diner.userData.table?.bowl;
    if (!bowl) return;
    service = { diner, bowl, startedAt: nowSec(), homeX: guide.position.x, lifted: false, filled: false, placed: false };
    serviceAudit = { started: true, lifted: false, filledCarry: false, completed: false };
    guide.userData.ai.locked = true;
    diner.userData.ai.locked = true;
    setAct(guide, 'serve', 6.2);
    setAct(diner, 'lookUp', 6.2);
    setBowlFill(serviceBowl, 0);
    serviceBowl.visible = false;
    guide.userData.walkHomeRotation = guide.rotation.y;
    beginWalk(guide);
  }

  function tickService() {
    if (!service) {
      if (phase !== 'seated' || beat || visitorOrder.status === 'queued') return;
      const empty = diners.find((d) => d.userData.ai?.needsService);
      if (empty) beginService(empty);
      return;
    }
    const s = service;
    const t = nowSec() - s.startedAt;
    const dinerX = s.diner.position.x;
    const workX = dinerX + (dinerX < 0 ? 0.28 : -0.28);
    const potX = cookingPot ? cookingPot.getWorldPosition(_potStationWorld).x : guide.position.x;

    // The three things that actually change state latch on elapsed time and run
    // in ascending order, so one slow frame that jumps past a whole phase still
    // performs every step. Gating them on which branch a frame lands in meant a
    // skipped frame left the cook walking to the pot empty-handed.
    if (t >= 1.0 && !s.lifted) {
      setBowlVisible(s.bowl, false);
      serviceBowl.visible = true;
      setBowlFill(serviceBowl, 0);
      s.lifted = true;
      serviceAudit.lifted = true;
    }
    if (t >= 2.85 && !s.filled) {
      setBowlFill(serviceBowl, 1);
      s.filled = true;
      // The bowl the cook refills must be the one they are holding, with the
      // seat left empty: that ordering is the thing worth asserting.
      serviceAudit.filledCarry = s.lifted && serviceBowl.visible && !s.bowl.visible;
    }
    if (t >= 4.8 && !s.placed) {
      setBowlFill(s.bowl, 1);
      s.diner.userData.ai.emptyCounted = false;
      setBowlVisible(s.bowl, true);
      serviceBowl.visible = false;
      s.placed = true;
    }

    // Each translation spends its opening beat turning, then advances a gait
    // from the distance actually covered. At a station the cook turns back to
    // the counter before lifting, filling or placing the bowl.
    if (t < 1.0) cookTravelX(s.homeX, workX, t);
    else if (t < 1.65) {
      guide.position.x = workX;
      faceCookAtStation(s.homeX, workX, t - 1.0);
    } else if (t < 2.55) cookTravelX(workX, potX + 0.7, (t - 1.65) / 0.9);
    else if (t < 3.25) {
      guide.position.x = potX + 0.7;
      faceCookAtStation(workX, potX + 0.7, t - 2.55);
    } else if (t < 4.15) cookTravelX(potX + 0.7, workX, (t - 3.25) / 0.9);
    else if (t < 4.8) {
      guide.position.x = workX;
      faceCookAtStation(potX + 0.7, workX, t - 4.15);
    } else cookTravelX(workX, s.homeX, (t - 4.8) / 1.2);

    if (t >= 6.0) {
      guide.position.x = s.homeX;
      s.diner.userData.ai.needsService = false;
      s.diner.userData.ai.locked = false;
      guide.userData.ai.locked = false;
      setAct(s.diner, 'eat', rnd(12, 18));
      setAct(guide, 'stir', rnd(6, 10));
      finishCookWalk();
      serviceAudit.completed = true;
      service = null;
      // Resume the room promptly after service. On a software renderer the old
      // delay plus sparse frames could leave the stall silent for the full
      // smoke-test window even though the director itself was still healthy.
      nextBeatAt = nowSec() + rnd(3, 6);
    }
  }

  const _handL = new THREE.Vector3(), _handR = new THREE.Vector3();
  const _carry = new THREE.Vector3(), _seatBowl = new THREE.Vector3();
  const _carryHead = new THREE.Vector3(), _carryBowlBox = new THREE.Box3();
  const _carryAxis = new THREE.Vector3(), _carryHands = new THREE.Vector3();
  function carryHandSeparation() {
    // Signed separation along the cook's lateral axis stays meaningful while
    // turning. World-X projection collapses sideways grips to zero and can
    // label two correctly separated hands as crossed.
    _carryAxis.set(1, 0, 0).transformDirection(guide.matrixWorld);
    return _carryHands.copy(_handR).sub(_handL).dot(_carryAxis);
  }
  const SERVICE_BOWL_DROP = 0.33;
  function syncServiceBowl() {
    if (!serviceBowl?.visible || !guideRig) return;
    guide.updateMatrixWorld(true);
    guideRig.armL.hand.getWorldPosition(_handL);
    guideRig.armR.hand.getWorldPosition(_handR);
    _carry.copy(_handL).add(_handR).multiplyScalar(0.5);
    // The bowl origin sits at its base, while the hands meet it near the rim.
    // Keeping the old 3.5 cm offset put the entire bowl over the cook's face.
    _carry.y -= SERVICE_BOWL_DROP;
    if (service) {
      const t = nowSec() - service.startedAt;
      service.bowl.getWorldPosition(_seatBowl);
      if (t < 1.65) serviceBowl.position.copy(_seatBowl).lerp(_carry, ease01((t - 1.0) / 0.65));
      else if (t < 4.15) serviceBowl.position.copy(_carry);
      else serviceBowl.position.copy(_carry).lerp(_seatBowl, ease01((t - 4.15) / 0.65));
      return;
    }
    const tr = activeTurnover;
    if (!tr || (tr.phase !== 'clear' && tr.phase !== 'welcome')) return;
    const t = nowSec() - tr.phaseAt;
    tr.diner.userData.table.bowl.getWorldPosition(_seatBowl);
    if (tr.phase === 'clear') {
      serviceBowl.position.copy(_seatBowl).lerp(_carry, ease01((t - 0.7) / 0.55));
    } else if (t < 1.4) {
      serviceBowl.position.copy(_carry);
    } else {
      serviceBowl.position.copy(_carry).lerp(_seatBowl, ease01((t - 1.4) / 0.65));
    }
  }

  function updateOrderUI() {
    if (!orderPanel) return;
    orderPanel.hidden = phase !== 'seated' || bookOpen || visitorOrder.dismissed;
    if (orderReopenPanel) orderReopenPanel.hidden = phase !== 'seated' || bookOpen || !visitorOrder.dismissed;
    orderTitle.textContent = visitorOrder.dish === 'house' ? LABELS.orderHouse
      : visitorOrder.dish === 'veggie' ? LABELS.orderVeggie : LABELS.orderTitle;
    orderChoices.hidden = visitorOrder.status !== 'choosing';
    for (const button of orderChoices.querySelectorAll('button')) button.disabled = !!visitorOrder.dish;
    orderSkip.hidden = visitorOrder.status !== 'choosing';
    if (orderComplete) orderComplete.hidden = visitorOrder.status !== 'done';
    orderStatus.textContent = visitorOrder.status === 'queued' ? LABELS.orderQueued
      : visitorOrder.status === 'serving' ? LABELS.orderServing
        : visitorOrder.status === 'done' && visitorOrder.firstBite ? LABELS.orderComplete
          : visitorOrder.dish ? LABELS.orderEnjoy : '';
  }

  function visitorBowl(dish) {
    let bowl = you.userData.table.bowl;
    if (!bowl) {
      bowl = buildRamenBowl(false, true, dish);
      bowl.userData.seatX = SEAT.x;
      bowl.userData.steam = addSteam(_visitorSeat.clone().add(new THREE.Vector3(0, 0.22, 0)), 0.13, 2);
      you.userData.table.bowl = bowl;
      scene.add(bowl);
      setBowlVisible(bowl, false);
      you.userData.visitorMeal = { cur: seatedPose(you), biting: false, biteT: 0 };
    }
    return bowl;
  }

  function orderMeal(dish) {
    if (phase !== 'seated' || visitorOrder.dismissed || visitorOrder.dish || !['house', 'veggie'].includes(dish)) return false;
    visitorOrder.dish = dish;
    visitorOrder.firstBite = false;
    delete visitorOrder.completedAt;
    const bowl = visitorBowl(dish);
    bowl.userData.dish = dish;
    bowl.userData.ingredients = dish === 'veggie'
      ? ['bowl', 'broth', 'noodles', 'tofu', 'mushroom', 'nori', 'spring-onion', 'chopsticks']
      : ['bowl', 'broth', 'noodles', 'egg', 'nori', 'chashu', 'spring-onion', 'chopsticks'];
    setBowlFill(bowl, 1);
    setBowlVisible(bowl, false);
    visitorOrder.status = 'queued';
    // A display-only GLB has no serving rig yet (#79); don't strand an order.
    if (REDUCED || !guideRig) placeVisitorMeal(true);
    updateOrderUI();
    return true;
  }

  function placeVisitorMeal(immediate = false) {
    const bowl = you.userData.table.bowl;
    bowl.position.copy(_visitorSeat);
    bowl.userData.steam.position.copy(_visitorSeat).add(_ikWorld.set(0, 0.22, 0));
    setBowlVisible(bowl, true);
    visitorOrder.status = immediate ? 'done' : 'eating';
    visitorOrder.carrying = false;
    visitorOrder.biteAt = nowSec();
    updateOrderUI();
  }

  function tickVisitorService() {
    if (visitorOrder.status === 'queued') {
      if (service || activeTurnover || beat) return;
      visitorOrder.status = 'serving';
      visitorOrder.startedAt = nowSec();
      visitorOrder.homeX = guide.position.x;
      guide.userData.ai.locked = true;
      setAct(guide, 'serve', 6.2);
      guide.userData.walkHomeRotation = guide.rotation.y;
      beginWalk(guide);
      updateOrderUI();
    }
    if (visitorOrder.status !== 'serving') return;
    const t = nowSec() - visitorOrder.startedAt;
    const workX = SEAT.x - 0.28;
    if (t < 1.4) guide.position.x = visitorOrder.homeX;
    else if (t < 3.4) cookTravelX(visitorOrder.homeX, workX, (t - 1.4) / 2);
    else if (t < 4.1) {
      guide.position.x = workX;
      faceCookAtStation(visitorOrder.homeX, workX, t - 3.4);
    } else cookTravelX(workX, visitorOrder.homeX, (t - 4.1) / 1.9);
    if (t >= 0.7) setBowlVisible(you.userData.table.bowl, true);
    if (t >= 6) {
      guide.position.x = visitorOrder.homeX;
      guide.userData.ai.locked = false;
      setAct(guide, 'stir', rnd(6, 10));
      finishCookWalk();
      placeVisitorMeal();
      nextBeatAt = nowSec() + rnd(3, 6);
    }
  }

  function syncVisitorBowl() {
    if (visitorOrder.status !== 'serving') return;
    const bowl = you.userData.table.bowl;
    const t = nowSec() - visitorOrder.startedAt;
    visitorOrder.carrying = t >= 1.4 && t < 3.4;
    guide.updateMatrixWorld(true);
    guideRig.armL.hand.getWorldPosition(_handL);
    guideRig.armR.hand.getWorldPosition(_handR);
    _carry.copy(_handL).add(_handR).multiplyScalar(0.5);
    _carry.y -= 0.18; // Visitor bowl's unscaled rim is 18cm above its base.
    if (t < 1.4) bowl.position.copy(_visitorPrep).lerp(_carry, ease01((t - 0.7) / 0.7));
    else if (t < 3.4) bowl.position.copy(_carry);
    else bowl.position.copy(_carry).lerp(_visitorSeat, ease01((t - 3.4) / 0.7));
    bowl.userData.steam.position.copy(bowl.position).add(_ikWorld.set(0, 0.22, 0));
  }

  function tickVisitorMeal(dt) {
    const meal = you.userData.visitorMeal;
    if (!meal || REDUCED || visitorOrder.status === 'choosing' || visitorOrder.status === 'queued' || visitorOrder.status === 'serving') return;
    const at = nowSec();
    if (visitorOrder.status === 'done' && (!visitorOrder.firstBite || at - visitorOrder.completedAt > 1)) return;
    meal.biteT = Math.max(0, at - visitorOrder.biteAt);
    meal.biting = visitorOrder.status === 'eating' && at >= visitorOrder.biteAt;
    if (meal.biting && meal.biteT >= 4.25) {
      meal.biting = false;
      visitorOrder.firstBite = true;
      const bowl = you.userData.table.bowl;
      setBowlFill(bowl, Math.max(0, bowl.userData.fill - 0.18));
      if (bowl.userData.fill <= 0.01) {
        visitorOrder.status = 'done';
        visitorOrder.completedAt = at;
        updateOrderUI();
      } else {
        visitorOrder.biteAt = at + rnd(0.8, 2.2);
      }
    }
    const eating = visitorOrder.status === 'eating';
    const pose = seatedPose(you);
    if (eating) SEATED_ACTS.eat(pose, meal.biteT, you);
    easePose(meal.cur, pose, 1 - Math.exp(-dt * 7));
    applyPose(you.userData.rig, meal.cur);
    const table = you.userData.table;
    table.heldChopsticks.visible = eating;
    table.noodleLift.visible = meal.biting && meal.biteT >= 0.45 && meal.biteT < 2.85;
    for (const stick of table.bowl.userData.restingChopsticks) stick.visible = !eating;
    if (eating) syncChopstickGrip(you);
  }

  const onOrderClick = (event) => {
    const dish = event.target.closest('[data-visitor-dish]')?.dataset.visitorDish;
    if (dish) orderMeal(dish);
  };
  const chooseAnotherMeal = () => {
    if (visitorOrder.status !== 'done') return;
    visitorOrder.status = 'choosing';
    visitorOrder.dish = null;
    updateOrderUI();
  };
  const onOrderSkip = () => {
    if (visitorOrder.status !== 'choosing') return;
    visitorOrder.dismissed = true;
    updateOrderUI();
  };
  const onOrderDone = () => {
    if (visitorOrder.status !== 'done') return;
    visitorOrder.dismissed = true;
    updateOrderUI();
  };
  const onOrderReopen = () => {
    visitorOrder.dismissed = false;
    if (visitorOrder.status === 'done') chooseAnotherMeal();
    else updateOrderUI();
  };

  /* ---------- speech ---------- */
  const bubbles = [];
  const _bubV = new THREE.Vector3();
  function say(npc, text, dur = 3.4) {
    if (!npc || !text) return;
    const el = document.createElement('div');
    el.className = 'say';
    el.textContent = text;
    document.body.appendChild(el);
    bubbles.push({ el, npc, bornAt: nowSec(), dur });
  }
  function updateBubbles() {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const t = nowSec() - b.bornAt;
      if (t >= b.dur) { b.el.remove(); bubbles.splice(i, 1); continue; }
      b.npc.userData.rig.head.getWorldPosition(_bubV);
      _bubV.y += 0.52; // clears the "you" tag, which sits just above head height
      _bubV.project(camera);
      const off = _bubV.z > 1;
      b.el.style.display = off ? 'none' : '';
      if (off) continue;
      b.el.style.left = (_bubV.x * 0.5 + 0.5) * window.innerWidth + 'px';
      b.el.style.top = (-_bubV.y * 0.5 + 0.5) * window.innerHeight + 'px';
      b.el.style.opacity = String(Math.max(0, Math.min(1, Math.min(t, b.dur - t) / 0.35)));
    }
  }
  const pickLine = (arr) => (arr && arr.length ? arr[(random() * arr.length) | 0] : '');

  /* ---------- the director ----------
     Independent loops read as machinery. Two characters acknowledging each other
     once every twenty seconds is what makes the place feel occupied. One beat
     runs at a time; it locks its cast, fires timed cues, then releases them. */
  let beat = null;
  let nextBeatAt = 0; // set on the first tick, once the clock is meaningful

  function startBeat(cast, dur, cues) {
    for (const n of cast) if (n.userData.ai) n.userData.ai.locked = true;
    beat = { cast, dur, cues, startedAt: nowSec(), i: 0 };
  }
  function tickBeat() {
    if (!beat) return;
    const t = nowSec() - beat.startedAt;
    while (beat.i < beat.cues.length && t >= beat.cues[beat.i].at) {
      beat.cues[beat.i].go();
      beat.i++;
    }
    if (t >= beat.dur) {
      for (const n of beat.cast) if (n.userData.ai) n.userData.ai.locked = false;
      beat = null;
      nextBeatAt = nowSec() + rnd(11, 21);
    }
  }

  function chooseBeat() {
    const cook = guideRig ? guide : null;
    const seated = diners.filter((d) => d.userData.ai && !d.userData.ai.turnover && !d.userData.ai.readyToLeave);
    if (!seated.length) return;
    const roll = random();

    // 1. the cook works the pot and acknowledges someone at the counter.
    // Serving is omitted until a bowl can physically travel with the gesture.
    if (cook && roll < 0.42) {
      const who = seated[(random() * seated.length) | 0];
      who.userData.ai.face = who.position.x < 0 ? 0.5 : -0.5;
      startBeat([cook, who], 7.6, [
        { at: 0.0, go: () => { setAct(cook, 'stir', 4.2); setAct(who, 'lookUp', 3.4); } },
        { at: 1.0, go: () => say(cook, pickLine(CHATTER.cook), 3.0) },
        { at: 4.2, go: () => { setAct(cook, 'wipe', 2.6); setAct(who, 'eat', 5.0); } },
        { at: 7.0, go: () => setAct(cook, 'stir', 6) },
      ]);
      return;
    }

    // 2. the cook says something across the counter
    if (cook && roll < 0.68) {
      const who = seated[(random() * seated.length) | 0];
      who.userData.ai.face = who.position.x < 0 ? 0.5 : -0.5;
      startBeat([cook, who], 7.4, [
        { at: 0.0, go: () => { setAct(cook, 'chat', 4.2); setAct(who, 'listen', 4.6); } },
        { at: 0.3, go: () => say(cook, pickLine(CHATTER.cook), 3.4) },
        { at: 4.4, go: () => say(who, pickLine(CHATTER.diner), 2.4) },
        { at: 4.4, go: () => { setAct(who, 'talk', 2.4); setAct(cook, 'stir', 3); } },
        { at: 6.6, go: () => setAct(who, 'eat', 6) },
      ]);
      return;
    }

    // 3. two people at the counter talk to each other
    if (seated.length >= 2) {
      const sorted = [...seated].sort((a, b) => a.position.x - b.position.x);
      const i = (random() * (sorted.length - 1)) | 0;
      const a = sorted[i], b = sorted[i + 1];
      a.userData.ai.face = -0.55; b.userData.ai.face = 0.55;
      startBeat([a, b], 8.6, [
        { at: 0.0, go: () => { setAct(a, 'talk', 3.2); setAct(b, 'listen', 3.6); } },
        { at: 0.2, go: () => say(a, pickLine(CHATTER.diner), 2.8) },
        { at: 3.4, go: () => { setAct(b, 'talk', 2.6); setAct(a, 'listen', 2.8); } },
        { at: 3.6, go: () => say(b, pickLine(CHATTER.diner), 2.6) },
        { at: 6.4, go: () => { setAct(a, 'eat', 6); setAct(b, 'eat', 6); } },
      ]);
    }
  }

  function tickDirector() {
    if (REDUCED) return;
    if (!nextBeatAt) nextBeatAt = nowSec() + 6;
    if (beat) { tickBeat(); return; }
    if (visitorOrder.status === 'queued') return;
    if (nowSec() >= nextBeatAt) chooseBeat();
  }

  function solveWalkingLeg(leg, footZ, lift, amt) {
    const upper = 0.4, lower = 0.375;
    const targetY = -0.755 + lift * amt;
    const targetZ = footZ * amt;
    const reach = Math.min(upper + lower - 0.001, Math.hypot(targetY, targetZ));
    const knee = Math.acos(Math.max(-1, Math.min(1,
      (reach * reach - upper * upper - lower * lower) / (2 * upper * lower)
    )));
    const targetAngle = Math.atan2(-targetZ, -targetY);
    const hip = targetAngle - Math.atan2(lower * Math.sin(knee), upper + lower * Math.cos(knee));
    leg.hp.rotation.x = hip;
    leg.knee.rotation.x = knee;
  }

  // Distance, not wall time, drives this gait. During each half-stride the
  // stance foot moves backward by exactly the root's forward displacement;
  // its world position therefore stays planted until the other foot lands.
  function walkRig(rig, distance, amt = 1, swingArms = true) {
    const foot = (offset) => {
      const cycle = ((distance / WALK_STRIDE + offset) % 1 + 1) % 1;
      if (cycle < 0.5) return { z: WALK_STRIDE * (0.25 - cycle), lift: 0 };
      const u = (cycle - 0.5) * 2;
      return {
        z: mix(-WALK_STRIDE * 0.25, WALK_STRIDE * 0.25, ease01(u)),
        lift: Math.sin(u * Math.PI) * 0.09,
      };
    };
    const left = foot(0.25), right = foot(0.75);
    solveWalkingLeg(rig.legL, left.z, left.lift, amt);
    solveWalkingLeg(rig.legR, right.z, right.lift, amt);
    rig.hip.position.y = mix(0.8, 0.78, amt);
    if (!swingArms) return;
    const phase = distance / WALK_STRIDE * Math.PI * 2;
    rig.armL.sh.rotation.x = Math.sin(phase + Math.PI) * 0.32 * amt;
    rig.armR.sh.rotation.x = Math.sin(phase) * 0.32 * amt;
    rig.armL.elbow.rotation.x = -0.25 * amt;
    rig.armR.elbow.rotation.x = -0.25 * amt;
    rig.armL.elbow.rotation.z = 0;
    rig.armR.elbow.rotation.z = 0;
    rig.torso.rotation.z = Math.sin(phase) * 0.025 * amt;
  }

  function beginWalk(npc) {
    npc.userData.walk = {
      distance: npc.userData.walk?.distance || 0,
      x: npc.position.x,
      z: npc.position.z,
      moving: false,
    };
  }

  function applyWalkFromTravel(npc, amt = 1, swingArms = true) {
    const walk = npc.userData.walk || (beginWalk(npc), npc.userData.walk);
    const dx = npc.position.x - walk.x;
    const dz = npc.position.z - walk.z;
    const step = Math.hypot(dx, dz);
    walk.distance += step / Math.max(0.001, npc.scale.x);
    walk.x = npc.position.x;
    walk.z = npc.position.z;
    walk.moving = step > 0.00001;
    if (walk.moving) walkRig(npc.userData.rig, walk.distance, amt, swingArms);
  }

  function cookTravelX(from, to, u) {
    const homeRotation = guide.userData.walkHomeRotation ?? guide.rotation.y;
    guide.userData.walkHomeRotation = homeRotation;
    const direction = Math.sign(to - from);
    const travelRotation = direction < 0 ? -Math.PI / 2 : direction > 0 ? Math.PI / 2 : homeRotation;
    const turn = ease01(u / 0.18);
    const travel = ease01((u - 0.18) / 0.82);
    guide.position.x = mix(from, to, travel);
    guide.rotation.y = mix(homeRotation, travelRotation, turn);
    guide.userData.serviceWalking = true;
    guide.userData.walkAmount = ease01(travel / 0.12);
  }

  function faceCookAtStation(from, to, elapsed, duration = 0.22) {
    const homeRotation = guide.userData.walkHomeRotation ?? guide.rotation.y;
    const direction = Math.sign(to - from);
    const travelRotation = direction < 0 ? -Math.PI / 2 : direction > 0 ? Math.PI / 2 : homeRotation;
    guide.rotation.y = mix(travelRotation, homeRotation, ease01(elapsed / duration));
  }

  function applyCookWalk() {
    if (!guideRig || !guide?.userData.serviceWalking) return;
    applyWalkFromTravel(guide, guide.userData.walkAmount, false);
  }

  function finishCookWalk() {
    if (!guideRig) return;
    guide.userData.serviceWalking = false;
    guide.rotation.y = guide.userData.walkHomeRotation ?? guide.rotation.y;
    guideRig.legL.hp.rotation.x = 0;
    guideRig.legR.hp.rotation.x = 0;
    guideRig.legL.knee.rotation.x = 0;
    guideRig.legR.knee.rotation.x = 0;
    guideRig.hip.position.y = 0.8;
    beginWalk(guide);
  }

  function standingCustomerPose(npc) {
    const p = seatedPose(npc);
    p.hipY = 0.8;
    p.torsoX = 0.04;
    p.headX = 0;
    p.lShX = 0; p.lShZ = 0; p.lElX = 0;
    p.rShX = 0; p.rShZ = 0; p.rElX = 0;
    p.lElZ = 0; p.rElZ = 0;
    return p;
  }

  function blendPose(a, b, u) {
    const p = {};
    for (const key in a) p[key] = mix(a[key], b[key], u);
    return p;
  }

  function setCustomerAppearance(npc) {
    const ai = npc.userData.ai;
    const index = diners.indexOf(npc);
    const look = CUSTOMER_PALETTE[(index + ai.customerGeneration) % CUSTOMER_PALETTE.length];
    for (const mat of npc.userData.appearance?.shirt || []) mat.color.setHex(look.shirt);
    npc.userData.appearance?.hair?.color.setHex(look.hair);
  }

  function setTurnoverPhase(turnover, phase, duration) {
    turnover.phase = phase;
    turnover.phaseAt = nowSec();
    turnover.duration = duration;
    turnover.diner.userData.ai.turnover = phase;
    if (['stepOut', 'leave', 'arrive', 'stepIn'].includes(phase)) beginWalk(turnover.diner);
  }

  function beginTurnover(diner) {
    const ai = diner.userData.ai;
    if (!ai || activeTurnover || service || beat || visitorOrder.status === 'queued') return false;
    ai.locked = true;
    ai.needsService = false;
    setAct(diner, 'pause', 60);
    const entryX = diner.position.x < 0 ? -4.35 : 4.35;
    activeTurnover = {
      diner,
      seatX: diner.userData.seatX,
      seatRotation: diner.userData.seatRotation,
      entryX,
      stageZ: CUSTOMER_Z + 0.42,
      guideHomeX: guide.position.x,
      bowlCleared: false,
      bowlPlaced: false,
      phase: 'stand', phaseAt: nowSec(), duration: 1.2,
    };
    ai.turnover = 'stand';
    const table = diner.userData.table;
    table.heldChopsticks.visible = false;
    table.noodleLift.visible = false;
    table.heldCup.visible = false;
    for (const stick of table.bowl?.userData.restingChopsticks || []) stick.visible = true;
    if (table.bowl?.userData.counterCup) table.bowl.userData.counterCup.visible = true;
    return true;
  }

  function finishTurnover(turnover) {
    const diner = turnover.diner;
    const ai = diner.userData.ai;
    diner.position.set(turnover.seatX, 0, CUSTOMER_Z);
    diner.rotation.y = turnover.seatRotation;
    const seated = seatedPose(diner);
    applyPose(diner.userData.rig, seated);
    diner.userData.rig.legL.hp.rotation.x = -1.5;
    diner.userData.rig.legR.hp.rotation.x = -1.5;
    diner.userData.rig.legL.knee.rotation.x = 1.5;
    diner.userData.rig.legR.knee.rotation.x = 1.5;
    ai.cur = seated;
    ai.tgt = seatedPose(diner);
    ai.mealsFinished = 0;
    ai.emptyCounted = false;
    ai.readyToLeave = false;
    ai.turnover = null;
    ai.locked = false;
    setBowlFill(diner.userData.table.bowl, 1);
    setBowlVisible(diner.userData.table.bowl, true);
    setAct(diner, 'eat', rnd(28, 42));
    activeTurnover = null;
  }

  function startTurnoverCook(fill) {
    guide.userData.ai.locked = true;
    setAct(guide, 'serve', 4);
    setBowlFill(serviceBowl, fill);
    serviceBowl.visible = true;
  }

  function finishTurnoverCook(tr) {
    guide.position.x = tr.guideHomeX;
    guide.userData.ai.locked = false;
    setAct(guide, 'stir', rnd(6, 10));
    serviceBowl.visible = false;
    finishCookWalk();
  }

  function tickTurnover() {
    if (!activeTurnover) {
      if (service || beat) return;
      const waiting = diners.find((d) => d.userData.ai?.readyToLeave);
      if (waiting) beginTurnover(waiting);
      return;
    }

    const tr = activeTurnover;
    const diner = tr.diner;
    const rig = diner.userData.rig;
    const elapsed = nowSec() - tr.phaseAt;
    const u = ease01(elapsed / tr.duration);
    const standing = standingCustomerPose(diner);

    if (tr.phase === 'stand') {
      applyPose(rig, blendPose(seatedPose(diner), standing, u));
      const legs = ease01((u - 0.38) / 0.62);
      rig.legL.hp.rotation.x = mix(-1.5, 0, legs);
      rig.legR.hp.rotation.x = mix(-1.5, 0, legs);
      rig.legL.knee.rotation.x = mix(1.5, 0, legs);
      rig.legR.knee.rotation.x = mix(1.5, 0, legs);
      diner.position.z = mix(CUSTOMER_Z, tr.stageZ, u);
      diner.rotation.y = mix(tr.seatRotation, Math.PI, u);
      if (elapsed >= tr.duration) setTurnoverPhase(tr, 'stepOut', TURNOVER_WALK.depthSeconds);
    } else if (tr.phase === 'stepOut') {
      applyPose(rig, standing);
      // Turn away from the counter before taking the first outward step. The
      // old version translated toward +Z while still facing -Z, so customers
      // visibly moonwalked away from their stool.
      const turn = ease01(u / 0.18);
      const travel = ease01((u - 0.18) / 0.82);
      diner.position.z = mix(tr.stageZ, 2.42, travel);
      diner.rotation.y = mix(Math.PI, 0, turn);
      applyWalkFromTravel(diner, ease01(travel / 0.14));
      if (elapsed >= tr.duration) setTurnoverPhase(tr, 'leave', TURNOVER_WALK.lateralSeconds);
    } else if (tr.phase === 'leave') {
      applyPose(rig, standing);
      const exitRotation = tr.entryX < tr.seatX ? -Math.PI / 2 : Math.PI / 2;
      const turn = ease01(u / 0.04);
      const travel = ease01((u - 0.04) / 0.96);
      diner.position.x = mix(tr.seatX, tr.entryX, travel);
      diner.position.z = 2.42;
      diner.rotation.y = mix(0, exitRotation, turn);
      applyWalkFromTravel(diner, ease01(travel / 0.1));
      if (elapsed >= tr.duration) {
        diner.visible = false;
        diner.userData.ai.customerGeneration++;
        setCustomerAppearance(diner);
        guide.position.x = tr.guideHomeX;
        setAct(guide, 'serve', 4);
        guide.userData.ai.locked = true;
        guide.userData.walkHomeRotation = guide.rotation.y;
        beginWalk(guide);
        setTurnoverPhase(tr, 'clear', 2.6);
      }
    } else if (tr.phase === 'clear') {
      const workX = tr.seatX + (tr.seatX < 0 ? 0.28 : -0.28);
      if (elapsed < 0.7) cookTravelX(tr.guideHomeX, workX, elapsed / 0.7);
      else if (elapsed < 1.25) {
        guide.position.x = workX;
        faceCookAtStation(tr.guideHomeX, workX, elapsed - 0.7);
      } else cookTravelX(workX, tr.guideHomeX, (elapsed - 1.25) / 1.15);
      if (elapsed >= 0.7 && !tr.bowlCleared) {
        setBowlVisible(diner.userData.table.bowl, false);
        startTurnoverCook(0);
        tr.bowlCleared = true;
      }
      if (elapsed >= tr.duration) {
        finishTurnoverCook(tr);
        setTurnoverPhase(tr, 'vacant', rnd(4, 7));
      }
    } else if (tr.phase === 'vacant') {
      if (elapsed >= tr.duration) {
        diner.position.set(tr.entryX, 0, 2.42);
        diner.rotation.y = tr.entryX < tr.seatX ? Math.PI / 2 : -Math.PI / 2;
        diner.visible = true;
        setTurnoverPhase(tr, 'arrive', TURNOVER_WALK.lateralSeconds);
      }
    } else if (tr.phase === 'arrive') {
      applyPose(rig, standing);
      diner.position.x = mix(tr.entryX, tr.seatX, u);
      diner.position.z = 2.42;
      diner.rotation.y = tr.entryX < tr.seatX ? Math.PI / 2 : -Math.PI / 2;
      applyWalkFromTravel(diner, ease01(u / 0.1));
      if (elapsed >= tr.duration) setTurnoverPhase(tr, 'stepIn', TURNOVER_WALK.depthSeconds);
    } else if (tr.phase === 'stepIn') {
      applyPose(rig, standing);
      const turn = ease01(u / 0.08);
      const travel = ease01((u - 0.08) / 0.92);
      const arrivalRotation = tr.entryX < tr.seatX ? Math.PI / 2 : -Math.PI / 2;
      const inwardRotation = arrivalRotation > 0 ? Math.PI : -Math.PI;
      diner.position.x = tr.seatX;
      diner.position.z = mix(2.42, tr.stageZ, travel);
      diner.rotation.y = mix(arrivalRotation, inwardRotation, turn);
      applyWalkFromTravel(diner, ease01(travel / 0.14));
      if (elapsed >= tr.duration) setTurnoverPhase(tr, 'sit', 1.2);
    } else if (tr.phase === 'sit') {
      applyPose(rig, blendPose(standing, seatedPose(diner), u));
      rig.legL.hp.rotation.x = mix(0, -1.5, u);
      rig.legR.hp.rotation.x = mix(0, -1.5, u);
      rig.legL.knee.rotation.x = mix(0, 1.5, u);
      rig.legR.knee.rotation.x = mix(0, 1.5, u);
      diner.position.z = mix(tr.stageZ, CUSTOMER_Z, u);
      diner.rotation.y = mix(Math.PI, tr.seatRotation, u);
      if (elapsed >= tr.duration) {
        diner.position.z = CUSTOMER_Z;
        setAct(diner, 'lookUp', 4);
        startTurnoverCook(1);
        setTurnoverPhase(tr, 'welcome', 3.1);
      }
    } else if (tr.phase === 'welcome') {
      const workX = tr.seatX + (tr.seatX < 0 ? 0.28 : -0.28);
      if (elapsed < 1.2) cookTravelX(tr.guideHomeX, workX, elapsed / 1.2);
      else if (elapsed < 2.05) {
        guide.position.x = workX;
        faceCookAtStation(tr.guideHomeX, workX, elapsed - 1.2);
      } else cookTravelX(workX, tr.guideHomeX, (elapsed - 2.05) / 0.95);
      if (elapsed >= 2.05 && !tr.bowlPlaced) {
        setBowlFill(diner.userData.table.bowl, 1);
        setBowlVisible(diner.userData.table.bowl, true);
        serviceBowl.visible = false;
        tr.bowlPlaced = true;
      }
      if (elapsed >= tr.duration) {
        finishTurnoverCook(tr);
        finishTurnover(tr);
      }
    }
  }

  // one person hunched over a bowl, chopsticks in hand
  function seatedPerson(sp, bowl = null, autonomous = true, seatTopY = SEAT_TOP_Y) {
    const d = buildPerson({
      shirt: sp.shirt, hair: sp.hair,
      scale: sp.scale ?? 0.96, build: sp.build ?? 1, headScale: sp.headScale ?? 1,
    });
    d.position.set(sp.x, 0, CUSTOMER_Z);
    d.rotation.y = Math.PI + (sp.facing || 0);
    d.userData.seatX = sp.x;
    d.userData.seatRotation = d.rotation.y;
    const r = d.userData.rig;
    // Sit the pelvis on the seat instead of through it. The pelvis is a sphere
    // of radius 0.135*build squashed to 0.66 in y, and the whole person is
    // scaled, so the hip height that lands its underside on the seat differs
    // per character.
    const sc = sp.scale ?? 0.96;
    const pelvisHalf = 0.135 * (sp.build ?? 1) * 0.66;
    d.userData.seatHipY = seatTopY / sc + pelvisHalf;
    r.hip.position.y = d.userData.seatHipY;
    // Neutral seated posture: thighs horizontal and lower legs vertical. The
    // recessed counter front provides the knee space this pose actually needs.
    r.legL.hp.rotation.x = -1.5; r.legR.hp.rotation.x = -1.5;
    r.legL.knee.rotation.x = 1.5; r.legR.knee.rotation.x = 1.5;
    r.armL.sh.rotation.x = -0.5; r.armR.sh.rotation.x = -0.7;
    r.armR.elbow.rotation.x = -1.0;
    const heldChopsticks = new THREE.Group();
    // Tip is the group origin. The grip end sits to the diner's right so the
    // pair spans the food-to-hand line instead of inheriting the wrist hinge.
    heldChopsticks.userData.axis = new THREE.Vector3(0, 0, 1);
    heldChopsticks.userData.direction = new THREE.Vector3();
    heldChopsticks.userData.normalized = new THREE.Vector3();
    heldChopsticks.userData.sticks = [];
    heldChopsticks.userData.grip = new THREE.Object3D();
    heldChopsticks.add(heldChopsticks.userData.grip);
    for (const x of [-0.01, 0.01]) {
      const stick = new THREE.Mesh(
        new THREE.BoxGeometry(0.009, 0.009, 1),
        m(0x8a6a3c, { rough: 0.8 })
      );
      stick.userData.pairOffset = x;
      heldChopsticks.add(stick);
      heldChopsticks.userData.sticks.push(stick);
    }
    const noodleLift = pos(cap(0.006, 0.13, 0xe8c26a, { rough: 0.8 }, 6), 0, -0.065, 0);
    noodleLift.rotation.z = 0.08;
    heldChopsticks.add(noodleLift);
    heldChopsticks.visible = false;
    r.torso.add(heldChopsticks);
    const heldCup = mug(0.055, 0.045, 0.11, 0xd8c8a5);
    heldCup.rotation.y = Math.PI;
    heldCup.visible = false;
    r.torso.add(heldCup);
    d.userData.table = { bowl, heldChopsticks, noodleLift, heldCup, chopstickTip: new THREE.Vector3() };
    if (autonomous) {
      initAI(d, 'diner', seatedPose);
      diners.push(d);
    }
    scene.add(d);
    if (bowl) {
      scene.updateMatrixWorld(true);
      objectPointInTorso(d, bowl.userData.counterCup, _ikWorld.set(0, 0, 0), heldCup.position);
    }
    return d;
  }

  function buildStool(x, style) {
    const topY = SEAT_TOP_Y + style.height;
    const seat = pos(cyl(0.17, 0.17, 0.06, style.color, { rough: 0.76 }, 18), x, topY - 0.03, CUSTOMER_Z);
    seat.rotation.y = style.rotation;
    seat.userData.seatX = x;
    stoolSeats.push(seat);
    scene.add(seat);
    const legHeight = topY - 0.03;
    const legMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, legHeight / 2, CUSTOMER_Z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, legHeight, 1),
    );
    stoolLegs.setMatrixAt(stoolLegs.count++, legMatrix);
    stoolLegs.instanceMatrix.needsUpdate = true;
    const g = new THREE.Group();
    g.position.set(x, 0, CUSTOMER_Z);
    addBlobShadow(g, 0.46, 0.75);
    scene.add(g);
    stoolStyles.push({ x, topY, rotation: style.rotation, color: style.color });
    return topY;
  }

  function buildDiners() {
    stoolLegs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.03, 0.05, 1, 10),
      m(0x2a2018),
      STOOL_STYLES.length,
    );
    stoolLegs.count = 0;
    scene.add(stoolLegs);
    DINER_SPECS.forEach((sp, index) => {
      const seatTopY = buildStool(sp.x, STOOL_STYLES[index]);
      const bowl = ramenBowls.find((candidate) => candidate.userData.seatX === sp.x);
      seatedPerson(sp, bowl, true, seatTopY);
    });
  }

  /* ---------- the free stool: the one seat that is always open ---------- */
  function buildEmptySeat() {
    const style = STOOL_STYLES[3];
    const g = new THREE.Group();
    g.position.set(SEAT.x, 0, SEAT.z);
    g.rotation.y = style.rotation;
    g.add(pos(cyl(0.17, 0.17, 0.06, style.color, { rough: 0.76 }, 18), 0, SEAT_TOP_Y - 0.03, 0));
    const legHeight = SEAT_TOP_Y - 0.03;
    const legMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(SEAT.x, legHeight / 2, SEAT.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, legHeight, 1),
    );
    stoolLegs.setMatrixAt(stoolLegs.count++, legMatrix);
    stoolLegs.instanceMatrix.needsUpdate = true;
    stoolStyles.push({ x: SEAT.x, topY: SEAT_TOP_Y, rotation: style.rotation, color: style.color });
    buildYou();
    // a warm ring on the ground so the open stool reads as an invitation
    seatGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffc46b, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    });
    seatGlowMat.visible = phase !== 'seated'; // skipped intro: never show the ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.23, 0.36, 32), seatGlowMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.016;
    g.add(ring);
    // A transparent volume makes the entire stool, not a tiny label or one
    // narrow cylinder, a reliable mouse/touch target in the 3D canvas.
    seatHitArea = pos(box(0.9, 1.18, 0.9, 0xffffff), 0, 0.59, 0);
    seatHitArea.material.transparent = true;
    seatHitArea.material.opacity = 0;
    seatHitArea.material.depthWrite = false;
    seatHitArea.material.colorWrite = false;
    g.add(seatHitArea);
    scene.add(g);
    registerHotspot('seat', LABELS.seatHotspot, g, new THREE.Vector3(SEAT.x, 1.0, SEAT.z));
  }

  // you, on the stool. built up front but hidden until the camera leaves you,
  // so the empty seat is not still empty once you are supposedly sitting in it.
  function buildYou() {
    you = seatedPerson({
      x: SEAT.x, hair: 0x241a12, shirt: 0x8c4436, scale: 0.99, build: 1.02, headScale: 0.99,
    }, null, false);
    you.visible = false;
    you.traverse((n) => {
      if (!n.material) return;
      const list = Array.isArray(n.material) ? n.material : [n.material];
      for (const mat of list) youMats.push({ mat, wasTransparent: mat.transparent, base: mat.opacity });
    });
    // a small warm light just off your shoulder. not a spotlight on a stage, more
    // like the lantern happens to fall on you.
    setYouReveal(0);
  }

  // fade in by opacity alone. depthWrite is deliberately never touched: switching it
  // off for the fade and failing to switch it back leaves the figure with no
  // self-occlusion, so their far arm shows straight through their chest.
  function setYouReveal(v) {
    youReveal = v;
    if (!you) return;
    you.visible = v > 0.001;
    const solid = v >= 0.995;
    for (const e of youMats) {
      const wantTransparent = solid ? e.wasTransparent : true;
      if (e.mat.transparent !== wantTransparent) {
        e.mat.transparent = wantTransparent;
        e.mat.needsUpdate = true;
      }
      e.mat.opacity = solid ? e.base : e.base * v;
    }
  }

  function buildStreet() {
    const winTex = textTexture((g, w, h) => {
      g.fillStyle = '#0c0a16'; g.fillRect(0, 0, w, h);
      for (let y = 20; y < h - 20; y += 46) {
        for (let x = 16; x < w - 16; x += 40) {
          if (random() < 0.5) {
            g.fillStyle = random() < 0.7 ? 'rgba(255,196,120,0.85)' : 'rgba(150,180,255,0.7)';
            g.fillRect(x, y, 22, 30);
          }
        }
      }
    }, 512, 512);
    const bld = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), new THREE.MeshBasicMaterial({ map: winTex }));
    bld.position.set(-2, 7, -14);
    scene.add(bld);
    const bld2 = bld.clone(); bld2.position.set(12, 6, -16); bld2.scale.set(0.7, 0.8, 1);
    scene.add(bld2);

    // Keep the pavement quiet: two differently built passers-by at different
    // depths read as a street, while three abreast read as a crowd on display.
    const w1 = buildPerson({ shirt: 0x222a38, coat: 0x18202d, cap: 0x141922, hair: 0x101010, scale: 0.96, build: 1.05, headScale: 0.97 });
    addBlobShadow(w1, 0.34, 0.46);
    w1.position.set(-7.2, 0.02, 3.72); w1.rotation.y = Math.PI / 2;
    w1.userData.speed = 0.62; w1.userData.range = 8.4;
    w1.userData.baseZ = 3.46;
    w1.userData.avoid = [{ x: -5.48, radius: 1.0, offset: -0.52 }, { x: 4.18, radius: 1.0, offset: -0.52 }];
    walkers.push(w1); scene.add(w1);
    const w2 = buildPerson({ shirt: 0x49343f, coat: 0x30242e, bag: 0x6d4936, hair: 0x241713, longHair: true, scale: 0.86, build: 0.88, headScale: 1.03 });
    addBlobShadow(w2, 0.31, 0.42);
    w2.position.set(6.5, 0.02, 3.08); w2.rotation.y = -Math.PI / 2;
    w2.userData.speed = -0.48; w2.userData.range = 7.2;
    w2.userData.baseZ = 2.68;
    w2.userData.avoid = [{ x: -4.2, radius: 1.25, offset: 0.42 }, { x: 4.25, radius: 1.2, offset: 0.42 }];
    walkers.push(w2); scene.add(w2);

    const tree = (x, z, scale, mirror = 1) => {
      const g = new THREE.Group();
      // Street trees belong in planters and grow unevenly. A cluster of flat
      // low-poly crowns catches both the cool sky and the shop spill without
      // turning into the bright cone row from the first pass.
      g.add(pos(cyl(0.26, 0.31, 0.32, 0x343238, { rough: 1 }, 8), 0, 0.16, 0));
      const trunk = pos(cyl(0.055, 0.085, 1.28, 0x3c2c27, { rough: 1 }, 7), 0, 0.89, 0);
      trunk.rotation.z = mirror * 0.035;
      g.add(trunk);
      const crownMat = new THREE.MeshStandardMaterial({ color: 0x18352f, roughness: 1, flatShading: true });
      const clusters = [
        [0, 1.52, 0, 0.43],
        [-0.30 * mirror, 1.65, 0.02, 0.32],
        [0.27 * mirror, 1.74, -0.03, 0.36],
        [-0.08 * mirror, 1.98, 0, 0.34],
        [0.13 * mirror, 2.18, 0.02, 0.25],
      ];
      const crowns = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1), crownMat, clusters.length,
      );
      const crownTransform = new THREE.Object3D();
      clusters.forEach(([cx, cy, cz, r], index) => {
        crownTransform.position.set(cx, cy, cz);
        crownTransform.scale.set(r, r * 0.84, r);
        crownTransform.updateMatrix();
        crowns.setMatrixAt(index, crownTransform.matrix);
      });
      g.add(crowns);
      g.position.set(x, 0, z); g.scale.setScalar(scale);
      addBlobShadow(g, 0.5 * scale, 0.32);
      streetTrees.push(g); scene.add(g);
    };
    tree(-4.55, 1.72, 0.9, -1);
    tree(4.86, 1.48, 0.8, 1);

    // One utility pole and loose overhead lines do more for the alley context
    // than another decorative object on the pavement.
    const pole = pos(cyl(0.065, 0.09, 4.4, 0x20202a, { rough: 1 }, 8), -5.48, 2.2, 3.65);
    scene.add(pole);
    scene.add(pos(box(1.0, 0.07, 0.08, 0x20202a, { rough: 1 }), -5.25, 3.82, 3.65));
    const wireMat = new THREE.LineBasicMaterial({ color: 0x161722, transparent: true, opacity: 0.8 });
    const wireSegments = [];
    for (let i = 0; i < 3; i++) {
      const points = [];
      for (let s = 0; s <= 20; s++) {
        const u = s / 20;
        points.push(new THREE.Vector3(-5.65 + u * 11.5, 3.92 - i * 0.16 - Math.sin(u * Math.PI) * 0.24, 3.64 + i * 0.04));
      }
      for (let s = 1; s < points.length; s++) wireSegments.push(points[s - 1], points[s]);
    }
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wireSegments), wireMat));

    // A single warm lamp gives the sidewalk a secondary pool of light without
    // competing with the stall.
    const lamp = new THREE.Group();
    lamp.add(pos(cyl(0.035, 0.05, 2.6, 0x282832, { rough: 0.9 }, 8), 0, 1.3, 0));
    lamp.add(pos(box(0.42, 0.08, 0.08, 0x282832, { rough: 0.9 }), -0.17, 2.56, 0));
    const shade = pos(sph(0.16, 0x252631, { rough: 0.9 }, 12), -0.37, 2.49, 0);
    shade.scale.set(1, 0.38, 1);
    lamp.add(shade);
    lamp.add(pos(cyl(0.09, 0.09, 0.025, 0xffbd73, { emissive: 0xff8f45, emissiveIntensity: 2 }, 12), -0.37, 2.41, 0));
    lamp.position.set(4.18, 0, 3.62);
    scene.add(lamp);
    const streetLight = new THREE.PointLight(0xffa45a, 0.82, 3.4, 2);
    streetLight.position.set(3.81, 2.42, 3.62);
    scene.add(streetLight);

    const vending = (x, color, glow) => {
      const machine = new THREE.Group();
      machine.add(pos(box(0.48, 0.92, 0.34, color, { rough: 0.82 }), 0, 0.46, 0));
      const panelTex = textTexture((ctx, w, h) => {
        ctx.fillStyle = '#e6e2d6'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = `#${glow.toString(16).padStart(6, '0')}`; ctx.fillRect(8, 8, w - 16, h * 0.68);
        ctx.fillStyle = '#b64d3c'; ctx.fillRect(8, h * 0.8, w - 16, h * 0.13);
      }, 128, 256);
      machine.add(pos(new THREE.Mesh(
        new THREE.PlaneGeometry(0.39, 0.48),
        new THREE.MeshBasicMaterial({ map: panelTex }),
      ), 0, 0.55, 0.181));
      machine.position.set(x, 0, 1.7);
      scene.add(machine);
    };
    vending(-4.45, 0x303844, 0x6d8faf);
    vending(-3.92, 0x4b2b2b, 0xb06b55);

    const board = new THREE.Group();
    const boardFrame = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), m(0x33251f, { rough: 1 }), 3,
    );
    const boardPart = new THREE.Object3D();
    [[0, 0.58, 0, 0.48, 0.56, 0.055], [-0.18, 0.25, 0, 0.045, 0.7, 0.045], [0.18, 0.25, 0, 0.045, 0.7, 0.045]]
      .forEach(([x, y, z, sx, sy, sz], index) => {
        boardPart.position.set(x, y, z);
        boardPart.scale.set(sx, sy, sz);
        boardPart.updateMatrix();
        boardFrame.setMatrixAt(index, boardPart.matrix);
      });
    board.add(boardFrame);
    board.add(pos(box(0.36, 0.32, 0.012, 0x8f3c2e, { emissive: 0x32100a, emissiveIntensity: 0.5 }), 0, 0.6, 0.035));
    board.position.set(3.85, 0, 1.72);
    board.rotation.y = -0.18;
    scene.add(board);

    for (let i = 0; i < 2; i++) {
      const bird = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x343c52, side: THREE.DoubleSide });
      // One symmetric silhouette per bird. The former two wing meshes plus a
      // separate body cost six draw calls for two tiny background details.
      const silhouette = new THREE.Shape();
      silhouette.moveTo(0, 0.018);
      silhouette.lineTo(-0.13, 0.038);
      silhouette.lineTo(-0.08, -0.02);
      silhouette.lineTo(-0.018, -0.03);
      silhouette.lineTo(0, -0.018);
      silhouette.lineTo(0.018, -0.03);
      silhouette.lineTo(0.08, -0.02);
      silhouette.lineTo(0.13, 0.038);
      silhouette.closePath();
      bird.add(new THREE.Mesh(new THREE.ShapeGeometry(silhouette), mat));
      bird.position.set(-2.8 + i * 1.4, 4.32 + i * 0.24, 1.9 - i * 0.25);
      bird.userData.speed = 0.38 + i * 0.08;
      bird.userData.phase = i * 1.7;
      birds.push(bird); scene.add(bird);
    }
  }

  function buildGround() {
    const gt = textTexture((g, w, h) => {
      g.fillStyle = '#13161c'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 800; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (random() * 0.028) + ')';
        g.fillRect(random() * w, random() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3;
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(0, k * h / 6); g.lineTo(w, k * h / 6); g.stroke(); }
    }, 512, 512);
    gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(5, 5);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Separate pavement, kerb and road. The old white dashed centre line made
    // this intimate frontage look like it sat beside a highway.
    const paveTex = textTexture((g, w, h) => {
      g.fillStyle = '#24252b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(8,10,14,0.65)'; g.lineWidth = 2;
      const cell = 32;
      for (let y = 0; y <= h; y += cell) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        const offset = (y / cell) % 2 ? cell / 2 : 0;
        for (let x = -offset; x <= w; x += cell) {
          g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + cell); g.stroke();
        }
      }
      for (let i = 0; i < 180; i++) {
        g.fillStyle = `rgba(255,255,255,${random() * 0.025})`;
        g.fillRect(random() * w, random() * h, 2, 2);
      }
    }, 256, 256);
    paveTex.wrapS = paveTex.wrapT = THREE.RepeatWrapping; paveTex.repeat.set(7, 1.5);
    const pavement = pos(new THREE.Mesh(
      new THREE.PlaneGeometry(15, 2.25),
      new THREE.MeshStandardMaterial({ map: paveTex, color: 0xb0aaa5, roughness: 0.92 })
    ), 0, 0.009, 3.08);
    pavement.rotation.x = -Math.PI / 2;
    scene.add(pavement);

    const roadTex = textTexture((g, w, h) => {
      g.fillStyle = '#0d1016'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) {
        const shade = 20 + Math.floor(random() * 18);
        g.fillStyle = `rgba(${shade},${shade + 2},${shade + 7},${0.12 + random() * 0.18})`;
        const r = 1 + random() * 2.4;
        g.fillRect(random() * w, random() * h, r, r);
      }
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.moveTo(random() * w, random() * h);
        g.quadraticCurveTo(random() * w, random() * h, random() * w, random() * h);
        g.stroke();
      }
    }, 256, 256);
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.repeat.set(10, 2);
    const road = pos(new THREE.Mesh(
      new THREE.PlaneGeometry(34, 4.2),
      new THREE.MeshStandardMaterial({ map: roadTex, color: 0x71747c, roughness: 0.84 })
    ), 0, 0.008, 5.72);
    road.rotation.x = -Math.PI / 2;
    scene.add(road);
    const curb = pos(box(18, 0.14, 0.2, 0x4b4c52, { rough: 1 }), 0, 0.07, 4.18);
    scene.add(curb);

    const wetMat = new THREE.MeshStandardMaterial({ color: 0x8f4a32, roughness: 0.28, metalness: 0.08, transparent: true, opacity: 0.09, depthWrite: false });
    const wet = pos(new THREE.Mesh(new THREE.CircleGeometry(1, 32), wetMat), 0.35, 0.022, 3.05);
    wet.rotation.x = -Math.PI / 2; wet.scale.set(3.2, 0.72, 1); scene.add(wet);
    const lampWet = pos(new THREE.Mesh(new THREE.CircleGeometry(1, 24), wetMat.clone()), 3.82, 0.022, 3.62);
    lampWet.rotation.x = -Math.PI / 2; lampWet.scale.set(1.15, 0.42, 1); scene.add(lampWet);

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.6), new THREE.MeshBasicMaterial({ color: 0xff9a4d, transparent: true, opacity: 0.105, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.025, 2.0);
    scene.add(glow);
  }

  function walkerPathZ(walker, x = walker.position.x) {
    const data = walker.userData;
    let z = data.baseZ;
    for (const avoid of data.avoid || []) {
      const proximity = Math.max(0, 1 - Math.abs(x - avoid.x) / avoid.radius);
      z += avoid.offset * proximity * proximity;
    }
    return z;
  }

  /* ---------- the cook: GLB if present, stand-in otherwise ---------- */
  function useStandInCook() {
    guide = buildPerson({ shirt: 0xffffff, apron: true, toque: true, skin: 0xd7a173, hair: 0x241a12 });
    guide.position.set(COOK_HOME_X, 0, -0.3);
    guide.rotation.y = -0.08;
    guideRig = guide.userData.rig;
    // Build the tool in torso space from its grip to its scoop. A wrist child
    // inherits both arm hinges; that made the ladle flip upward behind the
    // cook's head even though the hand itself was aimed at the pot.
    const ladle = new THREE.Group();
    ladle.userData.grip = new THREE.Object3D();
    const ladleEnd = objectPointInTorso(guide, cookingPot, POT_BROTH_POINT, new THREE.Vector3());
    ladle.userData.grip.position.copy(ladleEnd).add(POT_STIR_GRIP_OFFSET);
    ladle.userData.grip.position.x = guideRig.armR.sh.position.x;
    ladle.add(ladle.userData.grip);
    // The scoop terminates below the open rim and near the broth centre. The
    // old endpoint sat behind the closed lid, so neither contact was readable.
    const ladleVector = ladleEnd.clone().sub(ladle.userData.grip.position);
    const handle = cyl(0.012, 0.012, ladleVector.length(), 0x9a8058, {}, 8);
    handle.position.copy(ladle.userData.grip.position).addScaledVector(ladleVector, 0.5);
    handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ladleVector.clone().normalize());
    ladle.add(handle);
    const scoop = sph(0.045, 0x8d939a, { metal: 0.5, rough: 0.4 }, 10);
    scoop.position.copy(ladleEnd);
    ladle.add(scoop);
    ladle.userData.scoop = new THREE.Object3D();
    ladle.userData.scoop.position.copy(ladleEnd);
    ladle.add(ladle.userData.scoop);
    ladle.userData.center = new THREE.Vector3();
    ladle.userData.end = new THREE.Vector3();
    // Pivot the handle from the hand while the scoop traces a visible circle
    // below the broth surface. Moving the entire utensil a centimetre made it
    // look parked against the rim rather than actively stirring.
    ladle.userData.setStir = (angle) => {
      const center = objectPointInTorso(guide, cookingPot, POT_BROTH_POINT, ladle.userData.center);
      const end = ladle.userData.end.copy(center);
      end.x += Math.cos(angle) * 0.07;
      end.z += Math.sin(angle) * 0.055;
      end.y += Math.sin(angle * 2) * 0.012;
      ladle.userData.grip.position.copy(center).add(POT_STIR_GRIP_OFFSET);
      ladle.userData.grip.position.x = guideRig.armR.sh.position.x;
      ladle.userData.grip.position.y += Math.sin(angle) * 0.012;
      ladle.userData.grip.position.z += Math.cos(angle) * 0.012;
      const vector = end.clone().sub(ladle.userData.grip.position);
      handle.position.copy(ladle.userData.grip.position).addScaledVector(vector, 0.5);
      handle.scale.y = vector.length() / ladleVector.length();
      handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
      scoop.position.copy(end);
      ladle.userData.scoop.position.copy(end);
    };
    guideRig.torso.add(ladle);
    const cloth = pos(box(0.16, 0.012, 0.12, 0xd7c9a6, { rough: 1 }), 0, -0.30, 0.08);
    cloth.rotation.x = 0.16;
    cloth.visible = false;
    guideRig.armR.wrist.add(cloth);
    guide.userData.tools = { ladle, ladleHand: 'R', cloth };
    addBlobShadow(guide, 0.4, 0.7);
    initAI(guide, 'cook', standingPose);
    scene.add(guide);
    registerHotspot('guide', LABELS.navigation.guide, guide, new THREE.Vector3(COOK_HOME_X - 0.23, 1.7, -0.3));
    buildPins();
  }

  function loadCook() {
    const loader = new GLTFLoader();
    loader.load(
      '/models/chef.glb',
      (gltf) => {
        guide = gltf.scene;
        // normalise: assume model faces +Z, feet at y=0; scale to ~1.7 units tall
        const bb = new THREE.Box3().setFromObject(guide);
        const size = new THREE.Vector3(); bb.getSize(size);
        const s = 1.7 / (size.y || 1.7);
        guide.scale.setScalar(s);
        guide.position.set(COOK_HOME_X, 0, -0.5);
        guide.rotation.y = -0.22;
        guide.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.frustumCulled = false; } });
        scene.add(guide);
        if (gltf.animations && gltf.animations.length) {
          guideMixer = new THREE.AnimationMixer(guide);
          const clip =
            gltf.animations.find((a) => /idle|breath/i.test(a.name)) || gltf.animations[0];
          guideMixer.clipAction(clip).play();
        }
        registerHotspot('guide', LABELS.navigation.guide, guide, new THREE.Vector3(COOK_HOME_X - 0.13, 1.9, -0.5));
        buildPins();
      },
      undefined,
      () => useStandInCook() // no /models/chef.glb yet — use the built-in stand-in
    );
  }

  /* ---------- hotspots + DOM pins ---------- */
  function registerHotspot(key, label, obj, anchor) {
    obj.traverse((n) => { n.userData.hotspot = key; });
    obj.userData.hotspot = key;
    hotspots.push({ key, label, obj, anchor, el: null });
  }

  const pinWrap = document.getElementById('pins');
  const ORDER = { menu: 1, guide: 2, log: 3, bill: 4 };
  let pinsBuilt = false;
  function buildPins() {
    if (pinsBuilt) return;
    pinsBuilt = true;
    const seen = new Set();
    [...hotspots].filter((h) => h.key !== 'seat').sort((a, b) => (ORDER[a.key] || 9) - (ORDER[b.key] || 9)).forEach((hs) => {
      if (seen.has(hs.key)) return; // one pin per section (the pot + board both open "menu")
      seen.add(hs.key);
      const el = document.createElement('button');
      el.className = 'pin';
      el.setAttribute('aria-label', 'Open ' + hs.label);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      el.append(dot, document.createTextNode(labelFor(hs.key)));
      el.addEventListener('click', () => onHotspot(hs.key));
      el.addEventListener('mouseenter', () => { hs._hover = true; });
      el.addEventListener('mouseleave', () => { hs._hover = false; });
      pinWrap.appendChild(el);
      hotspots.filter((h) => h.key === hs.key).forEach((h) => { h.el = el; });
    });
  }
  function labelFor(key) {
    return LABELS.navigation[key] || key;
  }
  // pins are built once the cook (async) is registered; this is the safety net
  setTimeout(buildPins, 3000);

  const _v = new THREE.Vector3();
  function updatePins() {
    const w = window.innerWidth, h = window.innerHeight;
    const drawn = new Set();
    for (const hs of hotspots) {
      if (!hs.el || drawn.has(hs.el)) continue;
      if (bookOpen) { hs.el.style.display = 'none'; drawn.add(hs.el); continue; }
      drawn.add(hs.el);
      _v.copy(hs.anchor).project(camera);
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const off = _v.z > 1 || x < 40 || x > w - 40 || y < 74 || y > h - 40;
      hs.el.style.display = off ? 'none' : '';
      if (!off) {
        hs.el.style.left = x + 'px';
        hs.el.style.top = y + 'px';
        hs.el.classList.toggle('hot', !!hs._hover);
      }
    }
  }

  /* ---------- camera ---------- */
  // NightBowl is composed as a street-front diorama, not a hollow 360-degree
  // world. Keep the orbit on the built frontage and stop zoom-out before the
  // edge of the set becomes the subject.
  const CAMERA_LIMITS = Object.freeze({
    azimuthMin: 0.02,
    azimuthMax: 0.92,
    radiusMin: 4.6,
    radiusMax: 7.4,
  });
  // The arrival begins farther out for the walk-in composition; seated input
  // still obeys radiusMax through rT and the wheel/pinch clamps below.
  const cam = { az: 0.78, el: 0.28, r: 9.6, azT: 0.5, elT: 0.17, rT: 6.7 };
  const target = new THREE.Vector3(0, 1.2, 0.25);
  let dragging = false, movedFar = false, dnX = 0, dnY = 0, lX = 0, lY = 0, dnT = 0, userMoved = false;
  const activePointers = new Map();
  let pinchDistance = 0;

  function orbitPos(az, el, r) {
    return new THREE.Vector3(
      target.x + r * Math.cos(el) * Math.sin(az),
      target.y + r * Math.sin(el) + 0.5,
      target.z + r * Math.cos(el) * Math.cos(az)
    );
  }

  /* ---------- the intro: stand in the street, take the seat, then hand
       the camera back to the normal outside view ---------- */
  // 'street' = first person on the pavement, waiting for the click
  // 'sitting' = the short walk-in-and-sit move
  // 'seated'  = everything from here is the scene exactly as it always was
  let sitStart = 0;
  let seatPin = null;
  const _look = new THREE.Vector3();

  // the walk in, in four beats. each one is timed rather than keyframed so the
  // velocity stays continuous instead of stopping dead at every waypoint.
  const BEAT = { walk: 2.7, sit: 1.3, hold: 0.4, pull: 1.6 };
  const SIT_END = BEAT.walk + BEAT.sit + BEAT.hold + BEAT.pull;

  const STAND_Y = 1.60;    // eye height on your feet
  const APPROACH_Z = 2.30; // where you stop, just behind the stool
  const SEAT_Y = 1.14;     // eye height once you are down
  const SEAT_Z = 1.60;
  const LOOK_STREET = [SEAT.x, 1.88, 0.55];
  const LOOK_STAND = [SEAT.x, 1.62, 0.45];
  const LOOK_SEAT = [SEAT.x, 1.30, 0.25];

  let introZ = 6.4;   // where the walk started, captured on click
  let restPos = null; // the orbit rest pose, captured on click

  if (phase === 'seated') {
    cam.az = cam.azT; cam.el = cam.elT; cam.r = cam.rT;
    setYouReveal(1); // reduced motion: you are simply already sitting there
    buildYouPin();
  } else if (pinWrap) {
    pinWrap.style.display = 'none';
  }

  // a narrow (portrait) window sees far less width, so stand further back or the
  // stall sign gets cropped. the walk in then just starts from further out.
  function streetZ() {
    const a = window.innerWidth / window.innerHeight;
    return a >= 1 ? 6.4 : Math.min(9.2, 6.4 + (1 - a) * 5.2);
  }

  const lerp = (a, b, u) => a + (b - a) * u;
  const easeInOutSine = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
  const smoothstep = (u) => u * u * (3 - 2 * u);
  // lowering yourself onto a stool: weight leaves your legs from a standstill, the
  // seat takes it a fraction past level, then it comes back up. starting and ending
  // at zero speed is what keeps it from snapping the moment you stop walking.
  const OVERSHOOT = 1.04;
  function sitCurve(u) {
    if (u < 0.74) return OVERSHOOT * smoothstep(u / 0.74);
    const b = (u - 0.74) / 0.26;
    return OVERSHOOT + (1 - OVERSHOOT) * smoothstep(b);
  }

  function sampleIntro(tt) {
    let px, py, pz, lx, ly, lz;

    if (tt < BEAT.walk) {
      // walking up. easeInOutSine means you start from rest and slow to a stop,
      // and sin(pi*u) is exactly that ease's velocity, so the footfalls and the
      // body sway fade in and out with your actual pace.
      const u = tt / BEAT.walk;
      const e = easeInOutSine(u);
      const pace = Math.sin(u * Math.PI);
      px = SEAT.x + Math.sin(u * 8.5) * 0.018 * pace;
      py = STAND_Y + Math.sin(u * 17) * 0.021 * pace;
      pz = lerp(introZ, APPROACH_Z, e);
      lx = SEAT.x;
      ly = lerp(LOOK_STREET[1], LOOK_STAND[1], e);
      lz = lerp(LOOK_STREET[2], LOOK_STAND[2], e);
    } else if (tt < BEAT.walk + BEAT.sit) {
      // sitting. the drop carries weight and dips just past the seat before
      // settling; the glide forward onto the stool is smooth and separate.
      const u = (tt - BEAT.walk) / BEAT.sit;
      const drop = sitCurve(u);
      const glide = easeInOutSine(u);
      px = SEAT.x;
      py = lerp(STAND_Y, SEAT_Y, drop);
      pz = lerp(APPROACH_Z, SEAT_Z, glide);
      lx = SEAT.x;
      ly = lerp(LOOK_STAND[1], LOOK_SEAT[1], drop);
      lz = lerp(LOOK_STAND[2], LOOK_SEAT[2], glide);
    } else if (tt < BEAT.walk + BEAT.sit + BEAT.hold) {
      // a beat, sitting there breathing, before the camera lets go of you
      const b = tt - BEAT.walk - BEAT.sit;
      px = SEAT.x;
      // the breath fades out across the beat so the pull-out starts from exactly
      // SEAT_Y rather than a few millimetres above it
      py = SEAT_Y + Math.sin(b * 2.1) * 0.006 * (1 - b / BEAT.hold);
      pz = SEAT_Z;
      lx = LOOK_SEAT[0]; ly = LOOK_SEAT[1]; lz = LOOK_SEAT[2];
    } else {
      // the camera detaches and pulls out to the view the site has always had
      const u = Math.min(1, (tt - BEAT.walk - BEAT.sit - BEAT.hold) / BEAT.pull);
      const e = easeInOutSine(u);
      px = lerp(SEAT.x, restPos.x, e);
      py = lerp(SEAT_Y, restPos.y, e);
      pz = lerp(SEAT_Z, restPos.z, e);
      lx = lerp(LOOK_SEAT[0], target.x, e);
      ly = lerp(LOOK_SEAT[1], target.y, e);
      lz = lerp(LOOK_SEAT[2], target.z, e);
    }

    camera.position.set(px, py, pz);
    _look.set(lx, ly, lz);
    camera.lookAt(_look);
  }

  function takeSeat() {
    if (phase !== 'street') return;
    phase = 'sitting';
    // wall clock, not accumulated dt: dt is capped at 0.05 so on anything under
    // 20fps the intro would stretch out well past its 6s instead of just dropping
    // frames. a timed move should take the same time on every machine.
    sitStart = performance.now();
    introZ = streetZ();
    restPos = orbitPos(cam.azT, cam.elT, cam.rT);
    if (seatHitArea) seatHitArea.visible = false;
    seatPin?.classList.add('gone');
  }

  function seated() {
    phase = 'seated';
    cam.az = cam.azT; cam.el = cam.elT; cam.r = cam.rT;
    if (seatGlowMat) seatGlowMat.visible = false;
    setYouReveal(1);
    if (pinWrap) pinWrap.style.display = '';
    buildYouPin();
    if (hintEl) { hintEl.classList.remove('gone'); hintTimer = setTimeout(hideHint, 7000); }
    seatPin?.remove();
    seatPin = null;
    updateOrderUI();
  }

  function ndc(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  const onDown = (e) => {
    if (phase === 'sitting') return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    ndc(e); // a tap may never fire pointermove, so seed the ray here too
    movedFar = false;
    dnX = lX = e.clientX; dnY = lY = e.clientY; dnT = performance.now();
    if (phase !== 'seated') return; // no orbiting while you are still standing
    if (activePointers.size > 1) {
      const [a, b] = [...activePointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      dragging = false;
      movedFar = true;
    } else {
      dragging = true;
    }
    userMoved = true;
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    hideHint();
  };
  const onMove = (e) => {
    ndc(e);
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (activePointers.size > 1) {
      const [a, b] = [...activePointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) {
        cam.rT = Math.max(CAMERA_LIMITS.radiusMin, Math.min(
          CAMERA_LIMITS.radiusMax,
          cam.rT - (distance - pinchDistance) * 0.012,
        ));
      }
      pinchDistance = distance;
      movedFar = true;
      userMoved = true;
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lX, dy = e.clientY - lY;
    lX = e.clientX; lY = e.clientY;
    if (Math.abs(e.clientX - dnX) + Math.abs(e.clientY - dnY) > 6) movedFar = true;
    cam.azT = Math.max(CAMERA_LIMITS.azimuthMin, Math.min(
      CAMERA_LIMITS.azimuthMax,
      cam.azT - dx * 0.006,
    ));
    cam.elT = Math.max(-0.03, Math.min(0.62, cam.elT - dy * 0.004));
  };
  const onUp = (e) => {
    activePointers.delete(e.pointerId);
    pinchDistance = 0;
    dragging = false; canvas.classList.remove('grabbing');
    if (phase === 'sitting') return;
    if (!movedFar && performance.now() - dnT < 500) tryClick();
  };
  const onWheel = (e) => {
    e.preventDefault();
    if (phase !== 'seated') return;
    userMoved = true;
    cam.rT = Math.max(CAMERA_LIMITS.radiusMin, Math.min(
      CAMERA_LIMITS.radiusMax,
      cam.rT + e.deltaY * 0.002,
    ));
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', (e) => {
    activePointers.delete(e.pointerId);
    pinchDistance = 0;
    dragging = false;
    canvas.classList.remove('grabbing');
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function rootHotspot(o) {
    let n = o;
    while (n) { if (n.userData && n.userData.hotspot) return n.userData.hotspot; n = n.parent; }
    return null;
  }
  function tryClick() {
    if (bookOpen || phase === 'sitting') return;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hotspots.map((h) => h.obj), true)[0];
    if (!hit) return;
    const k = rootHotspot(hit.object);
    if (!k) return;
    if (k === 'seat') { takeSeat(); return; }
    if (phase === 'seated') onHotspot(k); // the stall is only clickable once you sit
  }
  function updateHover() {
    if (bookOpen || phase === 'sitting') { canvas.classList.remove('pointing'); return; }
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hotspots.map((h) => h.obj), true)[0];
    const k = hit && rootHotspot(hit.object);
    canvas.classList.toggle('pointing', phase === 'street' ? k === 'seat' : !!k);
  }

  /* ---------- seat prompt ---------- */
  const _sv = new THREE.Vector3();
  if (phase === 'street') {
    seatPin = document.createElement('button');
    seatPin.className = 'seat-pin';
    seatPin.setAttribute('aria-label', LABELS.seatAria);
    seatPin.title = LABELS.seatAria;
    seatPin.addEventListener('click', takeSeat);
    document.body.appendChild(seatPin);
  }
  function buildYouPin() {
    if (youPin) return;
    youPin = document.createElement('div');
    youPin.className = 'you-pin';
    youPin.textContent = LABELS.youLabel;
    document.body.appendChild(youPin);
  }
  function updateYouPin() {
    if (!youPin || !you) return;
    _sv.set(SEAT.x, 1.62, 1.5).project(camera);
    const off = _sv.z > 1;
    youPin.style.display = off ? 'none' : '';
    if (off) return;
    youPin.style.left = (_sv.x * 0.5 + 0.5) * window.innerWidth + 'px';
    youPin.style.top = (-_sv.y * 0.5 + 0.5) * window.innerHeight + 'px';
    youPin.style.opacity = String(youReveal);
  }

  function updateSeatPin(t) {
    if (seatGlowMat) {
      seatGlowMat.opacity = phase === 'street' ? 0.16 + Math.sin(t * 2.4) * 0.1 : 0;
    }
    if (!seatPin) return;
    // The wordless DOM target sits over the stool body. It stays generous on
    // touch screens while the pulsing ring supplies the visual invitation.
    _sv.set(SEAT.x, 0.56, SEAT.z).project(camera);
    seatPin.style.left = (_sv.x * 0.5 + 0.5) * window.innerWidth + 'px';
    seatPin.style.top = (-_sv.y * 0.5 + 0.5) * window.innerHeight + 'px';
  }

  /* ---------- hint ---------- */
  const hintEl = document.getElementById('hint');
  let hintTimer = phase === 'seated' ? setTimeout(hideHint, 7000) : 0;
  if (phase !== 'seated' && hintEl) hintEl.classList.add('gone');
  function hideHint() { if (hintEl) hintEl.classList.add('gone'); clearTimeout(hintTimer); }

  /* ---------- resize ---------- */
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  /* ---------- loop ---------- */
  let startT = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    // getDelta() first: getElapsedTime() calls it internally and consumes the
    // delta, so asking for elapsed first leaves dt at ~0 forever (which froze the
    // street walkers and the animation mixer). elapsedTime is safe to read direct.
    const poseDt = Math.min(clock.getDelta(), 0.5);
    // Locomotion stays capped so one stalled frame cannot teleport a walker.
    // Pose easing uses the real elapsed interval; otherwise a 1 FPS software
    // renderer advances wall-clock actions while leaving the limbs seconds
    // behind the object they are supposed to hold.
    const dt = Math.min(poseDt, 0.05);
    const t = clock.elapsedTime;
    if (!startT) startT = t;
    const intro = REDUCED ? 1 : Math.min(1, (t - startT) / 2.6);
    const ease = 1 - Math.pow(1 - intro, 3);

    if (phase === 'street') {
      // first person, standing on the pavement. a little idle sway, nothing else.
      camera.position.set(
        SEAT.x + Math.sin(t * 0.5) * 0.04,
        STAND_Y + Math.sin(t * 0.85) * 0.012,
        streetZ()
      );
      camera.lookAt(LOOK_STREET[0], LOOK_STREET[1], LOOK_STREET[2]);
    } else if (phase === 'sitting') {
      const sitT = (performance.now() - sitStart) / 1000;
      sampleIntro(Math.min(sitT, SIT_END));
      // you appear once the camera has actually left the seat, part way through
      // the pull-out, so you never materialise inside the lens
      const pu = (sitT - (BEAT.walk + BEAT.sit + BEAT.hold)) / BEAT.pull;
      setYouReveal(Math.max(0, Math.min(1, (pu - 0.28) / 0.42)));
      if (sitT >= SIT_END) seated();
    } else {
      if (!userMoved) {
        cam.az += ((cam.azT + Math.sin(t * 0.11) * 0.05) - cam.az) * (0.02 + 0.04 * ease);
        cam.el += (cam.elT - cam.el) * 0.03;
        cam.r += (cam.rT - cam.r) * 0.03;
      } else {
        cam.az += (cam.azT - cam.az) * 0.08;
        cam.el += (cam.elT - cam.el) * 0.08;
        cam.r += (cam.rT - cam.r) * 0.08;
      }
      camera.position.set(
        target.x + cam.r * Math.cos(cam.el) * Math.sin(cam.az),
        target.y + cam.r * Math.sin(cam.el) + 0.5,
        target.z + cam.r * Math.cos(cam.el) * Math.cos(cam.az)
      );
      camera.lookAt(target);
    }

    if (guideMixer) guideMixer.update(dt);
    if (guide) guide.userData.serviceWalking = false;

    if (REDUCED) {
      for (const d of diners) applyPose(d.userData.rig, d.userData.ai.cur);
      if (guideRig && guide.userData.ai) applyPose(guideRig, guide.userData.ai.cur);
    } else {
      // the director only performs for someone who is actually sitting down
      if (phase === 'seated') {
        tickVisitorService();
        if (visitorOrder.status !== 'serving') tickTurnover();
        if (!activeTurnover && visitorOrder.status !== 'serving') {
          tickService();
          if (!service) tickDirector();
        }
      }
      for (const d of diners) if (!d.userData.ai?.turnover) tickNPC(d, poseDt);
      if (guideRig && guide.userData.ai) tickNPC(guide, poseDt);
      applyCookWalk();
      syncServiceBowl();
      syncVisitorBowl();
      tickVisitorMeal(poseDt);
      updateBubbles();
    }

    for (let i = 0; i < walkers.length; i++) {
      const wk = walkers[i], wd = wk.userData;
      if (REDUCED) continue;
      wk.position.x += wd.speed * dt;
      if (wk.position.x > wd.range || wk.position.x < -wd.range) {
        wk.position.x = wk.position.x > wd.range ? -wd.range : wd.range;
        wk.position.z = walkerPathZ(wk);
        // A street-loop wrap is a teleport; a large sparse-frame step isn't.
        beginWalk(wk);
      }
      const pathZ = walkerPathZ(wk);
      wk.position.z += (pathZ - wk.position.z) * Math.min(1, dt * 4.5);
      applyWalkFromTravel(wk);
    }

    for (const bird of birds) {
      if (REDUCED) continue;
      bird.position.x += bird.userData.speed * dt;
      if (bird.position.x > 12) bird.position.x = -12;
      bird.rotation.z = Math.sin(t * 2.2 + bird.userData.phase) * 0.06;
      bird.children[0].scale.y = 0.72 + Math.sin(t * 4 + bird.userData.phase) * 0.25;
    }

    for (const grp of steamGroups) {
      for (const q of grp.children) {
        const life = ((t * (REDUCED ? 0.05 : 0.4) + q.userData.seed) % 1);
        q.position.y = life * 0.95;
        q.position.x = Math.sin((life + q.userData.seed) * Math.PI * 2) * q.userData.spread * 0.42;
        q.position.z = Math.cos((life * 1.7 + q.userData.seed) * Math.PI * 2) * q.userData.spread * 0.12;
        q.material.opacity = Math.sin(life * Math.PI) * 0.27;
        q.scale.set(0.62 + life * 0.65, 0.72 + life * 0.55, 1);
        q.quaternion.copy(camera.quaternion);
        q.rotateZ(Math.sin((life + q.userData.seed) * Math.PI * 2) * 0.22);
      }
    }

    for (let i = 0; i < norenFlaps.length; i++) {
      norenFlaps[i].rotation.x = REDUCED ? 0 : Math.sin(t * 1.3 + i) * 0.05;
    }
    if (!REDUCED) {
      for (let i = 0; i < lanternMats.length; i++) {
        lanternMats[i].emissiveIntensity = 1.2 + Math.sin(t * (6 + i * 2.1)) * 0.12 + random() * 0.04;
      }
    }

    updateHover();
    if (phase === 'seated') { updatePins(); updateYouPin(); }
    else { updateSeatPin(t); updateYouPin(); }
    if (!auditSkipRender) renderer.render(scene, camera);
  }
  orderChoices?.addEventListener('click', onOrderClick);
  orderSkip?.addEventListener('click', onOrderSkip);
  orderAgain?.addEventListener('click', chooseAnotherMeal);
  orderDone?.addEventListener('click', onOrderDone);
  orderReopen?.addEventListener('click', onOrderReopen);
  updateOrderUI();
  frame();

  return {
    setBookOpen(v) { bookOpen = v; hideHint(); updateOrderUI(); },
    orderMeal,
    testEmptyBowl(index = 0) {
      const diner = diners[index];
      const bowl = diner?.userData.table?.bowl;
      if (!bowl) return false;
      setBowlFill(bowl, 0);
      diner.userData.ai.needsService = true;
      return true;
    },
    testTurnover(index = 0) {
      const diner = diners[index];
      const bowl = diner?.userData.table?.bowl;
      const ai = diner?.userData.ai;
      if (!diner || !bowl || !ai || activeTurnover) return false;
      setBowlFill(bowl, 0);
      ai.mealsFinished = 2;
      ai.emptyCounted = true;
      ai.readyToLeave = true;
      ai.needsService = false;
      setAct(diner, 'pause', 60);
      return true;
    },

    /* ---------- deterministic pose audit (scripts/npc-audit.mjs) ----------
       Stops the render loop, forces one action on one character at one point in
       its timeline, and reports where the joints and props actually ended up in
       world space. Bounds come from the objects in the scene, never from numbers
       copied out of this file, so moving a stool moves the test with it. */
    auditBegin() {
      cancelAnimationFrame(raf);
      raf = 0;
      const roots = [...diners, ...walkers, guide, you].filter(Boolean);
      auditVisibility = new Map(roots.map((root) => [root, root.visible]));
      return true;
    },
    auditFocus(kind, index) {
      if (!auditVisibility) return false;
      const subject = kind === 'cook' ? guide : kind === 'walker' ? walkers[index] : kind === 'visitor' ? you : diners[index];
      for (const root of auditVisibility.keys()) root.visible = root === subject;
      return Boolean(subject);
    },
    auditEnd() {
      if (auditVisibility) {
        for (const [root, visible] of auditVisibility) root.visible = visible;
        auditVisibility = null;
      }
      if (!raf) raf = requestAnimationFrame(frame);
      return true;
    },

    auditStreetWalkers(xs) {
      walkers.forEach((walker, index) => {
        if (!Number.isFinite(xs?.[index])) return;
        walker.position.x = xs[index];
        walker.position.z = walkerPathZ(walker, xs[index]);
        beginWalk(walker);
      });
      scene.updateMatrixWorld(true);
      return walkers.map((walker) => ({ x: walker.position.x, z: walker.position.z }));
    },

    auditLocomotion(kind, index = 0) {
      const npc = kind === 'cook' ? guide : kind === 'walker' ? walkers[index] : diners[index];
      const rig = npc?.userData.rig;
      if (!npc || !rig) return null;
      scene.updateMatrixWorld(true);
      const point = (object) => {
        const value = object.getWorldPosition(new THREE.Vector3());
        return { x: value.x, y: value.y, z: value.z };
      };
      return {
        root: point(npc),
        footL: point(rig.legL.shoe),
        footR: point(rig.legR.shoe),
        distance: npc.userData.walk?.distance || 0,
        moving: !!npc.userData.walk?.moving,
        scale: npc.scale.x,
        facingX: Math.sin(npc.rotation.y),
        facingZ: Math.cos(npc.rotation.y),
      };
    },

    // Test-only: keep the real live director/pose/gait updates while a no-GPU
    // runner measures world-space contact. auditFrame still draws screenshots.
    auditRendering(enabled) { auditSkipRender = !enabled; },

    /* Test-only transform perturbations for the IK regression audit. Each call
       is reversible by applying the opposite delta (or reciprocal scale). */
    auditIKPerturb(target, index, delta) {
      const diner = diners[index];
      const object = target === 'bowl' ? diner?.userData.table?.bowl
        : target === 'mouth' ? diner?.userData.rig?.head
          : target === 'pot' ? cookingPot
            : target === 'counter' ? counterTop
              : target === 'body' ? diner : null;
      if (!object) return false;
      if (target === 'body') object.scale.multiplyScalar(delta.scale);
      else object.position.add(_ikWorld.set(delta.x || 0, delta.y || 0, delta.z || 0));
      scene.updateMatrixWorld(true);
      return true;
    },

    /* Point the camera at a world position and draw one frame, so a pose the
       audit flagged can be photographed. scripts/pose-shots.mjs uses this
       between auditBegin() and auditEnd(); nothing in the running site calls
       it. Numbers read as a measurement are worth far less to whoever has to
       fix the pose than a picture of it. */
    auditFrame({ target, azimuth = 0.9, elevation = 0.22, radius = 2.0 }) {
      const c = _frameTarget.set(target.x, target.y, target.z);
      camera.position.set(
        c.x + Math.cos(elevation) * Math.sin(azimuth) * radius,
        c.y + Math.sin(elevation) * radius,
        c.z + Math.cos(elevation) * Math.cos(azimuth) * radius,
      );
      camera.lookAt(c);
      renderer.render(scene, camera);
      return true;
    },

    auditActs() {
      return { seated: Object.keys(SEATED_ACTS), cook: Object.keys(COOK_ACTS) };
    },

    auditSubjects() {
      const list = diners.map((d, i) => ({
        kind: 'diner', index: i, x: d.position.x, z: d.position.z, scale: d.scale.x,
      }));
      if (guide) list.push({ kind: 'cook', index: 0, x: guide.position.x, z: guide.position.z, scale: guide.scale.x });
      if (you?.userData.table.bowl) list.push({ kind: 'visitor', index: 0, x: you.position.x, z: you.position.z, scale: you.scale.x });
      return list;
    },

    auditVisitorDish(dish) {
      if (!TESTING || !auditVisibility || !['house', 'veggie'].includes(dish)) return false;
      const bowl = visitorBowl(dish);
      bowl.userData.dish = dish;
      setBowlFill(bowl, 1);
      bowl.position.copy(_visitorSeat);
      setBowlVisible(bowl, true);
      setYouReveal(1);
      return true;
    },

    auditFurniture() {
      const b = (o) => {
        if (!o) return null;
        const box = new THREE.Box3().setFromObject(o);
        if (!Number.isFinite(box.min.x) || box.isEmpty()) return null;
        return {
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
        };
      };
      return {
        counterTop: b(counterTop),
        counterFront: b(counterFront),
        counterShelf: b(counterShelf),
        pot: b(cookingPot),
        ground: { y: 0 },
        stools: stoolSeats.map((s) => ({ seatX: s.userData.seatX, box: b(s) })),
        bowls: ramenBowls.map((bowl) => ({ seatX: bowl.userData.seatX, box: b(bowl) })),
      };
    },

    auditPose(kind, index, act, tl) {
      const npc = kind === 'cook' ? guide : kind === 'visitor' ? you : diners[index];
      if (!npc) return null;
      const acts = kind === 'cook' ? COOK_ACTS : SEATED_ACTS;
      const fn = acts[act];
      if (!fn) return null;
      const rig = npc.userData.rig;
      const ai = kind === 'visitor' ? npc.userData.visitorMeal : npc.userData.ai;
      const table = npc.userData.table;
      const keep = { act: ai.act, biting: ai.biting, biteT: ai.biteT, face: ai.face };
      ai.act = act;
      if (typeof ai.face !== 'number') ai.face = 0.5;
      // `eat` is driven by the bite clock rather than the action timeline, so the
      // sweep has to move that clock to see the whole reach-hold-return arc.
      if (act === 'eat') { ai.biting = true; ai.biteT = tl; }

      let pose = kind === 'cook' ? standingPose() : seatedPose(npc);
      // Object-derived targets must be sampled from this subject's own base
      // pose, not whichever action the preceding audit sample happened to use.
      applyPose(rig, pose);
      scene.updateMatrixWorld(true);
      fn(pose, tl, npc);
      applyPose(rig, pose);
      // Settle once after the action's torso/head transform is in place. This
      // mirrors the next live frame without making audit order affect contact.
      scene.updateMatrixWorld(true);
      pose = kind === 'cook' ? standingPose() : seatedPose(npc);
      fn(pose, tl, npc);
      applyPose(rig, pose);

      // Props follow the action exactly as the live tick switches them, so the
      // audit sees what a visitor sees.
      if (table) {
        table.heldChopsticks.visible = act === 'eat';
        if (table.noodleLift) table.noodleLift.visible = act === 'eat' && tl >= 0.45 && tl < 2.85;
        table.heldCup.visible = act === 'drink';
        for (const stick of table.bowl?.userData.restingChopsticks || []) stick.visible = act !== 'eat';
        if (table.bowl?.userData.counterCup) table.bowl.userData.counterCup.visible = act !== 'drink';
      }
      if (npc.userData.tools) {
        npc.userData.tools.ladle.visible = act === 'stir';
        npc.userData.tools.cloth.visible = act === 'wipe';
      }

      if (act === 'eat') syncChopstickGrip(npc);

      scene.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      const w = (o) => (o ? (o.getWorldPosition(v), { x: v.x, y: v.y, z: v.z }) : null);
      const wp = (o, point) => {
        if (!o) return null;
        v.copy(point);
        o.localToWorld(v);
        return { x: v.x, y: v.y, z: v.z };
      };
      // Box3.setFromObject walks hidden children too, so a stowed ladle would
      // count as part of the arm holding it. Walk only what is actually drawn,
      // and allow a subtree to be left out so a limb can be measured without
      // the prop in its hand.
      const _bb = new THREE.Box3();
      const b = (o, skip = null) => {
        if (!o || o.visible === false) return null;
        o.updateWorldMatrix(true, true);
        const box = new THREE.Box3();
        let found = false;
        const walk = (n) => {
          if (n === skip || n.visible === false) return;
          if (n.isMesh && n.geometry) {
            if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
            if (n.isInstancedMesh && !n.boundingBox) n.computeBoundingBox();
            _bb.copy(n.isInstancedMesh ? n.boundingBox : n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
            box.union(_bb);
            found = true;
          }
          for (const c of n.children) walk(c);
        };
        walk(o);
        if (!found || box.isEmpty() || !Number.isFinite(box.min.x)) return null;
        return {
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
        };
      };

      const sample = {
        kind, index, act, tl,
        angles: {
          hipY: pose.hipY,
          torsoX: pose.torsoX, torsoY: pose.torsoY, torsoZ: pose.torsoZ,
          headX: pose.headX, headY: pose.headY, headZ: pose.headZ,
          lShX: pose.lShX, lShZ: pose.lShZ, lElX: pose.lElX,
          rShX: pose.rShX, rShZ: pose.rShZ, rElX: pose.rElX,
          lWrX: pose.lWrX, lWrY: pose.lWrY, lWrZ: pose.lWrZ,
          rWrX: pose.rWrX, rWrY: pose.rWrY, rWrZ: pose.rWrZ,
        },
        joints: {
          head: w(rig.head), hip: w(rig.hip),
          shoulderL: w(rig.armL.sh), shoulderR: w(rig.armR.sh),
          elbowL: w(rig.armL.elbow), elbowR: w(rig.armR.elbow),
          handL: w(rig.armL.hand), handR: w(rig.armR.hand),
          toolGrip: npc.userData.tools ? w(npc.userData.tools.ladle.userData.grip) : null,
          toolHand: npc.userData.tools
            ? w(npc.userData.tools.ladleHand === 'R' ? rig.armR.hand : rig.armL.hand)
            : null,
          toolScoop: npc.userData.tools ? w(npc.userData.tools.ladle.userData.scoop) : null,
          chopstickGrip: table ? w(table.heldChopsticks.userData.grip) : null,
          chopstickTip: table ? w(table.heldChopsticks) : null,
          cupRim: table ? wp(table.heldCup, table.heldCup.userData.rimPoint) : null,
          cupGrip: table ? wp(table.heldCup, table.heldCup.userData.gripPoint) : null,
          footL: w(rig.legL.shoe), footR: w(rig.legR.shoe),
        },
        targets: {
          bowl: table?.bowl ? wp(table.bowl, BOWL_BITE_POINT) : null,
          mouth: table ? wp(rig.face, MOUTH_POINT) : null,
          pot: kind === 'cook' ? wp(cookingPot, POT_BROTH_POINT) : null,
          counter: wp(counterTop, _ikWorld.set(0, 0, 0)),
        },
        boxes: {
          body: b(npc),
          handL: b(rig.armL.hand, rig.armL.wrist), handR: b(rig.armR.hand, rig.armR.wrist),
          forearmL: b(rig.armL.elbow, rig.armL.hand),
          forearmR: b(rig.armR.elbow, rig.armR.hand),
          thighL: b(rig.legL.hp, rig.legL.knee), thighR: b(rig.legR.hp, rig.legR.knee),
          shinL: b(rig.legL.knee, rig.legL.shoe), shinR: b(rig.legR.knee, rig.legR.shoe),
          pelvis: b(rig.pelvis),
          heldChopsticks: table ? b(table.heldChopsticks) : null,
          heldCup: table ? b(table.heldCup) : null,
          ladle: npc.userData.tools ? b(npc.userData.tools.ladle) : null,
          cloth: npc.userData.tools ? b(npc.userData.tools.cloth) : null,
          ownBowl: table?.bowl ? b(table.bowl.getObjectByName('bowl')) : null,
        },
      };
      Object.assign(ai, keep);
      return sample;
    },

    /* Run the whole sweep inside the page and return it in one go. Sampling one
       pose per round trip was the slowest thing in CI by a wide margin. */
    auditSweep(plan) {
      const api = window.__nightbowl;
      const out = [];
      for (const sub of api.auditSubjects()) {
        const list = sub.kind === 'cook' ? api.auditActs().cook : sub.kind === 'visitor' ? ['eat', 'pause', 'lookUp'] : api.auditActs().seated;
        for (const act of list) {
          for (const tl of (plan[act] || plan.default)) {
            const s = api.auditPose(sub.kind, sub.index, act, tl);
            if (s) { s.subjectX = sub.x; s.subjectScale = sub.scale; out.push(s); }
          }
        }
      }
      return out;
    },

    /* Used by scripts/smoke.mjs. A navigation pin is a DOM button positioned
       every frame from a 3D anchor, so it can drift off the thing it labels
       without anything throwing. Two failures matter and neither is caught by
       a "does the element exist" check: the pin stops sitting over its own
       object, and two pins land on top of each other so one is unclickable.

       "Sits over its own object" is measured as screen-space overlap between
       the pin rect and the projected bounding box of the object, not as a
       raycast. A raycast reports the nearest hotspot, so a correctly placed
       pin whose object is occluded by nearer scenery reads as a miss. */
    auditPins() {
      if (!pinWrap) return { available: false, pins: [] };
      const w = window.innerWidth, h = window.innerHeight;
      const hidden = pinWrap.style.display === 'none';
      const toScreen = (v) => {
        _pinV.copy(v).project(camera);
        return { x: (_pinV.x * 0.5 + 0.5) * w, y: (-_pinV.y * 0.5 + 0.5) * h, behind: _pinV.z > 1 };
      };
      const seen = new Set();
      const pins = [];
      for (const hs of hotspots) {
        if (!hs.el || seen.has(hs.el)) continue;
        seen.add(hs.el);
        const r = hs.el.getBoundingClientRect();

        // Every object registered under this key: the menu pin covers both the
        // board and the pot, and either one counts as the thing it labels.
        let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
        for (const other of hotspots) {
          if (other.key !== hs.key) continue;
          // Not setFromObject: it walks hidden children too, so the cook's
          // stowed ladle and cloth would inflate the guide hotspot's box and
          // make the pin look better placed than it is.
          visibleBox(other.obj, _pinBox);
          if (_pinBox.isEmpty()) continue;
          for (let c = 0; c < 8; c++) {
            _pinCorner.set(
              c & 1 ? _pinBox.max.x : _pinBox.min.x,
              c & 2 ? _pinBox.max.y : _pinBox.min.y,
              c & 4 ? _pinBox.max.z : _pinBox.min.z,
            );
            const p = toScreen(_pinCorner);
            if (p.behind) continue;
            sx0 = Math.min(sx0, p.x); sy0 = Math.min(sy0, p.y);
            sx1 = Math.max(sx1, p.x); sy1 = Math.max(sy1, p.y);
          }
        }
        const target = sx1 > sx0 ? { left: sx0, top: sy0, right: sx1, bottom: sy1 } : null;
        const anchor = toScreen(hs.anchor);

        pins.push({
          key: hs.key,
          label: hs.label,
          shown: !hidden && hs.el.style.display !== 'none',
          // Where the anchor projects to, reported even while the pin is
          // hidden, so "hidden" can be shown to be off-screen on purpose.
          anchor,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          target,
          onTarget: !!target && r.right > target.left && r.left < target.right
            && r.bottom > target.top && r.top < target.bottom,
        });
      }
      return { available: true, phase, viewport: { width: w, height: h }, pins };
    },

    // Used by scripts/smoke.mjs. The thing worth catching here is a non-finite
    // value leaking into a rig: it renders as a vanished or mangled character
    // and throws nothing at all, so a "no console errors" check sails past it.
    selfCheck() {
      let nonFinite = 0;
      const scan = (o) => {
        if (!o) return;
        const { rotation: r, position: p } = o;
        for (const v of [r.x, r.y, r.z, p.x, p.y, p.z]) if (!Number.isFinite(v)) nonFinite++;
      };
      const rigs = diners.map((d) => d.userData.rig).concat(walkers.map((w) => w.userData.rig));
      if (you) rigs.push(you.userData.rig);
      if (guideRig) rigs.push(guideRig);
      for (const rg of rigs) {
        if (!rg) continue;
        scan(rg.hip); scan(rg.torso); scan(rg.head);
        scan(rg.armL.sh); scan(rg.armL.elbow); scan(rg.armR.sh); scan(rg.armR.elbow);
        scan(rg.legL.hp); scan(rg.legL.knee); scan(rg.legR.hp); scan(rg.legR.knee);
      }
      for (const d of diners) scan(d);
      for (const w of walkers) scan(w);
      scan(guide);
      scan(camera);
      let serviceCarryPose = null;
      let visitorCarryPose = null;
      if (visitorOrder.status === 'serving' && visitorOrder.carrying) {
        guide.updateMatrixWorld(true);
        guideRig.armL.hand.getWorldPosition(_handL);
        guideRig.armR.hand.getWorldPosition(_handR);
        guideRig.head.getWorldPosition(_carryHead);
        visibleBox(you.userData.table.bowl.getObjectByName('bowl'), _carryBowlBox);
        visitorCarryPose = {
          handGap: Math.max(_carryBowlBox.distanceToPoint(_handL), _carryBowlBox.distanceToPoint(_handR)),
          handSeparation: carryHandSeparation(),
          faceClearance: _carryHead.y - _carryBowlBox.max.y,
        };
      }
      if (service && serviceBowl?.visible && guideRig) {
        guide.updateMatrixWorld(true);
        guideRig.armL.hand.getWorldPosition(_handL);
        guideRig.armR.hand.getWorldPosition(_handR);
        guideRig.head.getWorldPosition(_carryHead);
        visibleBox(serviceBowl, _carryBowlBox);
        const serviceTime = nowSec() - service.startedAt;
        serviceCarryPose = {
          carrying: serviceTime >= 1.65 && serviceTime < 4.15,
          handSeparation: carryHandSeparation(),
          bowlTop: _carryBowlBox.max.y,
          headY: _carryHead.y,
          faceClearance: _carryHead.y - _carryBowlBox.max.y,
        };
      }
      return {
        phase,
        diners: diners.length,
        visitor: !!you,
        visitorAutonomous: !!you?.userData.ai,
        visitorOrder: {
          ...visitorOrder,
          carryPose: visitorCarryPose,
          bowlVisible: !!you?.userData.table.bowl?.visible,
          fill: you?.userData.table.bowl?.userData.fill ?? 0,
          toppings: you?.userData.table.bowl?.userData.foodParts.filter((part) => part.index === undefined && part.mesh.visible).map((part) => part.mesh.name) || [],
          position: you?.userData.table.bowl?.position.toArray() || null,
          heldChopsticks: !!you?.userData.table.heldChopsticks.visible,
          restingChopsticks: !!you?.userData.table.bowl?.userData.restingChopsticks[0].visible,
          steam: !!you?.userData.table.bowl?.userData.steam.visible,
        },
        walkers: walkers.length,
        streetLife: {
          trees: streetTrees.length,
          birds: birds.length,
          walkers: walkers.length,
          longHair: walkers.filter((walker) => walker.userData.streetStyle?.longHair).length,
          coats: walkers.filter((walker) => walker.userData.streetStyle?.coat).length,
        },
        cook: !!guide,
        hotspots: hotspots.length,
        bubbles: bubbles.length,
        ramenBowls: ramenBowls.length,
        heroBowls: ramenBowls.filter((b) => b.userData.hero).length,
        ramenIngredients: ramenBowls.map((b) => b.userData.ingredients || []),
        steamSources: steamGroups.length,
        steamStyle: steamGroups.every((g) => g.userData.style === 'curling-ribbon'),
        lanterns: lanterns.map(({ group, light }) => ({
          x: group.position.x,
          y: group.position.y,
          intensity: light.intensity,
          color: light.color.getHex(),
        })),
        stoolStyles,
        counterComposition: {
          runs: [counterTop, counterFront, counterShelf].map((part) => ({
            x: part.position.x, width: part.geometry.parameters.width,
          })),
          condiments: Array.from({ length: counterCondiments.count }, (_, index) => {
            const matrix = new THREE.Matrix4();
            counterCondiments.getMatrixAt(index, matrix);
            return { x: matrix.elements[12], y: matrix.elements[13], z: matrix.elements[14] };
          }),
          cookX: guide?.position.x,
          potX: cookingPot?.position.x,
        },
        dinerStations: diners.map((diner) => ({
          seatX: diner.position.x,
          bowlX: diner.userData.table?.bowl?.position.x,
          bowlZ: diner.userData.table?.bowl?.position.z,
          hasHeldChopsticks: !!diner.userData.table?.heldChopsticks,
          hasCup: !!diner.userData.table?.heldCup && !!diner.userData.table?.bowl?.userData.counterCup,
        })),
        seatXs: DINER_SPECS.map((spec) => spec.x).concat(SEAT.x).sort((a, b) => a - b),
        dinerActions: diners.map((diner) => ({
          action: diner.userData.ai?.act,
          biting: !!diner.userData.ai?.biting,
          needsService: !!diner.userData.ai?.needsService,
          fill: diner.userData.table?.bowl?.userData.fill,
          bowlVisible: !!diner.userData.table?.bowl?.visible,
          heldChopsticks: !!diner.userData.table?.heldChopsticks?.visible,
          restingChopsticks: (diner.userData.table?.bowl?.userData.restingChopsticks || [])
            .some((stick) => stick.visible),
          heldCup: !!diner.userData.table?.heldCup?.visible,
          counterCup: !!diner.userData.table?.bowl?.userData.counterCup?.visible,
        })),
        cookStationOffset: guide && cookingPot
          ? Math.abs(guide.getWorldPosition(_guideStationWorld).x
            - cookingPot.getWorldPosition(_potStationWorld).x)
          : null,
        cookHasWorkingProps: !!guide?.userData.tools?.ladle && !!guide?.userData.tools?.cloth,
        cookAction: guide?.userData.ai?.act || null,
        mouthPhases: diners.map((diner) => diner.userData.ai?.mouthPhase)
          .concat(guide?.userData.ai?.mouthPhase ?? []),
        actionTempos: diners.map((diner) => diner.userData.ai?.tempo)
          .concat(guide?.userData.ai?.tempo ?? []),
        turnover: activeTurnover ? {
          phase: activeTurnover.phase,
          duration: activeTurnover.duration,
          index: diners.indexOf(activeTurnover.diner),
          x: activeTurnover.diner.position.x,
          z: activeTurnover.diner.position.z,
          facingX: Math.sin(activeTurnover.diner.rotation.y),
          facingZ: Math.cos(activeTurnover.diner.rotation.y),
          seatX: activeTurnover.seatX,
          entryX: activeTurnover.entryX,
          stageZ: activeTurnover.stageZ,
          visible: activeTurnover.diner.visible,
          generation: activeTurnover.diner.userData.ai.customerGeneration,
          seatBowlVisible: !!activeTurnover.diner.userData.table.bowl.visible,
          carryBowlVisible: !!serviceBowl?.visible,
        } : null,
        customerGenerations: diners.map((diner) => diner.userData.ai?.customerGeneration || 0),
        service: service && {
          active: true,
          filled: service.filled,
          placed: service.placed,
          bowlVisible: !!serviceBowl?.visible,
          dinerX: service.diner.position.x,
          carryPose: serviceCarryPose,
        },
        serviceAudit,
        pot: cookingPot && {
          x: cookingPot.position.x,
          y: cookingPot.position.y,
          scale: cookingPot.scale.x,
        },
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        // Counts, not bytes: WebGL exposes no query for texture memory.
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        camera: {
          azimuth: cam.azT,
          elevation: cam.elT,
          radius: cam.rT,
          limits: { ...CAMERA_LIMITS },
        },
        touchAction: getComputedStyle(canvas).touchAction,
        nonFinite,
      };
    },

    dispose() {
      cancelAnimationFrame(raf);
      orderChoices?.removeEventListener('click', onOrderClick);
      orderSkip?.removeEventListener('click', onOrderSkip);
      orderAgain?.removeEventListener('click', chooseAnotherMeal);
      orderDone?.removeEventListener('click', onOrderDone);
      orderReopen?.removeEventListener('click', onOrderReopen);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
