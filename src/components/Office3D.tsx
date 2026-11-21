"use client";

// Scene 3D văn phòng AI Office: sàn 1 tầng, mỗi phòng ban 1 phòng riêng,
// 7 nhân viên người bán chân thực (model GLB Mixamo: X Bot / Michelle / Soldier)
// ngồi tại bàn, đứng dậy đi họp / nhận việc theo nhiệm vụ được giao.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import {
  EMPLOYEES,
  MODEL_URLS,
  ROOMS,
  STATUS_COLOR,
  STATUS_LABEL,
  findPath,
  roomCenter,
  type EmployeeDef,
  type EmpStatus,
} from "@/lib/office-data";

export interface OfficeHandle {
  assignTask: (empId: string, title: string) => void;
  focusView: (view: "all" | "meeting" | "quanly") => void;
}

interface Props {
  onStatus: (empId: string, status: EmpStatus, progress: number) => void;
  onLog: (text: string) => void;
  onSelect: (empId: string) => void;
}

interface Agent {
  def: EmployeeDef;
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  idleAction: THREE.AnimationAction | null;
  walkAction: THREE.AnimationAction | null;
  current: THREE.AnimationAction | null;
  label: { sprite: THREE.Sprite; redraw: (s: EmpStatus) => void };
  ring: THREE.Mesh;
  bones: {
    hips?: THREE.Object3D;
    leftUpLeg?: THREE.Object3D;
    rightUpLeg?: THREE.Object3D;
    leftLeg?: THREE.Object3D;
    rightLeg?: THREE.Object3D;
  };
  fallbackParts?: { legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D };
  nodeId: string;
  chairPos: THREE.Vector3;
  chairFacing: number;
  seated: boolean;
  busy: boolean;
  status: EmpStatus;
  path: { x: number; z: number }[];
  walkResolve: (() => void) | null;
  walkPhase: number;
}

const WALL_H = 2.6;

function makeLabel(name: string, tint: string): {
  sprite: THREE.Sprite;
  redraw: (s: EmpStatus) => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.3, 0.575, 1);

  const redraw = (s: EmpStatus) => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(8,12,24,0.78)";
    ctx.beginPath();
    ctx.roundRect(6, 14, 500, 100, 22);
    ctx.fill();
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.roundRect(6, 14, 16, 100, 8);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 40, 52);
    ctx.fillStyle = STATUS_COLOR[s];
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText(STATUS_LABEL[s], 40, 94);
    tex.needsUpdate = true;
  };
  redraw("idle");
  return { sprite, redraw };
}

function makeSign(text: string, color: string, w = 4.4): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 1024, 160);
  ctx.font = "bold 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), 512, 84);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.156), mat);
  return mesh;
}

function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
  opts: { emissive?: string; basic?: boolean; opacity?: number } = {},
): THREE.Mesh {
  const mat = opts.basic
    ? new THREE.MeshBasicMaterial({ color, transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1 })
    : new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.05,
        emissive: opts.emissive ?? "#000000",
        transparent: opts.opacity !== undefined,
        opacity: opts.opacity ?? 1,
      });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = !opts.basic;
  m.receiveShadow = true;
  return m;
}

