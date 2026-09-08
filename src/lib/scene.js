/* ============================================================
   nightbowl — the ramen stall scene (three.js, no globals)

   Everything here is drawn from primitives except the cook:
   if /models/chef.glb exists it is loaded and animated, otherwise
   a hand-built stand-in is used so the scene always works.

   initScene(canvas, onHotspot) -> { setBookOpen, dispose }
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function initScene(canvas, onHotspot) {
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

  /* ---------- stall ---------- */
  buildStall();
  buildCounterItems();
  buildDiners();
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
  function buildPerson(opt = {}) {
    const sc = opt.scale || 1;
    const skin = opt.skin || 0xcf9264;
    const shirt = opt.shirt || 0x39506b;
    const p = new THREE.Group();

    const hip = new THREE.Group();
    hip.position.y = 0.8;
    p.add(hip);
    hip.add(pos(box(0.26, 0.16, 0.16, shirt, { rough: 0.9 }), 0, 0, 0));

    const torso = new THREE.Group();
    torso.position.y = 0.12;
    hip.add(torso);
    torso.add(pos(cyl(0.15, 0.18, 0.44, shirt, { rough: 0.9 }, 14), 0, 0.22, 0));
    if (opt.apron) torso.add(pos(box(0.3, 0.4, 0.1, 0xe7dcc5, { rough: 1 }), 0, 0.14, 0.1));
    torso.add(pos(cyl(0.05, 0.05, 0.08, skin, { rough: 1 }, 10), 0, 0.46, 0));

    const head = new THREE.Group();
    head.position.y = 0.56;
    torso.add(head);
    head.add(pos(sph(0.13, skin, { rough: 1 }, 18), 0, 0, 0));
    const faceTex = textTexture((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#20140c';
      g.beginPath(); g.arc(w * 0.38, h * 0.46, 7, 0, 7); g.fill();
      g.beginPath(); g.arc(w * 0.62, h * 0.46, 7, 0, 7); g.fill();
      g.strokeStyle = '#20140c'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w * 0.33, h * 0.36); g.lineTo(w * 0.43, h * 0.34); g.stroke();
      g.beginPath(); g.moveTo(w * 0.57, h * 0.34); g.lineTo(w * 0.67, h * 0.36); g.stroke();
      g.beginPath(); g.moveTo(w * 0.42, h * 0.62); g.quadraticCurveTo(w * 0.5, h * 0.68, w * 0.58, h * 0.62); g.stroke();
    }, 128, 128);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true }));
    face.position.set(0, 0.01, 0.122);
    head.add(face);
    head.add(pos(sph(0.135, opt.hair || 0x1c1510, { rough: 1 }, 16), 0, 0.03, -0.01));
    if (opt.cap != null) {
      head.add(pos(cyl(0.14, 0.14, 0.06, opt.cap, { rough: 1 }, 14), 0, 0.07, 0));
      head.add(pos(box(0.24, 0.02, 0.02, opt.cap), 0, 0.05, 0));
    }
    if (opt.toque) {
      const toque = pos(cyl(0.16, 0.15, 0.14, 0xf3efe6, { rough: 1 }, 18), 0, 0.13, 0);
      const puff = pos(sph(0.17, 0xf3efe6, { rough: 1 }, 14), 0, 0.24, 0);
      puff.scale.y = 0.7;
      head.add(toque); head.add(puff);
    }

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.19, 0.36, 0);
      sh.add(pos(cyl(0.045, 0.05, 0.24, shirt, { rough: 0.9 }, 8), 0, -0.12, 0));
      const elbow = new THREE.Group(); elbow.position.y = -0.24;
      elbow.add(pos(cyl(0.04, 0.045, 0.22, skin, { rough: 1 }, 8), 0, -0.11, 0));
      elbow.add(pos(box(0.06, 0.07, 0.05, skin, { rough: 1 }), 0, -0.24, 0));
      sh.add(elbow);
      torso.add(sh);
      return { sh, elbow };
    };
    const armL = arm(-1), armR = arm(1);

    const leg = (side) => {
      const hp = new THREE.Group();
      hp.position.set(side * 0.09, 0, 0);
      hp.add(pos(cyl(0.06, 0.065, 0.4, 0x2c2c34, { rough: 0.9 }, 8), 0, -0.2, 0));
      const knee = new THREE.Group(); knee.position.y = -0.4;
      knee.add(pos(cyl(0.05, 0.055, 0.38, 0x2c2c34, { rough: 0.9 }, 8), 0, -0.19, 0));
      knee.add(pos(box(0.09, 0.05, 0.18, 0x161616, { rough: 0.9 }), 0, -0.38, 0.04));
      hp.add(knee);
      hip.add(hp);
      return { hp, knee };
    };
    const legL = leg(-1), legR = leg(1);

    p.userData.rig = { hip, torso, head, armL, armR, legL, legR };
    p.scale.setScalar(sc);
    return p;
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

  function buildDiners() {
    const spots = [
      { x: -1.9, hair: 0x2a1c12, shirt: 0x6b4a2f },
      { x: -0.9, hair: 0x14100c, shirt: 0x394a5e },
      { x: 1.75, hair: 0x3a2a1a, shirt: 0x5a5560 },
    ];
    spots.forEach((sp, i) => {
      scene.add(pos(cyl(0.17, 0.17, 0.06, 0xb0423a, { rough: 0.7 }, 18), sp.x, 0.56, 1.52));
      scene.add(pos(cyl(0.03, 0.05, 0.56, 0x2a2018, {}, 10), sp.x, 0.28, 1.52));
      const d = buildPerson({ shirt: sp.shirt, hair: sp.hair, scale: 0.96 });
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
      d.userData.phase = i * 2.1;
      diners.push(d);
      scene.add(d);
    });
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

    const w1 = buildPerson({ shirt: 0x22202a, hair: 0x101010, scale: 1.02 });
    w1.position.set(-8, 0, 3.4); w1.rotation.y = Math.PI / 2;
    w1.userData.speed = 0.9; w1.userData.range = 8;
    walkers.push(w1); scene.add(w1);
    const w2 = buildPerson({ shirt: 0x2b2530, hair: 0x1a1a1a, scale: 0.98 });
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
    [...hotspots].sort((a, b) => (ORDER[a.key] || 9) - (ORDER[b.key] || 9)).forEach((hs) => {
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
  if (REDUCED) { cam.az = cam.azT; cam.el = cam.elT; cam.r = cam.rT; }

  function ndc(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  const onDown = (e) => {
    dragging = true; movedFar = false; userMoved = true;
    dnX = lX = e.clientX; dnY = lY = e.clientY; dnT = performance.now();
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
    if (!movedFar && performance.now() - dnT < 500) tryClick();
  };
  const onWheel = (e) => {
    e.preventDefault(); userMoved = true;
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
    if (bookOpen) return;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hotspots.map((h) => h.obj), true)[0];
    if (hit) { const k = rootHotspot(hit.object); if (k) onHotspot(k); }
  }
  function updateHover() {
    if (bookOpen) { canvas.classList.remove('pointing'); return; }
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hotspots.map((h) => h.obj), true)[0];
    canvas.classList.toggle('pointing', !!(hit && rootHotspot(hit.object)));
  }

  /* ---------- hint ---------- */
  const hintEl = document.getElementById('hint');
  let hintTimer = setTimeout(hideHint, 7000);
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
    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!startT) startT = t;
    const intro = REDUCED ? 1 : Math.min(1, (t - startT) / 2.6);
    const ease = 1 - Math.pow(1 - intro, 3);

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

    if (guideMixer) guideMixer.update(dt);

    if (guideRig && guide) {
      if (REDUCED) {
        guide.position.x = -0.3;
        guideRig.torso.rotation.y = Math.sin(t * 0.6) * 0.15;
      } else {
        const gx = Math.sin(t * 0.34) * 1.0 - 0.3;
        guide.position.x = gx;
        guide.rotation.y = Math.cos(t * 0.34) >= 0 ? -1.3 : 1.3;
        walkRig(guideRig, t * 3.4, 1);
        for (const hs of hotspots) if (hs.key === 'guide') hs.anchor.x = gx;
      }
    } else if (guide && !guideRig && !REDUCED) {
      // GLB cook: gentle patrol, no procedural limb work
      const gx = Math.sin(t * 0.3) * 0.9 - 0.3;
      guide.position.x = gx;
      guide.rotation.y = (Math.cos(t * 0.3) >= 0 ? 1 : -1) * 0.4 + Math.PI;
      for (const hs of hotspots) if (hs.key === 'guide') hs.anchor.x = gx;
    }

    for (const d of diners) {
      const rg = d.userData.rig;
      const s = REDUCED ? 0 : (Math.sin(t * 1.6 + d.userData.phase) * 0.5 + 0.5);
      rg.armR.elbow.rotation.x = -0.7 - s * 0.7;
      rg.torso.rotation.x = 0.08 + s * 0.12;
      rg.head.rotation.x = s * 0.15;
    }

    for (let i = 0; i < walkers.length; i++) {
      const wk = walkers[i], wd = wk.userData;
      if (REDUCED) continue;
      wk.position.x += wd.speed * dt;
      if (wk.position.x > wd.range) wk.position.x = -wd.range;
      if (wk.position.x < -wd.range) wk.position.x = wd.range;
      walkRig(wk.userData.rig, t * 3.0 + i, 1);
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
    updatePins();
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
