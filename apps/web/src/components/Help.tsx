import { useState } from "react";
import { Sheet } from "./ui";

type Tip = { t: string; d: string };
type HelpDoc = { title: string; intro: string; tips: Tip[] };

export type HelpKey = "map" | "home" | "wishlist" | "addPlace" | "itinerary" | "transit" | "expenses" | "checklist" | "settings";

const HELP: Record<HelpKey, HelpDoc> = {
  map: {
    title: "지도 사용법",
    intro: "우리가 고른 장소를 한눈에 보는 첫 화면이에요.",
    tips: [
      { t: "장소 찾기", d: "위 검색창에 이름을 입력하면 우리 장소가 먼저 나와요. 없으면 '지도에서 찾아 추가하기'로 새로 넣을 수 있어요." },
      { t: "도시 · 날짜로 보기", d: "부산·경주·포항 칩으로 도시별로, DAY 칩으로 그날 일정만 볼 수 있어요. DAY를 고르면 도보 동선도 그려져요." },
      { t: "장소 보기", d: "핀이나 아래 카드를 누르면 상세가 열려요. 투표, 메모, 일정 넣기, 길찾기를 거기서 해요." },
      { t: "지도를 눌러 추가", d: "지도의 빈 곳을 누르면 그 위치로 장소를 바로 추가할 수 있어요." },
      { t: "주변 교통", d: "'주변 교통'을 켜고 지도를 누르면 반경 500m 버스정류장·지하철역이 보여요." },
      { t: "내 위치", d: "오른쪽 아래 위치 버튼을 누르면 지금 있는 곳으로 이동해요." },
    ],
  },
  home: {
    title: "요약 화면 사용법",
    intro: "여행 전체 진행 상황을 한 번에 보는 곳이에요.",
    tips: [
      { t: "D-day와 일정", d: "출발까지 남은 날과 DAY별 도시가 보여요. 여행 중에는 오늘 일정이 위에 떠요." },
      { t: "다음 방문 · 다음 열차", d: "다음에 갈 곳과 탈 열차를 바로 확인할 수 있어요." },
      { t: "바로가기", d: "위시리스트, 같이 쓴 돈, 여행 준비, 철도 예약을 눌러 해당 화면으로 이동해요." },
      { t: "최근 활동", d: "같이 여행하는 사람이 무엇을 추가·수정했는지 보여줘요." },
      { t: "설정", d: "오른쪽 위 톱니바퀴에서 여행 날짜, 내일로 패스, 초대 링크를 관리해요." },
    ],
  },
  wishlist: {
    title: "위시리스트 사용법",
    intro: "가고 싶은 곳을 모으고 함께 투표하는 곳이에요.",
    tips: [
      { t: "추가하기", d: "오른쪽 위 '추가' 또는 아래 ＋ 버튼으로 장소를 넣어요. 네이버 지도·카카오맵 공유 링크를 붙여 넣어도 돼요." },
      { t: "하트 투표", d: "카드 오른쪽 하트를 누르면 '꼭 가고 싶어'로 투표돼요. 점수가 높을수록 위로 올라와요." },
      { t: "자세한 선호도", d: "카드를 눌러 상세를 열면 꼭!/좋아/고민/제외 중에서 고를 수 있어요." },
      { t: "필터", d: "위 탭으로 '둘 다 원하는 곳', '내가 추가한 곳', '일정 미배정' 등을 골라 볼 수 있어요." },
      { t: "일정에 넣기", d: "상세에서 날짜를 고르면 그 날 일정에 들어가고 카드에 DAY 표시가 붙어요." },
    ],
  },
  addPlace: {
    title: "장소 추가 사용법",
    intro: "가고 싶은 곳을 위시리스트에 넣는 화면이에요.",
    tips: [
      { t: "공유 링크 붙여넣기", d: "네이버 지도나 카카오맵에서 '공유 → 링크 복사' 후 '붙여넣기'를 누르면 이름이 자동으로 채워져요." },
      { t: "위치 지정", d: "링크만으로는 위치를 알 수 없어요. 아래 지도에서 위치를 찍어 주세요. 나중에 해도 괜찮아요." },
      { t: "도시 · 분류", d: "도시와 분류(관광지·카페·음식점 등)를 고르면 지도와 목록에서 구분돼 보여요." },
      { t: "내 선호도 · 메모", d: "얼마나 가고 싶은지와 메모(영업시간, 꼭 먹을 메뉴 등)를 같이 남길 수 있어요." },
    ],
  },
  itinerary: {
    title: "일정 사용법",
    intro: "날짜별로 방문 순서와 이동 시간을 정하는 곳이에요.",
    tips: [
      { t: "날짜 고르기", d: "위 DAY 카드를 눌러 날짜를 바꿔요." },
      { t: "순서 바꾸기", d: "각 장소의 위/아래 버튼으로 순서를 바꿔요. 장소 사이 이동 시간이 자동으로 다시 계산돼요." },
      { t: "동선 최적화", d: "'✨ 도보 동선 최적화 추천'을 누르면 가장 짧은 순서를 제안해요. 마음에 들 때만 '이 순서로 적용'을 눌러요." },
      { t: "시간 고정", d: "예약한 식당처럼 시간이 정해진 곳은 '시간 고정'으로 묶어둘 수 있어요." },
      { t: "미배정 장소", d: "아래 '미배정 장소'에서 날짜를 정해요. '날짜 추천 받기'를 누르면 위치를 보고 날짜를 제안해줘요." },
      { t: "공유", d: "'이 날 일정 공유'를 누르면 일정이 복사돼요. 카톡에 붙여 넣으면 돼요." },
    ],
  },
  transit: {
    title: "교통 사용법",
    intro: "열차, 버스, 지하철 정보를 찾는 곳이에요.",
    tips: [
      { t: "열차 시간표", d: "출발역·도착역과 날짜를 고르면 그날 열차 시간표가 나와요. 일정 날짜별 빠른 선택 카드를 눌러도 돼요." },
      { t: "내 열차", d: "탈 열차를 저장해두고 예매 완료 여부를 표시할 수 있어요. 요약 화면 '다음 열차'에도 떠요." },
      { t: "내일로", d: "내일로 패스로 기차를 탄 날 수를 세어줘요. 남은 탑승일을 넘지 않게 확인하세요." },
      { t: "주변 정류장", d: "현재 위치나 장소를 고르면 주변 버스정류장과 지하철역을 보여줘요." },
      { t: "경로 검색", d: "출발지와 도착지를 정하고 버튼을 누르면 대중교통 경로를 찾아줘요. 결과는 검색한 시점 기준이에요." },
    ],
  },
  expenses: {
    title: "가계부 사용법",
    intro: "같이 쓴 돈을 기록하고 마지막에 정산하는 곳이에요.",
    tips: [
      { t: "지출 기록", d: "'기록'에서 금액, 분류, 누가 냈는지, 누구랑 나눌지를 고르면 돼요." },
      { t: "나누는 방식", d: "지출마다 고른 사람끼리 똑같이 나눠 계산해요. 한 사람만 쓴 돈은 그 사람만 고르세요." },
      { t: "정산", d: "아래 '정산'에서 누가 누구에게 얼마를 보내면 되는지 알려줘요." },
      { t: "삭제", d: "잘못 쓴 항목은 오른쪽 휴지통으로 지울 수 있어요." },
    ],
  },
  checklist: {
    title: "체크리스트 사용법",
    intro: "여행 전 준비물과 할 일을 같이 챙기는 곳이에요.",
    tips: [
      { t: "준비물 · 할 일", d: "위 탭으로 🎒 준비물과 ✅ 할 일을 나눠 볼 수 있어요." },
      { t: "체크하기", d: "항목을 누르면 완료로 바뀌고, 누가 완료했는지 같이 보여요." },
      { t: "추천 항목", d: "'추천 항목 더 넣기'를 누르면 기차 여행에 자주 필요한 것들을 한 번에 넣어줘요." },
    ],
  },
  settings: {
    title: "설정 사용법",
    intro: "여행 기본 정보와 같이 쓰기를 관리하는 곳이에요.",
    tips: [
      { t: "여행 정보", d: "여행 이름과 시작일·종료일을 바꾸면 DAY와 D-day가 맞춰져요." },
      { t: "내일로 패스", d: "패스 종류(연속 7일권·선택 3일권), 시작일, 출발역·귀가역을 넣어두면 탑승일을 세어줘요." },
      { t: "같이 쓰기", d: "초대 주소를 복사해서 보내면 받은 사람이 이름만 고르고 바로 함께 편집할 수 있어요." },
      { t: "이 기기에서 나가기", d: "다른 이름으로 들어가고 싶을 때 써요. 데이터는 지워지지 않아요." },
    ],
  },
};

/** Round "?" button that opens a short how-to sheet for the current screen. */
export default function HelpButton({ page, className = "" }: { page: HelpKey; className?: string }) {
  const [open, setOpen] = useState(false);
  const doc = HELP[page];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${doc.title} 보기`}
        className={`tap shrink-0 rounded-full flex items-center justify-center active:scale-95 transition-transform ${className}`}>
        <span className="w-7 h-7 rounded-full bg-sand text-navy-soft text-[15px] font-bold flex items-center justify-center" aria-hidden>?</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={doc.title}>
        <p className="text-[15px] text-navy-soft mb-4">{doc.intro}</p>
        <ol className="space-y-4 pb-2">
          {doc.tips.map((tip, i) => (
            <li key={tip.t} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-coral-soft text-coral-ink text-[13px] font-bold flex items-center justify-center shrink-0 mt-0.5 num">{i + 1}</span>
              <div>
                <p className="font-semibold text-[16px]">{tip.t}</p>
                <p className="text-[14px] text-navy-soft leading-relaxed mt-0.5">{tip.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <button className="btn btn-primary w-full mt-4" onClick={() => setOpen(false)}>알겠어요</button>
      </Sheet>
    </>
  );
}
