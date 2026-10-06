/**
 * Ai là "người đứng đầu" — theo ngành và theo loại người mua.
 *
 * Cùng một ngành, "người đúng" khác nhau tuỳ người mua là nhà máy, nhà nhập
 * khẩu/phân phối, hay chuỗi bán lẻ. Và trong mọi ngành đều có người mua thật
 * (quyết định chi tiền) đi kèm người gác cửa (có quyền phủ quyết).
 *
 * Dữ liệu này là nguồn duy nhất để xếp hạng đầu mối: ranker, UI và connector
 * đều đọc từ đây, không hard-code ở nơi khác.
 */

export type SectorKey = "agri" | "processed_food" | "textile";
export type BuyerTypeKey = "manufacturer" | "importer_distributor" | "retailer" | "brand";

export type TargetRole = {
  rank: number;
  /** Chức danh thường gặp trên thị trường (giữ tiếng Anh vì đó là từ trên LinkedIn/hợp đồng). */
  title: string;
  titleVi: string;
  /** Có quyền dừng giao dịch dù không phải người chi tiền. */
  gatekeeper?: boolean;
  why: string;
  /** Đường thực tế để tiếp cận vai trò này, không phải kênh liên hệ. */
  route: string;
};

export type RolePlaybook = {
  sector: SectorKey;
  buyerType: BuyerTypeKey;
  headline: string;
  /** Ghi chú riêng của tổ hợp ngành × loại người mua. */
  note?: string;
  roles: TargetRole[];
};

export const SECTORS: { key: SectorKey; label: string; examples: string }[] = [
  { key: "agri", label: "Nông sản", examples: "điều, cà phê, hồ tiêu, gạo, dừa, trái cây sấy/đông lạnh" },
  { key: "processed_food", label: "Thực phẩm chế biến", examples: "bánh kẹo, gia vị, nước sốt, đồ ăn liền, private label" },
  { key: "textile", label: "Dệt may", examples: "may mặc, vải, sợi, phụ liệu" },
];

export const BUYER_TYPES: { key: BuyerTypeKey; label: string }[] = [
  { key: "manufacturer", label: "Nhà máy / nhà chế biến" },
  { key: "importer_distributor", label: "Nhà nhập khẩu / phân phối" },
  { key: "retailer", label: "Chuỗi bán lẻ (private label)" },
  { key: "brand", label: "Brand / chuỗi thời trang" },
];

