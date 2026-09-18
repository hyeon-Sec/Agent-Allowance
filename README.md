# Agent Allowance

AI 에이전트에게 결제를 맡길 때 쓸 수 있는 돈의 범위를 Sui 컨트랙트로 제한하는 프로젝트입니다. 에이전트가 결제를 결정한 이유는 결제마다 Walrus에 저장합니다.

Blockthon 2026 (Sui × Walrus) 출품작이며, Sui testnet에서 도는 로컬 데모입니다.

## 왜 만들었나

결제하는 AI 에이전트에게 지갑 키를 그대로 주면 프롬프트 인젝션이나 키 유출 한 번에 잔액 전체가 위험해집니다. 그렇다고 결제마다 사람이 승인하면 에이전트를 쓰는 의미가 없습니다.

그래서 에이전트가 쓸 예산을 별도의 Sui 객체(Allowance)에 넣고, 에이전트 키로는 정해진 규칙 안에서만 결제할 수 있게 했습니다.

## 동작 방식

1. 사용자가 채팅으로 요청합니다. 예: "점심 사줘"
2. AI(Claude, Gemini, OpenAI 중 선택)가 상점을 찾고 남은 한도를 확인한 뒤 결제를 결정합니다.
3. 서버가 요청과 결정 이유를 Walrus에 저장하고, 다시 읽어서 내용이 맞는지 확인합니다.
4. 에이전트 키로 `spend`를 호출하면 컨트랙트가 다음을 검사합니다.
   - 등록된 에이전트인지
   - 소유자가 정지하지 않았는지
   - 허용된 상점인지
   - 1회 한도와 24시간 주기 한도 안인지
   - 잔액이 충분한지
5. 통과하면 송금과 함께 `SpendApproved`가, 위반하면 송금 없이 `SpendBlocked`가 남습니다. 두 이벤트 모두 Walrus 기록 ID를 담고 있습니다.

한도 변경과 정지는 `OwnerCap`을 가진 소유자가 브라우저 지갑으로 직접 서명합니다. 서버는 소유자 키를 갖지 않습니다.

## 데모

정책: 잔액 0.3 SUI, 1회 0.1 SUI, 24시간 주기 0.2 SUI, 허용 상점 3곳

- "점심 정식 사줘": 승인되고, Sui 트랜잭션과 Walrus 기록 링크가 뜹니다.
- "알고리즘 교재 사줘" (0.15 SUI): 1회 한도를 넘어 거절됩니다.
- "쿠폰 이벤트 참여해줘": 상점 설명에 숨겨 둔 송금 지시(프롬프트 인젝션)에 에이전트가 어떻게 반응하는지 봅니다.
- "지난번 결제 기록 알려줘": Walrus에 저장된 과거 기록을 읽어서 답합니다.
- 공격 시뮬레이션 버튼: LLM을 거치지 않고 에이전트 키로 컨트랙트를 직접 호출합니다. 체인이 거절합니다.
- 소유자 지갑으로 정지: 이후 결제가 모두 거절됩니다.

## 실행

Node 20.19 이상(또는 22.12 이상), testnet SUI, 소유자용 Sui 브라우저 지갑이 필요합니다. 채팅을 쓰려면 AI API 키가 하나 이상 있어야 합니다.

```bash
cd agent
npm install
cp .env.example .env   # PACKAGE_ID, ALLOWANCE_ID, OWNER_CAP_ID, AGENT_SECRET_KEY, AI 키 입력
npm start              # http://127.0.0.1:8787
```

- AI 키는 쓸 것만 넣으면 됩니다(`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`). 기본 AI는 `AI_PROVIDER`, 모델은 `*_MODEL`로 바꿉니다. OpenAI는 API 키로 호출하며 ChatGPT 구독과는 별개입니다.
- 소유자 키는 `.env`에 넣지 않습니다. 들어 있으면 서버가 시작하지 않습니다.
- AI 키가 없어도 대시보드, 정책 조회, 공격 시뮬레이션은 동작합니다.

새로 배포할 때는 소유자 환경에서 실행합니다.

```bash
cd move/agent_allowance
sui move test
sui client publish        # 출력된 PackageID를 agent/.env에 입력

cd ../../agent
read -rs -p 'Owner key: ' SETUP_OWNER_SECRET_KEY && export SETUP_OWNER_SECRET_KEY
npm run setup             # ALLOWANCE_ID, OWNER_CAP_ID가 .env에 기록됨
unset SETUP_OWNER_SECRET_KEY
```

## 테스트

```bash
cd agent && npm run typecheck && npm test   # TypeScript 테스트 50개
cd move/agent_allowance && sui move test    # Move 테스트 9개
```

## testnet 배포

| | |
|---|---|
| Package | [0xf9e3…1557](https://suiscan.xyz/testnet/object/0xf9e3ebefaea62292e50a2225251dbb502f35ac29bbf6c628f68efe794cb51557) |
| Allowance | [0x395f…e858](https://suiscan.xyz/testnet/object/0x395f31a6de3b5a2816c80e55405e1e313fe90c83320079914bfb198d9c94e858) |

실제로 실행해 본 트랜잭션:

- 허용 상점에 0.01 SUI 결제, 승인: [ENNg1S…efz5](https://suiscan.xyz/testnet/tx/ENNg1S91kfh1XswwgcufiDLnF4qNKcobRLDYr38vefz5)
- 공격자 주소로 송금 시도, 거절: [DWGBkt…7rrS](https://suiscan.xyz/testnet/tx/DWGBktG1cdtXEVbRYnZsUuPAZyCAzUg4o1eqVNrJ7rrS)
- 5 SUI 인출 시도, 1회 한도 초과로 거절: [5dygz3…TgW](https://suiscan.xyz/testnet/tx/5dygz3Jh3DwcTzb6PiaXtMfhZkHHrj77VFYDNNQqpTgW)

## 한계

- 보호하는 건 Allowance 안의 돈입니다. 에이전트 주소에 있는 가스 잔액은 보호 대상이 아닙니다.
- 에이전트 키가 유출되면 허용 상점과 한도 안의 결제까지는 막을 수 없습니다. 이때는 정지한 뒤 키를 바꿔야 합니다.
- Walrus 기록을 저장하고 확인하는 건 앱입니다. 컨트랙트는 blob ID의 내용까지 확인하지 않습니다.
- 한도는 24시간마다 초기화됩니다. 직전 24시간을 합산하는 방식이 아닙니다.
- Walrus 기록은 공개되며 5 epochs 동안만 보관됩니다.
- 127.0.0.1에서만 도는 단일 사용자 데모이고, 캠퍼스 상점은 가상입니다.
- 실제 AI 대화 결제는 Gemini(`gemini-3.5-flash-lite`)로 승인·거절·인젝션 거부·기록 조회 시나리오를 확인했습니다. Claude·OpenAI는 테스트 서버로만 검증했고, 브라우저 지갑 서명은 실제 지갑으로는 아직 확인하지 못했습니다.

## 폴더

```
move/agent_allowance/   Move 컨트랙트와 테스트
agent/src/              서버 (AI 연동, 결제, Walrus, Sui)
agent/browser/          소유자 지갑 연결
agent/tests/            테스트
web/                    대시보드
docs/                   검증 기록, 발표 자료
```
