# Agent Allowance

AI 에이전트에게 결제를 맡기되, 쓸 수 있는 범위는 Sui 컨트랙트가 정하고 결제 이유는 Walrus에 남기는 프로젝트입니다.

- GitHub: <GitHub 저장소 URL>
- 데모 영상: <데모 영상 URL>
- Blockthon 2026 · Sui × Walrus

(대시보드 스크린샷)

## 문제

결제하는 AI 에이전트에게 지갑 키를 주면 프롬프트 인젝션이나 키 유출 한 번에 잔액 전체가 위험해집니다. 결제마다 사람이 승인하면 안전하지만 에이전트를 쓰는 의미가 없습니다. 에이전트가 왜 그 결제를 했는지 나중에 확인할 방법도 없습니다.

## 해결

에이전트가 쓸 예산을 Sui의 Allowance 객체에 넣었습니다.

- 에이전트는 상점을 찾고 결제를 결정합니다. 에이전트 키로 할 수 있는 건 한도 안의 결제뿐입니다.
- 컨트랙트는 결제마다 허용 상점, 1회 한도, 24시간 한도, 정지 여부를 검사합니다. 위반하면 송금하지 않고 거절 기록을 남깁니다.
- 결제 전에 요청과 판단 이유를 Walrus에 저장합니다. 이 기록의 ID가 결제 이벤트에 들어갑니다.
- 소유자는 브라우저 지갑으로 한도를 바꾸거나 에이전트를 멈춥니다.

해커톤 주제에 맞춰 보면 Memory는 Walrus의 판단 기록, Agency는 AI의 자율 결제, Ownership은 소유자의 통제입니다.

## 데모

정책: 잔액 0.3 SUI, 1회 0.1 SUI, 24시간 0.2 SUI, 허용 상점 3곳

- "점심 사줘": 결제가 승인되고, Sui 트랜잭션과 Walrus 기록을 바로 열어 볼 수 있습니다.
- "교재 사줘" (0.15 SUI): 1회 한도를 넘어 체인이 거절합니다.
- "쿠폰 이벤트 참여해줘": 상점 설명에 숨긴 송금 지시에 에이전트가 어떻게 반응하는지 봅니다.
- "지난번 결제 기록 알려줘": Walrus에 저장된 과거 기록을 읽어서 답합니다.
- 공격 시뮬레이션: 에이전트 키가 털렸다고 가정하고 LLM 없이 컨트랙트를 직접 호출합니다. 그래도 정책 밖의 결제는 체인이 거절합니다.
- 소유자 정지: 지갑으로 정지하면 이후 결제가 모두 거절됩니다.

AI는 Claude, Gemini, OpenAI 중에서 골라 쓸 수 있고, 어떤 AI를 쓰든 같은 온체인 규칙을 거칩니다.

## 기술

Sui Move, Walrus, Claude / Gemini / OpenAI API, TypeScript (Node.js, Express), Sui dApp Kit

## 확인한 것

testnet에서 실제로 실행한 트랜잭션:

- 허용 상점에 0.01 SUI 결제, 승인: [ENNg1S…efz5](https://suiscan.xyz/testnet/tx/ENNg1S91kfh1XswwgcufiDLnF4qNKcobRLDYr38vefz5)
- 공격자 주소로 송금 시도, 거절: [DWGBkt…7rrS](https://suiscan.xyz/testnet/tx/DWGBktG1cdtXEVbRYnZsUuPAZyCAzUg4o1eqVNrJ7rrS)
- 5 SUI 인출 시도, 거절: [5dygz3…TgW](https://suiscan.xyz/testnet/tx/5dygz3Jh3DwcTzb6PiaXtMfhZkHHrj77VFYDNNQqpTgW)

테스트는 Move 9개, TypeScript 50개가 통과합니다. Gemini로 실제 대화 결제(승인, 한도·허용 상점 거절, 인젝션 거부, 과거 기록 조회)를 확인했습니다. 브라우저 지갑 서명은 실제 지갑으로는 아직 확인하지 못했습니다.

컨트랙트: [Package](https://suiscan.xyz/testnet/object/0xf9e3ebefaea62292e50a2225251dbb502f35ac29bbf6c628f68efe794cb51557) · [Allowance](https://suiscan.xyz/testnet/object/0x395f31a6de3b5a2816c80e55405e1e313fe90c83320079914bfb198d9c94e858)

## 다음 단계

- Seal로 판단 기록 암호화
- 컨트랙트에서 Walrus 기록 존재 확인
- 에이전트 가스 대납
- AI 개발자의 유료 API·데이터 구매 예산처럼 실제 쓰임새에 맞는 정책 템플릿

## 팀

- <이름>: <역할>
