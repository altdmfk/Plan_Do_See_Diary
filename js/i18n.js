/**
 * Plan-Do-See Diary - Internationalization (i18n) Engine
 * Default language: Korean ('ko'). Supports English ('en').
 * Keeps 'Plan', 'Do', 'See' in English as per specifications.
 */

export const I18N = {
  ko: {
    appTitle: 'Plan-Do-See Diary',
    themePink: '핑크',
    themeForest: '포레스트',
    themeDark: '다크',
    langKo: '한국어',
    langEn: 'English',
    exportBtn: '내보내기',
    importBtn: '가져오기',
    resetBtn: '데이터 초기화',
    newPlanBtn: '+ 새 계획',
    allPlans: '전체 계획',
    searchPlaceholder: '계획, 할 일, 태그 검색',
    allPlanPriorities: '전체',
    allTodoPriorities: '전체',
    allPriorities: '전체',
    allStatus: '상태: 전체',
    statusInProgress: '진행 중',
    statusCompleted: '완료됨',
    statusDelayed: '지연됨',
    sortDueDate: '마감일',
    sortStartDate: '시작일',
    sortPriority: '우선순위',
    sortCreated: '최신 등록',
    colPlanTitle: '1. Plan',
    colDoTitle: '2. Do',
    colSeeTitle: '3. See',
    addPlanBtn: '+ 추가',
    addTodoBtn: '+ 추가',
    reflectBtn: '회고 작성',
    
    // Priorities
    priorityUrgent: '긴급',
    priorityHigh: '높음',
    priorityMedium: '보통',
    priorityLow: '낮음',

    // Empty States
    emptyPlanTitle: '등록된 계획이 없습니다',
    emptyPlanDesc: '이번 주기의 계획이 없습니다. 새 계획을 등록하여 목표를 설정하세요.',
    emptyDoTitle: '모두 완료되었습니다!',
    emptyDoDesc: '계획을 세우면 실행할 항목들이 여기에 표시됩니다.',
    emptySeeTitle: '분석 데이터 없음',
    emptySeeDesc: 'Do 단계에서 할 일을 완료하면 분석 및 회고 루프가 활성화됩니다.',

    // Card Actions
    selectedBadge: '선택됨',
    historyBtn: '수정 이력',
    editBtn: '수정',
    deleteBtn: '삭제',
    logTimeBtn: '시간 기록',
    dueLabel: '마감일:',
    targetLabel: '목표 기준:',
    delayedBadge: '[지연]',
    blockedReasonLabel: '진행 차단 사유:',
    hoursUnit: '시간',
    minutesUnit: '분',
    tzLabel: 'KST',

    // See Metrics
    metricPlanned: '계획 건수',
    metricCompleted: '완료 건수',
    metricDelayed: '지연 건수',
    metricBlocked: '막힘 건수',
    metricTimeDelta: '실행 시간 차이',
    estimatedLabel: '예상 시간:',
    actualLabel: '실제 시간:',
    varianceLabel: '시간 차이:',
    feedbackLoopTitle: 'Plan 개선 반영',
    feedbackLoopDesc: '지난 실행 분석과 인사이트를 다음 계획 수립에 바로 연결합니다.',
    advanceFeedbackBtn: '피드백 개선 계획',
    previousReflectionsTitle: '이전 회고 기록',

    // Modals
    createPlanTitle: '새 계획 작성',
    editPlanTitle: '계획 수정',
    planTitleLabel: '계획 목표 / 제목 *',
    planTitlePlaceholder: '예: 이번 주 건강 관리 및 운동 루틴 실천',
    startDateLabel: '시작일 (KST) *',
    endDateLabel: '종료일 (KST) *',
    priorityLabel: '우선순위',
    estimatedHoursLabel: '예상 소요 시간 (분)',
    estimatedHoursPlaceholder: '예: 600',
    successCriteriaLabel: '목표 달성 기준',
    successCriteriaPlaceholder: '예: 주 4회 운동 완료 및 하루 물 2L 마시기',
    revisionReasonLabel: '수정 사유',
    revisionReasonPlaceholder: '계획을 변경하는 이유를 입력하세요',
    cancelBtn: '취소',
    savePlanBtn: '계획 저장',

    addTodoTitle: '새 할 일 추가',
    editTodoTitle: '할 일 수정',
    linkedPlanLabel: '연결된 계획 *',
    todoTitleLabel: '할 일 제목 *',
    todoTitlePlaceholder: '예: 퇴근 후 헬스장에서 런닝머신 40분 뛰기',
    dueDateLabel: '마감일 (KST) *',
    estimatedMinutesLabel: '예상 소요 시간 (분)',
    tagsLabel: '태그 (쉼표로 구분)',
    tagsPlaceholder: '예: 운동, 건강, 습관',
    descriptionLabel: '상세 설명',
    descriptionPlaceholder: '예: 스트레칭 10분, 러닝 30분 진행하기',
    saveTodoBtn: '할 일 저장',

    execLoggerTitle: 'Do 실행 기록',
    liveTimerLabel: '실시간 측정 타이머',
    startTimerBtn: '타이머 시작',
    stopTimerBtn: '타이머 정지',
    resetTimerBtn: '초기화',
    startTimeLabel: '시작 일시',
    endTimeLabel: '종료 일시',
    actualMinutesLabel: '실제 소요 시간 (분) *',
    blockedInputLabel: '진행 차단 사유',
    blockedInputPlaceholder: '진행 중 지연되거나 차단된 원인이 있다면 적어주세요 (예: 늦은 퇴근)',
    saveLogOnlyBtn: '기록만 저장',
    completeAndLogBtn: '완료 처리 및 기록 저장',

    historyModalTitle: '계획 수정 이력',
    noHistoryText: '이전 수정 이력이 없습니다.<br>계획을 수정할 때 자동으로 이전 버전 스냅샷이 보존됩니다.',
    revisionNumberLabel: '버전 #',

    seeModalTitle: '회고 작성',
    reviewDateLabel: '회고 평가일 (KST) *',
    insightLabel: '개선 인사이트 및 회고 내용 *',
    insightPlaceholder: '예: 평일 저녁 피로감으로 운동이 미뤄짐. 다음 주에는 아침 가벼운 산책으로 루틴을 분산하기로 함.',
    saveReflectionBtn: '회고 저장',

    dirtyModalTitle: '저장되지 않은 변경사항',
    dirtyModalBody: '입력 중인 변경사항이 있습니다. 취소하고 나가시겠습니까, 아니면 계속 작성하시겠습니까?',
    keepEditingBtn: '계속 작성',
    discardBtn: '변경사항 취소',

    resetModalTitle: '데이터 초기화 및 관리',
    resetModalBody: '내 계정의 데이터를 0건으로 비우거나, 예시 데이터를 다시 채울 수 있습니다.',
    resetSeedBtn: '예시 데이터 생성',
    resetConfirmBtn: '0건으로 완전 초기화',
    loadExampleBtn: '예시 데이터 생성',
    loadExampleSuccess: '예시 데이터가 생성되었습니다.',

    importModalTitle: 'JSON 백업 파일 가져오기',
    importModalDesc: '유효한 Plan-Do-See 백업 JSON 파일(최대 5MB)을 선택하세요. 이전 버전 스키마(v1) 자동 변환 및 무결성 검증이 지원됩니다.',
    importSubmitBtn: '가져오기 및 복원',

    // Validation & Toasts
    onlyNumbersAllowed: '숫자만 입력 가능합니다.',
    timeRangeError: '종료 시간은 시작 시간 이후여야 합니다.',
    dateRangeError: '종료일은 시작일 이후여야 합니다.',
    minDurationRequired: '예상 소요 시간은 최소 1분 이상이어야 합니다.',
    textTooLong: '입력 내용이 너무 깁니다. (최대 {max}자)',
    todoDueDateExceedsPlan: '할 일 마감일은 계획 종료일({date}) 이후로 설정할 수 없습니다.',
    planHoursLessThanTodos: '계획 목표 시간({hours}분)은 등록된 할 일들의 예상 시간 합계({todoMinutes}분)보다 작을 수 없습니다.',
    todosExceedPlanHours: '할 일들의 예상 시간 합계({totalMinutes}분)가 계획의 목표 시간({planHours}분)을 초과할 수 없습니다.',
    planSaved: '계획이 저장되었습니다.',
    planUpdated: '계획이 수정되고 이전 버전이 스냅샷으로 보존되었습니다.',
    replicateTodosLabel: '이전 계획의 할 일(Do) 목록도 함께 복제하기',
    feedbackPlanCreatedWithTodos: '피드백 개선 계획과 할 일이 함께 생성되었습니다.',
    planDeleted: '계획이 삭제되었습니다.',
    todoAdded: '새로운 할 일이 추가되었습니다.',
    todoUpdated: '할 일이 수정되었습니다.',
    todoDeleted: '할 일이 삭제되었습니다.',
    todoCompleted: '할 일을 완료 처리했습니다.',
    todoInProgress: '할 일을 진행 중으로 변경했습니다.',
    scopeSwitched: '세션 스코프가 전환되었습니다 (새로운 데이터가 로드되었습니다).',
    themeChanged: '테마가 변경되었습니다.',
    langChanged: '언어가 한국어로 설정되었습니다.',
    backupExported: 'JSON 백업 파일이 저장되었습니다.',
    backupImported: '백업 데이터가 성공적으로 복원되었습니다 (중복 행 0건).',
    resetSuccess: '데이터가 0건으로 초기화되었습니다.',
    selectPlanFirst: '먼저 계획을 선택해 주세요.',
    noChangesMade: '변경된 계획 내용이 없습니다.',
    tagFilterActive: '태그 필터',
    actionDuplicate: '이미 처리된 요청입니다.',
    fileReadFailed: '파일을 읽는데 실패했습니다.',
    importErrorPrefix: '가져오기 오류: ',
    enterPlanTitle: '계획 제목을 입력하세요.',
    enterTodoTitle: '할 일 제목을 입력하세요.',
    enterInsight: '개선 인사이트 및 회고 내용을 입력하세요.'
  },

  en: {
    appTitle: 'Plan-Do-See Diary',
    themePink: 'Pink',
    themeForest: 'Forest',
    themeDark: 'Dark',
    langKo: '한국어',
    langEn: 'English',
    exportBtn: 'Export',
    importBtn: 'Import',
    resetBtn: 'Reset',
    newPlanBtn: '+ New Plan',
    allPlans: 'All Plans',
    searchPlaceholder: 'Search Plans, To Dos, tags',
    allPlanPriorities: 'All',
    allTodoPriorities: 'All',
    allPriorities: 'All',
    allStatus: 'Status: All',
    statusInProgress: 'In Progress',
    statusCompleted: 'Completed',
    statusDelayed: 'Delayed',
    sortDueDate: 'Due Date',
    sortStartDate: 'Start Date',
    sortPriority: 'Priority',
    sortCreated: 'Recently Added',
    colPlanTitle: '1. Plan',
    colDoTitle: '2. Do',
    colSeeTitle: '3. See',
    addPlanBtn: '+ Add',
    addTodoBtn: '+ Add',
    reflectBtn: 'Write Reflection',

    // Priorities
    priorityUrgent: 'Urgent',
    priorityHigh: 'High',
    priorityMedium: 'Medium',
    priorityLow: 'Low',

    // Empty States
    emptyPlanTitle: 'No active plans',
    emptyPlanDesc: 'No active plans for this cycle. Click New Plan or generate examples to structure your goals.',
    emptyDoTitle: 'All clear!',
    emptyDoDesc: 'Plan items will appear here as actionable To Dos. Add a To Do to start execution.',
    emptySeeTitle: 'No analytics data',
    emptySeeDesc: 'Complete tasks in the Do stage to unlock analytics and reflection loops.',

    // Card Actions
    selectedBadge: 'Selected',
    historyBtn: 'History',
    editBtn: 'Edit',
    deleteBtn: 'Delete',
    logTimeBtn: 'Log Time',
    dueLabel: 'Due:',
    targetLabel: 'Target:',
    delayedBadge: '[Delayed]',
    blockedReasonLabel: 'Blocked Reason:',
    hoursUnit: 'h',
    minutesUnit: 'm',
    tzLabel: 'KST',

    // See Metrics
    metricPlanned: 'Planned',
    metricCompleted: 'Completed',
    metricDelayed: 'Delayed',
    metricBlocked: 'Blocked',
    metricTimeDelta: 'Execution Time Delta',
    estimatedLabel: 'Estimated:',
    actualLabel: 'Actual:',
    varianceLabel: 'Variance:',
    feedbackLoopTitle: 'Plan Feedback Loop',
    feedbackLoopDesc: 'Connect retrospective adjustments and learnings directly into the next Plan cycle.',
    advanceFeedbackBtn: 'Advance Feedback Plan',
    previousReflectionsTitle: 'Previous Reflections',

    // Modals
    createPlanTitle: 'Create Plan',
    editPlanTitle: 'Edit Plan',
    planTitleLabel: 'Plan Goal / Title *',
    planTitlePlaceholder: 'e.g. Weekly Health & Fitness Routine',
    startDateLabel: 'Start Date (KST) *',
    endDateLabel: 'End Date (KST) *',
    priorityLabel: 'Priority',
    estimatedHoursLabel: 'Estimated Time',
    estimatedHoursPlaceholder: 'e.g. 600',
    successCriteriaLabel: 'Success Criteria',
    successCriteriaPlaceholder: 'e.g. Complete 4 workout sessions and drink 2L water daily',
    revisionReasonLabel: 'Revision Reason',
    revisionReasonPlaceholder: 'Why is this plan being updated?',
    cancelBtn: 'Cancel',
    savePlanBtn: 'Save Plan',

    addTodoTitle: 'Add To Do',
    editTodoTitle: 'Edit To Do',
    linkedPlanLabel: 'Linked Plan *',
    todoTitleLabel: 'To Do Title *',
    todoTitlePlaceholder: 'e.g. 40 minutes treadmill workout at the gym',
    dueDateLabel: 'Due Date (KST) *',
    estimatedMinutesLabel: 'Estimated Time',
    tagsLabel: 'Tags (comma-separated)',
    tagsPlaceholder: 'e.g. Workout, Health, Habits',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'e.g. 10 min warm-up stretch, 30 min jog',
    saveTodoBtn: 'Save To Do',

    execLoggerTitle: 'Do Execution Logger',
    liveTimerLabel: 'Live Elapsed Time',
    startTimerBtn: 'Start Timer',
    stopTimerBtn: 'Stop Timer',
    resetTimerBtn: 'Reset Timer',
    startTimeLabel: 'Start Time',
    endTimeLabel: 'End Time',
    actualMinutesLabel: 'Actual Elapsed Minutes *',
    blockedInputLabel: 'Blocked Reason',
    blockedInputPlaceholder: 'If execution was delayed, describe what blocked progress (e.g. Overtime)',
    saveLogOnlyBtn: 'Save Log Only',
    completeAndLogBtn: 'Complete & Save Log',

    historyModalTitle: 'Revision History',
    noHistoryText: 'No previous revisions recorded yet.<br>Revisions are created automatically when a plan is updated.',
    revisionNumberLabel: 'Revision #',

    seeModalTitle: 'Retrospective Reflection',
    reviewDateLabel: 'Review Evaluation Date (KST) *',
    insightLabel: 'Adjustment Insight / Retrospective *',
    insightPlaceholder: 'e.g. Evening workouts were delayed due to fatigue. Plan to shift 2 sessions to the morning next cycle.',
    saveReflectionBtn: 'Save Reflection',

    dirtyModalTitle: 'Unsaved Changes',
    dirtyModalBody: 'You have unsaved changes in this form. Do you want to discard them or keep editing?',
    keepEditingBtn: 'Keep Editing',
    discardBtn: 'Discard Changes',

    resetModalTitle: 'Reset & Manage Data',
    resetModalBody: 'You can purge your account data to 0 rows or reload example data.',
    resetSeedBtn: 'Generate Examples',
    resetConfirmBtn: 'Purge to 0 Items',
    loadExampleBtn: 'Generate Examples',
    loadExampleSuccess: 'Example data generated successfully.',

    importModalTitle: 'Import JSON Backup',
    importModalDesc: 'Select a valid Plan-Do-See JSON backup file (max 5MB). Automatic legacy v1 migration and atomic rollback validation are enabled.',
    importSubmitBtn: 'Import & Restore',

    // Validation & Toasts
    onlyNumbersAllowed: 'Only numbers are allowed.',
    timeRangeError: 'End time must be after start time.',
    dateRangeError: 'End date must be after start date.',
    minDurationRequired: 'Estimated duration must be at least 1 minute.',
    textTooLong: 'Input text is too long (Max {max} characters).',
    todoDueDateExceedsPlan: 'To Do due date cannot be after the plan end date ({date}).',
    planHoursLessThanTodos: 'Plan estimated time ({hours}m) cannot be less than the total To Do estimated time ({todoMinutes}m).',
    todosExceedPlanHours: 'Total To Do estimated minutes ({totalMinutes}m) cannot exceed the plan target ({planHours}m).',
    planSaved: 'Plan saved successfully.',
    planUpdated: 'Plan updated and revision snapshot saved.',
    replicateTodosLabel: 'Replicate tasks (Do) from previous plan',
    feedbackPlanCreatedWithTodos: 'Feedback plan and tasks replicated successfully.',
    planDeleted: 'Plan deleted successfully.',
    todoAdded: 'To Do added to plan.',
    todoUpdated: 'To Do updated successfully.',
    todoDeleted: 'To Do deleted.',
    todoCompleted: 'To Do marked as completed.',
    todoInProgress: 'To Do moved to In Progress.',
    scopeSwitched: 'Switched session scope (Clean state loaded).',
    themeChanged: 'Theme changed.',
    langChanged: 'Language set to English.',
    backupExported: 'Backup JSON exported successfully.',
    backupImported: 'Backup restored and migrated successfully (0 duplicate rows).',
    resetSuccess: 'Data purged to 0 rows.',
    selectPlanFirst: 'Please select a plan first.',
    noChangesMade: 'No changes were made to the plan.',
    tagFilterActive: 'Tag Filter',
    actionDuplicate: 'Action already recorded.',
    fileReadFailed: 'Failed to read file from disk.',
    importErrorPrefix: 'Import Error: ',
    enterPlanTitle: 'Please enter a plan title.',
    enterTodoTitle: 'Please enter a To Do title.',
    enterInsight: 'Please enter retrospective insight.'
  }
};

class I18nManager {
  constructor() {
    this.currentLang = (typeof localStorage !== 'undefined' && localStorage.getItem('pds_active_lang')) || 'ko';
  }

  getLang() {
    return this.currentLang;
  }

  setLang(lang) {
    if (lang !== 'ko' && lang !== 'en') return;
    this.currentLang = lang;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pds_active_lang', lang);
    }
  }

  t(key) {
    const dict = I18N[this.currentLang] || I18N.ko;
    return dict[key] || I18N.ko[key] || key;
  }
}

export const i18n = new I18nManager();
