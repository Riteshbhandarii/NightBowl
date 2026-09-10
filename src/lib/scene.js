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
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      g.globalAlpha = 0.15 + Math.random() * 0.5;
      g.fillRect(Math.random() * w, Math.random() * h * 0.46, 1.5, 1.5);
    }
    g.globalAlpha = 1;
  }, 16, 512);
  scene.fog = new THREE.Fog(0x201a30, 10, 36);

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const clock = new THREE.Clock();

  const hotspots = [];
  const steamGroups = [];
  const lanternMats = [];
  const norenFlaps = [];
  const diners = [];
  const walkers = [];
  // the one stool that is never taken, and the ring that advertises it
  const SEAT = { x: 0.1, z: 1.52 };
  let seatGlowMat = null;
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
      g.fillText('nightbowl', w / 2, h / 2 - 8);
      g.fillStyle = '#d1663a'; g.font = "400 40px 'Space Mono', monospace";
      g.fillText('OPEN LATE  ·  RAMEN  ·  EST. 2026', w / 2, h - 50);
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
      g.font = "700 96px 'Zilla Slab', serif"; g.fillText('N', w / 2, h * 0.5 + 4);
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
      g.font = "700 104px 'Zilla Slab', serif"; g.fillText('MENU', 74, 56);
      g.strokeStyle = '#463625'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(74, 188); g.lineTo(w - 74, 188); g.stroke();
      const items = [['Chess Engine', 'PyTorch'], ['chat-systems', 'Django'], ['weather ETL', 'Airflow'],
        ['CV runner', 'MediaPipe'], ['ML-Final', 'Keras'], ['Cleanclip', 'Python'], ['SisuSpeak', 'startup'], ['Thesis', 'research']];
      g.textBaseline = 'middle';
      items.forEach((it, k) => {
        const y = 262 + k * 84;
        g.fillStyle = '#e8d7b0'; g.font = "500 44px 'Hanken Grotesk', sans-serif"; g.textAlign = 'left';
        g.fillText(it[0], 78, y);
        g.fillStyle = '#997c48'; g.font = "400 32px 'Space Mono', monospace"; g.textAlign = 'right';
        g.fillText(it[1], w - 78, y);
      });
      g.fillStyle = '#6b5636'; g.textAlign = 'left'; g.font = "400 28px 'Space Mono', monospace";
      g.fillText('tap to open the menu', 78, h - 48);
    }, 1024, 1320);
    const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.6), new THREE.MeshStandardMaterial({ map: menuTex, roughness: 0.9 }));
    menuBoard.position.set(-1.75, 1.62, -1.1);
    s.add(menuBoard);
    registerHotspot('menu', 'Menu', menuBoard, new THREE.Vector3(-1.75, 2.6, -1.05));

    const posterTex = textTexture((g, w, h) => {
      g.fillStyle = '#e8dbbf'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#a5341d'; g.fillRect(0, 0, w, 96);
      g.fillStyle = '#e8dbbf'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = "700 56px 'Zilla Slab', serif"; g.fillText('KITCHEN LOG', w / 2, 48);
      g.fillStyle = '#3a2f22'; g.textAlign = 'left'; g.font = "400 34px 'Hanken Grotesk', sans-serif";
      ['— why a ramen stall', '— a chess engine, my games', '— a boring Airflow DAG', '— what the model learned'].forEach((t, k) => {
        g.fillText(t, 42, 168 + k * 60);
      });
      g.fillStyle = '#8a6a3c'; g.font = "400 26px 'Space Mono', monospace";
      g.fillText('fresh batches inside', 42, h - 42);
    }, 512, 640);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.95 }));
    poster.position.set(1.8, 1.75, -1.09);
    s.add(pos(box(1.36, 1.66, 0.06, 0x2a2018), 1.8, 1.75, -1.14));
    s.add(poster);
    registerHotspot('log', 'Kitchen Log', poster, new THREE.Vector3(1.8, 2.56, -1.03));

    [-2.3, 0, 2.3].forEach((x) => {
      const lg = new THREE.Group();
      lg.add(pos(cyl(0.012, 0.012, 0.62, 0x0f0f0f, {}, 6), 0, 0.31, 0));
      const b = sph(0.25, 0xffb066, { emissive: 0xff7326, emissiveIntensity: 1.35, rough: 0.6 }, 20);
      b.scale.y = 1.28; b.position.y = -0.1; lg.add(b);
      lanternMats.push(b.material);
      lg.add(pos(cyl(0.07, 0.09, 0.06, 0x281b13, {}, 10), 0, 0.13, 0));
      const light = new THREE.PointLight(0xffa64d, 1.5, 7.5, 2);
      light.position.y = -0.1; lg.add(light);
      lg.position.set(x, 2.56, 0.6);
      scene.add(lg);
    });

    scene.add(s);
  }

  function buildCounterItems() {
    const g = new THREE.Group();
    g.add(pos(box(6.4, 0.14, 1.05, 0x7a5334, { rough: 0.66 }), 0, 1.02, 0.6));
    g.add(pos(box(6.4, 0.95, 0.12, 0x5c3d26, { rough: 0.86 }), 0, 0.52, 1.08));
    g.add(pos(box(6.1, 0.08, 0.9, 0x452f1f, { rough: 0.9 }), 0, 0.55, 0.2));

    const potG = new THREE.Group();
    potG.add(pos(cyl(0.42, 0.38, 0.5, 0x3d4248, { metal: 0.55, rough: 0.36 }, 28), 0, 0.35, 0));
    potG.add(pos(cyl(0.4, 0.42, 0.07, 0x4a5056, { metal: 0.55, rough: 0.36 }, 28), 0, 0.63, 0));
    potG.add(pos(sph(0.05, 0x2b2f33, { metal: 0.4 }, 10), 0, 0.69, 0));
    potG.position.set(1.5, 1.09, 0.55);
    g.add(potG);
    addSteam(new THREE.Vector3(1.5, 1.82, 0.55), 0.34, 9);
    registerHotspot('menu', 'Specials', potG, new THREE.Vector3(1.5, 2.05, 0.55));

    [-2.15, -1.5, -0.85].forEach((x, k) => {
      const z = 0.5 + (k % 2) * 0.12;
      g.add(pos(cyl(0.19, 0.11, 0.13, 0xe9ddc6, { rough: 0.5 }, 22), x, 1.16, z));
      g.add(pos(cyl(0.165, 0.16, 0.03, 0xcf9a55, { rough: 0.3 }, 18), x, 1.21, z));
      addSteam(new THREE.Vector3(x, 1.35, z), 0.13, 4);
    });

    const boxG = new THREE.Group();
    boxG.add(pos(box(0.34, 0.3, 0.34, 0xcbb083, { rough: 0.95 }), 0, 0.15, 0));
    const fa = pos(box(0.34, 0.02, 0.16, 0xd8bd90), 0, 0.3, 0.09); fa.rotation.x = -0.5;
    const fb = pos(box(0.34, 0.02, 0.16, 0xbfa478), 0, 0.3, -0.09); fb.rotation.x = 0.5;
    boxG.add(fa); boxG.add(fb);
    boxG.position.set(2.55, 1.09, 0.6); boxG.rotation.y = 0.4;
    g.add(boxG);
    registerHotspot('bill', 'The Bill', boxG, new THREE.Vector3(2.55, 1.72, 0.6));

    [-2.7, -2.4, 2.75].forEach((x) => {
      g.add(pos(cyl(0.05, 0.07, 0.34, 0x2f6f5e, { rough: 0.4, metal: 0.1 }, 12), x, 0.72, 0.15));
    });

    scene.add(g);
  }

  function addSteam(p, spread, count) {
    const grp = new THREE.Group();
    grp.position.copy(p);
    const tex = textTexture((c, w, h) => {
      const rg = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      rg.addColorStop(0, 'rgba(255,255,255,0.5)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.fillRect(0, 0, w, h);
    }, 64, 64);
    for (let i = 0; i < count; i++) {
      const q = new THREE.Mesh(
        new THREE.PlaneGeometry(spread * 1.8, spread * 1.8),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })
      );
      q.userData.seed = Math.random();
      q.userData.spread = spread;
      grp.add(q);
    }
    steamGroups.push(grp);
    scene.add(grp);
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
    head.add(pos(sph(0.111 * hs, opt.hair || 0x1c1510, { rough: 1 }, 16), 0, 0.024, -0.008));
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
      sh.add(elbow);
      torso.add(sh);
      return { sh, elbow };
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
      return { hp, knee };
    };
    const legL = leg(-1), legR = leg(1);

    p.userData.rig = { hip, torso, head, armL, armR, legL, legR, face };
    p.scale.setScalar(sc);
    return p;
  }

  /* ================= NPC acting =================
     A pose is a flat set of joint targets. An action writes one; the rig eases
     toward it every frame. That means any action blends into any other for free,
     with no explicit crossfade code and no snapping.
     ============================================== */

  function seatedPose() {
    return {
      hipY: 0.64, torsoX: 0.08, torsoY: 0, torsoZ: 0,
      headX: 0, headY: 0, headZ: 0,
      lShX: -0.5, lShZ: 0, lElX: 0,
      rShX: -0.7, rShZ: 0, rElX: -1.0,
      mouth: 0,
    };
  }
  function standingPose() {
    return {
      hipY: 0.8, torsoX: 0.07, torsoY: 0, torsoZ: 0,
      headX: 0.15, headY: 0, headZ: 0,
      lShX: -0.95, lShZ: 0.1, lElX: -0.75,
      rShX: -1.0, rShZ: -0.12, rElX: -0.6,
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
    rig.armR.sh.rotation.x = c.rShX; rig.armR.sh.rotation.z = c.rShZ;
    rig.armR.elbow.rotation.x = c.rElX;
    const open = c.mouth > 0.5;
    const f = rig.face;
    if (f && f.userData.open !== open) {
      f.userData.open = open;
      f.material.map = faceTexture(open);
      f.material.needsUpdate = true;
    }
  }

  // mouth flap: fast, irregular, and only while a line is actually up
  const flap = (tl) => (Math.sin(tl * 17) + Math.sin(tl * 26.3) > 0.1 ? 1 : 0);

  // ---- seated actions ----
  const SEATED_ACTS = {
    eat(p, tl) {
      const s = Math.sin(tl * 2.6) * 0.5 + 0.5;
      p.rElX = -0.7 - s * 0.7;
      p.torsoX = 0.08 + s * 0.12;
      p.headX = s * 0.15;
    },
    pause(p, tl) {
      p.rElX = -0.85;
      p.torsoX = 0.06 + Math.sin(tl * 0.9) * 0.02;
      p.headX = 0.05;
      p.headY = Math.sin(tl * 0.5) * 0.3;
    },
    drink(p, tl) {
      const lift = Math.sin(Math.min(Math.PI, tl * 1.1));
      p.lShX = -0.5 - lift * 0.55;
      p.lElX = -lift * 1.5;
      p.rShX = -0.7 - lift * 0.3;
      p.torsoX = 0.08 - lift * 0.06;
      p.headX = -lift * 0.25;
    },
    talk(p, tl, npc) {
      p.torsoY = npc.userData.ai.face * 0.5;
      p.headY = npc.userData.ai.face * 0.7;
      p.headX = Math.sin(tl * 3.1) * 0.06;
      p.rShX = -0.55 + Math.sin(tl * 2.2) * 0.18;
      p.rElX = -0.75 + Math.sin(tl * 2.9) * 0.25;
      p.mouth = flap(tl);
    },
    listen(p, tl, npc) {
      p.torsoY = npc.userData.ai.face * 0.4;
      p.headY = npc.userData.ai.face * 0.65;
      // a nod every couple of seconds
      p.headX = Math.max(0, Math.sin(tl * 1.4)) * 0.16;
      p.rElX = -0.9;
    },
    lookUp(p, tl) {
      p.headX = -0.16;
      p.torsoX = 0.02;
      p.rElX = -0.9;
    },
  };

  // ---- cook actions ----
  const COOK_ACTS = {
    stir(p, tl) {
      const st = tl * 1.9;
      p.hipY = 0.8 + Math.sin(tl * 1.1) * 0.012;
      p.torsoX = 0.07 + Math.sin(tl * 1.1) * 0.022 + Math.sin(tl * 0.85) * 0.014;
      p.torsoY = Math.sin(tl * 0.5) * 0.1;
      p.headX = 0.15 + Math.sin(tl * 0.9) * 0.05;
      p.headY = Math.sin(tl * 0.37) * 0.2;
      p.rShX = -1.0 + Math.sin(st) * 0.1;
      p.rShZ = -0.12 + Math.cos(st) * 0.12;
      p.rElX = -0.6 + Math.sin(st + 1.1) * 0.15;
    },
    plate(p, tl) {
      p.torsoX = 0.3;
      p.headX = 0.42;
      p.lShX = -1.25; p.lElX = -0.5;
      p.rShX = -1.2 + Math.sin(tl * 3.4) * 0.16;
      p.rElX = -0.85 + Math.sin(tl * 4.1) * 0.2;
    },
    serve(p, tl) {
      const push = Math.sin(Math.min(Math.PI, tl * 1.5));
      p.torsoX = 0.1 + push * 0.22;
      p.headX = 0.2 + push * 0.12;
      p.lShX = -1.15 - push * 0.5; p.lElX = -0.35;
      p.rShX = -1.15 - push * 0.5; p.rElX = -0.3;
    },
    chat(p, tl) {
      p.torsoX = 0.02;
      p.torsoY = Math.sin(tl * 0.7) * 0.12;
      p.headX = -0.05 + Math.sin(tl * 2.6) * 0.05;
      p.headY = Math.sin(tl * 0.9) * 0.16;
      p.lShX = -0.7; p.lElX = -0.5;
      p.rShX = -0.85 + Math.sin(tl * 2.4) * 0.22;
      p.rShZ = -0.2 + Math.cos(tl * 1.7) * 0.16;
      p.rElX = -0.9 + Math.sin(tl * 3.1) * 0.3;
      p.mouth = flap(tl);
    },
    wipe(p, tl) {
      p.torsoX = 0.24;
      p.torsoY = Math.sin(tl * 2.1) * 0.22;
      p.headX = 0.34;
      p.rShX = -1.3; p.rElX = -0.4;
      p.rShZ = Math.sin(tl * 2.1) * 0.3;
      p.lShX = -0.6; p.lElX = -0.3;
    },
  };

  // ---- per-NPC state machine ----
  // Each NPC picks its own next action on a timer. The director can lock one out
  // of self-selection while a scripted beat is using it.
  const DINER_PLAN = [
    { act: 'eat', w: 5, dur: [4, 9] },
    { act: 'pause', w: 2, dur: [2.5, 4.5] },
    { act: 'drink', w: 1, dur: [2.6, 3.4] },
  ];
  const COOK_PLAN = [
    { act: 'stir', w: 5, dur: [5, 10] },
    { act: 'plate', w: 2, dur: [3, 5] },
    { act: 'wipe', w: 1, dur: [3.5, 5.5] },
  ];
  // function declaration, not a const arrow: initAI calls this during scene
  // construction, which happens above this line.
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pickPlan(plan) {
    let total = 0;
    for (const e of plan) total += e.w;
    let r = Math.random() * total;
    for (const e of plan) { r -= e.w; if (r <= 0) return e; }
    return plan[0];
  }

  function initAI(npc, kind, base) {
    npc.userData.ai = {
      kind, cur: base(), tgt: base(),
      act: kind === 'cook' ? 'stir' : 'eat',
      t: Math.random() * 3, dur: rnd(3, 7),
      locked: false, face: 0,
    };
  }
  function setAct(npc, act, dur) {
    const ai = npc.userData.ai;
    if (!ai) return;
    ai.act = act; ai.t = 0; ai.dur = dur;
  }

  function tickNPC(npc, dt) {
    const ai = npc.userData.ai;
    if (!ai) return;
    ai.t += dt;
    if (!ai.locked && ai.t >= ai.dur) {
      const plan = pickPlan(ai.kind === 'cook' ? COOK_PLAN : DINER_PLAN);
      ai.act = plan.act; ai.t = 0; ai.dur = rnd(plan.dur[0], plan.dur[1]);
    }
    const base = ai.kind === 'cook' ? standingPose() : seatedPose();
    const fn = (ai.kind === 'cook' ? COOK_ACTS : SEATED_ACTS)[ai.act];
    if (fn) fn(base, ai.t, npc);
    ai.tgt = base;
    // exponential smoothing, framerate independent
    easePose(ai.cur, ai.tgt, 1 - Math.exp(-dt * 7));
    applyPose(npc.userData.rig, ai.cur);
  }

  /* ---------- speech ---------- */
  const bubbles = [];
  const _bubV = new THREE.Vector3();
  function say(npc, text, dur = 3.4) {
    if (!npc || !text) return;
    const el = document.createElement('div');
    el.className = 'say';
    el.textContent = text;
    document.body.appendChild(el);
    bubbles.push({ el, npc, t: 0, dur });
  }
  function updateBubbles(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.t += dt;
      if (b.t >= b.dur) { b.el.remove(); bubbles.splice(i, 1); continue; }
      b.npc.userData.rig.head.getWorldPosition(_bubV);
      _bubV.y += 0.52; // clears the "you" tag, which sits just above head height
      _bubV.project(camera);
      const off = _bubV.z > 1;
      b.el.style.display = off ? 'none' : '';
      if (off) continue;
      b.el.style.left = (_bubV.x * 0.5 + 0.5) * window.innerWidth + 'px';
      b.el.style.top = (-_bubV.y * 0.5 + 0.5) * window.innerHeight + 'px';
      b.el.style.opacity = String(Math.max(0, Math.min(1, Math.min(b.t, b.dur - b.t) / 0.35)));
    }
  }
  const pickLine = (arr) => (arr && arr.length ? arr[(Math.random() * arr.length) | 0] : '');

  /* ---------- the director ----------
     Independent loops read as machinery. Two characters acknowledging each other
     once every twenty seconds is what makes the place feel occupied. One beat
     runs at a time; it locks its cast, fires timed cues, then releases them. */
  let beat = null;
  let nextBeat = 6;

  function startBeat(cast, dur, cues) {
    for (const n of cast) if (n.userData.ai) n.userData.ai.locked = true;
    beat = { cast, dur, cues, t: 0, i: 0 };
  }
  function tickBeat(dt) {
    if (!beat) return;
    beat.t += dt;
    while (beat.i < beat.cues.length && beat.t >= beat.cues[beat.i].at) {
      beat.cues[beat.i].go();
      beat.i++;
    }
    if (beat.t >= beat.dur) {
      for (const n of beat.cast) if (n.userData.ai) n.userData.ai.locked = false;
      beat = null;
      nextBeat = rnd(11, 21);
    }
  }

  function chooseBeat() {
    const cook = guideRig ? guide : null;
    const seated = diners.filter((d) => d.userData.ai);
    if (!seated.length) return;
    const roll = Math.random();

    // 1. the cook plates a bowl and puts it in front of someone
    if (cook && roll < 0.42) {
      const who = seated[(Math.random() * seated.length) | 0];
      who.userData.ai.face = who.position.x < 0 ? 0.5 : -0.5;
      startBeat([cook, who], 9.2, [
        { at: 0.0, go: () => setAct(cook, 'plate', 3.4) },
        { at: 3.4, go: () => { setAct(cook, 'serve', 2.2); setAct(who, 'lookUp', 2.6); } },
        { at: 4.4, go: () => say(cook, pickLine(CHATTER.cook), 3.2) },
        { at: 5.8, go: () => setAct(cook, 'chat', 2.0) },
        { at: 6.2, go: () => setAct(who, 'listen', 2.4) },
        { at: 8.0, go: () => { setAct(cook, 'stir', 6); setAct(who, 'eat', 7); } },
      ]);
      return;
    }

    // 2. the cook says something across the counter
    if (cook && roll < 0.68) {
      const who = seated[(Math.random() * seated.length) | 0];
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
      const i = (Math.random() * (sorted.length - 1)) | 0;
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

  function tickDirector(dt) {
    if (REDUCED) return;
    if (beat) { tickBeat(dt); return; }
    nextBeat -= dt;
    if (nextBeat <= 0) chooseBeat();
  }

  function walkRig(rig, phase, amt) {
    rig.legL.hp.rotation.x = Math.sin(phase) * 0.55 * amt;
    rig.legR.hp.rotation.x = Math.sin(phase + Math.PI) * 0.55 * amt;
    rig.legL.knee.rotation.x = Math.max(0, -Math.cos(phase)) * 0.7 * amt;
    rig.legR.knee.rotation.x = Math.max(0, -Math.cos(phase + Math.PI)) * 0.7 * amt;
    rig.armL.sh.rotation.x = Math.sin(phase + Math.PI) * 0.4 * amt;
    rig.armR.sh.rotation.x = Math.sin(phase) * 0.4 * amt;
    rig.armL.elbow.rotation.x = -0.3 * amt;
    rig.armR.elbow.rotation.x = -0.3 * amt;
    rig.hip.position.y = 0.8 - Math.abs(Math.sin(phase)) * 0.03 * amt;
    rig.torso.rotation.z = Math.sin(phase) * 0.03 * amt;
  }

  // one person hunched over a bowl, chopsticks in hand
  function seatedPerson(sp) {
    const d = buildPerson({
      shirt: sp.shirt, hair: sp.hair,
      scale: sp.scale ?? 0.96, build: sp.build ?? 1, headScale: sp.headScale ?? 1,
    });
    d.position.set(sp.x, 0, 1.5);
    d.rotation.y = Math.PI;
    const r = d.userData.rig;
    r.hip.position.y = 0.64;
    r.legL.hp.rotation.x = -1.5; r.legR.hp.rotation.x = -1.5;
    r.legL.knee.rotation.x = 1.5; r.legR.knee.rotation.x = 1.5;
    r.armL.sh.rotation.x = -0.5; r.armR.sh.rotation.x = -0.7;
    r.armR.elbow.rotation.x = -1.0;
    const stick = pos(box(0.012, 0.012, 0.16, 0x8a6a3c), 0, -0.24, 0.02);
    stick.rotation.x = 0.5;
    r.armR.elbow.add(stick);
    initAI(d, 'diner', seatedPose);
    diners.push(d);
    scene.add(d);
    return d;
  }

  function buildStool(x) {
    scene.add(pos(cyl(0.17, 0.17, 0.06, 0xb0423a, { rough: 0.7 }, 18), x, 0.56, 1.52));
    scene.add(pos(cyl(0.03, 0.05, 0.56, 0x2a2018, {}, 10), x, 0.28, 1.52));
    const g = new THREE.Group();
    g.position.set(x, 0, 1.52);
    addBlobShadow(g, 0.46, 0.75);
    scene.add(g);
  }

  function buildDiners() {
    const spots = [
      { x: -1.9, hair: 0x2a1c12, shirt: 0x6b4a2f, scale: 1.0, build: 1.08, headScale: 0.97 },
      { x: -0.9, hair: 0x14100c, shirt: 0x394a5e, scale: 0.92, build: 0.94, headScale: 1.03 },
      { x: 1.75, hair: 0x3a2a1a, shirt: 0x5a5560, scale: 0.97, build: 1.0, headScale: 1.0 },
    ];
    spots.forEach((sp, i) => {
      buildStool(sp.x);
      seatedPerson(sp);
    });
  }

  /* ---------- the free stool: the one seat that is always open ---------- */
  function buildEmptySeat() {
    const g = new THREE.Group();
    g.position.set(SEAT.x, 0, SEAT.z);
    g.add(pos(cyl(0.17, 0.17, 0.06, 0xb0423a, { rough: 0.7 }, 18), 0, 0.56, 0));
    g.add(pos(cyl(0.03, 0.05, 0.56, 0x2a2018, {}, 10), 0, 0.28, 0));
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
    scene.add(g);
    registerHotspot('seat', 'Take a seat', g, new THREE.Vector3(SEAT.x, 1.0, SEAT.z));
  }

  // you, on the stool. built up front but hidden until the camera leaves you,
  // so the empty seat is not still empty once you are supposedly sitting in it.
  function buildYou() {
    you = seatedPerson({
      x: SEAT.x, hair: 0x241a12, shirt: 0x8c4436, scale: 0.99, build: 1.02, headScale: 0.99,
    });
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
          if (Math.random() < 0.5) {
            g.fillStyle = Math.random() < 0.7 ? 'rgba(255,196,120,0.85)' : 'rgba(150,180,255,0.7)';
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

    const w1 = buildPerson({ shirt: 0x22202a, hair: 0x101010, scale: 1.04, build: 1.07, headScale: 0.96 });
    addBlobShadow(w1, 0.36, 0.6);
    w1.position.set(-8, 0, 3.4); w1.rotation.y = Math.PI / 2;
    w1.userData.speed = 0.9; w1.userData.range = 8;
    walkers.push(w1); scene.add(w1);
    const w2 = buildPerson({ shirt: 0x2b2530, hair: 0x1a1a1a, scale: 0.95, build: 0.92, headScale: 1.02 });
    addBlobShadow(w2, 0.34, 0.6);
    w2.position.set(7, 0, 4.1); w2.rotation.y = -Math.PI / 2;
    w2.userData.speed = -0.65; w2.userData.range = 7;
    walkers.push(w2); scene.add(w2);
  }

  function buildGround() {
    const gt = textTexture((g, w, h) => {
      g.fillStyle = '#13161c'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 800; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.028) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3;
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(0, k * h / 6); g.lineTo(w, k * h / 6); g.stroke(); }
    }, 512, 512);
    gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(5, 5);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), new THREE.MeshBasicMaterial({ color: 0xff9a4d, transparent: true, opacity: 0.06 }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.01, 1.6);
    scene.add(glow);
  }

  /* ---------- the cook: GLB if present, stand-in otherwise ---------- */
  function useStandInCook() {
    guide = buildPerson({ shirt: 0xffffff, apron: true, toque: true, skin: 0xd7a173, hair: 0x241a12 });
    guide.position.set(-0.3, 0, -0.5);
    guideRig = guide.userData.rig;
    // a ladle in the stirring hand, so the motion reads as cooking
    const ladle = pos(cyl(0.012, 0.012, 0.2, 0x9a8058, {}, 8), 0, -0.26, 0.02);
    ladle.rotation.x = 0.45;
    ladle.add(pos(sph(0.045, 0x8d939a, { metal: 0.5, rough: 0.4 }, 10), 0, -0.11, 0.01));
    guideRig.armR.elbow.add(ladle);
    addBlobShadow(guide, 0.4, 0.7);
    initAI(guide, 'cook', standingPose);
    scene.add(guide);
    registerHotspot('guide', 'The Guide', guide, new THREE.Vector3(-0.3, 1.7, -0.5));
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
        guide.position.set(-0.3, 0, -0.5);
        guide.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.frustumCulled = false; } });
        scene.add(guide);
        if (gltf.animations && gltf.animations.length) {
          guideMixer = new THREE.AnimationMixer(guide);
          const clip =
            gltf.animations.find((a) => /idle|breath/i.test(a.name)) || gltf.animations[0];
          guideMixer.clipAction(clip).play();
        }
        registerHotspot('guide', 'The Guide', guide, new THREE.Vector3(-0.3, 1.9, -0.5));
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
      el.innerHTML = '<span class="dot" aria-hidden="true"></span>' + labelFor(hs.key);
      el.addEventListener('click', () => onHotspot(hs.key));
      el.addEventListener('mouseenter', () => { hs._hover = true; });
      el.addEventListener('mouseleave', () => { hs._hover = false; });
      pinWrap.appendChild(el);
      hotspots.filter((h) => h.key === hs.key).forEach((h) => { h.el = el; });
    });
  }
  function labelFor(key) {
    return { menu: 'Menu', guide: 'The Guide', log: 'Kitchen Log', bill: 'The Bill' }[key] || key;
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
  const cam = { az: 0.78, el: 0.28, r: 9.6, azT: 0.5, elT: 0.17, rT: 6.7 };
  const target = new THREE.Vector3(0, 1.2, 0.25);
  let dragging = false, movedFar = false, dnX = 0, dnY = 0, lX = 0, lY = 0, dnT = 0, userMoved = false;

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
  }

  function ndc(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  const onDown = (e) => {
    if (phase === 'sitting') return;
    ndc(e); // a tap may never fire pointermove, so seed the ray here too
    movedFar = false;
    dnX = lX = e.clientX; dnY = lY = e.clientY; dnT = performance.now();
    if (phase !== 'seated') return; // no orbiting while you are still standing
    dragging = true; userMoved = true;
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    hideHint();
  };
  const onMove = (e) => {
    ndc(e);
    if (!dragging) return;
    const dx = e.clientX - lX, dy = e.clientY - lY;
    lX = e.clientX; lY = e.clientY;
    if (Math.abs(e.clientX - dnX) + Math.abs(e.clientY - dnY) > 6) movedFar = true;
    cam.azT -= dx * 0.006;
    cam.elT = Math.max(-0.03, Math.min(0.62, cam.elT - dy * 0.004));
  };
  const onUp = () => {
    dragging = false; canvas.classList.remove('grabbing');
    if (phase === 'sitting') return;
    if (!movedFar && performance.now() - dnT < 500) tryClick();
  };
  const onWheel = (e) => {
    e.preventDefault();
    if (phase !== 'seated') return;
    userMoved = true;
    cam.rT = Math.max(4.6, Math.min(10, cam.rT + e.deltaY * 0.002));
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { dragging = false; canvas.classList.remove('grabbing'); });
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
    seatPin.innerHTML = '<span class="dot" aria-hidden="true"></span>take a seat';
    seatPin.setAttribute('aria-label', 'Take the empty seat at the counter');
    seatPin.addEventListener('click', takeSeat);
    document.body.appendChild(seatPin);
  }
  function buildYouPin() {
    if (youPin) return;
    youPin = document.createElement('div');
    youPin.className = 'you-pin';
    youPin.textContent = 'you';
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
    _sv.set(SEAT.x, 1.02, SEAT.z).project(camera);
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
    const dt = Math.min(clock.getDelta(), 0.05);
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

    if (REDUCED) {
      for (const d of diners) applyPose(d.userData.rig, d.userData.ai.cur);
      if (guideRig && guide.userData.ai) applyPose(guideRig, guide.userData.ai.cur);
    } else {
      // the director only performs for someone who is actually sitting down
      if (phase === 'seated') tickDirector(dt);
      for (const d of diners) tickNPC(d, dt);
      if (guideRig && guide.userData.ai) tickNPC(guide, dt);
      updateBubbles(dt);
    }

    for (let i = 0; i < walkers.length; i++) {
      const wk = walkers[i], wd = wk.userData;
      if (REDUCED) continue;
      wk.position.x += wd.speed * dt;
      if (wk.position.x > wd.range) wk.position.x = -wd.range;
      if (wk.position.x < -wd.range) wk.position.x = wd.range;
      walkRig(wk.userData.rig, t * (2.75 + i * 0.55) + i * 1.9, 1);
    }

    for (const grp of steamGroups) {
      for (const q of grp.children) {
        const life = ((t * (REDUCED ? 0.05 : 0.4) + q.userData.seed) % 1);
        q.position.y = life * 0.95;
        q.position.x = Math.sin((life + q.userData.seed) * 6) * q.userData.spread * 0.45;
        q.material.opacity = Math.sin(life * Math.PI) * 0.3;
        q.scale.setScalar(0.5 + life * 1.5);
        q.quaternion.copy(camera.quaternion);
      }
    }

    for (let i = 0; i < norenFlaps.length; i++) {
      norenFlaps[i].rotation.x = REDUCED ? 0 : Math.sin(t * 1.3 + i) * 0.05;
    }
    if (!REDUCED) {
      for (let i = 0; i < lanternMats.length; i++) {
        lanternMats[i].emissiveIntensity = 1.2 + Math.sin(t * (6 + i * 2.1)) * 0.12 + Math.random() * 0.04;
      }
    }

    updateHover();
    if (phase === 'seated') { updatePins(); updateYouPin(); }
    else { updateSeatPin(t); updateYouPin(); }
    renderer.render(scene, camera);
  }
  frame();

  return {
    setBookOpen(v) { bookOpen = v; hideHint(); },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
