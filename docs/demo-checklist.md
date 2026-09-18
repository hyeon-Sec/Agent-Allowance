# 데모 체크리스트

## 0. 한 번만: 소유자 지갑 준비 (⑦ 정지 장면용, 선택)

소유권은 `OwnerCap` 객체를 누가 갖고 있느냐로 정해진다. 개인 키를 옮기지 말고 **OwnerCap을 지갑 주소로 전송**한다.

1. 크롬에 **Slush** 확장 설치, 지갑 생성, 네트워크를 **Testnet**으로.
2. Slush 주소(`0x…` 66자)를 복사한다.
3. CLI 소유자 계정에서 OwnerCap과 가스용 SUI를 그 주소로 보낸다(`npm run demo:reset`으로 새 Allowance를 만들 때마다 다시 필요).
   ```bash
   S=~/.local/bin/sui; TO=<Slush 주소>; CAP=$(grep ^OWNER_CAP_ID= .env | cut -d= -f2)
   $S client transfer --to $TO --object-id $CAP
   COIN=$($S client gas --json | python3 -c 'import sys,json; print(max(json.load(sys.stdin), key=lambda c:int(c["mistBalance"]))["gasCoinId"])')
   $S client transfer-sui --to $TO --sui-coin-object-id $COIN --amount 50000000
   ```
4. 대시보드의 "소유자 지갑 연결" → Slush 선택 → "소유자 확인 완료"가 뜨면 끝. 정지·한도 변경은 Slush 팝업에서 서명한다.

현재 데모 Allowance(`0x8d71…5351`)의 OwnerCap은 이미 Slush 주소 `0x16a9…330c`로 옮겨져 있고 가스 0.05 SUI도 보내 두었다.

지갑 없이 녹화하면 ⑦은 빼고 "정지와 한도 변경은 소유자 지갑이 서명한다"고 말로만 한다.

## 1. 녹화 직전 (30분)

```bash
cd /mnt/c/Users/maker/Desktop/hackerthon/blockthon/agent
# 서버가 켜져 있으면 Ctrl+C로 끄고
npm run demo:reset     # 새 Allowance 0.3 SUI, 기록 삭제, 에이전트 가스 +0.05
npm start
```

브라우저: `http://localhost:8787/?present=1` → F11 전체화면 → Ctrl + `+` 로 125~150%.

- [ ] 잔액 0.3 SUI, 사용액 0, "활성" 배지
- [ ] 결제 기록 "아직 결제 시도가 없습니다"
- [ ] AI 선택: 쓸 프로바이더로 (키 미설정 표시 없는 것)
- [ ] 이모지(🍱 📘 🔓 ✅ 🛑)가 제대로 보이는지. 네모면 알려줄 것
- [ ] 다른 탭에 Suiscan Allowance 페이지 열어 두기 (대시보드 상단 링크)
- [ ] Walrus 링크는 첫 로딩이 느리므로 녹화 전에 아무 것도 없으면 건너뜀. 첫 승인 카드가 뜨면 링크를 한 번 미리 열어 두고 녹화에선 두 번째 열기
- [ ] 알림·메신저 끄기, 배터리 연결

녹화: `Win + G` → 캡처 → 녹화 시작. 무음. 장면 순서는 `발표.txt` 4장 ①~⑨.
Gemini 무료로 찍을 때는 채팅 장면 사이에 **60초 이상** 쉰다(대기 시간은 편집에서 자름).

## 2. 편집

Clipchamp(Windows 11 기본): 대기 구간 자르기, 장면마다 자막 한 줄, 3분 이내, 1080p mp4로 내보내기.
자막 예: "AI가 스스로 결제 → Sui 승인 + Walrus 기록", "AI가 한도를 알고 스스로 멈춤", "AI를 건너뛰어도 체인이 거절", "소유자 지갑 서명 한 번으로 정지".

저장: 노트북 + USB + Google Drive(링크 있는 모든 사용자 보기). 제출 폼에 Drive 링크.

## 3. 현장 (토요일)

**출발 전(금요일 밤)**
- [ ] `npm run demo:reset` 한 번 더 → 라이브용 깨끗한 Allowance
- [ ] `npm start` 켠 채로 두기. Windows 전원 옵션: 덮개 닫아도 절전 안 함
- [ ] 에이전트 가스 0.05 이상: `~/.local/bin/sui client gas 0x5e2816d109190bd80182d7dbbb7870eac4c88415c0ae7600e7b0d6629031e217`
- [ ] 영상 파일이 노트북에 있고 재생되는지
- [ ] 폰 핫스팟 켜지는지

**발표 5분 전**
```bash
curl -s http://127.0.0.1:8787/api/status | head -c 120
```
응답이 오면 OK. 안 오면 `cd agent && npm start`. 대시보드 새로고침 → "활성" 배지 확인.

**발표 순서**: 슬라이드 1~3 → 영상(3분) → 라이브 10초: **🔓 공격자 주소로 송금** 클릭 → 거절 카드 → Sui 트랜잭션 링크 → SpendBlocked 이벤트 → 슬라이드 5 → 마무리.

라이브가 안 되면 "영상에서 보신 대로입니다"로 넘어간다. 채팅은 라이브로 하지 않는다.
