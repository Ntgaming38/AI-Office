// Dữ liệu mặt bằng văn phòng AI Office — dùng chung cho scene 3D và panel điều khiển.
// Tọa độ tính bằng mét, gốc ở tâm sàn. Sàn 40 x 24 (x: -20..20, z: -12..12).

export type EmpStatus = "idle" | "working" | "walking" | "meeting" | "done";

export interface RoomDef {
  id: string;
  name: string;
  /** [x0, x1, z0, z1] */
  bounds: [number, number, number, number];
  color: string;
  /** Vị trí cửa trên tường giáp hành lang */
  doorX: number;
  doorSide: "back" | "front";
  kind: "office" | "meeting" | "lounge" | "lobby";
}

export interface EmployeeDef {
  id: string;
  name: string;
  role: string;
  roomId: string;
  model: "xbot" | "michelle" | "soldier";
  tint: string;
}

// Model GLB: bộ mẫu Mixamo của three.js examples, nạp từ GitHub raw khi mở trang.
// Muốn chạy offline: tải 3 file Xbot.glb / Michelle.glb / Soldier.glb từ
// https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf
// bỏ vào public/models/ rồi đổi 3 URL dưới thành "/models/xbot.glb" v.v.
const GLB_BASE = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf";
export const MODEL_URLS: Record<EmployeeDef["model"], string> = {
  xbot: `${GLB_BASE}/Xbot.glb`,
  michelle: `${GLB_BASE}/Michelle.glb`,
  soldier: `${GLB_BASE}/Soldier.glb`,
};

export const ROOMS: RoomDef[] = [
  // Hàng sau (z: -12..-4), cửa mở về hành lang ở z = -4
  { id: "quanly", name: "Phòng Quản Lý", bounds: [-20, -12, -12, -4], color: "#8b5cf6", doorX: -16, doorSide: "back", kind: "office" },
  { id: "congnghe", name: "Phòng Công Nghệ", bounds: [-12, -4, -12, -4], color: "#3b82f6", doorX: -8, doorSide: "back", kind: "office" },
  { id: "thietke", name: "Phòng Thiết Kế", bounds: [-4, 4, -12, -4], color: "#ec4899", doorX: 0, doorSide: "back", kind: "office" },
  { id: "nghiencuu", name: "Phòng Nghiên Cứu", bounds: [4, 12, -12, -4], color: "#10b981", doorX: 8, doorSide: "back", kind: "office" },
  { id: "phonghop", name: "Phòng Họp", bounds: [12, 20, -12, -4], color: "#f59e0b", doorX: 16, doorSide: "back", kind: "meeting" },
  // Hàng trước (z: -1..8), cửa mở về hành lang ở z = -1
  { id: "tiepthi", name: "Phòng Tiếp Thị", bounds: [-20, -12, -1, 8], color: "#f97316", doorX: -16, doorSide: "front", kind: "office" },
  { id: "kinhdoanh", name: "Phòng Kinh Doanh", bounds: [-12, -4, -1, 8], color: "#ef4444", doorX: -8, doorSide: "front", kind: "office" },
  { id: "phantich", name: "Phòng Phân Tích", bounds: [-4, 4, -1, 8], color: "#06b6d4", doorX: 0, doorSide: "front", kind: "office" },
  { id: "khanghi", name: "Khu Nghỉ", bounds: [4, 12, -1, 8], color: "#84cc16", doorX: 8, doorSide: "front", kind: "lounge" },
  { id: "sanh", name: "Sảnh Gen.G_VN", bounds: [12, 20, -1, 8], color: "#a78bfa", doorX: 16, doorSide: "front", kind: "lobby" },
];

