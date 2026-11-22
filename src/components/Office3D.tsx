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
  bubble: { sprite: THREE.Sprite; redraw: (s: EmpStatus) => void };
  ring: THREE.Mesh;
  bones: {
    hips?: THREE.Object3D;
    leftUpLeg?: THREE.Object3D;
    rightUpLeg?: THREE.Object3D;
    leftLeg?: THREE.Object3D;
    rightLeg?: THREE.Object3D;
    leftArm?: THREE.Object3D;
    rightArm?: THREE.Object3D;
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

const WALL_H = 1.45;

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
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.roundRect(6, 14, 500, 100, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(15,23,42,0.14)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(44, 64, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 74, 52);
    ctx.fillStyle = STATUS_COLOR[s];
    ctx.beginPath();
    ctx.arc(82, 94, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#475569";
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText(STATUS_LABEL[s], 100, 95);
    tex.needsUpdate = true;
  };
  redraw("idle");
  return { sprite, redraw };
}

const BUBBLE_TEXT: Record<EmpStatus, [string, string] | null> = {
  idle: null,
  walking: ["ĐANG DI CHUYỂN", "Đang đi tới nơi làm việc…"],
  meeting: ["ĐANG HỌP", "Trao đổi với AI Quản Lý…"],
  working: ["ĐANG LÀM VIỆC", "Đang xử lý nhiệm vụ…"],
  done: ["VỪA XONG", "Hoàn thành một việc!"],
};
const BUBBLE_COLOR: Record<EmpStatus, string> = {
  idle: "#64748b",
  walking: "#d97706",
  meeting: "#ea580c",
  working: "#0284c7",
  done: "#16a34a",
};

/** Bong bóng thoại trạng thái trên đầu nhân viên, kiểu video tham chiếu P&N. */
function makeBubble(): { sprite: THREE.Sprite; redraw: (s: EmpStatus) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.5, 0.78, 1);
  sprite.visible = false;

  const redraw = (s: EmpStatus) => {
    const info = BUBBLE_TEXT[s];
    sprite.visible = Boolean(info);
    if (!info) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(255,255,255,0.97)";
    ctx.beginPath();
    ctx.roundRect(10, 8, 492, 118, 24);
    ctx.fill();
    ctx.strokeStyle = "rgba(15,23,42,0.12)";
    ctx.lineWidth = 3;
    ctx.stroke();
    // Đuôi bong bóng
    ctx.fillStyle = "rgba(255,255,255,0.97)";
    ctx.beginPath();
    ctx.moveTo(236, 124);
    ctx.lineTo(276, 124);
    ctx.lineTo(256, 152);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = BUBBLE_COLOR[s];
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("● " + info[0], 34, 48);
    ctx.fillStyle = "#334155";
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText(info[1], 34, 92);
    tex.needsUpdate = true;
  };
  return { sprite, redraw };
}

function makeSign(text: string, color: string, w = 4.4): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 1024, 160);
  // Chip thẻ phòng: nền xanh đậm, chấm màu phòng, chữ trắng — kiểu video P&N
  ctx.fillStyle = "rgba(7,46,38,0.95)";
  ctx.beginPath();
  ctx.roundRect(162, 26, 700, 108, 54);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(232, 80, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 62px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text.toUpperCase(), 545, 82);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.156), mat);
  return mesh;
}

