import type { EmergencyCard, Location, OXQuestion } from '../types';

export const ORIENTATION = {
  intro:
    '2026년 전국에서 시행되는 퇴원환자단기집중서비스는 퇴원 후 이용자의 집~병원 이동과 병원 내 진료 전 과정을 함께하는 "동행지원 서비스"를 포함합니다.',
  guide: '지금부터 이용자를 모시고 병원에 다녀오는 과정을 함께 해봅니다.',
};

/** Sentinel target id: reaching this from an exit ends the map and starts the closing O/X quiz. */
export const CLOSING_QUIZ_ID = '__closing_quiz__';

export const LOCATIONS: Location[] = [
  // ── 필수 경로 (기존 7단계 8장면과 학습포인트·퀴즈·출처 동일) ─────────────
  {
    id: 'home_entrance',
    role: 'mandatory',
    mapOrder: 1,
    stageLabel: '사전준비 및 이동지원',
    image: '/images/scene_01.svg',
    imageAlt: '이용자 자택 현관 앞에서 돌봄제공인력이 인사하는 모습',
    learningSource: '사업안내서 Ⅵ-2-03 준비단계 체크리스트, 매뉴얼 Ⅰ-2-2·3',
    learningPoints: [
      '이동 목적·방법·경로·예상 소요시간을 사전에 확인한다',
      '이용자의 건강상태·피로도, 보행 능력을 미리 점검한다',
      '신분증, 진료카드, 처방전, 복용약 정보, 보조기구 등 준비물을 확인한다',
      '2인 배치가 필요한 경우 사전에 협의되어 있는지 확인한다',
    ],
    quiz: {
      situation: "이용자가 \"오늘은 그냥 제 차로 태워다 주세요\"라고 요청합니다. 어떻게 해야 할까요?",
      options: [
        { id: 'a', text: '흔쾌히 대신 운전해서 모신다', correct: false },
        { id: 'b', text: '원칙적으로 어렵다고 안내하고, 대중교통이나 기관 연계 이동수단을 안내한다', correct: true },
        { id: 'c', text: '일단 태워드리고 나중에 기관에 보고한다', correct: false },
      ],
      feedback: {
        correct:
          '맞습니다. 돌봄제공인력의 자가 차량 이용이나 이용자 차량 대리운전은 원칙적으로 할 수 없습니다. 이용자·가족이 직접 운전하는 경우만 예외이며, 교통비는 이용자 본인 부담이 원칙입니다.',
        incorrect: '다시 생각해보세요. 자가 차량으로 이용자를 태우거나 이용자 차량을 대리운전하는 것이 원칙적으로 가능한 일인지 떠올려보세요.',
      },
      source: '2026년 노인맞춤돌봄서비스 사업안내 Ⅵ-2-03',
    },
    exits: [
      { id: 'to_lobby', label: '병원으로 이동', hotspot: { x: 78, y: 62 }, targetId: 'hospital_lobby', style: 'forward' },
    ],
  },
  {
    id: 'hospital_lobby',
    role: 'mandatory',
    mapOrder: 2,
    stageLabel: '병원 도착 및 접수',
    image: '/images/scene_02.svg',
    imageAlt: '병원 로비의 접수·수납 창구와 안내판',
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-2 절차1',
    learningPoints: [
      '접수 위치를 안내하고, 신분증·진료카드가 준비되었는지 확인한다',
      '키오스크 사용을 보조하고, 진료과·진료 순서를 확인한다',
      '휠체어 등 이동지원 물품 대여를 지원한다',
    ],
    quiz: {
      situation: '이용자가 키오스크 조작을 많이 어려워합니다. 어떻게 도와야 할까요?',
      options: [
        { id: 'a', text: '옆에서 화면을 짚어가며 이용자가 직접 누르도록 안내한다', correct: true },
        { id: 'b', text: '대신 다 눌러서 접수를 끝내준다', correct: false },
        { id: 'c', text: '그냥 기다리게 하고 직원을 불러온다', correct: false },
      ],
      feedback: {
        correct: '맞습니다. 이용자의 의견과 선택을 존중하며, 과도한 개입이나 대리 처리는 지양해야 합니다.',
        incorrect: '다시 생각해보세요. 이용자가 스스로 할 수 있도록 돕는 것과 대신 해주는 것 중 어느 쪽이 원칙에 맞을까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-2 절차1',
    },
    exits: [
      { id: 'to_info_desk', label: '안내데스크 둘러보기', hotspot: { x: 16, y: 72 }, targetId: 'info_desk', style: 'optional' },
      { id: 'to_store', label: '편의점 둘러보기', hotspot: { x: 88, y: 78 }, targetId: 'convenience_store', style: 'optional' },
      { id: 'to_waiting_room', label: '대기실로 이동', hotspot: { x: 50, y: 20 }, targetId: 'waiting_room', style: 'forward' },
    ],
  },
  {
    id: 'waiting_room',
    role: 'mandatory',
    mapOrder: 3,
    stageLabel: '진료 대기',
    image: '/images/scene_03.svg',
    imageAlt: '대기실과 대기번호 전광판, 흐릿하게 처리된 배경 인물들',
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-2 절차2, Ⅳ-1',
    learningPoints: [
      '대기 장소와 번호를 안내하고, 화장실·휴게공간을 안내한다',
      '장시간 대기 시 수분 섭취, 피로도 등 상태를 확인한다',
      '혼잡한 장소에서는 이용자 곁을 벗어나지 않는다 (낙상 예방)',
    ],
    quiz: {
      situation: '대기가 길어져 잠깐 이용자를 대기실에 혼자 두고 화장실에 다녀와도 될까요?',
      options: [
        { id: 'a', text: '안 된다, 혼잡한 장소에서는 이용자 곁을 벗어나지 않는 것이 안전관리의 기본원칙이다', correct: true },
        { id: 'b', text: '괜찮다, 금방 다녀오면 된다', correct: false },
      ],
      feedback: {
        correct:
          '맞습니다. 혼잡한 장소에서 이용자 곁을 벗어나지 않는 것은 낙상 등 안전사고를 예방하는 기본원칙입니다. 자리를 비워야 한다면 다른 인력이나 보호자에게 요청하세요.',
        incorrect: '다시 생각해보세요. 혼잡한 대기실에서 이용자 곁을 잠시라도 벗어나는 것이 안전관리 원칙에 맞을지 떠올려보세요.',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-2 절차2, Ⅳ-1',
    },
    exits: [
      { id: 'to_restroom', label: '화장실 둘러보기', hotspot: { x: 14, y: 68 }, targetId: 'restroom', style: 'optional' },
      { id: 'to_lounge', label: '휴게 라운지 둘러보기', hotspot: { x: 90, y: 70 }, targetId: 'rest_lounge', style: 'optional' },
      { id: 'to_exam_room', label: '진료실로 이동', hotspot: { x: 66, y: 55 }, targetId: 'exam_room', style: 'forward' },
    ],
  },
  {
    id: 'exam_room',
    role: 'mandatory',
    mapOrder: 4,
    stageLabel: '진료실 동행',
    image: '/images/scene_04.svg',
    imageAlt: '진료실에서 의사, 이용자, 돌봄제공인력이 대화하는 모습',
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅰ-3-2 수행불가업무, Ⅲ-2',
    learningPoints: [
      '진료실 이동을 지원하고, 이용자의 의사 표현을 보조한다',
      '의료진의 안내사항 메모를 지원하고 다음 절차를 확인한다',
      '의료적 판단은 절대 대신하지 않는다',
    ],
    quiz: {
      situation:
        "의사가 \"통증이 심하면 응급실로 가세요\"라고 하자 이용자가 망설입니다. 돌봄제공인력이 \"이 정도면 안 가셔도 될 것 같아요\"라고 판단해 드려도 될까요?",
      options: [
        { id: 'a', text: '네, 경험상 판단해서 안내해드린다', correct: false },
        { id: 'b', text: '아니요, 통증 원인 추정이나 응급실 필요 여부 판단은 돌봄제공인력이 할 수 없는 의료적 판단이다', correct: true },
      ],
      feedback: {
        correct:
          '맞습니다. 통증의 원인을 추정하거나 응급실행 여부를 판단하는 것은 의료적 판단·진단 영역으로, 돌봄제공인력이 대신할 수 없습니다. 이용자가 스스로 결정하도록 안내하고 필요하면 보호자·기관에 상황을 전달하세요.',
        incorrect: '다시 생각해보세요. 통증의 정도나 응급실 필요 여부를 판단하는 것은 누구의 역할일까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅰ-3-2 수행불가업무, Ⅲ-2',
    },
    exits: [
      { id: 'to_test_corridor', label: '검사실로 이동', hotspot: { x: 50, y: 24 }, targetId: 'test_corridor', style: 'forward' },
    ],
  },
  {
    id: 'test_corridor',
    role: 'mandatory',
    mapOrder: 5,
    stageLabel: '검사 동행',
    image: '/images/scene_05.svg',
    imageAlt: '검사실 복도와 영상의학실 표지판, 엘리베이터',
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-3, Ⅳ-2 나-이동시 유의사항',
    learningPoints: [
      '검사실 위치·순서를 안내하고, 금식 여부 등 검사 전 준비사항을 확인한다',
      '검사 후 이동을 보조하고 이용자 상태를 확인한다',
      '휠체어 이동 시 문턱·엘리베이터 탑승 방법에 유의한다',
    ],
    quiz: {
      situation: '휠체어로 엘리베이터를 탈 때 올바른 방법은 무엇일까요?',
      options: [
        { id: 'a', text: '들어가고 나오는 방향은 상관없다', correct: false },
        { id: 'b', text: '앞으로 들어가서 앞으로 나온다', correct: false },
        { id: 'c', text: '뒤로 들어가서 앞으로 나온다', correct: true },
      ],
      feedback: {
        correct: '맞습니다. 뒤로 들어가서 앞으로 나오며, 나올 때 작은 바퀴가 문틈에 끼지 않도록 주의합니다.',
        incorrect: '다시 생각해보세요. 나갈 때 작은 바퀴가 문틈에 끼지 않으려면 어떤 방향으로 타야 할까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-3, Ⅳ-2 나-이동시 유의사항',
    },
    exits: [
      { id: 'to_billing', label: '수납창구로 이동', hotspot: { x: 30, y: 50 }, targetId: 'billing_desk', style: 'forward' },
      { id: 'to_pharmacy', label: '약국으로 이동', hotspot: { x: 70, y: 50 }, targetId: 'pharmacy', style: 'forward' },
    ],
  },
  {
    id: 'billing_desk',
    role: 'mandatory',
    mapOrder: 6,
    stageLabel: '수납 및 약국',
    subLabel: '수납',
    subIndex: 1,
    subTotal: 2,
    image: '/images/scene_06a.svg',
    imageAlt: '병원 수납창구',
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-3, Ⅲ-3-3, Ⅲ-4',
    learningPoints: [
      '수납창구를 안내하고 영수증·처방전 수령을 확인한다',
      '검사결과지·진료내용 촬영 및 공유는 금지행위임을 기억한다',
    ],
    quiz: {
      situation: '이용자 보호자가 검사결과지를 사진 찍어서 보내달라고 부탁합니다. 해드려도 될까요?',
      options: [
        { id: 'a', text: '아니요, 검사결과·진료내용의 촬영과 공유는 금지행위이다', correct: true },
        { id: 'b', text: '네, 보호자 요청이니 사진을 찍어 보내드린다', correct: false },
      ],
      feedback: {
        correct:
          '맞습니다. 검사결과지·진료내용을 촬영하거나 공유하는 것은 개인정보보호 원칙상 금지행위입니다. 정보 확인이 필요하면 이용자 본인이나 병원의 공식 절차를 통해 안내하세요.',
        incorrect: '다시 생각해보세요. 보호자의 부탁이라도 이용자의 검사결과를 임의로 촬영·전달해도 괜찮을지 떠올려보세요.',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅲ-3-3, Ⅲ-4',
    },
    exits: [
      { id: 'to_pharmacy', label: '약국으로 이동', hotspot: { x: 74, y: 58 }, targetId: 'pharmacy', style: 'forward' },
      {
        id: 'to_discharge',
        label: '귀가하기',
        hotspot: { x: 50, y: 20 },
        targetId: 'discharge_exit',
        style: 'gated',
        requires: ['pharmacy'],
      },
    ],
  },
  {
    id: 'pharmacy',
    role: 'mandatory',
    mapOrder: 6,
    stageLabel: '수납 및 약국',
    subLabel: '약국',
    subIndex: 2,
    subTotal: 2,
    image: '/images/scene_06b.svg',
    imageAlt: '병원 약국 창구',
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-3, Ⅲ-3-3',
    learningPoints: [
      '약국 창구로 안내하고 처방전을 확인한다',
      '복약 방법은 임의로 설명하지 않고, 약사의 설명을 이용자가 직접 듣도록 지원한다',
    ],
    quiz: {
      situation: '이용자가 약 먹는 법을 잘 모르는 것 같아, 돌봄제공인력이 대신 자세히 설명해 드려도 될까요?',
      options: [
        { id: 'a', text: '네, 잘 아는 부분이니 자세히 설명해드린다', correct: false },
        { id: 'b', text: '아니요, 복약 방법을 임의로 설명하지 않고 약사의 설명을 이용자가 직접 듣도록 지원한다', correct: true },
      ],
      feedback: {
        correct:
          '맞습니다. 복약 방법은 의료·약료 정보이므로 돌봄제공인력이 임의로 설명하지 않고, 이용자가 약사의 설명을 직접 듣도록 옆에서 지원합니다. 필요하면 메모를 도와드릴 수 있습니다.',
        incorrect: '다시 생각해보세요. 복약 방법 설명은 누구의 역할이며, 돌봄제공인력은 어떤 방식으로 도와야 할까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-3, Ⅲ-3-3',
    },
    exits: [
      { id: 'to_billing', label: '수납창구로 이동', hotspot: { x: 26, y: 58 }, targetId: 'billing_desk', style: 'forward' },
      {
        id: 'to_discharge',
        label: '귀가하기',
        hotspot: { x: 50, y: 20 },
        targetId: 'discharge_exit',
        style: 'gated',
        requires: ['billing_desk'],
      },
    ],
  },
  {
    id: 'discharge_exit',
    role: 'mandatory',
    mapOrder: 7,
    stageLabel: '귀가 지원 및 마무리',
    image: '/images/scene_07.svg',
    imageAlt: '병원 정문 앞 승하차 장면',
    learningSource: '사업안내서 Ⅵ-2-03 정리단계 체크리스트, 매뉴얼 Ⅳ-4',
    learningPoints: [
      '귀가 교통수단을 확인하고 안전한 승하차를 보조한다',
      '귀가 후 상태를 재확인하고 보호자·기관에 종료사항을 전달한다',
      '소요시간·경로·특이사항을 기록한다',
    ],
    quiz: {
      situation: '귀가 중 이용자가 갑자기 어지럼증을 호소하며 휘청입니다. 가장 먼저 해야 할 일은 무엇일까요?',
      options: [
        { id: 'a', text: '서둘러 목적지까지 이동한다', correct: false },
        { id: 'b', text: '안전한 곳에 앉히고 상태를 확인한 뒤, 필요시 의료진·119를 부른다', correct: true },
        { id: 'c', text: '보호자에게 먼저 전화한다', correct: false },
      ],
      feedback: {
        correct:
          '맞습니다. 초기대응 원칙은 ①상태 확인 → ②의료진·119 호출(필요시) → ③안전공간 확보 → ④보호자·기관 연락 → ⑤기록·보고 순입니다.',
        incorrect: '다시 생각해보세요. 이용자의 안전을 가장 먼저 확보하려면 무엇부터 해야 할까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅳ-4 / 2026년 노인맞춤돌봄서비스 사업안내 Ⅵ-2-03',
    },
    exits: [
      { id: 'to_closing_quiz', label: '마무리 퀴즈로 이동', hotspot: { x: 50, y: 66 }, targetId: CLOSING_QUIZ_ID, style: 'forward' },
    ],
  },

  // ── 선택(둘러보기) 장소 4곳 — 퀴즈 없음, 언제나 자유롭게 다녀올 수 있음 ─────
  {
    id: 'info_desk',
    role: 'optional',
    mapOrder: 2,
    stageLabel: '안내데스크',
    parentId: 'hospital_lobby',
    image: '/images/scene_opt_info_desk.svg',
    imageAlt: '병원 로비 종합안내데스크, 유니폼을 입은 안내 직원이 손으로 방향을 가리키는 모습',
    learningPoints: [
      '처음 온 병원에서는 종합안내데스크에서 진료과 위치·접수 절차를 먼저 물어볼 수 있다',
    ],
    exits: [{ id: 'return', label: '로비로 돌아가기', hotspot: { x: 50, y: 82 }, targetId: 'hospital_lobby', style: 'return' }],
  },
  {
    id: 'convenience_store',
    role: 'optional',
    mapOrder: 2,
    stageLabel: '편의점',
    parentId: 'hospital_lobby',
    image: '/images/scene_opt_store.svg',
    imageAlt: '병원 1층 편의점 입구, 음료 냉장고와 간단한 매대',
    learningPoints: [
      '대기 중 이용자가 물이나 간단한 간식을 찾을 때 편의점 위치를 안내할 수 있다',
    ],
    exits: [{ id: 'return', label: '로비로 돌아가기', hotspot: { x: 50, y: 82 }, targetId: 'hospital_lobby', style: 'return' }],
  },
  {
    id: 'restroom',
    role: 'optional',
    mapOrder: 3,
    stageLabel: '화장실',
    parentId: 'waiting_room',
    image: '/images/scene_opt_restroom.svg',
    imageAlt: '병원 복도의 화장실 입구와 표지판',
    learningPoints: [
      '화장실 위치를 미리 안내해두면 대기 중 이용자가 편하게 다녀올 수 있다',
      '혼잡한 장소에서는 이용자 곁을 벗어나지 않는다 (낙상 예방)',
    ],
    learningSource: '병원동행 서비스 교육 매뉴얼 Ⅱ-2-2 절차2, Ⅳ-1',
    exits: [{ id: 'return', label: '대기실로 돌아가기', hotspot: { x: 50, y: 82 }, targetId: 'waiting_room', style: 'return' }],
  },
  {
    id: 'rest_lounge',
    role: 'optional',
    mapOrder: 3,
    stageLabel: '휴게 라운지',
    parentId: 'waiting_room',
    image: '/images/scene_opt_lounge.svg',
    imageAlt: '병원 복도 한쪽의 창가 휴게 라운지, 벤치와 화분',
    learningPoints: [
      '장시간 대기로 피로해하면 휴게 라운지에서 잠시 쉬어가도록 안내할 수 있다',
    ],
    exits: [{ id: 'return', label: '대기실로 돌아가기', hotspot: { x: 50, y: 82 }, targetId: 'waiting_room', style: 'return' }],
  },
];

export const LOCATIONS_BY_ID: Record<string, Location> = Object.fromEntries(
  LOCATIONS.map((location) => [location.id, location]),
);

export const MANDATORY_LOCATIONS = LOCATIONS.filter((l) => l.role === 'mandatory');

export const TOTAL_STAGES = new Set(MANDATORY_LOCATIONS.map((l) => l.mapOrder)).size;

/** 보너스: 아무 이동 시점에서나 낮은 확률로 등장 (선택 구현, 점수에는 반영하지 않음) */
export const EMERGENCY_CARDS: EmergencyCard[] = [
  {
    id: 'fall',
    title: '낙상',
    responseSteps: [
      '무리하게 일으켜 세우지 않고 그 자리에서 움직이지 않도록 안내한다',
      '통증·출혈 여부를 확인한다',
      '의료진을 호출한다',
      '보호자·기관에 보고한다',
    ],
    quiz: {
      situation: '이용자가 이동 중 넘어졌습니다. 가장 먼저 해야 할 일은 무엇일까요?',
      options: [
        { id: 'a', text: '바로 부축해서 일으켜 세운다', correct: false },
        { id: 'b', text: '무리하게 일으켜 세우지 않고 그 자리에서 움직이지 않도록 안내한다', correct: true },
      ],
      feedback: {
        correct: '맞습니다. 무리하게 일으켜 세우면 숨은 부상을 악화시킬 수 있습니다. 먼저 그 자리에서 움직이지 않도록 하고 통증·출혈 여부를 확인하세요.',
        incorrect: '다시 생각해보세요. 넘어진 직후 바로 일으켜 세우는 것이 안전할까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
    },
    source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
  },
  {
    id: 'seizure',
    title: '경련',
    responseSteps: [
      '주변 위험물을 치워 안전공간을 확보한다',
      '단추·넥타이·벨트 등 조이는 것을 풀어준다',
      '팔다리를 붙잡거나 억누르지 않는다',
      '가능하면 옆으로 눕혀 기도를 확보한다',
      '입 안에 손수건 등 이물질을 넣지 않는다',
    ],
    quiz: {
      situation: '경련 중인 이용자가 혀를 깨물지 않도록 입에 손수건을 물려줘야 할까요?',
      options: [
        { id: 'a', text: '아니요, 질식 위험이 있으므로 입 안에 어떤 것도 넣지 않는다', correct: true },
        { id: 'b', text: '네, 혀를 보호하기 위해 물려준다', correct: false },
      ],
      feedback: {
        correct: '맞습니다. 입 안에 손수건 등을 넣으면 오히려 질식 위험이 커집니다. 팔다리를 억누르지 말고, 가능하면 옆으로 눕혀 기도를 확보하세요.',
        incorrect: '다시 생각해보세요. 입 안에 이물질을 넣으면 어떤 위험이 생길 수 있을까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
    },
    source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
  },
  {
    id: 'choking',
    title: '질식',
    responseSteps: [
      '의식이 있으면 기침을 유도한다',
      '말을 못하거나 호흡이 어려우면 즉시 의료진 도움을 요청한다',
      '하임리히법은 응급처치 교육을 이수한 경우 기관 지침에 따라서만 시행한다',
    ],
    quiz: {
      situation: '이용자가 음식을 먹다 갑자기 기침도 못하고 목을 부여잡습니다. 가장 먼저 해야 할 일은?',
      options: [
        { id: 'a', text: '당황하지 말고 직접 하임리히법을 시행한다', correct: false },
        { id: 'b', text: '말을 못하거나 호흡이 어려우면 즉시 의료진 도움을 요청한다', correct: true },
      ],
      feedback: {
        correct: '맞습니다. 말을 못하거나 호흡이 어려우면 즉시 의료진 도움을 요청하세요. 하임리히법은 응급처치 교육을 이수한 경우에 한해 기관 지침에 따라서만 시행합니다.',
        incorrect: '다시 생각해보세요. 하임리히법 같은 응급처치는 아무나 임의로 시행해도 될까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
    },
    source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
  },
  {
    id: 'burn',
    title: '화상',
    responseSteps: [
      '흐르는 차가운 물(낮은 압력)로 화상 부위를 식힌다',
      '연고를 바르지 않는다',
      '부종이 생기기 전 반지·시계 등 장신구를 제거한다',
      '수포를 터뜨리지 않는다',
    ],
    quiz: {
      situation: '이용자가 화상을 입었습니다. 상처에 연고를 발라드려도 될까요?',
      options: [
        { id: 'a', text: '네, 자극을 줄이기 위해 연고를 발라준다', correct: false },
        { id: 'b', text: '아니요, 연고를 바르지 않고 흐르는 차가운 물로 식힌다', correct: true },
      ],
      feedback: {
        correct: '맞습니다. 화상 부위에는 연고를 바르지 않고 흐르는 차가운 물(낮은 압력)로 식히는 것이 우선입니다. 수포는 터뜨리지 않습니다.',
        incorrect: '다시 생각해보세요. 화상 직후 연고를 바르는 것이 도움이 될지 떠올려보세요.',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
    },
    source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
  },
  {
    id: 'hypoglycemia',
    title: '저혈당',
    symptoms: ['식은땀', '손 떨림', '피로감', '경련', '불안감', '두통'],
    responseSteps: [
      '안전한 곳에 앉히거나 눕힌다',
      '저혈당 응급식품(주스 1/2컵, 사탕 3~4개, 설탕 1큰술, 요구르트 1개 중 하나) 섭취를 돕는다',
    ],
    quiz: {
      situation: '이용자가 식은땀을 흘리며 손을 떨고 불안해합니다. 저혈당이 의심될 때 도울 수 있는 방법은?',
      options: [
        { id: 'a', text: '안전한 곳에 앉히고 주스나 사탕 같은 저혈당 응급식품 섭취를 돕는다', correct: true },
        { id: 'b', text: '물을 최대한 많이 마시게 한다', correct: false },
      ],
      feedback: {
        correct: '맞습니다. 안전한 곳에 앉히거나 눕힌 뒤 주스 1/2컵, 사탕 3~4개, 설탕 1큰술, 요구르트 1개 중 하나 같은 저혈당 응급식품 섭취를 돕습니다.',
        incorrect: '다시 생각해보세요. 저혈당이 의심될 때는 어떤 음식이 도움이 될까요?',
      },
      source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
    },
    source: '병원동행 서비스 교육 매뉴얼 Ⅳ-5 응급상황별 사례 대응',
  },
];

/** 마무리 O/X 스피드 퀴즈 — 수행 불가 업무 총정리. 정답은 모두 X. */
export const OX_QUESTIONS: OXQuestion[] = [
  {
    id: 'ox_1',
    category: '의료적 판단·진단',
    prompt: "\"이 정도 통증이면 응급실 안 가셔도 될 것 같아요\"라고 이용자에게 말해준다",
    answer: 'X',
    explanation: '통증의 정도나 응급실 필요 여부를 판단하는 것은 의료적 판단·진단 영역으로 돌봄제공인력이 할 수 없는 업무입니다.',
  },
  {
    id: 'ox_2',
    category: '약 복용 지시·투여',
    prompt: '이용자 대신 인슐린 주사를 놓아준다',
    answer: 'X',
    explanation: '주사 등 약물 투여는 의료행위로, 돌봄제공인력이 대신 시행할 수 없습니다.',
  },
  {
    id: 'ox_3',
    category: '주사·상처 처치 등 의료행위',
    prompt: '이용자의 상처 부위를 직접 소독하고 드레싱해준다',
    answer: 'X',
    explanation: '상처 소독·드레싱 등 처치는 의료행위에 해당하여 돌봄제공인력이 수행할 수 없습니다.',
  },
  {
    id: 'ox_4',
    category: '보호자 동의가 필요한 의료 결정',
    prompt: '수술 동의서에 이용자를 대신해 서명한다',
    answer: 'X',
    explanation: '수술 동의 등 중요한 의료 결정은 이용자 본인이나 법적 보호자만 할 수 있으며, 돌봄제공인력은 대신 서명할 수 없습니다.',
  },
  {
    id: 'ox_5',
    category: '개인정보 임의 열람·전달',
    prompt: '검사결과지를 사진으로 찍어 보호자에게 전송한다',
    answer: 'X',
    explanation: '검사결과·진료내용 등 개인정보를 임의로 촬영·전달하는 것은 금지행위입니다.',
  },
  {
    id: 'ox_6',
    category: '이용자 금전 대리 사용',
    prompt: '이용자의 카드 비밀번호를 전달받아 대신 결제한다',
    answer: 'X',
    explanation: '이용자의 금전을 대리로 사용하거나 비밀번호를 전달받아 결제하는 것은 금지행위입니다.',
  },
];

export const TOTAL_SCORED_QUESTIONS = MANDATORY_LOCATIONS.length + OX_QUESTIONS.length;