function buildOffice(scene: THREE.Scene) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: "#263354", roughness: 0.9 });
  const wall = (cx: number, cz: number, len: number, axis: "x" | "z") => {
    const geo =
      axis === "x" ? new THREE.BoxGeometry(len, WALL_H, 0.18) : new THREE.BoxGeometry(0.18, WALL_H, len);
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set(cx, WALL_H / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    // Dải neon trên đỉnh tường
    const strip = new THREE.Mesh(
      axis === "x" ? new THREE.BoxGeometry(len, 0.05, 0.2) : new THREE.BoxGeometry(0.2, 0.05, len),
      new THREE.MeshBasicMaterial({ color: "#22d3ee" }),
    );
    strip.position.set(cx, WALL_H + 0.03, cz);
    g.add(strip);
  };

  // Sàn chính + thảm màu từng phòng
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.MeshStandardMaterial({ color: "#0d1526", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  for (const room of ROOMS) {
    const [x0, x1, z0, z1] = room.bounds;
    const inlay = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 - 0.2, z1 - z0 - 0.2),
      new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.07 }),
    );
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
    g.add(inlay);
    const sign = makeSign(room.name, room.color, 4.6);
    sign.position.set((x0 + x1) / 2, 3.15, (z0 + z1) / 2);
    g.add(sign);
  }
  // Hành lang
  const corridor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 3),
    new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.05 }),
  );
  corridor.rotation.x = -Math.PI / 2;
  corridor.position.set(0, 0.012, -2.5);
  g.add(corridor);

  // Tường ngoài
  wall(0, -12, 40, "x");
  wall(0, 12, 40, "x");
  wall(-20, 0, 24, "z");
  wall(20, 0, 24, "z");
  // Tường sau của hàng phòng trước (z = 8)
  wall(0, 8, 40, "x");
  // Vách ngăn dọc giữa các phòng
  for (const x of [-12, -4, 4, 12]) {
    wall(x, -8, 8, "z");
    wall(x, 3.5, 9, "z");
  }
  // Tường giáp hành lang có chừa cửa (rộng 1.8m tại doorX)
  for (const room of ROOMS) {
    const [x0, x1] = room.bounds;
    const zWall = room.doorSide === "back" ? -4 : -1;
    const a = room.doorX - 0.9;
    const b = room.doorX + 0.9;
    if (a > x0) wall((x0 + a) / 2, zWall, a - x0, "x");
    if (b < x1) wall((b + x1) / 2, zWall, x1 - b, "x");
  }

  // Nội thất từng phòng làm việc: bàn + màn hình + ghế
  const chairPosOf = new Map<string, { x: number; z: number; facing: number }>();
  for (const room of ROOMS) {
    const c = roomCenter(room);
    if (room.kind === "office") {
      const facing = room.doorSide === "back" ? 0 : Math.PI; // hàng sau quay mặt về +z, hàng trước về -z
      const chairZ = room.doorSide === "back" ? room.bounds[2] + 2.6 : room.bounds[3] - 2.6;
      const deskZ = chairZ + (room.doorSide === "back" ? 0.8 : -0.8);
      const big = room.id === "quanly";
      const dw = big ? 2.6 : 1.9;
      g.add(box(dw, 0.08, 0.85, "#334155", c.x, 0.74, deskZ));
      g.add(box(0.08, 0.74, 0.8, "#1e293b", c.x - dw / 2 + 0.1, 0.37, deskZ));
      g.add(box(0.08, 0.74, 0.8, "#1e293b", c.x + dw / 2 - 0.1, 0.37, deskZ));
      // Màn hình
      const monZ = deskZ + (room.doorSide === "back" ? 0.18 : -0.18);
      g.add(box(1.05, 0.62, 0.05, "#0f172a", c.x, 1.18, monZ));
      const screen = box(0.95, 0.52, 0.02, "#38bdf8", c.x, 1.18, monZ + (room.doorSide === "back" ? -0.035 : 0.035), {
        basic: true,
        opacity: 0.85,
      });
      g.add(screen);
      if (big) {
        g.add(box(0.8, 0.5, 0.05, "#0f172a", c.x - 1.05, 1.12, monZ));
        g.add(box(0.6, 0.04, 0.25, "#1e293b", c.x + 0.8, 0.78, deskZ));
      }
      g.add(box(0.7, 0.03, 0.25, "#1e293b", c.x, 0.79, deskZ + (room.doorSide === "back" ? -0.15 : 0.15)));
      // Ghế
      g.add(box(0.55, 0.06, 0.55, room.color, c.x, 0.46, chairZ));
      const backZ = chairZ + (room.doorSide === "back" ? -0.28 : 0.28);
      g.add(box(0.55, 0.65, 0.06, room.color, c.x, 0.85, backZ));
      chairPosOf.set(room.id, { x: c.x, z: chairZ, facing });
    } else if (room.kind === "meeting") {
      g.add(box(4.6, 0.09, 1.9, "#334155", c.x, 0.74, c.z - 0.5));
      for (const dx of [-1.6, 0, 1.6]) {
        g.add(box(0.55, 0.06, 0.55, "#475569", c.x + dx, 0.46, c.z - 1.85));
        g.add(box(0.55, 0.06, 0.55, "#475569", c.x + dx, 0.46, c.z + 0.85));
      }
      const bigScreen = box(3.4, 1.7, 0.06, "#2563eb", c.x, 1.6, room.bounds[2] + 0.15, { basic: true, opacity: 0.9 });
      g.add(bigScreen);
    } else if (room.kind === "lounge") {
      g.add(box(2.6, 0.5, 0.9, "#365314", c.x - 1.5, 0.35, c.z));
      g.add(box(0.9, 0.5, 2.2, "#365314", c.x + 1.6, 0.35, c.z + 0.8));
      g.add(box(1.4, 0.06, 0.7, "#1e293b", c.x, 0.32, c.z));
    } else if (room.kind === "lobby") {
      g.add(box(3.2, 1.05, 0.8, "#1e293b", c.x, 0.52, c.z + 1.6));
      const logo = makeSign("GEN.G_VN", "#22d3ee", 6.5);
      logo.position.set(c.x, 2.2, room.bounds[3] - 0.25);
      logo.rotation.y = Math.PI;
      g.add(logo);
    }
    // Chậu cây ở góc phòng
    const px = room.bounds[0] + 0.7;
    const pz = room.doorSide === "back" ? room.bounds[3] - 0.7 : room.bounds[2] + 0.7;
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.4, 10),
      new THREE.MeshStandardMaterial({ color: "#44403c", roughness: 1 }),
    );
    pot.position.set(px, 0.2, pz);
    g.add(pot);
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshStandardMaterial({ color: "#16a34a", roughness: 1 }),
    );
    leaf.position.set(px, 0.85, pz);
    g.add(leaf);
  }
  scene.add(g);
  return chairPosOf;
}

