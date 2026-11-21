# Gen.G_VN AI Office

Văn phòng nhân viên AI dạng **3D thật**: một tầng văn phòng, mỗi phòng ban có phòng riêng,
7 nhân viên AI **bán chân thực giống người thật** ngồi tại bàn làm việc của mình —
và **di chuyển theo nhiệm vụ thật**: khi được giao việc, nhân viên cùng AI Quản Lý
đi tới Phòng Họp, trao đổi, rồi quay về bàn và bắt đầu làm việc, trạng thái thay đổi theo từng bước.

> Đây là **bản demo giai đoạn 1** để kiểm chứng hướng đi (văn phòng 3D + di chuyển theo nhiệm vụ).
> Hệ thống nhiệm vụ đầy đủ, cơ sở dữ liệu, đăng nhập và quản lý tài khoản AI sẽ làm ở các giai đoạn sau.

## Chạy thử ở local (Windows)

Yêu cầu: Node.js 20+ (đã kiểm tra với Node v24).

```powershell
git pull
npm install
npm run dev
```

Mở trình duyệt tại **http://localhost:3000**

## Cách dùng bản demo

- **Kéo chuột / vuốt**: xoay camera 360° • **Cuộn / pinch**: zoom • **Bấm vào nhân viên** trong cảnh 3D để chọn.
- Nút **▶ Chạy demo tự động**: xem ngay một lượt giao việc mẫu.
- Mục **Giao nhiệm vụ mới**: nhập tên nhiệm vụ, chọn nhân viên, bấm *Giao nhiệm vụ* —
  AI Quản Lý và nhân viên đó sẽ đi tới Phòng Họp, họp nhanh, rồi nhân viên về bàn làm việc
  (có thanh tiến độ), xong báo **Hoàn thành** trong *Nhật ký hoạt động*.
- Nút góc trái dưới: chuyển nhanh camera tới **Toàn cảnh / Phòng họp / Phòng Quản Lý**.

## Bố cục văn phòng

| Phòng | Nhân viên |
|---|---|
| Phòng Quản Lý | AI Quản Lý |
| Phòng Công Nghệ | AI Lập Trình |
| Phòng Thiết Kế | AI Thiết Kế |
| Phòng Nghiên Cứu | AI Nghiên Cứu |
| Phòng Tiếp Thị | AI Tiếp Thị |
| Phòng Kinh Doanh | AI Kinh Doanh |
| Phòng Phân Tích | AI Phân Tích |
| Phòng Họp | Họp / nhận việc chung |
| Khu Nghỉ, Sảnh Gen.G_VN | Không gian chung |

## Công nghệ

- Next.js (App Router) + TypeScript + Tailwind CSS
- Three.js: dựng cảnh, nạp model người GLB (bộ mẫu Mixamo *X Bot / Michelle / Soldier*
  của three.js examples, nạp từ GitHub raw khi mở trang — cần mạng lúc tải model;
  muốn chạy offline xem ghi chú trong `src/lib/office-data.ts`), AnimationMixer cho
  dáng đi/đứng, tìm đường theo đồ thị điểm mốc (waypoint graph + BFS) qua cửa từng phòng và hành lang.
- Nếu nạp model lỗi, app tự dùng nhân vật dự phòng để không bao giờ hiện văn phòng trống.

## Cấu trúc source

```
src/
  app/            # layout + trang chính
  components/
    OfficeApp.tsx # giao diện: panel nhân viên, giao nhiệm vụ, nhật ký
    Office3D.tsx  # toàn bộ scene 3D, nhân vật, cơ chế di chuyển
  lib/
    office-data.ts# mặt bằng, danh sách phòng/nhân viên, đồ thị đường đi
```

## Lộ trình tiếp theo

1. ✅ Giai đoạn 1 — Demo văn phòng 3D + di chuyển theo nhiệm vụ (bản này)
2. Giai đoạn 2 — Hệ thống nhiệm vụ đầy đủ (tạo/lưu nhiệm vụ, vòng đời, hạn, độ ưu tiên) + Dashboard số liệu thật
3. Giai đoạn 3 — Dữ liệu bền (PostgreSQL + Prisma), đăng nhập, đồng bộ thời gian thực
4. Giai đoạn 4 — AI Manager điều phối tự động + tích hợp tài khoản AI (sau khi xác minh phương thức tích hợp chính thức)
