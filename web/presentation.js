export function paymentLabel(status) {
  return {
    approved: "✅ 결제 승인",
    blocked: "🛑 체인이 거절",
    error: "⚠️ 실행 오류",
    unknown: "❔ 결제 결과 미확인",
  }[status] ?? "❔ 결제 결과 미확인";
}
