/**
 * Provider của Company Report trong app — và **giá** của nó.
 *
 * Có hai provider, và câu hỏi "đang dùng cái nào" được trả lời **mỗi lượt
 * research**, không phải bằng một hằng số:
 *
 *  - `connector` — đọc website công khai của công ty (qua connector), dùng khoá
 *    tìm kiếm ở server để **tìm ra website** khi người dùng chỉ gõ tên. Tốn tiền
 *    gọi search và tốn thời gian đọc trang, nên tính **5 credits**.
 *  - `demo` — báo cáo minh hoạ, không đọc nguồn nào. **0 credits**, và mọi report
 *    mang `sampleData: true` để UI hiện nhãn.
 *
 * Ba thứ nằm chung một file vì chúng phải luôn khớp nhau: provider nào đang chạy,
 * giá bao nhiêu, và báo cáo có phải dữ liệu mẫu hay không. `report:test` kiểm
 * đúng cặp đó — đổi provider mà quên đổi giá thì test đỏ ngay, chứ không âm thầm
 * thu tiền cho một báo cáo chưa research.
 */

export const DEMO_PROVIDER = "demo" as const;
export const CONNECTOR_PROVIDER = "connector" as const;
export type ResearchProvider = typeof DEMO_PROVIDER | typeof CONNECTOR_PROVIDER;

/**
 * Giá của một report theo provider. Provider mẫu: 0 — trừ tiền cho một báo cáo
 * chưa research là nói dối bằng hoá đơn.
 */
export function researchCreditCost(provider: string, reportCost: number): number {
  return provider === DEMO_PROVIDER ? 0 : reportCost;
}

/** Khoá tìm kiếm phía server (Serper / Tavily / Brave). Không bao giờ ra client. */
export function searchApiKeyFromEnv(env: Record<string, string | undefined> = process.env): string {
  return (env.SEARCH_API_KEY ?? "").trim();
}

export type ResolvedResearchProvider = {
  provider: ResearchProvider;
  cost: number;
  /** Vì sao provider này — hiện thẳng cho người dùng khi là provider mẫu. */
  reason: string;
};

/**
 * Chọn provider cho một lượt research.
 *
 * Có khoá tìm kiếm ⇒ `connector` (đọc nguồn thật, tính credits). Không có khoá ⇒
 * `demo`, và nói rõ lý do để UI dán nhãn "dữ liệu mẫu" thay vì để người dùng
 * tưởng mình vừa research thật. Không có đường thứ ba: thà nói thẳng là báo cáo
 * mẫu còn hơn trả về một report nghe hợp lý mà không đọc ở đâu cả.
 */
export function resolveResearchProvider(options: { searchKey?: string | null; reportCost: number }): ResolvedResearchProvider {
  const key = (options.searchKey ?? "").trim();
  if (!key) {
    return {
      provider: DEMO_PROVIDER,
      cost: researchCreditCost(DEMO_PROVIDER, options.reportCost),
      reason: "chưa cấu hình khoá tìm kiếm (SEARCH_API_KEY) nên chưa đọc được nguồn công khai",
    };
  }
  return {
    provider: CONNECTOR_PROVIDER,
    cost: researchCreditCost(CONNECTOR_PROVIDER, options.reportCost),
    reason: "đã có khoá tìm kiếm — research đọc website công khai của công ty",
  };
}

/**
 * Bản dùng ở server: đọc khoá từ biến môi trường. `reportCost` truyền vào để
 * file này không phải import ngược lên lớp workspace (giữ nó không có vòng lặp
 * import, và giữ nó dùng được cả ở client).
 */
export function researchForEnv(reportCost: number, env: Record<string, string | undefined> = process.env): ResolvedResearchProvider {
  return resolveResearchProvider({ searchKey: searchApiKeyFromEnv(env), reportCost });
}