export const EMPLOYEES: EmployeeDef[] = [
  { id: "manager", name: "AI Quản Lý", role: "Quản lý văn phòng", roomId: "quanly", model: "soldier", tint: "#8b5cf6" },
  { id: "dev", name: "AI Lập Trình", role: "Lập trình viên", roomId: "congnghe", model: "xbot", tint: "#3b82f6" },
  { id: "designer", name: "AI Thiết Kế", role: "Nhà thiết kế", roomId: "thietke", model: "michelle", tint: "#ec4899" },
  { id: "researcher", name: "AI Nghiên Cứu", role: "Chuyên viên nghiên cứu", roomId: "nghiencuu", model: "michelle", tint: "#10b981" },
  { id: "marketing", name: "AI Tiếp Thị", role: "Chuyên viên tiếp thị", roomId: "tiepthi", model: "xbot", tint: "#f97316" },
  { id: "analyst", name: "AI Phân Tích", role: "Chuyên viên phân tích dữ liệu", roomId: "phantich", model: "soldier", tint: "#06b6d4" },
  { id: "business", name: "AI Kinh Doanh", role: "Chuyên viên kinh doanh", roomId: "kinhdoanh", model: "xbot", tint: "#ef4444" },
];

export const STATUS_LABEL: Record<EmpStatus, string> = {
  idle: "Sẵn sàng",
  working: "Đang làm việc",
  walking: "Đang di chuyển",
  meeting: "Đang họp",
  done: "Hoàn thành",
};

export const STATUS_COLOR: Record<EmpStatus, string> = {
  idle: "#94a3b8",
  working: "#38bdf8",
  walking: "#facc15",
  meeting: "#fb923c",
  done: "#4ade80",
};

// ---------- Đồ thị điểm đường đi (waypoint graph) ----------

export interface WPNode {
  id: string;
  x: number;
  z: number;
  edges: string[];
}

function buildGraph(): Map<string, WPNode> {
  const nodes = new Map<string, WPNode>();
  const add = (id: string, x: number, z: number) => nodes.set(id, { id, x, z, edges: [] });
  const link = (a: string, b: string) => {
    nodes.get(a)?.edges.push(b);
    nodes.get(b)?.edges.push(a);
  };

  // Hành lang giữa: z = -2.5, các nút thẳng hàng với cửa các phòng
  const corridorX = [-16, -8, 0, 8, 16];
  corridorX.forEach((x, i) => add(`c${i}`, x, -2.5));
  for (let i = 0; i < corridorX.length - 1; i++) link(`c${i}`, `c${i + 1}`);

  for (const room of ROOMS) {
    const [x0, x1, z0, z1] = room.bounds;
    const cx = (x0 + x1) / 2;
    const doorZ = room.doorSide === "back" ? z1 + 0.7 : z0 - 0.7;
    add(`door-${room.id}`, room.doorX, doorZ);
    // Nối cửa vào nút hành lang gần nhất theo trục x
    let nearest = "c0";
    let best = Infinity;
    corridorX.forEach((x, i) => {
      const d = Math.abs(x - room.doorX);
      if (d < best) {
        best = d;
        nearest = `c${i}`;
      }
    });
    link(`door-${room.id}`, nearest);
    // Điểm đứng tại bàn làm việc / trong phòng
    const deskZ = room.doorSide === "back" ? z0 + 2.6 : z1 - 2.6;
    add(`desk-${room.id}`, cx, deskZ);
    link(`desk-${room.id}`, `door-${room.id}`);
  }

  // Hai vị trí đứng họp trong phòng họp
  add("meet-a", 14.3, -8);
  add("meet-b", 17.7, -8);
  link("meet-a", "door-phonghop");
  link("meet-b", "door-phonghop");
  return nodes;
}

export const GRAPH = buildGraph();

/** Tìm đường ngắn nhất giữa 2 nút bằng BFS. Trả về danh sách tọa độ (bỏ nút đầu). */
export function findPath(fromId: string, toId: string): { x: number; z: number }[] {
  if (fromId === toId) return [];
  const prev = new Map<string, string | null>([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toId) break;
    for (const next of GRAPH.get(cur)?.edges ?? []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!prev.has(toId)) return [];
  const ids: string[] = [];
  let cur: string | null = toId;
  while (cur && cur !== fromId) {
    ids.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return ids
    .map((id) => GRAPH.get(id))
    .filter((n): n is WPNode => Boolean(n))
    .map((n) => ({ x: n.x, z: n.z }));
}

export function roomCenter(room: RoomDef): { x: number; z: number } {
  const [x0, x1, z0, z1] = room.bounds;
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
}