/** Texture sàn gỗ sáng cho toàn văn phòng. */
function makeWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const shades = ["#e3cda3", "#dec49b", "#e8d2ab", "#dcc198"];
  for (let r = 0; r < 4; r++) {
    ctx.fillStyle = shades[r];
    ctx.fillRect(0, r * 64, 256, 64);
    ctx.fillStyle = "rgba(150,118,74,0.55)";
    ctx.fillRect(0, r * 64, 256, 3);
    ctx.fillRect(((r * 97) % 200) + 20, r * 64, 3, 64);
    ctx.strokeStyle = "rgba(160,128,80,0.18)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, r * 64 + 14 + i * 18);
      ctx.bezierCurveTo(80, r * 64 + 10 + i * 18, 170, r * 64 + 20 + i * 18, 256, r * 64 + 14 + i * 18);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Texture màn hình code tối cho phòng kỹ thuật / màn hình lớn. */
function makeCodeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0c1424";
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = "#131f33";
  ctx.fillRect(0, 0, 512, 30);
  for (const [i, col] of ["#f87171", "#facc15", "#4ade80"].entries()) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(22 + i * 24, 15, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const cols = ["#7dd3fc", "#f0abfc", "#86efac", "#facc15", "#94a3b8", "#fda4af"];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < 11; row++) {
    const y = 52 + row * 24;
    let x = 22 + (row % 4) * 22;
    const segs = 2 + Math.floor(rnd() * 3);
    for (let sIdx = 0; sIdx < segs; sIdx++) {
      const wSeg = 26 + rnd() * 74;
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(x, y, wSeg, 9, 4);
      ctx.fill();
      x += wSeg + 14;
      if (x > 470) break;
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Texture bảng kanban sáng cho màn hình phòng họp / thiết kế. */
function makeKanbanTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f7fa";
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = "#0f2c3f";
  ctx.fillRect(0, 0, 512, 34);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 17px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("BẢNG VIỆC  ·  KANBAN", 16, 18);
  const colCols = ["#38bdf8", "#f59e0b", "#22c55e"];
  const cardCols = ["#bae6fd", "#fde68a", "#bbf7d0", "#fecdd3", "#ddd6fe"];
  for (let cIdx = 0; cIdx < 3; cIdx++) {
    const x = 14 + cIdx * 166;
    ctx.fillStyle = "#e6edf3";
    ctx.beginPath();
    ctx.roundRect(x, 48, 152, 258, 10);
    ctx.fill();
    ctx.fillStyle = colCols[cIdx];
    ctx.beginPath();
    ctx.roundRect(x + 10, 58, 60, 10, 5);
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const y = 82 + k * 72;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(x + 10, y, 132, 60, 8);
      ctx.fill();
      ctx.fillStyle = cardCols[(cIdx + k) % cardCols.length];
      ctx.beginPath();
      ctx.roundRect(x + 20, y + 10, 34, 9, 4);
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.roundRect(x + 20, y + 28, 112, 7, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(x + 20, y + 42, 84, 7, 3);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Texture mặt tủ server với đèn LED li ti. */
function makeServerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#141a24";
  ctx.fillRect(0, 0, 128, 256);
  for (let u = 0; u < 8; u++) {
    const y = 8 + u * 30;
    ctx.fillStyle = "#1d2635";
    ctx.fillRect(8, y, 112, 24);
    ctx.fillStyle = "#0a0e14";
    for (let vIdx = 0; vIdx < 5; vIdx++) ctx.fillRect(16, y + 5 + vIdx * 4, 52, 2);
    ctx.fillStyle = u % 3 === 0 ? "#f59e0b" : "#4ade80";
    ctx.beginPath();
    ctx.arc(104, y + 8, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(104, y + 17, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Texture màn hình giả lập dashboard/biểu đồ, nhuộm theo màu phòng ban. */
function makeScreenTexture(color: string, big = false): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = big ? 512 : 256;
  canvas.height = big ? 256 : 160;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = "#0a1120";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, big ? 26 : 16);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(10, big ? 9 : 5, W * 0.3, big ? 8 : 5);
  // Đồ thị đường
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const baseY = H * 0.6;
  for (let x = 10; x < W * 0.55; x += 12) {
    const y = baseY - Math.abs(Math.sin(x * 0.045)) * H * 0.26 - (x / W) * 14;
    if (x === 10) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Biểu đồ cột
  for (let i = 0; i < 5; i++) {
    const bh = (0.25 + ((i * 37) % 10) / 16) * H * 0.3;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(W * 0.63 + i * W * 0.068, H * 0.86 - bh, W * 0.042, bh);
  }
  ctx.globalAlpha = 1;
  // Dòng dữ liệu giả
  ctx.fillStyle = "rgba(148,197,255,0.8)";
  for (let r = 0; r < 4; r++) {
    ctx.fillRect(12, H * 0.72 + r * H * 0.07, W * (0.3 - r * 0.045), 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function screenMesh(w: number, h: number, color: string, big = false): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: makeScreenTexture(color, big) }),
  );
}

/** Băng tên công ty ở sảnh: nền xanh đậm, tên vàng, khẩu hiệu trắng. */
function makeBrandSign(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#14232f";
  ctx.beginPath();
  ctx.roundRect(4, 4, 1016, 248, 18);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f5c542";
  ctx.font = "bold 104px system-ui, sans-serif";
  ctx.fillText("GEN.G_VN", 48, 96);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "42px system-ui, sans-serif";
  ctx.fillText("AI COMPANY  ·  BUILD. LEARN. EVOLVE.", 50, 190);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
}

/** Một cụm màn hình hoàn chỉnh: khung + mặt dashboard + chân đế. Mặt hiển thị quay về +z. */
function monitorUnit(w: number, color: string): THREE.Group {
  const grp = new THREE.Group();
  const h = w * 0.58;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.05),
    new THREE.MeshStandardMaterial({ color: "#05070d", roughness: 0.3, metalness: 0.4 }),
  );
  frame.castShadow = true;
  grp.add(frame);
  const scr = screenMesh(w - 0.1, h - 0.1, color);
  scr.position.z = 0.035;
  grp.add(scr);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.34, 0.08),
    new THREE.MeshStandardMaterial({ color: "#0b1220", roughness: 0.4, metalness: 0.5 }),
  );
  stand.position.set(0, -h / 2 - 0.15, -0.02);
  grp.add(stand);
  return grp;
}

function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
  opts?: { rough?: number; metal?: number; basic?: boolean },
): THREE.Mesh {
  const mat = opts?.basic
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, roughness: opts?.rough ?? 0.6, metalness: opts?.metal ?? 0.1 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildOffice(scene: THREE.Scene) {
  const g = new THREE.Group();
  // Tường trắng thấp; mặt giáp hành lang có ô kính phía trên (phong cách P&N: sáng, thoáng)
  const wallMatW = new THREE.MeshStandardMaterial({ color: "#f7f9fa", roughness: 0.95 });
  const railMat = new THREE.MeshStandardMaterial({ color: "#d9e1e8", roughness: 0.6, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: "#cfe8f5",
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wall = (cx: number, cz: number, len: number, axis: "x" | "z", glassTop = false) => {
    const geo =
      axis === "x" ? new THREE.BoxGeometry(len, WALL_H, 0.14) : new THREE.BoxGeometry(0.14, WALL_H, len);
    const m = new THREE.Mesh(geo, wallMatW);
    m.position.set(cx, WALL_H / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    if (glassTop) {
      const pane = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(len, 1.0, 0.05) : new THREE.BoxGeometry(0.05, 1.0, len),
        glassMat,
      );
      pane.position.set(cx, WALL_H + 0.52, cz);
      g.add(pane);
      const rail = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(len, 0.07, 0.18) : new THREE.BoxGeometry(0.18, 0.07, len),
        railMat,
      );
      rail.position.set(cx, WALL_H + 1.05, cz);
      g.add(rail);
    } else {
      const rail = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(len, 0.06, 0.18) : new THREE.BoxGeometry(0.18, 0.06, len),
        railMat,
      );
      rail.position.set(cx, WALL_H + 0.03, cz);
      g.add(rail);
    }
  };

  // Sàn gỗ sáng toàn văn phòng + đế diorama xám nhạt (phong cách P&N)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(41.5, 0.18, 25.5),
    new THREE.MeshStandardMaterial({ color: "#bcc2c9", roughness: 0.9 }),
  );
  slab.position.y = -0.1;
  g.add(slab);

  for (const room of ROOMS) {
    const [x0, x1, z0, z1] = room.bounds;
    // Thảm theo khu: làm việc xanh ngọc, họp xám chì, nghỉ xám xanh, sảnh trung tính
    const carpetColor =
      room.kind === "office" ? "#a9cabd" : room.kind === "meeting" ? "#93a7b4" : room.kind === "lounge" ? "#b9cdd6" : "#cfd8dc";
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 - 0.5, z1 - z0 - 0.5),
      new THREE.MeshStandardMaterial({ color: carpetColor, roughness: 1 }),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    carpet.receiveShadow = true;
    g.add(carpet);
    const sign = makeSign(room.name, room.color, 4.6);
    sign.position.set((x0 + x1) / 2, 2.1, (z0 + z1) / 2);
    g.add(sign);
  }

  // Hành lang lát sáng
  const corridor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 3),
    new THREE.MeshStandardMaterial({ color: "#eef1f3", roughness: 0.95 }),
  );
  corridor.rotation.x = -Math.PI / 2;
  corridor.position.set(0, 0.014, -2.5);
  corridor.receiveShadow = true;
  g.add(corridor);

  // Bồn cây trắng chạy dọc dải sàn trước
  for (const bx of [-14, 0, 14]) {
    g.add(box(2.6, 0.4, 0.7, "#eef2f4", bx, 0.2, 11.2, { rough: 0.8 }));
    g.add(box(2.4, 0.22, 0.55, "#4d9e57", bx, 0.48, 11.2, { rough: 1 }));
  }

  // Tường ngoài
  wall(0, -12, 40, "x");
  wall(0, 12, 40, "x");
  wall(-20, 0, 24, "z");
  wall(20, 0, 24, "z");
  // Tường ngăn hàng sau / hàng trước (đặc)
  wall(0, 8, 40, "x");
  for (const x of [-12, -4, 4, 12]) wall(x, -8, 8, "z");
  for (const x of [-4, 4, 12]) wall(x, 3.5, 9, "z");
  // Tường phía cửa của từng phòng: chừa ô cửa 1.8m, phía trên là kính
  for (const room of ROOMS) {
    const [x0, x1, z0, z1] = room.bounds;
    const zWall = room.doorSide === "back" ? z1 : z0;
    const a = Math.max(x0, room.doorX - 0.9);
    const b = Math.min(x1, room.doorX + 0.9);
    if (a > x0) wall((x0 + a) / 2, zWall, a - x0, "x", true);
    if (b < x1) wall((b + x1) / 2, zWall, x1 - b, "x", true);
  }

  const chairPosOf = new Map<string, { x: number; z: number; facing: number }>();

  for (const room of ROOMS) {
    const [x0, x1, z0, z1] = room.bounds;
    const c = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
    const emp = EMPLOYEES.find((e) => e.roomId === room.id);
    const chairZ = room.doorSide === "back" ? z0 + 2.6 : z1 - 2.6;

    if (room.kind === "office" && emp) {
      const facing = room.doorSide === "back" ? 0 : Math.PI;
      const deskZ = room.doorSide === "back" ? chairZ + 0.8 : chairZ - 0.8;
      const back = room.doorSide === "back";
      const rowB = deskZ + (back ? 2.05 : -2.05);
      const chairRowB = rowB + (back ? 0.8 : -0.8);
      const pastels = ["#f6a8c1", "#93c5fd", "#7fd6a4", "#fcd34d", "#c4b5fd"];
      const aRot = back ? Math.PI : 0;
      const bRot = back ? 0 : Math.PI;
      // Một bàn trong cụm: mặt gỗ sáng, chân đen, màn hình, cốc trắng, giấy, ghế pastel
      const deskAt = (dx: number, dz: number, monRot: number, monOff: number, chairZPos: number | null, ci: number) => {
        const wx = c.x + dx;
        g.add(box(1.7, 0.07, 0.8, "#dfae74", wx, 0.74, dz, { rough: 0.65 }));
        g.add(box(0.07, 0.72, 0.7, "#2b2f36", wx - 0.78, 0.37, dz, { rough: 0.5 }));
        g.add(box(0.07, 0.72, 0.7, "#2b2f36", wx + 0.78, 0.37, dz, { rough: 0.5 }));
        const mon = monitorUnit(0.95, room.color);
        mon.position.set(wx, 1.18, dz + monOff);
        mon.rotation.y = monRot;
        g.add(mon);
        const mugW = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.035, 0.09, 10),
          new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }),
        );
        mugW.position.set(wx - 0.62, 0.82, dz + 0.15);
        g.add(mugW);
        g.add(box(0.26, 0.012, 0.36, "#ffffff", wx + 0.58, 0.78, dz + 0.1, { rough: 0.9 }));
        if (chairZPos !== null) {
          const col = pastels[ci % pastels.length];
          g.add(box(0.55, 0.07, 0.52, col, wx, 0.47, chairZPos, { rough: 0.7 }));
          const bz = chairZPos + (chairZPos > dz ? 0.27 : -0.27);
          g.add(box(0.55, 0.6, 0.07, col, wx, 0.82, bz, { rough: 0.7 }));
        }
      };
      deskAt(-1.95, deskZ, aRot, back ? 0.12 : -0.12, chairZ, 0);
      deskAt(1.95, deskZ, aRot, back ? 0.12 : -0.12, chairZ, 1);
      deskAt(-1.95, rowB, bRot, back ? -0.12 : 0.12, chairRowB, 2);
      deskAt(1.95, rowB, bRot, back ? -0.12 : 0.12, chairRowB, 3);
      deskAt(0, deskZ, aRot, back ? 0.12 : -0.12, null, 4);
      // Vòng sáng xanh ngọc dưới cụm bàn (điểm nhấn kiểu P&N)
      const ringMesh = new THREE.Mesh(
        new THREE.RingGeometry(2.75, 2.95, 48),
        new THREE.MeshBasicMaterial({ color: "#2dd4bf", transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.scale.set(1.18, 0.82, 1);
      ringMesh.position.set(c.x, 0.045, (deskZ + rowB) / 2);
      g.add(ringMesh);
      // Ghế của nhân viên: pastel, đồng bộ cụm bàn
      const empPastel = pastels[(room.id.length + 2) % pastels.length];
      g.add(box(0.55, 0.07, 0.52, empPastel, c.x, 0.47, chairZ, { rough: 0.7 }));
      const backZ = chairZ + (back ? -0.28 : 0.28);
      g.add(box(0.55, 0.6, 0.07, empPastel, c.x, 0.82, backZ, { rough: 0.7 }));
      chairPosOf.set(room.id, { x: c.x, z: chairZ, facing });
      // Kệ sách dọc tường bên trái phòng
      const shelfX = room.bounds[0] + 0.32;
      g.add(box(0.34, 1.9, 2.3, "#e9e2d4", shelfX, 0.95, c.z, { rough: 0.8 }));
      const bookCols = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626", "#64748b"];
      for (let sIdx = 0; sIdx < 3; sIdx++) {
        const sy = 0.45 + sIdx * 0.58;
        g.add(box(0.3, 0.04, 2.2, "#d8cfba", shelfX, sy - 0.06, c.z));
        for (let bIdx = 0; bIdx < 7; bIdx++) {
          const bh = 0.3 + ((bIdx * 13 + sIdx * 7 + room.id.length) % 10) / 40;
          g.add(
            box(0.2, bh, 0.13, bookCols[(bIdx + sIdx + room.id.length) % bookCols.length], shelfX + 0.03, sy + bh / 2, c.z - 0.95 + bIdx * 0.3, { rough: 0.9 }),
          );
        }
      }
      // Màn hình lớn trên tường sau: code tối / kanban sáng / biểu đồ tùy phòng
      const wallScr =
        room.id === "congnghe" || room.id === "nghiencuu"
          ? new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.5), new THREE.MeshBasicMaterial({ map: makeCodeTexture() }))
          : room.id === "thietke" || room.id === "tiepthi"
            ? new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.5), new THREE.MeshBasicMaterial({ map: makeKanbanTexture() }))
            : screenMesh(2.9, 1.5, room.color, true);
      if (back) {
        wallScr.position.set(c.x, 1.78, room.bounds[2] + 0.18);
      } else {
        wallScr.position.set(c.x, 1.78, room.bounds[3] - 0.18);
        wallScr.rotation.y = Math.PI;
      }
      g.add(wallScr);
      // Tủ server ở 2 góc tường sau cho phòng kỹ thuật / nghiên cứu
      if (room.id === "congnghe" || room.id === "nghiencuu") {
        const rackTex = makeServerTexture();
        for (const s of [-1, 1]) {
          const rx = c.x + s * 3.1;
          const rz = back ? room.bounds[2] + 0.55 : room.bounds[3] - 0.55;
          g.add(box(0.85, 1.95, 0.65, "#141a24", rx, 0.98, rz, { rough: 0.4, metal: 0.4 }));
          const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.8), new THREE.MeshBasicMaterial({ map: rackTex }));
          face.position.set(rx, 0.98, rz + (back ? 0.34 : -0.34));
          if (!back) face.rotation.y = Math.PI;
          g.add(face);
        }
      }
    } else if (room.kind === "meeting") {
      g.add(box(4.6, 0.09, 1.9, "#dfae74", c.x, 0.74, c.z - 0.5, { rough: 0.6 }));
      g.add(box(4.0, 0.03, 1.3, "#44586a", c.x, 0.8, c.z - 0.5, { rough: 0.5 }));
      for (const dx of [-1.6, 0, 1.6]) {
        g.add(box(0.12, 0.72, 0.12, "#2b2f36", c.x + dx, 0.36, c.z - 0.5, { rough: 0.5 }));
      }
      for (const dx of [-1.6, 0, 1.6]) {
        g.add(box(0.55, 0.06, 0.55, "#b6c2cc", c.x + dx, 0.46, c.z - 1.85, { rough: 0.7 }));
        g.add(box(0.55, 0.55, 0.06, "#b6c2cc", c.x + dx, 0.8, c.z - 2.12, { rough: 0.7 }));
        g.add(box(0.55, 0.06, 0.55, "#b6c2cc", c.x + dx, 0.46, c.z + 0.85, { rough: 0.7 }));
        g.add(box(0.55, 0.55, 0.06, "#b6c2cc", c.x + dx, 0.8, c.z + 1.12, { rough: 0.7 }));
      }
      g.add(box(3.6, 1.9, 0.08, "#1c2733", c.x, 1.6, room.bounds[2] + 0.14, { rough: 0.4 }));
      const bigScr = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 1.7),
        new THREE.MeshBasicMaterial({ map: makeKanbanTexture() }),
      );
      bigScr.position.set(c.x, 1.6, room.bounds[2] + 0.2);
      g.add(bigScr);
    } else if (room.kind === "lounge") {
      // Khu nghỉ sáng kiểu P&N: sofa xám nhạt + gối hồng, bàn cà phê gỗ, đèn cây, kệ thấp
      for (const dx of [-1.7, 0.6]) {
        g.add(box(2.0, 0.35, 0.85, "#d7dee3", c.x + dx, 0.3, c.z + 1.2, { rough: 0.9 }));
        g.add(box(2.0, 0.55, 0.22, "#d7dee3", c.x + dx, 0.62, c.z + 1.62, { rough: 0.9 }));
        g.add(box(0.55, 0.12, 0.6, "#f2b8c6", c.x + dx - 0.5, 0.52, c.z + 1.25, { rough: 0.9 }));
      }
      g.add(box(1.3, 0.07, 0.65, "#dfae74", c.x - 0.55, 0.42, c.z - 0.15, { rough: 0.65 }));
      g.add(box(0.08, 0.4, 0.08, "#2b2f36", c.x - 1.05, 0.2, c.z - 0.15));
      g.add(box(0.08, 0.4, 0.08, "#2b2f36", c.x - 0.05, 0.2, c.z - 0.15));
      // Đèn cây ánh ấm
      const lampPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8),
        new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.4, metalness: 0.6 }),
      );
      lampPole.position.set(c.x + 2.9, 0.75, c.z + 1.3);
      g.add(lampPole);
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.34, 0.36, 20, 1, true),
        new THREE.MeshStandardMaterial({ color: "#fff7e0", roughness: 0.9, side: THREE.DoubleSide }),
      );
      shade.position.set(c.x + 2.9, 1.6, c.z + 1.3);
      g.add(shade);
      const warm = new THREE.PointLight("#ffd9a0", 10, 6);
      warm.position.set(c.x + 2.9, 1.45, c.z + 1.3);
      g.add(warm);
      // Kệ thấp + sách màu
      g.add(box(2.2, 0.5, 0.4, "#e9e2d4", c.x - 1.2, 0.25, c.z - 2.2, { rough: 0.8 }));
      g.add(box(0.5, 0.3, 0.25, "#f59e0b", c.x - 1.9, 0.65, c.z - 2.2, { rough: 0.9 }));
      g.add(box(0.4, 0.36, 0.25, "#38bdf8", c.x - 1.35, 0.68, c.z - 2.2, { rough: 0.9 }));
    } else if (room.kind === "lobby") {
      // Quầy lễ tân: mặt trắng + thân gỗ nan dọc
      g.add(box(3.2, 0.08, 0.75, "#ffffff", c.x, 0.92, c.z + 1.6, { rough: 0.4 }));
      g.add(box(3.2, 0.85, 0.65, "#caa06a", c.x, 0.45, c.z + 1.6, { rough: 0.8 }));
      for (let i = 0; i < 9; i++) {
        g.add(box(0.05, 0.85, 0.03, "#a97f46", c.x - 1.4 + i * 0.35, 0.45, c.z + 1.95, { rough: 0.8 }));
      }
      // Băng tên công ty ở mặt tiền sảnh, hướng ra ngoài như bảng hiệu P&N
      const brand = makeBrandSign();
      brand.position.set(c.x, 1.75, room.bounds[3] + 0.22);
      g.add(brand);
      // Cầu thang trang trí góc sảnh
      for (let i = 0; i < 5; i++) {
        g.add(box(1.5, 0.16, 0.42, "#e8edf0", room.bounds[0] + 0.85, 0.08 + i * 0.17, c.z - 2.2 + i * 0.42, { rough: 0.7 }));
      }
      // Ghế chờ xám nhạt
      for (const dz of [-0.9, 0.9]) {
        g.add(box(0.55, 0.07, 0.52, "#c3ced6", c.x - 2.4, 0.47, c.z + dz, { rough: 0.8 }));
        g.add(box(0.55, 0.55, 0.07, "#c3ced6", c.x - 2.4, 0.8, c.z + dz - 0.26, { rough: 0.8 }));
      }
    }
    // Chậu cây ở góc phòng
    const px = room.bounds[0] + 0.7;
    const pz = room.doorSide === "back" ? room.bounds[3] - 0.7 : room.bounds[2] + 0.7;
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 0.42, 10),
      new THREE.MeshStandardMaterial({ color: "#f4f7f9", roughness: 0.7 }),
    );
    pot.position.set(px, 0.21, pz);
    g.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: "#3d9e4d", roughness: 1 });
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), leafMat);
    leaf.position.set(px, 0.88, pz);
    leaf.castShadow = true;
    g.add(leaf);
    const leaf2 = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), leafMat);
    leaf2.position.set(px + 0.22, 0.66, pz + 0.14);
    g.add(leaf2);
  }
  scene.add(g);
  const tick = () => {};
  return { chairPosOf, tick };
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
    scene.background = new THREE.Color("#c6cbd1");
    scene.fog = new THREE.Fog("#c6cbd1", 85, 170);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    camera.position.set(25, 23, 25);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -0.5);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight("#ffffff", "#c3cedb", 1.05));
    const sun = new THREE.DirectionalLight("#fff2df", 1.6);
    sun.position.set(14, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    scene.add(sun);
    const { chairPosOf, tick } = buildOffice(scene);

    const agents = new Map<string, Agent>();
    const setStatus = (a: Agent, s: EmpStatus, progress = 0) => {
      a.status = s;
      (a.ring.material as THREE.MeshBasicMaterial).color.set(STATUS_COLOR[s]);
      a.label.redraw(s);
      a.bubble.redraw(s);
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
      if (view === "all") camGoal = { pos: new THREE.Vector3(25, 23, 25), tgt: new THREE.Vector3(0, 0, -0.5) };
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
      const bubble = makeBubble();
      bubble.sprite.position.y = 2.88;
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
        bubble,
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
                if (sm && "color" in sm) sm.color.lerp(new THREE.Color(def.tint), 0.12);
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
            leftArm: findBone(model, "LeftArm"),
            rightArm: findBone(model, "RightArm"),
          };
          group.add(label.sprite);
          group.add(bubble.sprite);
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
          group.add(bubble.sprite);
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
      tick();
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
      // Ăn mừng khi hoàn thành: giơ 2 tay lên (kiểu video tham chiếu)
      for (const a of agents.values()) {
        if (a.bones.leftArm && a.bones.rightArm) {
          const up = a.status === "done";
          a.bones.leftArm.rotation.z = up ? 2.35 : 0;
          a.bones.rightArm.rotation.z = up ? -2.35 : 0;
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
