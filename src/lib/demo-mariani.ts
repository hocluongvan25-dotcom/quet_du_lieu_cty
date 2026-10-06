import type { CompanyReport } from "@/lib/demo-data";

/**
 * Mariani Packing Co., Inc. — fixture dựng từ dữ liệu CÔNG KHAI, có nguồn.
 *
 * Quy tắc của fixture này giống hệt quy tắc của pipeline thật:
 *  - Mọi giá trị công ty đều có `sourceUrl` trỏ tới trang đã thấy nó (kiểm tra 06/10/2026).
 *  - Thứ nhìn thấy trên trang do công ty tự công bố → `certainty: "confirmed"`.
 *  - Thứ đến từ hồ sơ LinkedIn công khai nhưng chưa kiểm lại → `certainty: "probable"`,
 *    và kênh chỉ ở mức "liên hệ thủ công".
 *  - Thứ KHÔNG tìm thấy thì ghi rõ là không tìm thấy (notes), không suy diễn.
 *
 * Nguồn đã kiểm:
 *   https://mariani.com/pages/contact-us
 *   https://mariani.com/pages/bulk-and-ingredients
 *   https://www.linkedin.com/company/mariani-packing-co.-inc./  (chính website liên kết ra)
 */
export const marianiReport: CompanyReport = {
  id: "report-mariani",
  companyName: "Mariani Packing Co., Inc.",
  initials: "MP",
  accent: "#3E9BC4",
  country: "United States",
  sourceInput: "Mariani Packing Co.",
  status: "ready",
  confidence: 91,
  createdAt: "Hôm nay, 14:05",
  expiresAt: "05/11/2026",
  daysLeft: 30,
  industry: "Chế biến & đóng gói trái cây sấy",
  description:
    "Nhà sản xuất trái cây sấy lớn nhất thế giới thuộc sở hữu gia đình, thành lập 1906, trụ sở Vacaville, California. Nguyên liệu trái cây sấy của Mariani được dùng bởi nhiều thương hiệu thực phẩm lớn, và công ty có bộ phận mua nguyên liệu riêng (Bulk & Ingredients).",
  website: "mariani.com",
  lastUpdated: "14:05 hôm nay",
  contacts: [
    {
      label: "Website chính thức",
      value: "mariani.com",
      type: "website",
      verified: true,
      source: "Website công ty",
      certainty: "confirmed",
      identityMatch: "company_general",
      sourceUrl: "https://mariani.com/",
    },
    {
      label: "LinkedIn công ty",
      value: "linkedin.com/company/mariani-packing-co.-inc.",
      type: "linkedin",
      verified: true,
      source: "Công ty tự liên kết ở chân trang",
      certainty: "confirmed",
      identityMatch: "company_general",
      sourceUrl: "https://mariani.com/pages/contact-us",
    },
    {
      label: "Điện thoại văn phòng",
      value: "+1 707-452-2800",
      type: "phone",
      verified: true,
      source: "Trang Contact Us",
      certainty: "confirmed",
      identityMatch: "company_general",
      sourceUrl: "https://mariani.com/pages/contact-us",
      policy: "needs_mailbox_check",
    },
    {
      label: "Email nguyên liệu (Bulk & Ingredients)",
      value: "ingredients@mariani.com",
      type: "email",
      verified: true,
      source: "Trang Bulk & Ingredients",
      certainty: "confirmed",
      identityMatch: "department",
      sourceUrl: "https://mariani.com/pages/bulk-and-ingredients",
      via: "Bộ phận nguyên liệu — kênh đúng nhất khi chào nguyên liệu thô",
      policy: "needs_mailbox_check",
    },
    {
      label: "Email chung",
      value: "productinfo@mariani.com",
      type: "email",
      verified: true,
      source: "Trang Contact Us",
      certainty: "confirmed",
      identityMatch: "company_general",
      sourceUrl: "https://mariani.com/pages/contact-us",
      policy: "needs_mailbox_check",
    },
    {
      label: "Email công bố theo vùng — Steve Sousa",
      value: "ssousa@mariani.com",
      type: "email",
      verified: true,
      source: "Trang Contact Us",
      certainty: "confirmed",
      identityMatch: "person",
      sourceUrl: "https://mariani.com/pages/contact-us",
      via: "Senior Director, Global Commodity Sales",
      policy: "needs_mailbox_check",
    },
    {
      label: "Email công bố theo vùng — Todd Garcia",
      value: "tgarcia@mariani.com",
      type: "email",
      verified: true,
      source: "Trang Contact Us",
      certainty: "confirmed",
      identityMatch: "person",
      sourceUrl: "https://mariani.com/pages/contact-us",
      via: "Phụ trách Asia — Japan & China",
      policy: "needs_mailbox_check",
    },
  ],
  sources: [
    {
      label: "Trang Contact Us (điện thoại, email, sales theo vùng)",
      url: "https://mariani.com/pages/contact-us",
      kind: "website",
      verified: true,
    },
    {
      label: "Bulk & Ingredients (email bộ phận nguyên liệu)",
      url: "https://mariani.com/pages/bulk-and-ingredients",
      kind: "website",
      verified: true,
    },
    {
      label: "LinkedIn công ty",
      url: "https://www.linkedin.com/company/mariani-packing-co.-inc./",
      kind: "social",
      verified: true,
    },
    {
      label: "Hồ sơ LinkedIn cá nhân (chưa kiểm lại trong hệ thống)",
      url: "https://www.linkedin.com/in/stacy-nygard-1517b2b",
      kind: "social",
    },
  ],
  signals: [
    "Website xác minh",
    "Có bộ phận mua nguyên liệu riêng",
    "Có đầu mối mua hàng công khai",
    "Sales theo vùng công bố email",
  ],
  people: [
    {
      id: "person-stacy-nygard",
      name: "Stacy Nygard",
      title: "Director, Procurement",
      department: "Procurement",
      rank: 1,
      relevance:
        "Ưu tiên số 1 khi chào nguyên liệu, bao bì hoặc dịch vụ sản xuất: phụ trách strategic sourcing, quản lý nhà cung cấp và có kinh nghiệm mua từ nhiều quốc gia.",
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/stacy-nygard-1517b2b",
      lastSeenAt: "06/10/2026",
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/stacy-nygard-1517b2b",
          certainty: "probable",
          policy: "manual_contact_only",
          note: "Kết nối và nhắn tin thủ công. Hệ thống không tự động gửi nội dung.",
        },
      ],
    },
    {
      id: "person-bella-huk",
      name: "Bella Huk",
      title: "Purchasing Manager",
      department: "Purchasing",
      rank: 2,
      relevance: "Đầu mối mua hàng trực tiếp, phù hợp khi cần hỏi quy trình nhà cung cấp và tiêu chuẩn đầu vào.",
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/bella-huk-5494828a",
      lastSeenAt: "06/10/2026",
      caution: "Hồ sơ ít thông tin (7 kết nối) — nên gửi lời mời kết nối kèm tin nhắn ngắn giới thiệu.",
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/bella-huk-5494828a",
          certainty: "probable",
          policy: "manual_contact_only",
          note: "Chỉ có profile công khai; không có email cá nhân nào được công bố nên hệ thống KHÔNG sinh email theo pattern.",
        },
      ],
    },
    {
      id: "person-maggie-zabat",
      name: "Maggie Zabat",
      title: "Sales Effectiveness Manager",
      department: "Sales",
      previousRole: "Trước đây: Senior Buyer, Buyer/Planner tại Mariani",
      rank: 3,
      relevance:
        "Hiểu quy trình mua, tồn kho, đánh giá nhà cung cấp và tiêu chuẩn FDA — hữu ích để hiểu cách Mariani chọn nhà cung cấp.",
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/maggie-zabat-657abb30",
      lastSeenAt: "06/10/2026",
      caution: "ĐÃ ĐỔI VAI TRÒ — hiện không còn giữ chức buyer. Không dùng làm đầu mối mua hàng.",
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/maggie-zabat-657abb30",
          certainty: "probable",
          policy: "manual_contact_only",
        },
      ],
    },
    {
      id: "person-joe-flannigan",
      name: "Joe Flannigan",
      title: "VP Key Corporate Accounts",
      department: "Sales & Marketing",
      rank: 4,
      relevance:
        "Chỉ dùng khi chào thành phẩm, private label hoặc hợp tác phân phối — phụ trách các kênh Club, Mass Merchandiser và Drug.",
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/joe-flannigan-b24616b",
      lastSeenAt: "06/10/2026",
      caution: "Đây là đầu mối BÁN của Mariani, không phải người mua. Xếp sau nhóm Procurement.",
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/joe-flannigan-b24616b",
          certainty: "probable",
          policy: "manual_contact_only",
        },
      ],
    },
  ],
  notes: [
    {
      kind: "not_found",
      label: "WhatsApp chính thức",
      detail:
        "Trang Contact chỉ có chat trên website (Gorgias), không có liên kết wa.me hay số WhatsApp nào được công bố. Hệ thống ghi nhận là KHÔNG tìm thấy, không suy diễn từ số tổng đài.",
      sourceUrl: "https://mariani.com/pages/contact-us",
    },
    {
      kind: "not_found",
      label: "Email cá nhân của Stacy Nygard / Bella Huk",
      detail:
        "Chỉ có profile LinkedIn công khai. Không có email cá nhân nào được công bố, nên không sinh email theo pattern (first.last@) — đây là loại dữ liệu chỉ được tạo khi có bước kiểm tra mailbox.",
    },
    {
      kind: "excluded",
      label: "+1 989-514-1459 · mariani@worldpantry.com",
      detail:
        "Nằm trên trang Contact nhưng là của WorldPantry — đơn vị vận hành web store, không phải liên hệ của Mariani. Nếu scrape tự động sẽ rất dễ gán nhầm thành số/email công ty.",
      sourceUrl: "https://mariani.com/pages/contact-us",
    },
  ],
};