function findBone(root: THREE.Object3D, suffix: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name.replace(/[^a-zA-Z]/g, "").endsWith(suffix)) found = o;
  });
  return found;
}

/** Tạo dáng ngồi cho các rig kiểu Mixamo (áp dụng sau mixer.update mỗi frame). */
function applySitPose(a: Agent) {
  const b = a.bones;
  if (b.leftUpLeg) b.leftUpLeg.rotation.x = -1.45;
  if (b.rightUpLeg) b.rightUpLeg.rotation.x = -1.45;
  if (b.leftLeg) b.leftLeg.rotation.x = 1.35;
  if (b.rightLeg) b.rightLeg.rotation.x = 1.35;
}

function clearSitPose(a: Agent) {
  const b = a.bones;
  for (const bone of [b.leftUpLeg, b.rightUpLeg, b.leftLeg, b.rightLeg]) {
    if (bone) bone.rotation.x = 0;
  }
}

function pickAction(
  mixer: THREE.AnimationMixer,
  clips: THREE.AnimationClip[],
  names: string[],
): THREE.AnimationAction | null {
  const clip = clips.find((c) => names.some((n) => c.name.toLowerCase().includes(n)));
  return clip ? mixer.clipAction(clip) : null;
}

function buildFallback(def: EmployeeDef): {
  group: THREE.Group;
  parts: NonNullable<Agent["fallbackParts"]>;
} {
  // Nhân vật dự phòng tỉ lệ người thật, dựng từ khối — chỉ dùng khi tải GLB lỗi.
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: "#e8b98d", roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: def.tint, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: "#1f2937", roughness: 0.9 });
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const legGeo = new THREE.BoxGeometry(0.16, 0.85, 0.18);
  legGeo.translate(0, -0.42, 0);
  const legL = mk(legGeo, dark, -0.11, 0.88, 0);
  const legR = mk(legGeo.clone(), dark, 0.11, 0.88, 0);
  mk(new THREE.BoxGeometry(0.52, 0.62, 0.28), cloth, 0, 1.2, 0);
  const armGeo = new THREE.BoxGeometry(0.13, 0.7, 0.15);
  armGeo.translate(0, -0.32, 0);
  const armL = mk(armGeo, cloth, -0.34, 1.48, 0);
  const armR = mk(armGeo.clone(), cloth, 0.34, 1.48, 0);
  mk(new THREE.SphereGeometry(0.16, 18, 14), skin, 0, 1.72, 0);
  return { group, parts: { legL, legR, armL, armR } };
}

