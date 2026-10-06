import type { CompanyReport } from "@/lib/demo-data";

/**
 * Mariani Packing Co., Inc. — dữ liệu công khai, có nguồn.
 *
 * Quy tắc của fixture này giống hệt pipeline thật:
 *  - Mọi giá trị đều có `sourceUrl` trỏ tới trang đã thấy nó (đối chiếu 06/10/2026).
 *  - Thứ công ty tự công bố → `certainty: "confirmed"`.
 *  - Thứ đến từ hồ sơ LinkedIn công khai nhưng chưa kiểm lại → `certainty: "probable"`,
 *    kênh ở mức "liên hệ thủ công".
 *  - Không mang lời khuyên bán hàng: hệ thống chỉ tìm và ghi nguồn.
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
    "Nhà sản xuất trái cây sấy thuộc sở hữu gia đình, thành lập 1906, trụ sở Vacaville, California. Có bộ phận mua nguyên liệu riêng (Bulk & Ingredients).",
  website: "mariani.com",
  foundedYear: 1906,
  headcount: "201–500 nhân sự (LinkedIn)",
  address: "500 Crocker Drive, Vacaville, CA 95688, USA",
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
      policy: "manual_contact_only",
    },
    {
      label: "Email bộ phận nguyên liệu",
      value: "ingredients@mariani.com",
      type: "email",
      verified: true,
      source: "Trang Bulk & Ingredients",
      certainty: "confirmed",
      identityMatch: "department",
      sourceUrl: "https://mariani.com/pages/bulk-and-ingredients",
      via: "Bulk & Ingredients",
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
      via: "Senior Director of Global Commodity Sales",
      personName: "Steve Sousa",
      personTitle: "Senior Director of Global Commodity Sales",
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
      via: "Asia — Japan & China",
      personName: "Todd Garcia",
      policy: "needs_mailbox_check",
    },
  ],
  sources: [
    {
      label: "Trang Contact Us",
      url: "https://mariani.com/pages/contact-us",
      kind: "website",
      verified: true,
    },
    {
      label: "Bulk & Ingredients",
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
  signals: ["Website xác minh", "Có bộ phận mua nguyên liệu riêng", "Có đầu mối mua hàng công khai", "Sales theo vùng công bố email"],
  people: [
    {
      id: "person-stacy-nygard",
      name: "Stacy Nygard",
      title: "Director, Procurement",
      department: "Procurement",
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
        },
      ],
    },
    {
      id: "person-bella-huk",
      name: "Bella Huk",
      title: "Purchasing Manager",
      department: "Purchasing",
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/bella-huk-5494828a",
      lastSeenAt: "06/10/2026",
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/bella-huk-5494828a",
          certainty: "probable",
          policy: "manual_contact_only",
        },
      ],
    },
    {
      id: "person-maggie-zabat",
      name: "Maggie Zabat",
      title: "Sales Effectiveness Manager",
      department: "Sales",
      previousRole: "Trước đây: Senior Buyer, Buyer/Planner tại Mariani",
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/maggie-zabat-657abb30",
      lastSeenAt: "06/10/2026",
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
      identityMatch: "person",
      certainty: "probable",
      sourceLabel: "Hồ sơ LinkedIn công khai",
      sourceUrl: "https://www.linkedin.com/in/joe-flannigan-b24616b",
      lastSeenAt: "06/10/2026",
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/joe-flannigan-b24616b",
          certainty: "probable",
          policy: "manual_contact_only",
        },
      ],
    },
  ]
};