export const ROLE_PLAYBOOKS: RolePlaybook[] = [
  {
    sector: "agri",
    buyerType: "manufacturer",
    headline: "Bán nguyên liệu nông sản cho nhà máy chế biến",
    note: "Với hàng commodity, người quyết định đôi khi nằm ở trading house (Olam, ECOM…) chứ không ở nhà máy — nếu nhà máy mua qua trung gian thì đừng bắt đầu ở nhà máy.",
    roles: [
      {
        rank: 1,
        title: "Procurement / Sourcing Manager (Commodity Buyer)",
        titleVi: "Trưởng mua nguyên liệu / Commodity Buyer",
        why: "Người chốt nguồn hàng: origin, giá, khối lượng, điều kiện giao. Với nông sản, họ là người quyết định thay nhà cung cấp.",
        route: "Trang 'Suppliers' / 'Become a supplier' của nhà máy, hội chợ ngành (SIAL, Anuga, Gulfood), hoặc qua trading house nếu nhà máy mua gián tiếp.",
      },
      {
        rank: 2,
        title: "QA / Food Safety Manager",
        titleVi: "Trưởng QA / An toàn thực phẩm",
        gatekeeper: true,
        why: "Có quyền phủ quyết: dư lượng thuốc BVTV, aflatoxin, kiểm dịch không đạt thì procurement không mua được. Đây là lý do phổ biến nhất khiến chào hàng nông sản bị dừng giữa đường.",
        route: "Thường lộ diện sau khi gửi mẫu — hỏi thẳng người mua: 'tiêu chuẩn nào và ai duyệt mẫu'.",
      },
      {
        rank: 3,
        title: "Import / Logistics & Compliance Manager",
        titleVi: "Trưởng nhập khẩu / chứng từ",
        why: "Chứng từ, mã HS, nhãn mác, kiểm dịch thực vật, quy định nhập khẩu. Người này quyết định lô hàng có thông quan được hay không.",
        route: "Đi kèm bước đàm phán giá — hỏi INCOTERMS và bộ chứng từ họ cần.",
      },
    ],
  },
  {
    sector: "agri",
    buyerType: "importer_distributor",
    headline: "Bán nông sản cho nhà nhập khẩu / phân phối",
    note: "Ở Mỹ, nhà nhập khẩu phải có chương trình FSVP (Foreign Supplier Verification Program) cho từng nhà cung cấp — hỏi thẳng ai phụ trách FSVP, đó vừa là người gác cửa vừa là tín hiệu bạn đang nói chuyện với công ty nghiêm túc.",
    roles: [
      {
        rank: 1,
        title: "Buying / Purchasing Manager",
        titleVi: "Trưởng thu mua",
        why: "Quyết định danh mục và nhà cung cấp cho thị trường của họ. Với nhà phân phối, đây là người duy nhất có quyền mở một mặt hàng mới.",
        route: "Trang 'Suppliers', hội chợ thực phẩm, hoặc qua hiệp hội ngành hàng của nước họ.",
      },
      {
        rank: 2,
        title: "QA / Technical Manager",
        titleVi: "Trưởng kỹ thuật / chất lượng",
        gatekeeper: true,
        why: "Ký duyệt nhà cung cấp theo tiêu chuẩn nước nhập khẩu; ở Mỹ gắn với FSVP, ở EU gắn với trách nhiệm của importer.",
        route: "Hỏi ngay từ email đầu: 'anh/chị cần những chứng nhận và báo cáo nào để duyệt nhà cung cấp mới'.",
      },
      {
        rank: 3,
        title: "Sales / Commercial Director",
        titleVi: "Giám đốc thương mại",
        why: "Người quyết định mặt hàng của bạn có được đẩy ra kênh bán của họ hay không — đặc biệt khi bạn cần họ đầu tư thời gian bán hàng.",
        route: "Chào kèm kế hoạch bán và hỗ trợ marketing, không chỉ bảng giá.",
      },
    ],
  },
  {
    sector: "processed_food",
    buyerType: "retailer",
    headline: "Bán thực phẩm chế biến / private label cho chuỗi bán lẻ",
    note: "Chuỗi bán lẻ hiếm khi mua qua email lạnh: hầu hết có cổng đăng ký nhà cung cấp riêng (vendor portal). Đăng ký trước, rồi mới tìm người.",
    roles: [
      {
        rank: 1,
        title: "Category Buyer / Own-Brand Buyer",
        titleVi: "Buyer phụ trách ngành hàng / buyer nhãn riêng",
        why: "Người chọn nhà cung cấp cho nhãn riêng và quyết định sản phẩm nào vào danh mục. Không có người này thì không có đơn hàng.",
        route: "Vendor/supplier portal của chuỗi + hội chợ private label (PLMA), sau đó tìm đúng buyer theo category.",
      },
      {
        rank: 2,
        title: "Product Development / Own-Brand Technologist",
        titleVi: "Phát triển sản phẩm nhãn riêng",
        why: "Đánh giá sản phẩm có khớp công thức, bao bì, hạn sử dụng và định vị giá của nhãn riêng hay không. Đây là người thực sự 'mở cửa' cho hàng thành phẩm.",
        route: "Gửi sample + spec (thành phần, dinh dưỡng, shelf-life, chứng nhận) thay vì catalogue.",
      },
      {
        rank: 3,
        title: "QA / Technical Manager",
        titleVi: "Trưởng chất lượng / kỹ thuật",
        gatekeeper: true,
        why: "Duyệt nhà máy, chứng nhận (BRCGS, IFS, HACCP), nhãn dinh dưỡng, dị ứng. Không qua được cửa này thì mọi bước trước đều vô nghĩa.",
        route: "Chuẩn bị sẵn hồ sơ audit và chứng nhận ngay từ email đầu.",
      },
      {
        rank: 4,
        title: "Import / Supply Chain Manager",
        titleVi: "Trưởng nhập khẩu / chuỗi cung ứng",
        why: "Điều kiện vận chuyển, nhiệt độ, kho bãi, tần suất giao — quyết định phương án logistics có khả thi về chi phí hay không.",
        route: "Đưa ra 2 phương án logistics kèm giá landed cost.",
      },
    ],
  },
  {
    sector: "processed_food",
    buyerType: "importer_distributor",
    headline: "Bán thực phẩm chế biến cho nhà nhập khẩu / phân phối",
    note: "Đây là kênh phổ biến nhất cho hàng thực phẩm Việt Nam: nhà nhập khẩu ethnic food thường nhỏ, quyết định nhanh, và người mua chính là chủ hoặc trưởng thu mua.",
    roles: [
      {
        rank: 1,
        title: "Buying / Purchasing Manager",
        titleVi: "Trưởng thu mua",
        why: "Quyết định nhập mặt hàng mới và chọn nhà cung cấp; thường đồng thời quan tâm giá landed và vòng quay hàng.",
        route: "Trang 'Suppliers' hoặc liên hệ trực tiếp qua email công bố; hội chợ thực phẩm châu Á (THAIFEX, Seoul Food).",
      },
      {
        rank: 2,
        title: "Category / Brand Manager",
        titleVi: "Quản lý ngành hàng / thương hiệu",
        why: "Đánh giá sản phẩm có hợp khẩu vị thị trường, bao bì và giá bán lẻ mục tiêu hay không.",
        route: "Gửi kèm dữ liệu bán hàng ở thị trường tương tự và giá bán lẻ đề xuất.",
      },
      {
        rank: 3,
        title: "QA / Food Safety Manager",
        titleVi: "Trưởng an toàn thực phẩm",
        gatekeeper: true,
        why: "Kiểm tra nhãn, dị ứng, phụ gia, hạn sử dụng theo luật nước nhập khẩu — nhãn sai là lô hàng bị giữ ở cảng.",
        route: "Hỏi trước yêu cầu nhãn của nước họ để tránh phải in lại.",
      },
    ],
  },
  {
    sector: "textile",
    buyerType: "brand",
    headline: "Bán cho brand / chuỗi thời trang (OEM–ODM)",
    note: "Với dệt may, người đứng đầu KHÔNG nằm ở trụ sở brand: hầu hết quyết định chọn nhà cung cấp nằm ở văn phòng mua hàng (Hồng Kông, Thượng Hải, Đài Loan) hoặc ở buying agent. Tìm đúng văn phòng trước, tìm người sau.",
    roles: [
      {
        rank: 1,
        title: "Sourcing / Vendor Manager (Buying Office)",
        titleVi: "Trưởng tìm nguồn / quản lý nhà cung cấp",
        why: "Người chọn và giữ nhà cung cấp: đánh giá năng lực, giá FOB, tiến độ, công suất. Họ là 'người mua' thật của brand dù chức danh không có chữ mua.",
        route: "Văn phòng mua hàng/buying agent của brand tại châu Á; hội chợ (Magic, Texworld, Intertextile) và các chương trình kết nối của VITAS/ngành.",
      },
      {
        rank: 2,
        title: "QA / Compliance & Audit Manager",
        titleVi: "Trưởng QA / tuân thủ - audit",
        gatekeeper: true,
        why: "Audit nhà máy (BSCI, WRAP, SLCP), hoá chất (OEKO-TEX, ZDHC), lao động. Không đạt audit thì không có đơn, bất kể giá tốt đến đâu.",
        route: "Chuẩn bị chứng chỉ và kết quả audit trong hồ sơ năng lực gửi ngay lần đầu.",
      },
      {
        rank: 3,
        title: "Production / Merchandising Manager",
        titleVi: "Trưởng sản xuất / merchandiser",
        why: "Người theo tiến độ, sample, chỉnh sửa kỹ thuật hằng ngày. Là đầu mối giữ quan hệ sau khi đã vào danh sách nhà cung cấp.",
        route: "Sau khi qua vòng sourcing — giữ liên lạc bằng năng lực đúng hạn và sample đúng spec.",
      },
      {
        rank: 4,
        title: "Material / Fabric Sourcing Manager",
        titleVi: "Trưởng tìm nguồn nguyên liệu / vải",
        why: "Chỉ đứng đầu khi bạn bán VẢI, SỢI hoặc phụ liệu: brand và nhà may mua vật liệu theo chỉ định của họ.",
        route: "Gửi kèm swatch, thông số kỹ thuật và chứng nhận vật liệu.",
      },
    ],
  },
];

export function findPlaybook(sector: SectorKey, buyerType: BuyerTypeKey): RolePlaybook | undefined {
  return ROLE_PLAYBOOKS.find((playbook) => playbook.sector === sector && playbook.buyerType === buyerType);
}

/** Các tổ hợp có playbook, dùng cho UI khi cần liệt kê. */
export function playbooksForSector(sector: SectorKey): RolePlaybook[] {
  return ROLE_PLAYBOOKS.filter((playbook) => playbook.sector === sector);
}