const Office3D = forwardRef<OfficeHandle, Props>(function Office3D(props, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    assignTask: (empId: string, title: string) => void;
    focusView: (view: "all" | "meeting" | "quanly") => void;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    assignTask: (empId, title) => apiRef.current?.assignTask(empId, title),
    focusView: (view) => apiRef.current?.focusView(view),
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    const { onStatus, onLog, onSelect } = props;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#070b14");
    scene.fog = new THREE.Fog("#070b14", 55, 110);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    camera.position.set(17, 16, 21);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -1);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight("#bcd7ff", "#1a2436", 0.9));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(14, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    scene.add(sun);
    const glow = new THREE.PointLight("#7c3aed", 60, 40);
    glow.position.set(0, 5, -2.5);
    scene.add(glow);

    const chairPosOf = buildOffice(scene);

    const agents = new Map<string, Agent>();
    const setStatus = (a: Agent, s: EmpStatus, progress = 0) => {
      a.status = s;
      (a.ring.material as THREE.MeshBasicMaterial).color.set(STATUS_COLOR[s]);
      a.label.redraw(s);
      onStatus(a.def.id, s, progress);
    };

    const playAction = (a: Agent, next: THREE.AnimationAction | null) => {
      if (!next || a.current === next) return;
      next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.25).play();
      if (a.current) a.current.fadeOut(0.25);
      a.current = next;
    };

    const sit = (a: Agent) => {
      a.seated = true;
      // Rig có xương đùi (Mixamo): hạ thấp gốc để mông chạm mặt ghế, chân gập.
      // Không có xương phù hợp: đứng tại bàn như bàn đứng.
      const sitY = a.bones.leftUpLeg ? -0.42 : 0;
      a.group.position.set(a.chairPos.x, sitY, a.chairPos.z);
      a.ring.position.y = 0.02 - sitY;
      a.group.rotation.y = a.chairFacing;
      playAction(a, a.idleAction);
    };
    const stand = (a: Agent) => {
      if (!a.seated) return;
      a.seated = false;
      clearSitPose(a);
      a.group.position.y = 0;
      a.ring.position.y = 0.02;
    };

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const walkTo = (a: Agent, targetNode: string): Promise<void> => {
      if (a.nodeId === targetNode) return Promise.resolve();
      stand(a);
      const pts = findPath(a.nodeId, targetNode);
      if (!pts.length) return Promise.resolve();
      setStatus(a, "walking");
      a.path = pts;
      return new Promise<void>((resolve) => {
        a.walkResolve = () => {
          a.nodeId = targetNode;
          playAction(a, a.idleAction);
          resolve();
        };
      });
    };

    const assignTask = async (empId: string, title: string) => {
      const emp = agents.get(empId);
      const mgr = agents.get("manager");
      if (!emp || !mgr || emp.busy || disposed) return;
      emp.busy = true;
      try {
        onLog(`AI Quản Lý giao nhiệm vụ "${title}" cho ${emp.def.name}.`);
        if (empId === "manager") {
          setStatus(emp, "working", 0);
        } else {
          await Promise.all([walkTo(mgr, "meet-a"), walkTo(emp, "meet-b")]);
          if (disposed) return;
          // Hai người quay mặt vào nhau trong phòng họp
          mgr.group.rotation.y = Math.PI / 2;
          emp.group.rotation.y = -Math.PI / 2;
          setStatus(mgr, "meeting");
          setStatus(emp, "meeting");
          onLog(`${emp.def.name} đang họp với AI Quản Lý tại Phòng Họp…`);
          await wait(3500);
          if (disposed) return;
          onLog(`${emp.def.name} đã nhận việc, quay về bàn làm việc.`);
          await Promise.all([
            walkTo(mgr, "desk-quanly").then(() => sit(mgr)),
            walkTo(emp, `desk-${emp.def.roomId}`).then(() => sit(emp)),
          ]);
          if (disposed) return;
          setStatus(mgr, "idle");
        }
        // Giai đoạn làm việc: tiến độ 0 → 100
        let p = 0;
        setStatus(emp, "working", 0);
        while (p < 100 && !disposed) {
          await wait(220);
          p = Math.min(100, p + 3 + Math.random() * 5);
          onStatus(emp.def.id, "working", Math.floor(p));
        }
        if (disposed) return;
        setStatus(emp, "done", 100);
        onLog(`✔ ${emp.def.name} hoàn thành nhiệm vụ "${title}".`);
        await wait(5000);
        if (!disposed && emp.status === "done") setStatus(emp, "idle");
      } finally {
        emp.busy = false;
      }
    };

    let camGoal: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;
    const focusView = (view: "all" | "meeting" | "quanly") => {
      if (view === "all") camGoal = { pos: new THREE.Vector3(17, 16, 21), tgt: new THREE.Vector3(0, 0, -1) };
      else if (view === "meeting") camGoal = { pos: new THREE.Vector3(16, 6.5, 3.5), tgt: new THREE.Vector3(16, 0.8, -8) };
      else camGoal = { pos: new THREE.Vector3(-16, 6, 3), tgt: new THREE.Vector3(-16, 0.8, -9) };
    };
    apiRef.current = { assignTask, focusView };

    // --- Nạp nhân vật ---
    const loader = new GLTFLoader();
    const cache = new Map<string, Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] }>>();
    const loadModel = (kind: EmployeeDef["model"]) => {
      if (!cache.has(kind)) {
        cache.set(
          kind,
          loader.loadAsync(MODEL_URLS[kind]).then((gltf) => ({
            scene: gltf.scene as THREE.Group,
            clips: gltf.animations,
          })),
        );
      }
      return cache.get(kind)!;
    };

    let readyCount = 0;
    const maybeAutoDemo = () => {
      readyCount += 1;
      if (readyCount === EMPLOYEES.length && !disposed) {
        onLog("Văn phòng đã sẵn sàng. Chạy thử một nhiệm vụ mẫu…");
        setTimeout(() => assignTask("dev", "Xây dựng tính năng đăng nhập"), 1200);
      }
    };

    for (const def of EMPLOYEES) {
      const chair = chairPosOf.get(def.roomId) ?? { x: 0, z: 0, facing: 0 };
      const group = new THREE.Group();
      group.userData.empId = def.id;
      const label = makeLabel(def.name, def.tint);
      label.sprite.position.y = 2.15;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.48, 32),
        new THREE.MeshBasicMaterial({ color: STATUS_COLOR.idle, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;

      const agent: Agent = {
        def,
        group,
        mixer: null,
        idleAction: null,
        walkAction: null,
        current: null,
        label,
        ring,
        bones: {},
        nodeId: `desk-${def.roomId}`,
        chairPos: new THREE.Vector3(chair.x, 0, chair.z),
        chairFacing: chair.facing,
        seated: false,
        busy: false,
        status: "idle",
        path: [],
        walkResolve: null,
        walkPhase: Math.random() * Math.PI * 2,
      };
      agents.set(def.id, agent);

      loadModel(def.model)
        .then(({ scene: modelScene, clips }) => {
          if (disposed) return;
          const model = skeletonClone(modelScene) as THREE.Group;
          model.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              const mesh = o as THREE.Mesh;
              // Clone material cho từng nhân viên để nhuộm màu riêng không dính nhau
              if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map((m) => m.clone());
              } else {
                mesh.material = mesh.material.clone();
              }
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              mats.forEach((m) => {
                const sm = m as THREE.MeshStandardMaterial;
                if (sm && "color" in sm) sm.color.lerp(new THREE.Color(def.tint), 0.22);
              });
            }
          });
          group.add(model);
          agent.mixer = new THREE.AnimationMixer(model);
          agent.idleAction = pickAction(agent.mixer, clips, ["idle"]);
          agent.walkAction =
            pickAction(agent.mixer, clips, ["walk", "walking"]) ?? agent.idleAction;
          agent.bones = {
            hips: findBone(model, "Hips"),
            leftUpLeg: findBone(model, "LeftUpLeg"),
            rightUpLeg: findBone(model, "RightUpLeg"),
            leftLeg: findBone(model, "LeftLeg"),
            rightLeg: findBone(model, "RightLeg"),
          };
          group.add(label.sprite);
          group.add(ring);
          // Vùng bấm chọn nhân viên
          const hit = new THREE.Mesh(
            new THREE.CylinderGeometry(0.55, 0.55, 2, 8),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          );
          hit.position.y = 1;
          hit.userData.empId = def.id;
          hit.name = `hit-${def.id}`;
          group.add(hit);
          scene.add(group);
          sit(agent);
          maybeAutoDemo();
        })
        .catch(() => {
          if (disposed) return;
          onLog(`Không tải được model 3D cho ${def.name} (kiểm tra mạng) — dùng nhân vật dự phòng.`);
          const fb = buildFallback(def);
          group.add(fb.group);
          agent.fallbackParts = fb.parts;
          group.add(label.sprite);
          group.add(ring);
          const hit = new THREE.Mesh(
            new THREE.CylinderGeometry(0.55, 0.55, 2, 8),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          );
          hit.position.y = 1;
          hit.userData.empId = def.id;
          hit.name = `hit-${def.id}`;
          group.add(hit);
          scene.add(group);
          sit(agent);
          maybeAutoDemo();
        });
    }

    // --- Bấm chọn nhân viên trong scene ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = 0;
    const onDown = () => {
      downAt = performance.now();
    };
    const onUp = (ev: PointerEvent) => {
      if (performance.now() - downAt > 250) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        [...agents.values()].map((a) => a.group),
        true,
      );
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.empId) o = o.parent;
        if (o?.userData.empId) {
          onSelect(o.userData.empId as string);
          break;
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // --- Kích thước + vòng lặp ---
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const clock = new THREE.Clock();
    let raf = 0;
    const SPEED = 1.6;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      for (const a of agents.values()) {
        a.mixer?.update(dt);
        if (a.seated) {
          applySitPose(a);
        } else if (a.path.length) {
          const target = a.path[0];
          const dx = target.x - a.group.position.x;
          const dz = target.z - a.group.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.08) {
            a.path.shift();
            if (!a.path.length && a.walkResolve) {
              const r = a.walkResolve;
              a.walkResolve = null;
              r();
            }
          } else {
            const step = Math.min(dist, SPEED * dt);
            a.group.position.x += (dx / dist) * step;
            a.group.position.z += (dz / dist) * step;
            const targetRot = Math.atan2(dx, dz);
            let diff = targetRot - a.group.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            a.group.rotation.y += diff * Math.min(1, dt * 10);
            playAction(a, a.walkAction);
            if (a.fallbackParts) {
              const s = Math.sin(t * 9 + a.walkPhase) * 0.55;
              a.fallbackParts.legL.rotation.x = s;
              a.fallbackParts.legR.rotation.x = -s;
              a.fallbackParts.armL.rotation.x = -s * 0.8;
              a.fallbackParts.armR.rotation.x = s * 0.8;
            }
          }
        } else if (a.fallbackParts) {
          a.fallbackParts.legL.rotation.x = 0;
          a.fallbackParts.legR.rotation.x = 0;
        }
      }
      if (camGoal) {
        camera.position.lerp(camGoal.pos, 0.05);
        controls.target.lerp(camGoal.tgt, 0.05);
        if (camera.position.distanceTo(camGoal.pos) < 0.15) camGoal = null;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="h-full w-full" />;
});

export default Office3D;
