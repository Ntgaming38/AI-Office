"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import {
  EMPLOYEES,
  STATUS_COLOR,
  STATUS_LABEL,
  type EmpStatus,
} from "@/lib/office-data";
import type { OfficeHandle } from "./Office3D";

const Office3D = dynamic(() => import("./Office3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-slate-400">
      Đang dựng văn phòng 3D…
    </div>
  ),
});

interface EmpState {
  status: EmpStatus;
  progress: number;
}

interface LogLine {
  time: string;
  text: string;
}

const SAMPLE_TASKS = [
  "Xây dựng tính năng đăng nhập",
  "Thiết kế banner ra mắt sản phẩm",
  "Nghiên cứu đối thủ cạnh tranh",
  "Lên kế hoạch chiến dịch tháng 12",
  "Phân tích doanh số tuần này",
  "Soạn báo giá cho khách hàng mới",
];

export default function OfficeApp() {
  const officeRef = useRef<OfficeHandle>(null);
  const [states, setStates] = useState<Record<string, EmpState>>(() =>
    Object.fromEntries(EMPLOYEES.map((e) => [e.id, { status: "idle" as EmpStatus, progress: 0 }])),
  );
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [selected, setSelected] = useState<string>("dev");
  const [taskTitle, setTaskTitle] = useState<string>(SAMPLE_TASKS[0]);
  const [target, setTarget] = useState<string>("dev");

  const onStatus = useCallback((empId: string, status: EmpStatus, progress: number) => {
    setStates((prev) => {
      const cur = prev[empId];
      if (cur && cur.status === status && cur.progress === progress) return prev;
      return { ...prev, [empId]: { status, progress } };
    });
  }, []);

  const onLog = useCallback((text: string) => {
    setLogs((prev) =>
      [{ time: new Date().toLocaleTimeString("vi-VN"), text }, ...prev].slice(0, 40),
    );
  }, []);

  const onSelect = useCallback((empId: string) => {
    setSelected(empId);
    setTarget(empId);
  }, []);

  const assign = (empId: string, title: string) => {
    officeRef.current?.assignTask(empId, title.trim() || "Nhiệm vụ mới");
  };

  const busyCount = EMPLOYEES.filter((e) => states[e.id]?.status === "working").length;
  const doneCount = EMPLOYEES.filter((e) => states[e.id]?.status === "done").length;

  return (
    <div className="flex h-dvh flex-col bg-[#070b14] text-slate-100 lg:flex-row">
      {/* Khu vực 3D */}
      <div className="relative min-h-[52dvh] flex-1 lg:min-h-0">
        <Office3D ref={officeRef} onStatus={onStatus} onLog={onLog} onSelect={onSelect} />
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-black/45 px-3 py-2 backdrop-blur-sm">
          <div className="text-sm font-bold tracking-wide text-cyan-300">
            GEN.G_VN — AI OFFICE
          </div>
          <div className="text-[11px] text-slate-300">
            Demo 3D: kéo để xoay • cuộn để zoom • bấm vào nhân viên để chọn
          </div>
        </div>
        <div className="absolute bottom-3 left-3 flex gap-2">
          {(
            [
              ["all", "Toàn cảnh"],
              ["meeting", "Phòng họp"],
              ["quanly", "Phòng Quản Lý"],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              onClick={() => officeRef.current?.focusView(view)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Panel điều khiển */}
      <aside className="flex w-full flex-1 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-[#0b1120] p-3 lg:w-[350px] lg:flex-none lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold">Bảng điều khiển</h1>
          <span className="text-[11px] text-slate-400">
            {busyCount} đang làm • {doneCount} hoàn thành
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <label className="mb-1 block text-xs font-semibold text-slate-300">
            Giao nhiệm vụ mới
          </label>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm outline-none focus:border-cyan-400"
            placeholder="Tên nhiệm vụ…"
          />
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SAMPLE_TASKS.slice(0, 3).map((t) => (
              <button
                key={t}
                onClick={() => setTaskTitle(t)}
                className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-white/20"
              >
                {t}
              </button>
            ))}
          </div>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm outline-none focus:border-cyan-400"
          >
            {EMPLOYEES.filter((e) => e.id !== "manager").map((e) => (
              <option key={e.id} value={e.id} className="bg-slate-900">
                {e.name} — {e.role}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => assign(target, taskTitle)}
              className="flex-1 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400"
            >
              Giao nhiệm vụ
            </button>
            <button
              onClick={() => assign("dev", SAMPLE_TASKS[0])}
              className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              ▶ Chạy demo tự động
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Nhân viên được giao sẽ cùng AI Quản Lý đi tới Phòng Họp, trao đổi,
            rồi quay về bàn làm việc. Trạng thái đổi theo từng bước.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <h2 className="mb-2 text-xs font-semibold text-slate-300">
            Nhân viên ({EMPLOYEES.length})
          </h2>
          <ul className="space-y-1.5">
            {EMPLOYEES.map((e) => {
              const st = states[e.id] ?? { status: "idle" as EmpStatus, progress: 0 };
              const isSel = selected === e.id;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => onSelect(e.id)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left transition ${
                      isSel ? "bg-white/15" : "bg-black/20 hover:bg-white/10"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-none rounded-full"
                        style={{ background: e.tint }}
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium leading-tight">{e.name}</span>
                        <span className="block text-[11px] leading-tight text-slate-400">
                          {e.role}
                        </span>
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: `${STATUS_COLOR[st.status]}26`, color: STATUS_COLOR[st.status] }}
                      >
                        {STATUS_LABEL[st.status]}
                      </span>
                    </span>
                    {st.status === "working" && (
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-cyan-400 transition-all"
                          style={{ width: `${st.progress}%` }}
                        />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <h2 className="mb-2 text-xs font-semibold text-slate-300">Nhật ký hoạt động</h2>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có hoạt động nào.</p>
          ) : (
            <ul className="space-y-1.5">
              {logs.map((l, i) => (
                <li key={i} className="text-xs leading-relaxed text-slate-300">
                  <span className="mr-1.5 text-slate-500">{l.time}</span>
                  {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Model người 3D bán chân thực: bộ mẫu Mixamo (X Bot / Michelle / Soldier)
          của three.js examples, nạp từ GitHub khi mở trang. Đây là bản demo
          kiểm chứng hướng đi; hệ thống nhiệm vụ thật, cơ sở dữ liệu và tài
          khoản AI sẽ làm ở các giai đoạn sau.
        </p>
      </aside>
    </div>
  );
}
