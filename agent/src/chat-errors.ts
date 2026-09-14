import type { AIProvider } from "./ai-config.js";

export class ChatExecutionError extends Error {
  constructor(public readonly kind: "missing_key" | "incomplete" | "tool_limit" | "invalid_response") {
    super(kind);
  }
}

/** Translate provider failures without exposing response bodies, keys, or request contents. */
export function describeChatError(error: unknown, hasPaymentAttempt: boolean, provider: AIProvider = "anthropic"): string {
  const data = error as {
    status?: number; statusCode?: number; code?: string; message?: string;
    error?: { code?: string; message?: string; error?: { message?: string } };
  } | null;
  const status = data?.status ?? data?.statusCode;
  const providerMessage = data?.error?.error?.message ?? data?.error?.message ?? data?.message ?? "";
  const code = data?.code ?? data?.error?.code;
  const label = { anthropic: "Anthropic", gemini: "Gemini", openai: "OpenAI" }[provider];
  const key = { anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY" }[provider];
  let reason = `${label} AI 요청을 처리하지 못했습니다. 모델 설정과 연결을 확인하세요.`;
  if (error instanceof ChatExecutionError) {
    reason = {
      missing_key: `${label} API 키가 설정되지 않았습니다. agent/.env에 ${key}를 설정하고 서버를 다시 시작하세요.`,
      incomplete: `${label} 응답이 완료되지 않아 처리를 중단했습니다.`,
      tool_limit: "AI 처리 단계 한도에 도달해 추가 실행을 중단했습니다.",
      invalid_response: `${label} 응답 형식을 확인할 수 없어 처리를 중단했습니다.`,
    }[error.kind];
  } else if (provider === "anthropic" && (status === 400 || status === 402) &&
      /credit balance is too low|insufficient credits/i.test(providerMessage)) {
    reason = "Anthropic API 크레딧 잔액이 부족합니다. Anthropic 콘솔에서 API 크레딧을 충전해 주세요.";
  } else if (provider === "openai" && code === "insufficient_quota") {
    reason = "OpenAI API 크레딧 또는 사용 예산이 부족합니다. API 결제 설정과 사용 한도를 확인하세요.";
  } else if (status === 401 || (provider === "gemini" && status === 400 && /API_KEY_INVALID|API key not valid/i.test(providerMessage))) {
    reason = `${label} API 키 인증에 실패했습니다. API 키를 확인하고 서버를 다시 시작하세요.`;
  } else if (status === 403 || status === 404) {
    reason = `${label} API 또는 설정된 모델에 접근할 수 없습니다. 모델 이름과 계정 권한을 확인하세요.`;
  } else if (status === 429) {
    reason = provider === "gemini"
      ? "Gemini API 할당량 또는 요청 한도에 도달했습니다. AI Studio에서 사용량과 결제 설정을 확인하세요."
      : `${label} API 요청 한도에 도달해 현재 응답을 받을 수 없습니다.`;
  } else if (status && status >= 500) {
    reason = `${label} API에 일시적인 장애가 발생했습니다.`;
  }
  return hasPaymentAttempt
    ? `${reason} 결제 시도가 있었습니다. 아래 결제 결과와 결제 기록을 확인하고 같은 구매 요청을 반복하지 마세요.`
    : `${reason} 결제는 실행하지 않았습니다.`;
}
