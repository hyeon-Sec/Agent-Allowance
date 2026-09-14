import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChatError } from "../src/chat-errors.js";

const insufficientCredits = {
  status: 400,
  error: { error: { message: "Your credit balance is too low to access the Anthropic API." } },
};
test("credit failure identifies the actionable cause and no payment", () => {
  const message = describeChatError(insufficientCredits, false);
  assert.match(message, /API 크레딧 잔액이 부족/);
  assert.match(message, /결제는 실행하지 않았습니다/);
});
test("a model error after a payment cannot claim no payment or suggest repeating the purchase", () => {
  const message = describeChatError(insufficientCredits, true);
  assert.match(message, /결제 결과.*확인/);
  assert.doesNotMatch(message, /결제는 실행하지 않았습니다/);
  assert.match(message, /구매 요청을 반복하지 마세요/);
});
test("unrecognized provider errors do not expose their response bodies", () => {
  const message = describeChatError({ status: 400, error: { error: { message: "secret-user-data-and-api-key" } } }, false);
  assert.doesNotMatch(message, /secret-user-data-and-api-key/);
  assert.doesNotMatch(message, /크레딧 잔액/);
});

test("OpenAI billing quota differs from rate limiting and Gemini errors name Gemini", () => {
  assert.match(describeChatError({ status: 429, code: "insufficient_quota" }, false, "openai"), /OpenAI API 크레딧 또는 사용 예산/);
  assert.match(describeChatError({ status: 429, code: "rate_limit_exceeded" }, false, "openai"), /OpenAI API 요청 한도/);
  assert.match(describeChatError({ status: 429 }, false, "gemini"), /Gemini API 할당량/);
  assert.match(describeChatError({ status: 400, message: "API key not valid. secret" }, false, "gemini"), /Gemini API 키 인증/);
  assert.doesNotMatch(describeChatError({ status: 400, message: "API key not valid. secret" }, false, "gemini"), /secret|Anthropic/);
});
