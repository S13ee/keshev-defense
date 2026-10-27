// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
let eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
// 20단계: 패키지 조회 요청과 응답을 연결하는 상태입니다. 표시 결과는 저장하지 않고, 지금 기다리는 요청이 있는지와 마지막으로 받아들인 응답의 식별값·조회 시각만 기억합니다.
// phase: initial(아직 본 요청 없음) · loading(현재 요청 진행 중) · cancelled(취소함) · failed(실패함) · accepted(현재 요청의 응답을 받아들임)
let vulnerabilityLookupState = { phase: 'initial', acceptedKey: null, acceptedAt: null };

export function createStudentView({ api, onChange } = {}) {
  // ---------- 마지막 총공세 2일차: 내 PC 점검 ----------
  // 버튼을 누를 때만 /api/pc/status 를 한 번 읽습니다. 그리기(renderStatus)나 onChange 에서는 조회하지 않습니다.
  // 읽은 값은 숫자·켜짐/꺼짐만 이 브라우저 저장소에 남겨 평소 범위를 만듭니다. 비밀값·개인정보·기록 본문은 저장하지 않습니다.
  const PC_PATH = '/api/pc/status';
  const PC_SCHEMA = 'aleph.on.pc-status.v1';
  const PC_STALE_MS = 60 * 1000;
  const HISTORY_KEY = 'keshev.pc-check.history.v1';
  const HISTORY_LIMIT = 60;
  const BASELINE_MIN = 5;
  const BASELINE_WINDOW = 20;
  let pcCheck = { status: 'idle' };
  let pcGeneration = 0;
  let pcRoot = null;
  let pendingFocusKey = null;
  const notifyChange = () => { if (typeof onChange === 'function') onChange(); };
  const pcIsRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const pcFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const pcCount = (value) => Number.isSafeInteger(value) && value >= 0;

  const storage = (() => {
    try {
      const store = globalThis.localStorage;
      if (!store) return null;
      const probe = '__keshev_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    } catch {
      return null;
    }
  })();
  const validEntry = (entry) => pcIsRecord(entry) && typeof entry.t === 'string' && Number.isFinite(Date.parse(entry.t));
  let pcHistory = (() => {
    if (!storage) return [];
    try {
      const parsed = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(validEntry).slice(-HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  })();
  let historySaved = Boolean(storage);
  const saveHistory = () => {
    if (!storage) { historySaved = false; return; }
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(pcHistory));
      historySaved = true;
    } catch {
      historySaved = false;
    }
  };

  const REASONS = {
    permission_denied: '권한 부족',
    timeout: '시간 초과',
    unsupported: '이 PC에서 지원 안 됨',
    cancelled: '취소됨',
    query_failed: '조회 실패',
    invalid_response: '응답 형식 확인 불가',
    invalid_sample: '표본 확인 불가',
  };
  const reasonText = (metric) => {
    const reason = pcIsRecord(metric) && typeof metric.reason === 'string' ? metric.reason : '';
    return REASONS[reason] ?? (reason ? `확인 불가(받은 값: ${reason.slice(0, 40)})` : '응답에 값 없음');
  };
  const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const pct = (value) => `${value.toFixed(1)}%`;
  const kstText = (iso) => {
    const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return '시각 확인 불가';
    const k = new Date(ms + 9 * 60 * 60 * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(k.getUTCFullYear(), 4)}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())} (한국 시각)`;
  };
  const ageText = (ms) => {
    if (ms < 60 * 1000) return '1분 이내';
    if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}분 전`;
    if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3600000)}시간 전`;
    return `${Math.floor(ms / 86400000)}일 전`;
  };

  // 응답의 항목마다 실측 여부를 따로 판정합니다. 응답이 왔다는 것과 항목을 읽었다는 것은 다릅니다.
  const readMetrics = (metrics) => {
    const m = pcIsRecord(metrics) ? metrics : {};
    const items = {};
    const cpu = m.cpu;
    items.cpu = cpu?.state === 'ok' && pcFinite(cpu.usagePercent) && cpu.usagePercent <= 100
      ? { ok: true, value: cpu.usagePercent, text: `${pct(cpu.usagePercent)} 사용`, note: `${pcFinite(cpu.sampleMs) ? cpu.sampleMs : '확인 불가'}ms 표본 1회 · 순간 값입니다` }
      : { ok: false, reason: reasonText(cpu) };
    const mem = m.memory;
    items.memory = mem?.state === 'ok' && pcFinite(mem.usedBytes) && pcFinite(mem.totalBytes) && mem.totalBytes > 0 && mem.usedBytes <= mem.totalBytes
      ? { ok: true, value: (mem.usedBytes / mem.totalBytes) * 100, text: `${gb(mem.usedBytes)} / ${gb(mem.totalBytes)} 사용 (${pct((mem.usedBytes / mem.totalBytes) * 100)})`, note: '사용 중인 메모리 / 전체 메모리' }
      : { ok: false, reason: reasonText(mem) };
    const disk = m.disk;
    items.disk = disk?.state === 'ok' && pcFinite(disk.freeBytes) && pcFinite(disk.totalBytes) && disk.totalBytes > 0 && disk.freeBytes <= disk.totalBytes
      ? { ok: true, value: (disk.freeBytes / disk.totalBytes) * 100, text: `${gb(disk.freeBytes)} 여유 / ${gb(disk.totalBytes)} (${pct((disk.freeBytes / disk.totalBytes) * 100)} 여유)`, note: '앱이 있는 드라이브 기준' }
      : { ok: false, reason: reasonText(disk) };
    const net = m.network;
    items.network = net?.state === 'ok' && pcCount(net.interfaceCount) && pcCount(net.ipv4Count)
      ? { ok: true, interfaces: net.interfaceCount, ipv4: net.ipv4Count, text: `인터페이스 ${net.interfaceCount}개 · IPv4 구성 ${net.ipv4Count}개`, note: '로컬 구성 요약 · 인터넷 접속이나 접속 허용을 확인한 결과가 아님' }
      : { ok: false, reason: reasonText(net) };
    const fw = m.firewall;
    const names = ['Domain', 'Private', 'Public'];
    const profiles = fw?.state === 'ok' && Array.isArray(fw.profiles) && fw.profiles.length === 3
      && names.every((name) => fw.profiles.some((p) => pcIsRecord(p) && p.name === name && typeof p.enabled === 'boolean'))
      ? Object.fromEntries(names.map((name) => [name, fw.profiles.find((p) => p.name === name).enabled]))
      : null;
    items.firewall = profiles
      ? { ok: true, profiles, text: names.map((name) => `${name} ${profiles[name] ? '켜짐' : '꺼짐'}`).join(' · '), note: '설정을 읽기만 함 · 켜져 있어도 보호 전체의 안전 판정이 아님' }
      : { ok: false, reason: reasonText(fw) };
    const ev = m.events;
    items.events = ev?.state === 'ok' && pcCount(ev.warningCount) && pcCount(ev.errorCount) && typeof ev.truncated === 'boolean'
      ? { ok: true, warnings: ev.warningCount, errors: ev.errorCount, truncated: ev.truncated, text: `최근 24시간 경고 ${ev.warningCount}건 · 오류 ${ev.errorCount}건${ev.truncated ? ' · 일부 집계(최대 5,000건)' : ''}`, note: 'System·Application 기록 건수 · 침해나 사고 판정이 아님 · 기록 내용은 읽지 않음' }
      : { ok: false, reason: reasonText(ev) };
    return items;
  };

  const classify = (result) => {
    if (!pcIsRecord(result) || result.ok !== true) {
      const code = pcIsRecord(result) && pcIsRecord(result.error) && typeof result.error.code === 'string' ? result.error.code.slice(0, 60) : '코드 없음';
      return code === 'NOT_ALLOWED' ? { status: 'unsupported', code } : { status: 'failed', code };
    }
    const data = pcIsRecord(result.data) ? result.data : null;
    const measured = data && typeof data.measuredAt === 'string' ? Date.parse(data.measuredAt) : NaN;
    if (!data || data.schema !== PC_SCHEMA || data.source !== 'local-pc' || !Number.isFinite(measured)) {
      return { status: 'unverifiable', code: 'PC_SHAPE_UNVERIFIED' };
    }
    return { status: 'ok', measuredAt: data.measuredAt, items: readMetrics(data.metrics) };
  };

  const remember = (check) => {
    const it = check.items;
    const entry = {
      t: check.measuredAt,
      cpu: it.cpu.ok ? Math.round(it.cpu.value * 10) / 10 : null,
      mem: it.memory.ok ? Math.round(it.memory.value * 10) / 10 : null,
      disk: it.disk.ok ? Math.round(it.disk.value * 10) / 10 : null,
      net: it.network.ok ? { i: it.network.interfaces, v4: it.network.ipv4 } : null,
      fw: it.firewall.ok ? { ...it.firewall.profiles } : null,
      ev: it.events.ok ? { w: it.events.warnings, e: it.events.errors, tr: it.events.truncated } : null,
    };
    if (pcHistory.length && pcHistory[pcHistory.length - 1].t === entry.t) return;
    pcHistory = [...pcHistory, entry].slice(-HISTORY_LIMIT);
    saveHistory();
  };

  // ---------- 마지막 총공세 3일차: 지난 점검과 비교해 바뀐 것 찾기 ----------
  // 기준(학생이 정함): 방화벽 켜짐→꺼짐 · 디스크 여유 평소 최저보다 5%p 넘게 감소 또는 10% 미만 · 메모리 평소 최고보다 10%p 넘게 높음
  // · Windows 오류 수 평소 최고보다 많음 · 네트워크 개수 바뀜(참고) · CPU 3번 연속 평소 최고보다 높음(참고) · 이전엔 읽혔는데 지금 확인 불가(확인 필요).
  // 평소 범위가 필요한 비교는 지난 점검이 5회 미만이면 하지 않습니다. 결과는 저장하지 않고 점검 기록에서 매번 다시 계산합니다.
  const RULE = { DISK_DROP: 5, DISK_FLOOR: 10, MEM_RISE: 10, CPU_STREAK: 3 };
  const PC_LABELS = { cpu: 'CPU', memory: '메모리', disk: '디스크', network: '네트워크', firewall: 'Windows 방화벽', events: 'Windows 기록' };
  const KIND_TEXT = { todo: '할 일', check: '확인 필요', note: '참고' };
  const KIND_ORDER = { todo: 0, check: 1, note: 2 };
  const shortTime = (iso) => {
    const full = kstText(iso);
    return full === '시각 확인 불가' ? full : full.slice(5, 16).replace('-', '/');
  };
  const detectChanges = (currentT) => {
    const idx = pcHistory.map((entry) => entry.t).lastIndexOf(currentT);
    if (idx < 0) return { compared: false, list: [] };
    const now = pcHistory[idx];
    const prev = pcHistory.slice(0, idx);
    if (!prev.length) return { compared: false, list: [] };
    const list = [];
    const add = (item, kind, title, evidence, hint) => list.push({ item, kind, title, evidence, hint });
    const lastWith = (pick) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const value = pick(prev[i]);
        if (value != null) return { t: prev[i].t, value };
      }
      return null;
    };
    const numbers = (from, pick) => from.map(pick).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-BASELINE_WINDOW);

    // 이전엔 읽혔는데 이번엔 읽지 못한 항목
    const picks = { cpu: (e) => e.cpu, memory: (e) => e.mem, disk: (e) => e.disk, network: (e) => e.net, firewall: (e) => e.fw, events: (e) => e.ev };
    for (const [item, pick] of Object.entries(picks)) {
      if (pick(now) != null) continue;
      const last = lastWith(pick);
      if (last) add(item, 'check', `${PC_LABELS[item]} 값을 이번에 읽지 못함`, `이전(${shortTime(last.t)}) 읽힘 → 지금 확인 불가`, '「내 PC 점검」을 다시 눌러 보고, 계속되면 권한이나 Windows 서비스 상태를 확인하세요');
    }

    // 방화벽: 평소 범위 없이 바로 비교
    const fwLast = pcIsRecord(now.fw) ? lastWith((e) => (pcIsRecord(e.fw) ? e.fw : null)) : null;
    if (fwLast) {
      for (const name of ['Domain', 'Private', 'Public']) {
        const before = fwLast.value[name];
        const after = now.fw[name];
        if (before === true && after === false) add('firewall', 'todo', `방화벽 ${name} 프로필이 꺼짐`, `이전(${shortTime(fwLast.t)}) 켜짐 → 지금 꺼짐`, 'Windows 보안 › 방화벽 및 네트워크 보호에서 직접 확인하세요 · 이 앱은 설정을 바꾸지 않습니다');
        if (before === false && after === true) add('firewall', 'note', `방화벽 ${name} 프로필이 다시 켜짐`, `이전(${shortTime(fwLast.t)}) 꺼짐 → 지금 켜짐`, '할 일 없음');
      }
    }

    // 디스크 여유
    if (typeof now.disk === 'number') {
      const values = numbers(prev, (e) => e.disk);
      const low = values.length ? Math.min(...values) : null;
      if (now.disk < RULE.DISK_FLOOR) {
        add('disk', 'todo', `디스크 여유 공간이 ${RULE.DISK_FLOOR}% 미만`, `지금 ${now.disk.toFixed(1)}% 여유${low != null ? ` · 지난 점검 최저 ${low.toFixed(1)}% 여유` : ''}`, '필요 없는 큰 파일, 다운로드 폴더, 휴지통을 직접 확인하세요');
      } else if (values.length >= BASELINE_MIN && now.disk < low - RULE.DISK_DROP) {
        add('disk', 'todo', '디스크 여유가 평소보다 크게 줄었음', `평소(지난 ${values.length}회) 최저 ${low.toFixed(1)}% 여유 → 지금 ${now.disk.toFixed(1)}% 여유 (${(low - now.disk).toFixed(1)}%p 감소)`, '최근 설치하거나 내려받은 큰 파일을 직접 확인하세요');
      }
    }

    // 메모리
    if (typeof now.mem === 'number') {
      const values = numbers(prev, (e) => e.mem);
      if (values.length >= BASELINE_MIN) {
        const high = Math.max(...values);
        if (now.mem > high + RULE.MEM_RISE) add('memory', 'todo', '메모리 사용이 평소보다 높음', `평소(지난 ${values.length}회) 최고 ${high.toFixed(1)}% → 지금 ${now.mem.toFixed(1)}% (${(now.mem - high).toFixed(1)}%p 높음)`, '작업 관리자(Ctrl+Shift+Esc) › 프로세스에서 메모리를 많이 쓰는 앱을 확인하세요');
      }
    }

    // Windows 오류 수 (경고는 흔해서 비교하지 않음)
    if (pcIsRecord(now.ev) && pcCount(now.ev.e)) {
      const values = numbers(prev, (e) => (pcIsRecord(e.ev) ? e.ev.e : null));
      if (values.length >= BASELINE_MIN) {
        const high = Math.max(...values);
        if (now.ev.e > high) add('events', 'todo', 'Windows 오류 기록이 평소보다 많음', `평소(지난 ${values.length}회) 최고 ${high}건 → 지금 ${now.ev.e}건 (최근 24시간)${now.ev.tr ? ' · 일부 집계' : ''}`, '이벤트 뷰어 › Windows 로그 › 시스템·응용 프로그램에서 오류를 직접 확인하세요 · 이 앱은 기록 내용을 읽지 않습니다');
      }
    }

    // 네트워크 개수 (참고)
    const netLast = pcIsRecord(now.net) ? lastWith((e) => (pcIsRecord(e.net) ? e.net : null)) : null;
    if (netLast && (netLast.value.i !== now.net.i || netLast.value.v4 !== now.net.v4)) {
      add('network', 'note', '네트워크 구성 개수가 바뀜', `이전(${shortTime(netLast.t)}) 인터페이스 ${netLast.value.i}개·IPv4 ${netLast.value.v4}개 → 지금 ${now.net.i}개·${now.net.v4}개`, 'VPN·와이파이·유선 연결을 바꿨다면 자연스러운 변화입니다');
    }

    // CPU: 순간 값이라 3번 연속 평소 최고보다 높을 때만 참고로 표시
    const run = [...prev.slice(-(RULE.CPU_STREAK - 1)), now];
    if (run.length === RULE.CPU_STREAK && run.every((e) => typeof e.cpu === 'number')) {
      const values = numbers(prev.slice(0, prev.length - (RULE.CPU_STREAK - 1)), (e) => e.cpu);
      if (values.length >= BASELINE_MIN) {
        const high = Math.max(...values);
        if (run.every((e) => e.cpu > high)) add('cpu', 'note', `CPU 사용이 ${RULE.CPU_STREAK}번 연속 평소보다 높음`, `평소(그 전 ${values.length}회) 최고 ${high.toFixed(1)}% → 최근 ${RULE.CPU_STREAK}번 ${run.map((e) => `${e.cpu.toFixed(1)}%`).join(' · ')}`, '작업 관리자 › 프로세스에서 CPU를 많이 쓰는 앱을 확인하세요 · 보안 문제라는 뜻은 아닙니다');
      }
    }

    list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    return { compared: true, previousT: prev[prev.length - 1].t, previousCount: prev.length, list };
  };

  async function runPcCheck() {
    if (pcCheck.status === 'loading') return;
    if (!api || typeof api.get !== 'function') {
      pcCheck = { status: 'unsupported', code: 'NO_STUDENT_API' };
      notifyChange();
      return;
    }
    const own = ++pcGeneration;
    pcCheck = { status: 'loading' };
    notifyChange();
    let result;
    try { result = await api.get(PC_PATH); } catch { result = { ok: false, error: { code: 'CLIENT_ERROR' } }; }
    if (own !== pcGeneration) return;
    pcCheck = classify(result);
    if (pcCheck.status === 'ok') remember(pcCheck);
    notifyChange();
  }

  // 평소 범위: 이번 점검을 뺀 지난 점검 값으로만 만듭니다. 표본이 모자라면 비교하지 않습니다.
  const baseline = (key, currentT, unit = '%') => {
    const values = pcHistory
      .filter((entry) => entry.t !== currentT && typeof entry[key] === 'number' && Number.isFinite(entry[key]))
      .slice(-BASELINE_WINDOW)
      .map((entry) => entry[key]);
    if (values.length < BASELINE_MIN) return `평소 값 모으는 중 ${values.length}/${BASELINE_MIN}회 · 아직 비교하지 않음`;
    return `평소(지난 ${values.length}회) ${Math.min(...values).toFixed(1)}${unit} ~ ${Math.max(...values).toFixed(1)}${unit}`;
  };
  const eventBaseline = (currentT) => {
    const values = pcHistory
      .filter((entry) => entry.t !== currentT && pcIsRecord(entry.ev) && pcCount(entry.ev.e))
      .slice(-BASELINE_WINDOW)
      .map((entry) => entry.ev.e);
    if (values.length < BASELINE_MIN) return `평소 값 모으는 중 ${values.length}/${BASELINE_MIN}회 · 아직 비교하지 않음`;
    return `평소(지난 ${values.length}회) 오류 ${Math.min(...values)} ~ ${Math.max(...values)}건`;
  };

  const pcNode = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };

  function renderPcCheck() {
    const section = pcNode('section', 'event');
    section.setAttribute('aria-label', '내 PC 점검');
    const head = pcNode('div', 'event-head');
    head.append(pcNode('h3', null, '내 PC 점검'), pcNode('span', 'tag tag-student', '학생 구현 · 총공세'));
    section.append(head);
    section.append(pcNode('p', 'muted', '이 PC에서 실제로 잰 값만 보여 줍니다. 누를 때 한 번만 읽고, 스스로 다시 읽지 않습니다.'));
    section.append(pcNode('p', 'muted', '보안 서버(SDP) 연결과 상관없이 작동합니다. 보안 서버 연결 상태는 아래 「보안 서버 연결 상태」에 따로 표시하며, 이 점검 결과와 섞지 않습니다.'));

    const actions = pcNode('div', 'event-actions');
    const loading = pcCheck.status === 'loading';
    const button = pcNode('button', 'btn', loading ? '점검 중…' : '내 PC 점검');
    button.type = 'button';
    button.dataset.focusKey = 'pc-check';
    if (loading) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => { void runPcCheck(); });
    actions.append(button);
    section.append(actions);

    const status = (kind, text) => {
      const p = pcNode('p', `state state-${kind}`, text);
      p.setAttribute('role', 'status');
      section.append(p);
    };

    if (pcCheck.status === 'idle') status('empty', '아직 점검하지 않았습니다 · 확인 불가(조회 전)');
    else if (pcCheck.status === 'loading') status('loading', '점검 중… CPU 표본과 Windows 기록을 읽고 있습니다');
    else if (pcCheck.status === 'unsupported') status('empty', `지원 없음(${pcCheck.code}) · 이 앱에서는 학생 화면이 PC 값을 읽을 수 없습니다. 위쪽 「내 PC 상태」 제공 카드를 확인하세요`);
    else if (pcCheck.status === 'failed') status('error', `점검 실패(${pcCheck.code}) · 이전 값을 현재 상태로 보여 주지 않습니다 · 「내 PC 점검」을 다시 눌러 주세요`);
    else if (pcCheck.status === 'unverifiable') status('empty', `확인 불가(${pcCheck.code}) · 응답 형식을 확인하지 못해 값을 보여 주지 않습니다`);
    else if (pcCheck.status === 'ok') {
      const items = pcCheck.items;
      const labels = { cpu: 'CPU', memory: '메모리', disk: '디스크', network: '네트워크', firewall: 'Windows 방화벽', events: 'Windows 기록' };
      const keys = Object.keys(labels);
      const missing = keys.filter((key) => !items[key].ok);
      const age = Date.now() - Date.parse(pcCheck.measuredAt);
      const stale = !Number.isFinite(age) || age > PC_STALE_MS;
      const measuredCount = keys.length - missing.length;
      const coverage = measuredCount === 0
        ? `응답은 왔지만 6개 항목 모두 확인 불가 · 실측 0개`
        : `실측 ${measuredCount}/6${missing.length ? ` · 확인 불가 ${missing.length}개(${missing.map((key) => labels[key]).join(', ')})` : ''}`;
      status(stale ? 'empty' : (measuredCount ? 'ok' : 'empty'),
        `${stale ? '오래됨 · 현재 상태로 보지 않음 · ' : ''}${coverage} · 잰 시각 ${kstText(pcCheck.measuredAt)} · ${Number.isFinite(age) ? ageText(Math.max(0, age)) : '경과 시간 확인 불가'} · 출처 이 PC(local-pc)`);

      // 지난 점검과 비교한 결과를 칸 목록보다 먼저 보여 줍니다.
      const changes = detectChanges(pcCheck.measuredAt);
      const changeBox = pcNode('div', 'event');
      changeBox.setAttribute('data-pc-changes', changes.compared ? String(changes.list.length) : 'none');
      changeBox.append(pcNode('h4', null, `${stale ? '오래된 점검 기준 · ' : ''}지난 점검과 비교`));
      if (!changes.compared) {
        changeBox.append(pcNode('p', 'muted', '비교할 지난 점검이 없습니다 · 첫 점검은 비교하지 않습니다'));
      } else {
        const count = (kind) => changes.list.filter((c) => c.kind === kind).length;
        const urgent = count('todo') + count('check');
        changeBox.append(pcNode('p', urgent ? 'state state-error' : (changes.list.length ? 'state state-empty' : 'state state-ok'), changes.list.length
          ? `바뀐 것 ${changes.list.length}개 · 할 일 ${count('todo')} · 확인 필요 ${count('check')} · 참고 ${count('note')}`
          : `바뀐 것 없음 · 비교 대상: 바로 전 점검(${shortTime(changes.previousT)})${changes.previousCount >= BASELINE_MIN ? `과 평소 범위(지난 ${Math.min(changes.previousCount, BASELINE_WINDOW)}회)` : ''}`));
        if (changes.previousCount < BASELINE_MIN) {
          changeBox.append(pcNode('p', 'muted', `평소 범위 비교는 지난 점검이 ${BASELINE_MIN}회 모인 뒤 시작합니다(지금 ${changes.previousCount}회) · 지금은 방화벽·네트워크·읽기 실패·디스크 ${RULE.DISK_FLOOR}% 미만만 비교합니다`));
        }
        if (changes.list.length) {
          const ul = pcNode('ul', 'records');
          for (const change of changes.list) {
            const li = pcNode('li', 'event');
            li.setAttribute('data-change-kind', change.kind);
            const h = pcNode('div', 'event-head');
            h.append(pcNode('span', change.kind === 'note' ? 'tag' : 'tag tag-demo', KIND_TEXT[change.kind]), pcNode('span', 'item-title', change.title));
            li.append(h, pcNode('p', null, `근거: ${change.evidence}`), pcNode('p', 'muted', change.hint));
            ul.append(li);
          }
          changeBox.append(ul);
        }
      }
      section.append(changeBox);

      const changedBy = {};
      for (const change of changes.list) (changedBy[change.item] ??= []).push(change);

      const list = pcNode('ul', 'records');
      for (const key of keys) {
        const item = items[key];
        const li = pcNode('li', 'event');
        li.setAttribute('data-pc-item', key);
        if (changedBy[key]) li.setAttribute('data-changed', changedBy[key].map((c) => c.kind).join(' '));
        const itemHead = pcNode('div', 'event-head');
        itemHead.append(pcNode('span', 'item-title', labels[key]));
        itemHead.append(pcNode('span', item.ok ? 'tag' : 'tag tag-demo', item.ok ? (stale ? '실측 · 오래됨' : '실측') : '확인 불가'));
        li.append(itemHead);
        if (item.ok) {
          li.append(pcNode('p', null, item.text));
          li.append(pcNode('p', 'muted', item.note));
          if (key === 'cpu') li.append(pcNode('p', 'muted', `${baseline('cpu', pcCheck.measuredAt)} · 순간 값이라 ${RULE.CPU_STREAK}번 연속 평소 최고보다 높을 때만 참고로 알림`));
          if (key === 'memory') li.append(pcNode('p', 'muted', baseline('mem', pcCheck.measuredAt)));
          if (key === 'disk') li.append(pcNode('p', 'muted', baseline('disk', pcCheck.measuredAt, '% 여유')));
          if (key === 'events') li.append(pcNode('p', 'muted', eventBaseline(pcCheck.measuredAt)));
        } else {
          li.append(pcNode('p', null, `확인 불가 · ${item.reason}`));
          li.append(pcNode('p', 'muted', '0이나 예시 값으로 채우지 않습니다 · 정상으로 보지 않습니다'));
        }
        for (const change of changedBy[key] ?? []) {
          li.append(pcNode('p', change.kind === 'note' ? 'state state-empty' : 'state state-error', `바뀜(${KIND_TEXT[change.kind]}) · ${change.evidence}`));
        }
        list.append(li);
      }
      section.append(list);
    }

    const saved = pcHistory.length;
    section.append(pcNode('p', 'muted', historySaved
      ? `점검 기록: 이 브라우저에 ${saved}회 저장됨 · 숫자와 켜짐/꺼짐만 저장하고 비밀값·개인정보·기록 내용은 저장하지 않습니다`
      : '점검 기록: 이 브라우저에 저장할 수 없어 이번 실행 중에만 기억합니다 · 평소 범위가 쌓이지 않습니다'));
    return section;
  }

  // 앱이 이 칸을 다시 그리면 버튼도 새로 만들어지므로, 버튼에 있던 초점을 같은 버튼으로 되돌립니다.
  function keepFocus(nextRoot) {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (pcRoot && active && pcRoot.contains(active) && active.dataset?.focusKey) pendingFocusKey = active.dataset.focusKey;
    pcRoot = nextRoot;
    if (!pendingFocusKey) return;
    queueMicrotask(() => {
      const key = pendingFocusKey;
      pendingFocusKey = null;
      if (!pcRoot?.isConnected) return;
      const current = document.activeElement;
      if (current && current !== document.body && pcRoot.contains(current)) return;
      if (current && current !== document.body && current !== document.documentElement) return;
      pcRoot.querySelector(`[data-focus-key="${key}"]`)?.focus({ preventScroll: true });
    });
  }

  const view = {
    renderIdentity(input) {
      const payload = input !== null && typeof input === 'object' ? input : {};
      const { me, devices, sessions } = payload;
      const root = document.createElement('div');
      root.setAttribute('aria-label', '계정·기기·세션 정보');

      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const resourceStatus = (resource) => {
        if (!isRecord(resource)) return 'unknown';
        return ['loading', 'ok', 'error', 'idle'].includes(resource.status) ? resource.status : 'unknown';
      };
      const rawCode = (value) => typeof value === 'string' && value.trim() ? value.slice(0, 40) : null;
      const unknownCodeLabel = (value) => {
        const raw = rawCode(value);
        return raw === null ? '확인 불가(값 없음)' : `확인 불가(받은 값: ${raw})`;
      };
      const modeLabel = (resource) => {
        const mode = isRecord(resource)
          ? (resource.mode ?? (isRecord(resource.meta) ? resource.meta.mode : undefined))
          : undefined;
        if (mode === 'connected') return '실제 연결(connected)';
        if (mode === 'demo') return '예제 자료(demo)';
        if (mode === 'disconnected') return '연결 없음(disconnected)';
        if (mode === 'unknown') return '확인 불가(unknown)';
        return unknownCodeLabel(mode);
      };
      const statusMessage = (resource) => {
        const status = resourceStatus(resource);
        if (status === 'loading') return '불러오는 중(loading)';
        if (status === 'idle') return '아직 불러오지 않음(idle)';
        if (status === 'ok') return '응답 받음(ok)';
        if (status === 'error') {
          const error = isRecord(resource) && isRecord(resource.error) ? resource.error : {};
          const message = typeof error.message === 'string' && error.message.trim() ? error.message : '원인 확인 불가';
          const code = rawCode(error.code) ?? '확인 불가';
          if (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED') {
            return `확인 불가: 응답 형식이 계약과 다름(error, ${code}): ${message}`;
          }
          return `연결 실패(error, ${code}): ${message}`;
        }
        return isRecord(resource) ? unknownCodeLabel(resource.status) : '확인 불가(값 없음)';
      };
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const appendMode = (parent, resource) => {
        appendText(parent, 'p', `연결 모드: ${modeLabel(resource)}`);
      };
      const appendResourceStatus = (parent, resource) => {
        const message = statusMessage(resource);
        const status = resourceStatus(resource);
        appendText(parent, 'p', message, status === 'unknown' ? 'unknown' : status);
      };
      const valueOrUnknown = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return '확인 불가';
      };
      const statusValue = (kind, value) => {
        if (kind === 'device') {
          if (value === 'compliant') return { label: '보안 기준 충족', state: 'compliant' };
          if (value === 'noncompliant') return { label: '주의: 보안 기준 미충족', state: 'noncompliant' };
          if (value === 'unknown') return { label: '확인 불가', state: 'unknown' };
          return { label: unknownCodeLabel(value), state: 'unknown' };
        }
        if (value === 'active') return { label: '활성', state: 'active' };
        if (value === 'expired') return { label: '주의: 만료', state: 'expired' };
        if (value === 'revoked') return { label: '주의: 철회됨', state: 'revoked' };
        if (value === 'unknown') return { label: '확인 불가', state: 'unknown' };
        return { label: unknownCodeLabel(value), state: 'unknown' };
      };
      const appendStatusField = (parent, kind, value) => {
        const shown = statusValue(kind, value);
        const raw = rawCode(value);
        let label;
        if (shown.state === 'unknown' && value !== 'unknown') {
          label = shown.label;
        } else {
          label = `${shown.label}(${raw ?? '값 없음'})`;
        }
        appendText(parent, 'p', `상태: ${label}`, shown.state);
      };
      const makeSection = (title) => {
        const section = document.createElement('section');
        appendText(section, 'h3', title);
        root.append(section);
        return section;
      };

      const accountSection = makeSection('계정');
      appendMode(accountSection, me);
      appendResourceStatus(accountSection, me);
      if (resourceStatus(me) === 'ok') {
        const data = isRecord(me.data) ? me.data : {};
        const user = isRecord(data.user) ? data.user : {};
        appendText(accountSection, 'p', `사용자: ${valueOrUnknown(user.label)} · ID: ${valueOrUnknown(user.id)}`);
      }

      const deviceSection = makeSection('현재 기기');
      appendResourceStatus(deviceSection, me);
      if (resourceStatus(me) === 'ok') {
        const data = isRecord(me.data) ? me.data : {};
        const device = isRecord(data.device) ? data.device : {};
        appendText(deviceSection, 'p', `기기 이름: ${valueOrUnknown(device.label)} · ID: ${valueOrUnknown(device.id)}`);
        appendStatusField(deviceSection, 'device', device.status);
      }
      appendText(deviceSection, 'h4', '기기 목록');
      appendMode(deviceSection, devices);
      appendResourceStatus(deviceSection, devices);
      if (resourceStatus(devices) === 'ok') {
        const rows = Array.isArray(devices.data) ? devices.data : null;
        if (!rows) {
          appendText(deviceSection, 'p', '확인 불가', 'unknown');
        } else if (rows.length === 0) {
          appendText(deviceSection, 'p', '등록된 기기 없음(0건)', 'empty');
        } else {
          const list = document.createElement('ul');
          for (const row of rows) {
            const item = document.createElement('li');
            const device = isRecord(row) ? row : {};
            const shownStatus = statusValue('device', device.status);
            item.setAttribute('data-state', shownStatus.state);
            appendText(item, 'p', `기기 이름: ${valueOrUnknown(device.label)} · ID: ${valueOrUnknown(device.id)}`);
            appendStatusField(item, 'device', device.status);
            list.append(item);
          }
          deviceSection.append(list);
        }
      }

      const sessionSection = makeSection('현재 세션');
      appendResourceStatus(sessionSection, me);
      if (resourceStatus(me) === 'ok') {
        const data = isRecord(me.data) ? me.data : {};
        const session = isRecord(data.session) ? data.session : {};
        appendText(sessionSection, 'p', `세션 ID: ${valueOrUnknown(session.id)}`);
        appendStatusField(sessionSection, 'session', session.status);
      }
      appendText(sessionSection, 'h4', '세션 목록');
      appendMode(sessionSection, sessions);
      appendResourceStatus(sessionSection, sessions);
      if (resourceStatus(sessions) === 'ok') {
        const rows = Array.isArray(sessions.data) ? sessions.data : null;
        if (!rows) {
          appendText(sessionSection, 'p', '확인 불가', 'unknown');
        } else if (rows.length === 0) {
          appendText(sessionSection, 'p', '세션 없음(0건)', 'empty');
        } else {
          const list = document.createElement('ul');
          for (const row of rows) {
            const item = document.createElement('li');
            const session = isRecord(row) ? row : {};
            const shownStatus = statusValue('session', session.status);
            item.setAttribute('data-state', shownStatus.state);
            appendText(item, 'p', `세션 ID: ${valueOrUnknown(session.id)}`);
            appendStatusField(item, 'session', session.status);
            list.append(item);
          }
          sessionSection.append(list);
        }
      }

      return root;
    },
    renderDecision(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', '업무 앱 접속 판정');
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const payload = isRecord(input) ? input : null;
      const rawCode = (value) => typeof value === 'string' && value.trim() ? value.slice(0, 40) : null;
      const displayValue = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return '확인 불가';
      };
      const mode = payload
        ? (payload.mode ?? (isRecord(payload.meta) ? payload.meta.mode : undefined))
        : undefined;
      let modeLabel;
      if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      else modeLabel = `확인 불가(unknown) · 받은 값: ${rawCode(mode) ?? '없음'}`;
      appendText(root, 'p', `연결 모드: ${modeLabel}`);

      if (!payload) {
        appendText(root, 'p', '확인 불가(unknown) · 입력 없음 · 허용되지 않음', 'unknown');
        return root;
      }

      const data = isRecord(payload.data) ? payload.data : {};
      const status = payload.status;
      if (status === 'idle') {
        appendText(root, 'p', '앱을 골라 접속을 요청하세요(idle)', 'idle');
        return root;
      }
      if (status === 'loading') {
        appendText(root, 'p', '판정 확인 중(loading)', 'loading');
        return root;
      }
      if (status === 'error') {
        const error = isRecord(payload.error) ? payload.error : {};
        const code = rawCode(error.code) ?? '확인 불가';
        const message = typeof error.message === 'string' && error.message.trim()
          ? error.message
          : '원인 확인 불가';
        if (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED') {
          appendText(root, 'p', `확인 불가(unknown): 응답 형식이 계약과 다름(error, ${code}): ${message} · 허용도 거부도 아닙니다`, 'unknown');
        } else {
          appendText(root, 'p', `요청 실패(error, ${code}): ${message} · 접근 거부 판정이 아닙니다`, 'error');
        }
        return root;
      }
      if (status !== 'ok') {
        const receivedStatus = rawCode(status) ?? '없음';
        appendText(root, 'p', `확인 불가(unknown) · 받은 status: ${receivedStatus} · 허용되지 않음`, 'unknown');
        return root;
      }

      appendText(root, 'p', '응답 받음(ok)', 'ok');
      const hasIdentifier = (value) =>
        (typeof value === 'string' && value.trim().length > 0) ||
        (typeof value === 'number' && Number.isFinite(value));
      const selectedAppId = hasIdentifier(payload.appId) ? payload.appId : data.appId;
      const hasSelectedAppId = hasIdentifier(selectedAppId);
      const hasTargetAppId = hasIdentifier(data.appId);
      const mismatch = hasIdentifier(payload.appId) && hasTargetAppId && payload.appId !== data.appId;

      if (mismatch) {
        appendText(root, 'p', '확인 불가(unknown): 선택한 앱과 판정 대상 앱이 다름 · 허용되지 않음', 'mismatch');
        appendText(root, 'p', `선택한 앱 ID: ${displayValue(selectedAppId)}`);
        appendText(root, 'p', `판정 대상 앱 ID: ${displayValue(data.appId)}`);
        return root;
      } else {
        const appId = hasSelectedAppId ? selectedAppId : undefined;
        appendText(root, 'p', `대상 앱 ID: ${displayValue(appId)}`);
        const decision = data.decision;
        if (decision === 'allow') {
          appendText(root, 'p', '판정: 허용(allow)', 'allow');
          appendText(root, 'p', '정책상 허용이며 실제 앱 접속 성공을 보장하지 않습니다');
        } else if (decision === 'deny') {
          appendText(root, 'p', '판정: 거부(deny)', 'deny');
        } else if (decision === 'challenge') {
          appendText(root, 'p', '판정: 추가 확인 필요(challenge)', 'challenge');
          appendText(root, 'p', '이 앱이 추가 인증을 대신 수행하지 않습니다');
        } else if (decision === 'unknown') {
          appendText(root, 'p', '판정: 확인 불가(unknown) · 허용되지 않음', 'unknown');
        } else {
          const receivedDecision = rawCode(decision) ?? '없음';
          appendText(root, 'p', `판정: 확인 불가(unknown) · 받은 값: ${receivedDecision} · 허용되지 않음`, 'unknown');
        }
      }

      const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason : '확인 불가';
      const checkedAtValue = data.checkedAt ?? (isRecord(payload.meta) ? payload.meta.checkedAt : undefined);
      appendText(root, 'p', `판정 이유: ${reason}`);
      appendText(root, 'p', `판정 시각: ${displayValue(checkedAtValue)}`);
      return root;
    },
    renderEvents(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', '보안 기록');
      const appendText = (parent, tag, value) => {
        const node = document.createElement(tag);
        node.textContent = value;
        parent.append(node);
        return node;
      };
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const payload = isRecord(input) ? input : null;
      const scalarText = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return null;
      };
      const receivedValue = (value) => scalarText(value)?.slice(0, 40) ?? '없음';
      const eventValue = (event, key) => isRecord(event) ? event[key] : undefined;
      const mode = payload
        ? (payload.mode ?? (isRecord(payload.meta) ? payload.meta.mode : undefined))
        : undefined;
      let modeLabel;
      if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      else modeLabel = `확인 불가(unknown) · 받은 값: ${receivedValue(mode)}`;
      appendText(root, 'p', `연결 모드: ${modeLabel}`);

      const status = payload?.status;
      if (status === 'loading') {
        appendText(root, 'p', '기록을 불러오는 중(loading)');
        eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
        return root;
      }
      if (status === 'idle') {
        appendText(root, 'p', '아직 기록을 불러오지 않음(idle)');
        eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
        return root;
      }
      if (status === 'error') {
        const error = isRecord(payload.error) ? payload.error : {};
        const code = scalarText(error.code);
        const message = typeof error.message === 'string' && error.message.trim() ? error.message : '원인 확인 불가';
        if (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED') {
          appendText(root, 'p', `확인 불가(unknown): 응답 형식이 계약과 다름 (error, ${code ?? '코드 없음'}): ${message} · 이전 목록을 표시하지 않습니다`);
        } else {
          appendText(root, 'p', `기록을 불러오지 못했습니다: ${message} (error, ${code ?? '코드 없음'})`);
        }
        eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
        return root;
      }
      if (status !== 'ok') {
        appendText(root, 'p', `확인 불가(unknown) · 받은 status: ${receivedValue(status)}`);
        eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
        return root;
      }

      appendText(root, 'p', '응답 받음(ok)');
      if (!Array.isArray(payload.data)) {
        appendText(root, 'p', '확인 불가(unknown): 기록 목록 형식이 아님');
        eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
        return root;
      }
      const records = payload.data;
      if (records.length === 0) {
        appendText(root, 'p', '표시할 기록이 없습니다');
        eventFilterState = { kind: 'all', appId: 'all', access: 'all' };
        return root;
      }

      const recordIdText = (event) => scalarText(eventValue(event, 'id')) ?? '확인 불가';
      const parsedTime = (event) => {
        const at = scalarText(eventValue(event, 'at'));
        if (at === null) return null;
        const milliseconds = Date.parse(at);
        return Number.isFinite(milliseconds) ? milliseconds : null;
      };
      const timeLabel = (event) => {
        const original = scalarText(eventValue(event, 'at'));
        const milliseconds = parsedTime(event);
        if (milliseconds === null) return `시각: 확인 불가(받은 값: ${receivedValue(eventValue(event, 'at'))})`;
        const koreanDate = new Date(milliseconds + 9 * 60 * 60 * 1000);
        if (!Number.isFinite(koreanDate.getTime())) {
          return `시각: 확인 불가(받은 값: ${receivedValue(eventValue(event, 'at'))})`;
        }
        const pad = (value, width = 2) => String(value).padStart(width, '0');
        const koreanTime = `${pad(koreanDate.getUTCFullYear(), 4)}-${pad(koreanDate.getUTCMonth() + 1, 2)}-${pad(koreanDate.getUTCDate())} ${pad(koreanDate.getUTCHours())}:${pad(koreanDate.getUTCMinutes())}:${pad(koreanDate.getUTCSeconds())}`;
        return `시각: ${original} (한국 시각 ${koreanTime})`;
      };
      const kindLabel = (value) => {
        if (value === 'access') return '접속 기록(access)';
        if (value === 'xdr') return 'XDR 경보(xdr)';
        return `확인 불가(unknown) · 받은 값: ${receivedValue(value)}`;
      };
      const appLabel = (event) => {
        const appId = scalarText(eventValue(event, 'appId'));
        return appId === null ? '앱 확인 불가(appId 없음)' : `앱: ${appId}`;
      };
      const accessLabel = (value) => {
        if (value === 'allowed') return '허용됨(allowed)';
        if (value === 'denied') return '거부됨(denied)';
        if (value === 'unknown') return '확인 불가(unknown)';
        return `확인 불가(unknown) · 받은 값: ${receivedValue(value)}`;
      };
      const sessionLabel = (value) => {
        if (value === 'active') return '활성(active)';
        if (value === 'expired') return '주의: 만료(expired)';
        if (value === 'revoked') return '주의: 철회됨(revoked)';
        if (value === 'unknown') return '확인 불가(unknown)';
        return `확인 불가(unknown) · 받은 값: ${receivedValue(value)}`;
      };
      const deviceLabel = (value) => {
        if (value === 'compliant') return '보안 기준 충족(compliant)';
        if (value === 'noncompliant') return '주의: 보안 기준 미충족(noncompliant)';
        if (value === 'unknown') return '확인 불가(unknown)';
        return `확인 불가(unknown) · 받은 값: ${receivedValue(value)}`;
      };
      const optionValue = (value) => scalarText(value);
      const uniqueValues = (key, nestedState) => {
        const values = [];
        const seen = new Set();
        for (const event of records) {
          const value = nestedState
            ? (isRecord(eventValue(event, 'state')) ? event.state.access : undefined)
            : eventValue(event, key);
          const text = optionValue(value);
          if (text !== null && !seen.has(text)) {
            seen.add(text);
            values.push(text);
          }
        }
        return values;
      };
      const kindValues = uniqueValues('kind', false);
      const appValues = uniqueValues('appId', false);
      const accessValues = uniqueValues('state', true);
      if (!kindValues.includes(eventFilterState.kind)) eventFilterState.kind = 'all';
      if (!appValues.includes(eventFilterState.appId)) eventFilterState.appId = 'all';
      if (!accessValues.includes(eventFilterState.access)) eventFilterState.access = 'all';

      const scope = appendText(root, 'p', `표시 범위: 내 최근 기록 최대 40건 · 받은 기록 ${records.length}건 · 전체 로그나 다른 사용자 기록이 아님 · XDR은 이미 저장된 경보만`);
      scope.setAttribute('data-state', 'scope');
      const filterContainer = document.createElement('div');
      const listRegion = document.createElement('div');
      const detailRegion = document.createElement('div');
      root.append(filterContainer, listRegion, detailRegion);
      const selectedEvent = { current: null };

      const appendFilter = (labelText, id, selected, values, labelForValue, onChange) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        label.setAttribute('for', id);
        const select = document.createElement('select');
        select.id = id;
        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = '전체(all)';
        select.append(all);
        for (const value of values) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = labelForValue(value);
          select.append(option);
        }
        select.value = selected;
        select.addEventListener('change', onChange);
        filterContainer.append(label, select);
        return select;
      };
      const renderDetail = (event) => {
        detailRegion.replaceChildren();
        if (!event) return;
        const detail = document.createElement('section');
        detail.setAttribute('data-student-event-detail', scalarText(eventValue(event, 'id')) ?? '');
        appendText(detail, 'h3', '기록 상세');
        appendText(detail, 'p', `사건 ID: ${recordIdText(event)}`);
        appendText(detail, 'p', appLabel(event));
        appendText(detail, 'p', `종류: ${kindLabel(eventValue(event, 'kind'))}`);
        appendText(detail, 'p', timeLabel(event));

        const appendItems = (title, key, emptyText) => {
          appendText(detail, 'h4', title);
          const items = eventValue(event, key);
          if (!Array.isArray(items)) {
            appendText(detail, 'p', '확인 불가(unknown)');
          } else if (items.length === 0) {
            appendText(detail, 'p', emptyText);
          } else {
            const list = document.createElement('ul');
            for (const entry of items) {
              const item = document.createElement('li');
              const id = scalarText(eventValue(entry, 'id')) ?? '확인 불가';
              const text = scalarText(eventValue(entry, 'text')) ?? '확인 불가';
              appendText(item, 'p', `ID: ${id} · 내용: ${text}`);
              list.append(item);
            }
            detail.append(list);
          }
        };
        appendItems('근거', 'evidence', '근거 없음(0건)');
        appendItems('규칙', 'rules', '규칙 없음(0건)');

        const state = isRecord(eventValue(event, 'state')) ? event.state : {};
        appendText(detail, 'h4', '상태');
        appendText(detail, 'p', `접속: ${accessLabel(state.access)}`);
        appendText(detail, 'p', `세션: ${sessionLabel(state.session)}`);
        appendText(detail, 'p', `기기: ${deviceLabel(state.device)}`);

        const actions = eventValue(event, 'supportedActions');
        if (Array.isArray(actions) && actions.length > 0) {
          const actionSection = document.createElement('section');
          appendText(actionSection, 'h4', '조치');
          for (const action of actions) {
            let actionName = null;
            if (typeof action === 'string' && action.trim()) {
              actionName = action;
            } else if (isRecord(action)) {
              for (const key of ['action', 'id', 'name']) {
                if (typeof action[key] === 'string' && action[key].trim()) {
                  actionName = action[key];
                  break;
                }
              }
            }
            if (actionName === null) {
              appendText(actionSection, 'p', '조치 이름 확인 불가(unknown)');
              continue;
            }
            const buttonName = `${actionName} 미지원`;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = buttonName;
            button.setAttribute('aria-label', buttonName);
            button.setAttribute('aria-disabled', 'true');
            button.disabled = true;
            actionSection.append(button);
            appendText(actionSection, 'p', '아직 지원하지 않는 조치입니다 · 조치 실행 연결은 준비 중입니다 · 요청을 보내지 않습니다');
          }
          detail.append(actionSection);
        }
        detailRegion.append(detail);
      };
      const ordered = [...records].sort((left, right) => {
        const leftTime = parsedTime(left);
        const rightTime = parsedTime(right);
        if (leftTime === null && rightTime !== null) return 1;
        if (leftTime !== null && rightTime === null) return -1;
        if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
        const leftId = scalarText(eventValue(left, 'id')) ?? '';
        const rightId = scalarText(eventValue(right, 'id')) ?? '';
        if (leftId < rightId) return -1;
        if (leftId > rightId) return 1;
        return 0;
      });
      const renderList = () => {
        listRegion.replaceChildren();
        const filtered = ordered.filter((event) => {
          const kind = optionValue(eventValue(event, 'kind'));
          const appId = optionValue(eventValue(event, 'appId'));
          const state = eventValue(event, 'state');
          const access = isRecord(state) ? optionValue(state.access) : null;
          return (eventFilterState.kind === 'all' || kind === eventFilterState.kind) &&
            (eventFilterState.appId === 'all' || appId === eventFilterState.appId) &&
            (eventFilterState.access === 'all' || access === eventFilterState.access);
        });
        appendText(listRegion, 'p', `표시 ${filtered.length}건 / 받은 기록 ${records.length}건`);
        if (filtered.length === 0) {
          appendText(listRegion, 'p', `필터 조건에 맞는 기록이 없습니다(0건 / 받은 기록 ${records.length}건)`);
        } else {
          const list = document.createElement('ul');
          for (const event of filtered) {
            const row = document.createElement('li');
            row.setAttribute('data-student-event-id', scalarText(eventValue(event, 'id')) ?? '');
            appendText(row, 'p', `사건 ID: ${recordIdText(event)}`);
            appendText(row, 'p', timeLabel(event));
            appendText(row, 'p', `종류: ${kindLabel(eventValue(event, 'kind'))}`);
            appendText(row, 'p', appLabel(event));
            appendText(row, 'p', `요약: ${scalarText(eventValue(event, 'summary')) ?? '요약 없음'}`);
            const button = document.createElement('button');
            const buttonName = `${recordIdText(event)} 상세`;
            button.textContent = buttonName;
            button.setAttribute('aria-label', buttonName);
            button.type = 'button';
            button.addEventListener('click', () => {
              selectedEvent.current = selectedEvent.current === event ? null : event;
              renderDetail(selectedEvent.current);
            });
            row.append(button);
            list.append(row);
          }
          listRegion.append(list);
        }
        if (selectedEvent.current && !filtered.includes(selectedEvent.current)) {
          selectedEvent.current = null;
        }
        renderDetail(selectedEvent.current);
      };

      const kindSelect = appendFilter('기록 종류', 'student-event-kind-filter', eventFilterState.kind, kindValues, (value) => {
        if (value === 'access') return '접속 기록(access)';
        if (value === 'xdr') return 'XDR 경보(xdr)';
        return `확인 불가(unknown) · 받은 값: ${receivedValue(value)}`;
      }, () => {
        eventFilterState.kind = kindSelect.value;
        renderList();
      });
      const appSelect = appendFilter('업무 앱', 'student-event-app-filter', eventFilterState.appId, appValues, (value) => `앱(${value})`, () => {
        eventFilterState.appId = appSelect.value;
        renderList();
      });
      const accessSelect = appendFilter('접속 상태', 'student-event-access-filter', eventFilterState.access, accessValues, accessLabel, () => {
        eventFilterState.access = accessSelect.value;
        renderList();
      });
      renderList();
      return root;
    },
    renderStatus(input) {
      // 총공세: 맨 위에 내 PC 점검, 그 아래에 16단계의 기기·세션·알림·진단 표시를 그대로 둡니다.
      const wrap = document.createElement('div');
      wrap.setAttribute('aria-label', '내 PC 점검과 보안 서버 상태');
      wrap.append(renderPcCheck());
      const legacyTitle = document.createElement('h3');
      legacyTitle.textContent = '보안 서버 연결 상태 (기기·세션·알림·진단)';
      wrap.append(legacyTitle, view.renderServerStatus(input));
      keepFocus(wrap);
      return wrap;
    },
    renderServerStatus(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', '기기·세션·알림·진단 상태');
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const payload = isRecord(input) ? input : {};
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const scalarText = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return null;
      };
      const receivedValue = (value) => scalarText(value)?.slice(0, 40) ?? '없음';
      const mode = payload.mode ?? (isRecord(payload.devices)
        ? (payload.devices.mode ?? (isRecord(payload.devices.meta) ? payload.devices.meta.mode : undefined))
        : undefined);
      let modeLabel;
      if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      else modeLabel = `확인 불가(unknown) · 받은 값: ${receivedValue(mode)}`;
      appendText(root, 'p', `연결 모드: ${modeLabel}`);

      const valueOrUnknown = (value) => scalarText(value) ?? '확인 불가';
      const stateLabel = (kind, value) => {
        if (kind === 'device') {
          if (value === 'compliant') return '보안 기준 충족(compliant)';
          if (value === 'noncompliant') return '주의: 보안 기준 미충족(noncompliant)';
          if (value === 'unknown') return '확인 불가(unknown)';
        } else {
          if (value === 'active') return '활성(active)';
          if (value === 'expired') return '주의: 만료(expired)';
          if (value === 'revoked') return '주의: 철회됨(revoked)';
          if (value === 'unknown') return '확인 불가(unknown)';
        }
        return `확인 불가(unknown) · 받은 값: ${receivedValue(value)}`;
      };
      const appendRange = (parent, text) => appendText(parent, 'p', text);
      const appendRetry = (parent) => appendText(parent, 'p', '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요');
      const appendResource = (section, resource, kind) => {
        const resourceRecord = isRecord(resource) ? resource : {};
        const status = resourceRecord.status;
        if (status === 'loading') {
          appendText(section, 'p', kind === 'device' ? '기기 목록을 불러오는 중(loading)' : kind === 'session' ? '세션 정보를 불러오는 중(loading)' : '진단 정보를 불러오는 중(loading)', 'loading');
          return;
        }
        if (status === 'idle') {
          appendText(section, 'p', '아직 불러오지 않음(idle)', 'idle');
          return;
        }
        if (status === 'error') {
          const error = isRecord(resourceRecord.error) ? resourceRecord.error : {};
          const code = scalarText(error.code) ?? '코드 없음';
          const message = typeof error.message === 'string' && error.message.trim() ? error.message : '원인 확인 불가';
          const title = kind === 'device' ? '기기 목록을 불러오지 못했습니다' : kind === 'session' ? '세션 정보를 불러오지 못했습니다' : '진단 정보를 불러오지 못했습니다';
          if (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED') {
            const subject = kind === 'device' ? '기기' : kind === 'session' ? '세션' : '진단 정보';
            appendText(section, 'p', `확인 불가(unknown): ${subject} 응답 형식이 계약과 다름 (error, ${code}): ${message}`, 'unknown');
          } else {
            const timeoutSource = `${code} ${message}`;
            const timeoutPrefix = /timeout|시간 초과/i.test(timeoutSource) ? '시간 초과(timeout): ' : '';
            appendText(section, 'p', `${timeoutPrefix}${title}: ${message} (error, ${code})`, 'error');
          }
          appendRetry(section);
          return;
        }
        if (status !== 'ok') {
          appendText(section, 'p', `확인 불가(unknown) · 받은 status: ${receivedValue(status)}`, 'unknown');
          return;
        }

        appendText(section, 'p', '응답 받음(ok)', 'ok');
        if (kind === 'diagnostic') return;
        if (!Array.isArray(resourceRecord.data)) {
          appendText(section, 'p', kind === 'device' ? '확인 불가(unknown): 기기 목록 형식이 아님' : '확인 불가(unknown): 세션 목록 형식이 아님', 'unknown');
          return;
        }
        const rows = resourceRecord.data;
        if (rows.length === 0) {
          appendText(section, 'p', kind === 'device' ? '등록된 기기가 없음(0건)' : '현재 연결 없음(0건)', 'empty');
          return;
        }
        const list = document.createElement('ul');
        for (const row of rows) {
          const item = document.createElement('li');
          const record = isRecord(row) ? row : {};
          if (kind === 'device') {
            appendText(item, 'p', `기기: ${valueOrUnknown(record.label)} · ID: ${valueOrUnknown(record.id)} · 상태: ${stateLabel('device', record.status)}`, record.status === 'noncompliant' ? 'noncompliant' : record.status === 'compliant' ? 'compliant' : 'unknown');
          } else {
            appendText(item, 'p', `세션 ID: ${valueOrUnknown(record.id)} · 상태: ${stateLabel('session', record.status)}`, record.status === 'expired' || record.status === 'revoked' ? record.status : record.status === 'active' ? 'active' : 'unknown');
          }
          list.append(item);
        }
        section.append(list);
      };
      const makeSection = (title) => {
        const section = document.createElement('section');
        appendText(section, 'h3', title);
        root.append(section);
        return section;
      };

      const deviceSection = makeSection('등록 기기');
      appendRange(deviceSection, '내 이름으로 등록되고 회수되지 않은 기기 최대 100개 · 지금 쓰는 기기가 맨 앞');
      appendResource(deviceSection, payload.devices, 'device');

      const sessionSection = makeSection('현재 연결 세션');
      appendRange(sessionSection, '지금 검증된 연결 하나만 표시합니다(지난 세션 목록이 아님)');
      appendResource(sessionSection, payload.sessions, 'session');

      const notificationSection = makeSection('알림');
      if (Array.isArray(payload.notifications)) {
        if (payload.notifications.length === 0) {
          appendText(notificationSection, 'p', '주의할 알림이 없습니다');
        } else {
          const list = document.createElement('ul');
          for (const notification of payload.notifications) {
            const entry = isRecord(notification) ? notification : {};
            const textValue = (value) => typeof value === 'string' && value.trim() ? value.slice(0, 200) : '확인 불가';
            appendText(list, 'li', `자료: ${textValue(entry.resource)} · 코드: ${textValue(entry.code)} · 내용: ${textValue(entry.message)}`);
          }
          notificationSection.append(list);
        }
      } else {
        appendText(notificationSection, 'p', '확인 불가(unknown): 알림 형식이 아님', 'unknown');
      }

      const diagnosticSection = makeSection('진단 정보');
      const diagnostics = payload.diagnostics;
      appendResource(diagnosticSection, diagnostics, 'diagnostic');
      const diagnosticRecord = isRecord(diagnostics) ? diagnostics : {};
      const diagnosticData = diagnosticRecord.status === 'ok' && isRecord(diagnosticRecord.data) ? diagnosticRecord.data : {};
      const engine = isRecord(diagnosticData.engine) ? diagnosticData.engine : {};
      const redact = (value) => {
        const text = scalarText(value);
        if (text === null) return '확인 불가';
        return /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|\bbearer\s+\S+|token=|key=|password|secret/i.test(text) ? '[가림]' : text;
      };
      const diagnosticValues = [
        ['requestId', redact(diagnosticData.requestId)],
        ['component', redact(diagnosticData.component)],
        ['version', redact(diagnosticData.version)],
        ['checkedAt', redact(diagnosticData.checkedAt)],
        ['engine.mode', redact(engine.mode)],
        ['engine.code', redact(engine.code)],
      ];
      if (diagnosticRecord.status === 'ok') {
        for (const [label, value] of diagnosticValues) appendText(diagnosticSection, 'p', `${label}: ${value}`);
      }
      appendText(diagnosticSection, 'p', '진단 정보는 제공 화면이 조회한 결과이며, 비밀번호·토큰·API 키는 표시하거나 복사하지 않습니다');
      appendText(diagnosticSection, 'p', '도움 요청에 쓸 위 진단 정보 6개 값만 복사합니다');
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.textContent = '도움정보 복사';
      copyButton.setAttribute('aria-label', '도움정보 복사');
      diagnosticSection.append(copyButton);
      const copyResult = appendText(diagnosticSection, 'p', '');
      const copiedValues = diagnosticRecord.status === 'ok'
        ? diagnosticValues
        : [['requestId', '확인 불가'], ['component', '확인 불가'], ['version', '확인 불가'], ['checkedAt', '확인 불가'], ['engine.mode', '확인 불가'], ['engine.code', '확인 불가']];
      const copyText = copiedValues.map(([label, value]) => `${label}: ${value}`).join('\n');
      const showCopyFailure = (error) => {
        const message = isRecord(error) && typeof error.message === 'string' && error.message.trim()
          ? redact(error.message)
          : '원인 확인 불가';
        copyResult.textContent = `도움정보를 복사하지 못했습니다: ${message}`;
      };
      copyButton.addEventListener('click', () => {
        try {
          const clipboard = globalThis.navigator?.clipboard;
          if (!clipboard || typeof clipboard.writeText !== 'function') {
            throw new Error('클립보드를 사용할 수 없습니다');
          }
          Promise.resolve()
            .then(() => clipboard.writeText(copyText))
            .then(() => {
              copyResult.textContent = '도움정보 6개 값을 클립보드에 복사함';
            })
            .catch((error) => {
              showCopyFailure(error);
            });
        } catch (error) {
          showCopyFailure(error);
        }
      });
      return root;
    },
    renderVulnerabilities(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', '설치 패키지와 알려진 취약점 조회 결과');
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const plainText = (value, max) => {
        if (typeof value === 'string' && value.trim()) return value.slice(0, max);
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return null;
      };
      const redact = (value) => {
        if (typeof value !== 'string') return null;
        return /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|\bbearer\s+\S+|token=|key=|password|secret/i.test(value) ? '[가림]' : value;
      };
      const received = (value) => {
        const text = plainText(value, 40);
        return text === null ? '없음' : (redact(text) ?? '없음');
      };
      const safeCode = (value) => {
        if (typeof value !== 'string' || !value.trim()) return '코드 없음';
        const text = value.trim();
        return /^[A-Za-z0-9_.:-]{1,80}$/.test(text) ? text : (redact(text.slice(0, 80)) ?? '코드 없음');
      };
      const safeMessage = (value) => {
        if (typeof value !== 'string') return '원인 확인 불가';
        const firstLine = value.split(/\r?\n/)[0] ?? '';
        if (!firstLine.trim()) return '원인 확인 불가';
        return redact(firstLine.slice(0, 300)) ?? '원인 확인 불가';
      };
      const timeLabel = (value) => {
        const original = plainText(value, 40);
        if (original === null) return '확인 불가(받은 값: 없음)';
        const milliseconds = Date.parse(original);
        if (!Number.isFinite(milliseconds)) return `확인 불가(받은 값: ${received(original)})`;
        const korean = new Date(milliseconds + 9 * 60 * 60 * 1000);
        if (!Number.isFinite(korean.getTime())) return `확인 불가(받은 값: ${received(original)})`;
        const pad = (number, width = 2) => String(number).padStart(width, '0');
        return `${original} (한국 시각 ${pad(korean.getUTCFullYear(), 4)}-${pad(korean.getUTCMonth() + 1)}-${pad(korean.getUTCDate())} ${pad(korean.getUTCHours())}:${pad(korean.getUTCMinutes())}:${pad(korean.getUTCSeconds())})`;
      };
      // package-lock.json 에 기록된 정확한 버전(예: 1.2.3, 1.2.3-beta.1)만 설치 버전으로 인정합니다. ^1.2.0 같은 범위는 인정하지 않습니다.
      const exactVersion = (value) => (typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value) ? value : null);
      const notClean = '취약점 없음·정상·안전으로 판단하지 않습니다';
      const retryGuide = '다시 조회는 제공 화면의 「설치 패키지 조회」를 직접 누르세요 · 자동으로 다시 조회하지 않습니다';

      const payload = isRecord(input) ? input : {};
      const mode = payload.mode ?? (isRecord(payload.meta) ? payload.meta.mode : undefined);
      let modeLabel;
      if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      else modeLabel = `확인 불가(unknown) · 받은 값: ${received(mode)}`;
      appendText(root, 'p', `연결 모드: ${modeLabel}`);

      // 조회 전·조회 중·실패·취소에는 이전 표를 그리지 않습니다(호출마다 새로 그림).
      const status = payload.status;
      if (status === 'idle') {
        vulnerabilityLookupState = { phase: 'initial', acceptedKey: null, acceptedAt: null };
        appendText(root, 'p', `조회 전(idle) · 아직 조회하지 않았습니다 · ${notClean}`, 'idle');
        return root;
      }
      if (status === 'loading') {
        vulnerabilityLookupState = { ...vulnerabilityLookupState, phase: 'loading' };
        appendText(root, 'p', '조회 중(loading) · 이전 결과는 현재 결과가 아니므로 표시하지 않습니다', 'loading');
        return root;
      }
      if (status === 'error') {
        const error = isRecord(payload.error) ? payload.error : {};
        vulnerabilityLookupState = { ...vulnerabilityLookupState, phase: error.code === 'CANCELLED' ? 'cancelled' : 'failed' };
        if (error.code === 'CANCELLED') {
          appendText(root, 'p', `조회 취소됨(error, CANCELLED): ${safeMessage(error.message)}`, 'cancelled');
          appendText(root, 'p', `취소한 조회는 결과가 아닙니다 · ${notClean} · 늦게 도착한 응답은 표시하지 않습니다`);
        } else {
          appendText(root, 'p', `조회 실패(error, ${safeCode(error.code)}): ${safeMessage(error.message)}`, 'error');
          appendText(root, 'p', `조회 실패는 결과가 아닙니다 · ${notClean} · 이전 결과는 표시하지 않습니다`);
        }
        appendText(root, 'p', retryGuide);
        return root;
      }
      if (status !== 'ok') {
        appendText(root, 'p', `확인 불가(unknown) · 받은 status: ${received(status)} · ${notClean}`, 'unknown');
        return root;
      }

      const data = isRecord(payload.data) ? payload.data : null;
      if (!data) {
        appendText(root, 'p', `확인 불가(unknown) · 조회 결과 형식이 아님 · ${notClean}`, 'unknown');
        return root;
      }

      // 늦은 응답 차단: 현재 진행 중인 요청의 응답이거나, 이미 받아들인 같은 응답을 다시 그릴 때만 표시합니다.
      // 취소·실패 뒤에 새 조회(loading) 없이 도착한 응답, 이미 받아들인 결과보다 조회 시각이 이른 응답은 늦은(이전) 응답으로 보고 표시하지 않습니다.
      const responseCheckedAt = plainText(data.checkedAt ?? (isRecord(payload.meta) ? payload.meta.checkedAt : undefined), 40);
      const responseTime = responseCheckedAt === null ? Number.NaN : Date.parse(responseCheckedAt);
      const responseKey = [responseCheckedAt ?? '', plainText(data.lockfileHash, 128) ?? '', typeof data.status === 'string' ? data.status : '', Array.isArray(data.packages) ? data.packages.length : -1].join('|');
      const lookup = vulnerabilityLookupState;
      const sameAccepted = lookup.phase === 'accepted' && lookup.acceptedKey === responseKey;
      const olderThanAccepted = Number.isFinite(lookup.acceptedAt) && Number.isFinite(responseTime) && responseTime < lookup.acceptedAt;
      const expected = lookup.phase === 'loading' || lookup.phase === 'initial';
      if (!sameAccepted && (!expected || olderThanAccepted)) {
        const reason = lookup.phase === 'cancelled'
          ? '취소한 조회 뒤에 도착한 응답'
          : lookup.phase === 'failed' ? '실패한 조회 뒤에 도착한 응답' : '이미 표시한 결과보다 이전 시각의 응답';
        appendText(root, 'p', `늦게 도착한 응답이라 표시하지 않습니다(stale) · ${reason} · 받은 조회 시각: ${responseCheckedAt ?? '없음'}`, 'stale');
        appendText(root, 'p', `이 응답은 현재 조회 결과가 아닙니다 · ${notClean}`);
        appendText(root, 'p', retryGuide);
        return root;
      }
      vulnerabilityLookupState = { phase: 'accepted', acceptedKey: responseKey, acceptedAt: Number.isFinite(responseTime) ? responseTime : lookup.acceptedAt };

      // 전체 조회 상태
      const scanStatus = data.status;
      const scanLabels = {
        complete: ['모두 조회(complete)', '허용된 공개 패키지를 정확한 설치 버전으로 모두 OSV에 조회했습니다 · 알려진 항목이 없다는 것은 안전 보장이 아닙니다'],
        partial: ['일부 조회 실패(partial)', '일부 결과입니다 · 조회하지 못한 패키지는 확인 불가이며 취약점 없음이 아닙니다 · 이미 받은 취약점 ID는 그대로 표시합니다'],
        not_checked: ['아직 조회 안 함(not_checked)', `승인된 공개 조회 대상 패키지가 없어 조회하지 않았습니다 · ${notClean}`],
        not_configured: ['조회 준비 미완료(not_configured)', `조회 대상 프로젝트 설정이 필요합니다(운영자 준비 사항) · ${notClean}`],
        unverifiable: ['lock 파일 확인 불가(unverifiable)', `package-lock.json 과 설치된 패키지를 대조할 수 없어 정확한 설치 버전을 확인하지 못했습니다 · ${notClean}`],
      };
      const scan = typeof scanStatus === 'string' && Object.hasOwn(scanLabels, scanStatus)
        ? scanLabels[scanStatus]
        : [`확인 불가(unknown) · 받은 값: ${received(scanStatus)}`, notClean];
      appendText(root, 'p', `전체 조회 상태: ${scan[0]}`, typeof scanStatus === 'string' && Object.hasOwn(scanLabels, scanStatus) ? scanStatus : 'unknown');
      appendText(root, 'p', scan[1]);
      appendText(root, 'p', '전체 결과는 package-lock.json 과 설치된 node_modules 의 메타데이터를 대조한 정확한 설치 버전 기준입니다 · OSV는 알려진 취약점 데이터베이스이며 조회 결과가 없어도 안전을 보장하지 않습니다');

      if (data.lockfileVersion !== undefined && data.lockfileVersion !== null) appendText(root, 'p', `lockfileVersion: ${received(data.lockfileVersion)}`);
      if (plainText(data.lockfileHash, 128) !== null) appendText(root, 'p', `lockfileHash: ${plainText(data.lockfileHash, 128)}`);
      if (data.checkedAt !== undefined && data.checkedAt !== null) appendText(root, 'p', `전체 조회 시각(checkedAt): ${timeLabel(data.checkedAt)}`);

      // 패키지별 결과
      const packages = Array.isArray(data.packages) ? data.packages : null;
      if (packages === null) {
        appendText(root, 'p', `확인 불가(unknown) · 패키지 목록 형식이 아님 · ${notClean}`, 'unknown');
        return root;
      }
      if (packages.length === 0) {
        appendText(root, 'p', `표시할 패키지 결과 없음(0건) · 조회한 결과가 아니므로 ${notClean}`, 'empty');
        return root;
      }

      const rowStatus = (row, findings, version) => {
        const value = row.status;
        if (version === null) return { label: `확인 불가(unknown) · 정확한 설치 버전이 아님(받은 version: ${received(row.version)}) · ${notClean}`, state: 'unverifiable' };
        if (value === 'known_vulnerabilities') {
          return findings.length > 0
            ? { label: `알려진 항목 있음(known_vulnerabilities) · ${findings.length}건`, state: 'known_vulnerabilities' }
            : { label: `확인 불가(unknown) · 알려진 항목 있음으로 받았으나 취약점 ID 없음 · ${notClean}`, state: 'unverifiable' };
        }
        if (value === 'none_found') {
          return findings.length === 0
            ? { label: '알려진 항목 없음(none_found) · 이 버전을 OSV 조회 범위에서 끝까지 확인했고 알려진 항목이 없다는 뜻이며 안전 보장은 아닙니다', state: 'none_found' }
            : { label: `확인 불가(unknown) · 상태(none_found)와 받은 취약점 목록이 다름 · 받은 ID는 그대로 표시 · ${notClean}`, state: 'unverifiable' };
        }
        if (value === 'unverifiable') {
          return findings.length > 0
            ? { label: `일부 확인·전체 조회 확인 불가(unverifiable) · 받은 취약점 ${findings.length}건은 그대로 표시 · 나머지는 ${notClean}`, state: 'unverifiable' }
            : { label: `조회 확인 불가(unverifiable) · ${notClean}`, state: 'unverifiable' };
        }
        return { label: `확인 불가(unknown) · 받은 값: ${received(value)} · ${notClean}`, state: 'unverifiable' };
      };

      const counts = { known_vulnerabilities: 0, none_found: 0, unverifiable: 0 };
      const table = document.createElement('table');
      const caption = document.createElement('caption');
      caption.textContent = '설치 패키지별 OSV 조회 결과(정확한 설치 버전 기준)';
      table.append(caption);
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const title of ['패키지(name)', '설치 버전(version)', '조회 상태(status)', '출처(source)', '확인 시각(checkedAt)', '취약점 ID · 수정 시각(modified)']) {
        const cell = document.createElement('th');
        cell.setAttribute('scope', 'col');
        cell.textContent = title;
        headRow.append(cell);
      }
      head.append(headRow);
      table.append(head);
      const body = document.createElement('tbody');
      for (const entry of packages) {
        const row = isRecord(entry) ? entry : {};
        const name = plainText(row.name, 214);
        const version = exactVersion(row.version);
        const findings = Array.isArray(row.vulnerabilities)
          ? row.vulnerabilities.filter((item) => isRecord(item) && plainText(item.id, 120) !== null)
          : [];
        const shown = rowStatus(row, findings, version);
        counts[shown.state] += 1;
        const tr = document.createElement('tr');
        tr.setAttribute('data-student-package-name', name ?? '');
        tr.setAttribute('data-student-package-version', version ?? '');
        tr.setAttribute('data-state', shown.state);
        appendText(tr, 'td', name ?? '확인 불가(이름 없음)');
        appendText(tr, 'td', version ?? `확인 불가(unknown) · 받은 값: ${received(row.version)}`);
        appendText(tr, 'td', shown.label);
        appendText(tr, 'td', plainText(row.source, 200) ?? '출처 확인 불가');
        appendText(tr, 'td', timeLabel(row.checkedAt));
        const findingCell = document.createElement('td');
        if (findings.length === 0) {
          findingCell.textContent = shown.state === 'none_found' ? '알려진 항목 없음' : '받은 취약점 ID 없음';
        } else {
          const list = document.createElement('ul');
          for (const item of findings) appendText(list, 'li', `${plainText(item.id, 120)} · modified: ${timeLabel(item.modified)}`);
          findingCell.append(list);
        }
        tr.append(findingCell);
        body.append(tr);
      }
      table.append(body);
      appendText(root, 'p', `패키지 ${packages.length}개 · 알려진 항목 있음 ${counts.known_vulnerabilities} · 알려진 항목 없음 ${counts.none_found} · 확인 불가 ${counts.unverifiable}`);
      root.append(table);
      return root;
    },
    renderAiConnection(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', 'AI 연결 점검 결과');
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const payload = isRecord(input) ? input : {};
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const scalarText = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return null;
      };
      const redact = (value) => {
        const text = typeof value === 'string' ? value : null;
        if (text === null) return null;
        return /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|\bbearer\s+\S+|token=|key=|password|secret/i.test(text) ? '[가림]' : text;
      };
      const received = (value) => {
        if (typeof value === 'boolean') return String(value);
        const text = scalarText(value);
        return text === null ? '없음' : (redact(text.slice(0, 40)) ?? '없음');
      };
      const mode = payload.mode ?? (isRecord(payload.meta) ? payload.meta.mode : undefined);
      let modeLabel;
      if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      else modeLabel = `확인 불가(unknown) · 받은 값: ${received(mode)}`;
      appendText(root, 'p', `연결 모드: ${modeLabel}`);
      appendText(root, 'p', '이 칸은 앱 서버를 거친 앱 안의 AI 연결 점검 결과입니다 · 워크벤치 수업용 AI나 ALEPH 과제 판정 AI와는 다른 연결입니다');

      const status = payload.status;
      if (status === 'idle') {
        appendText(root, 'p', 'AI 연결 점검 전(idle)', 'idle');
        return root;
      }
      if (status === 'loading') {
        appendText(root, 'p', 'AI 연결 점검 중(loading)', 'loading');
        return root;
      }
      if (status === 'cancelled') {
        appendText(root, 'p', 'AI 연결 점검 취소됨(cancelled) · 이전 결과는 현재 결과가 아닙니다', 'cancelled');
        appendText(root, 'p', '다시 점검은 점검 버튼(「AI 연결 점검」 또는 「현재 API 연결 점검」)을 직접 누르세요 · 자동으로 다시 점검하지 않습니다');
        return root;
      }
      const error = isRecord(payload.error) ? payload.error : {};
      const rawErrorCode = typeof error.code === 'string' && error.code.trim() ? error.code.trim() : null;
      const shownCode = rawErrorCode === null
        ? '코드 없음'
        : (/^[A-Za-z0-9_.:-]{1,80}$/.test(rawErrorCode) ? rawErrorCode : (redact(rawErrorCode.slice(0, 80)) ?? '코드 없음'));
      const firstLine = typeof error.message === 'string' ? (error.message.split(/\r?\n/)[0] ?? '') : '';
      const message = firstLine.trim() ? (redact(firstLine.slice(0, 300)) ?? '원인 확인 불가') : '원인 확인 불가';
      const codeGroups = {
        provisioning: ['ON_AI_PROVISIONING_PENDING', 'ON_AI_TRANSPORT_PENDING', 'ON_AI_AUTHORIZATION_CHANGED', 'ON_AI_TEST_TRANSPORT_ONLY'],
        auth: ['WB_CLCO_AUTH_REQUIRED', 'WB_CLCO_INVALID_TOKEN'],
        blocked: ['WB_CLCO_ACCESS_BLOCKED'],
        limit: ['WB_CLCO_COHORT_BUDGET_EXHAUSTED', 'WB_CLCO_LIMIT_REACHED'],
        hours: ['WB_CLCO_SESSION_CLOSED'],
        rate: ['WB_CLCO_RATE_LIMITED'],
        timeout: ['WB_CLCO_TIMEOUT'],
        network: ['WB_CLCO_NETWORK_ERROR', 'WB_CLCO_SERVER_UNAVAILABLE', 'WB_CLCO_REQUEST_FAILED'],
        cancelled: ['WB_CLCO_CANCELLED'],
        model: ['ON_AI_MODEL_LIST_EMPTY'],
        contract: ['CONTRACT_MISMATCH', 'ENGINE_RESULT_UNVERIFIED'],
      };
      const category = () => {
        if (rawErrorCode !== null) {
          for (const [name, codes] of Object.entries(codeGroups)) {
            if (codes.includes(rawErrorCode)) return name;
          }
        }
        const text = `${rawErrorCode ?? ''} ${firstLine}`.toLowerCase();
        if (/cancel|취소/.test(text)) return 'cancelled';
        if (/timeout|timed out|시간 초과/.test(text)) return 'timeout';
        if (/rate.?limit|too many|요청 제한/.test(text)) return 'rate';
        if (/network|네트워크|연결할 수 없/.test(text)) return 'network';
        if (/provision|권한 준비/.test(text)) return 'provisioning';
        if (/budget|usage|quota|사용량|한도/.test(text)) return 'limit';
        if (/session closed|이용 시간|운영 시간/.test(text)) return 'hours';
        if (/model|모델/.test(text)) return 'model';
        if (/unauthori|auth|인증/.test(text)) return 'auth';
        if (/forbidden|blocked|접근 제한|권한이 없/.test(text)) return 'blocked';
        return 'unknown';
      };

      if (status === 'error') {
        const reason = category();
        const head = reason === 'cancelled'
          ? 'AI 연결 점검 취소됨'
          : reason === 'timeout' ? 'AI 연결 점검 시간 초과(timeout)' : 'AI 연결 점검 실패';
        appendText(root, 'p', `${head}(error, ${shownCode}): ${message}`, 'error');
        const guide = {
          provisioning: '원인: 앱 권한 준비 중 · 학생 설정 오류가 아닙니다 · 담당자에게 계정 연결과 앱 권한 확인을 요청하세요',
          auth: '원인: 인증 실패 · 보호 현황에서 계정 연결을 다시 확인하고, 계속되면 담당자에게 확인을 요청하세요',
          blocked: '원인: 접근 제한 · 계정 연결을 다시 확인하고 담당자에게 권한을 확인하세요',
          limit: '원인: 반 사용량 또는 이용 한도 초과 · 담당자에게 확인하세요',
          hours: '원인: 이용 시간이 아님 · 이용 가능한 시간을 확인하세요',
          rate: '원인: 요청 제한(짧은 시간에 요청이 많음) · 잠시 뒤 직접 다시 점검하세요',
          timeout: '원인: 시간 초과(timeout) · 응답이 늦어 점검이 끝났습니다 · 잠시 뒤 직접 다시 점검하세요',
          network: '원인: 네트워크 또는 서버 연결 문제 · 잠시 뒤 직접 다시 점검하세요',
          cancelled: '원인: 취소됨 · 이전 결과는 현재 결과가 아닙니다',
          model: '원인: 쓸 수 있는 모델 없음 · 담당자에게 모델 허용 설정 확인을 요청하세요',
          contract: '원인: 확인 불가(unknown) · 응답 형식이 계약과 다름 · 성공으로 보지 않습니다 · 담당자에게 계정 연결과 앱 권한 확인을 요청하세요',
          unknown: '원인: 확인 불가(unknown) · 담당자에게 계정 연결과 앱 권한 확인을 요청하세요',
        };
        appendText(root, 'p', guide[reason] ?? guide.unknown);
        appendText(root, 'p', '이전 점검 결과는 현재 결과가 아니므로 표시하지 않습니다');
        appendText(root, 'p', '다시 점검은 점검 버튼(「AI 연결 점검」 또는 「현재 API 연결 점검」)을 직접 누르세요 · 자동으로 다시 점검하지 않습니다');
        return root;
      }
      if (status !== 'ok') {
        const receivedStatus = received(status);
        appendText(root, 'p', `확인 불가(unknown) · 받은 status: ${receivedStatus}`, 'unknown');
        return root;
      }

      const data = isRecord(payload.data) ? payload.data : {};
      const audience = data.audienceAuthorization;
      if (audience === 'test') appendText(root, 'p', '시험 연결 점검(test)');
      else if (audience === 'verified') appendText(root, 'p', '앱 권한 확인 후 점검(verified)');
      else appendText(root, 'p', `확인 불가(unknown) · 받은 값: ${received(audience)}`, 'unknown');

      if (data.transportChecked === true) appendText(root, 'p', '전송 경로 확인: 예(transportChecked: true)');
      else appendText(root, 'p', `확인 불가(unknown) · transportChecked: ${received(data.transportChecked)}`, 'unknown');
      const modelCount = typeof data.modelCount === 'number' && Number.isFinite(data.modelCount)
        ? String(data.modelCount)
        : '확인 불가';
      appendText(root, 'p', `사용 가능 모델 수: ${modelCount}`);
      const checkedAt = payload.checkedAt ?? data.checkedAt ?? (isRecord(payload.meta) ? payload.meta.checkedAt : undefined);
      appendText(root, 'p', `점검 시각: ${scalarText(checkedAt) ?? '확인 불가'}`);
      appendText(root, 'p', '사건 설명은 아직 실행하지 않았습니다');
      appendText(root, 'p', '연결 점검 결과일 뿐이며 사건 설명 결과가 아닙니다');
      if (payload.explanationAccepted === false) appendText(root, 'p', '사건 설명 수락: 아니요(explanationAccepted: false)');
      else if (payload.explanationAccepted === true) appendText(root, 'p', '사건 설명 수락: 예(explanationAccepted: true)');
      else appendText(root, 'p', '사건 설명 수락: 확인 불가(unknown)', 'unknown');
      if (typeof data.help === 'string') {
        const help = redact(data.help.slice(0, 300)) ?? '';
        appendText(root, 'p', `도움말: ${help}`);
      }
      return root;
    },
    renderExplanation(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', 'AI 사건 설명');
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const scalarText = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return null;
      };
      const redact = (value) => {
        if (typeof value !== 'string') return null;
        return /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|\bbearer\s+\S+|token=|key=|password|secret/i.test(value) ? '[가림]' : value;
      };
      const safeText = (value, max) => {
        const text = scalarText(value);
        return text === null ? null : (redact(text.slice(0, max)) ?? null);
      };
      const received = (value) => safeText(value, 40) ?? '없음';
      const safeCode = (value) => {
        if (typeof value !== 'string' || !value.trim()) return '코드 없음';
        const text = value.trim();
        return /^[A-Za-z0-9_.:-]{1,80}$/.test(text) ? text : (redact(text.slice(0, 80)) ?? '코드 없음');
      };
      const safeMessage = (value) => {
        if (typeof value !== 'string') return '원인 확인 불가';
        const firstLine = value.split(/\r?\n/)[0] ?? '';
        if (!firstLine.trim()) return '원인 확인 불가';
        return redact(firstLine.slice(0, 300)) ?? '원인 확인 불가';
      };
      const appendNotExecuted = () => appendText(root, 'p', 'AI 설명은 참고 정보입니다 · 설명·제안만으로 보안 조치를 실행하지 않습니다');

      const payload = isRecord(input) ? input : {};
      const event = isRecord(payload.event) ? payload.event : null;
      const explanation = isRecord(payload.explanation) ? payload.explanation : null;
      const status = explanation ? explanation.status : undefined;

      const mode = explanation
        ? (explanation.mode ?? (isRecord(explanation.meta) ? explanation.meta.mode : undefined))
        : undefined;
      let modeLabel;
      if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      else modeLabel = `확인 불가(unknown) · 받은 값: ${received(mode)}`;
      appendText(root, 'p', `연결 모드: ${modeLabel}`);

      // 1) 오류는 사건 선택 여부와 관계없이 먼저 표시합니다.
      if (status === 'error') {
        const error = isRecord(explanation.error) ? explanation.error : {};
        const code = safeCode(error.code);
        appendText(root, 'p', `AI 설명 실패: ${safeMessage(error.message)} (error, ${code})`, 'error');
        const provisioning = ['ON_AI_PROVISIONING_PENDING', 'ON_AI_TRANSPORT_PENDING', 'ON_AI_AUTHORIZATION_CHANGED', 'ON_AI_TEST_TRANSPORT_ONLY'];
        let reason;
        if (error.code === 'ON_AI_INVALID_INPUT') reason = '근거 부족 · 기록의 근거·규칙·현재 상태가 부족해 설명을 만들 수 없습니다';
        else if (error.code === 'ON_AI_INVALID_OUTPUT') reason = '근거 불일치 · AI 설명의 근거와 형식을 기록과 대조해 확인할 수 없습니다';
        else if (error.code === 'WB_CLCO_CANCELLED') reason = '요청 취소됨 · 이전 설명은 현재 결과가 아닙니다';
        else if (provisioning.includes(error.code)) reason = '앱 권한 준비 중 · 실제 사건 설명은 실행되지 않았습니다';
        else if (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED') reason = '확인 불가(unknown) · 응답 형식이 계약과 다름';
        else reason = `확인 불가(unknown) · 받은 코드: ${code}`;
        appendText(root, 'p', `실패 이유: ${reason}`, 'error');
        appendText(root, 'p', '기록은 그대로입니다 · 업무 앱 판정과 보안 기록은 계속 사용할 수 있습니다');
        appendNotExecuted();
        return root;
      }

      // 2) 오류가 없고 사건을 고르지 않았으면 선택 안내만 표시합니다.
      if (event === null) {
        appendText(root, 'p', '보안 기록에서 기록을 먼저 고르세요', 'idle');
        appendNotExecuted();
        return root;
      }
      const eventId = scalarText(event.id);
      if (eventId === null) {
        appendText(root, 'p', '확인 불가(unknown): 선택한 기록의 사건 ID 없음 · 설명을 표시하지 않습니다', 'unknown');
        appendNotExecuted();
        return root;
      }

      // 3) 요청 전·요청 중·취소·모르는 상태는 성공으로 보이지 않게 합니다.
      if (!explanation) {
        appendText(root, 'p', '확인 불가(unknown) · 설명 응답 없음', 'unknown');
        appendNotExecuted();
        return root;
      }
      if (status === 'idle') {
        appendText(root, 'p', `선택한 사건 ID: ${eventId} · 아직 설명을 요청하지 않음(idle)`, 'idle');
        appendNotExecuted();
        return root;
      }
      if (status === 'loading') {
        appendText(root, 'p', `선택한 사건 ID: ${eventId} · 설명 요청 중(loading)`, 'loading');
        appendNotExecuted();
        return root;
      }
      if (status === 'cancelled') {
        appendText(root, 'p', '설명 요청 취소됨(cancelled) · 이전 설명은 현재 결과가 아닙니다', 'cancelled');
        appendNotExecuted();
        return root;
      }
      if (status !== 'ok') {
        appendText(root, 'p', `확인 불가(unknown) · 받은 status: ${received(status)}`, 'unknown');
        appendNotExecuted();
        return root;
      }

      // 4) 성공 응답도 근거·실행 여부를 대조한 뒤에만 성공으로 표시합니다.
      const data = isRecord(explanation.data) ? explanation.data : null;
      const evidenceRows = Array.isArray(event.evidence) ? event.evidence : null;
      const evidenceText = new Map();
      if (evidenceRows) {
        for (const row of evidenceRows) {
          const id = isRecord(row) ? scalarText(row.id) : null;
          if (id !== null && !evidenceText.has(id)) evidenceText.set(id, isRecord(row) ? row.text : undefined);
        }
      }
      const supportedActions = Array.isArray(event.supportedActions) ? event.supportedActions : null;
      const problems = [];
      const unmatched = [];
      const checkIds = (ids, label) => {
        if (!Array.isArray(ids) || ids.length === 0) {
          problems.push(`근거 부족 · ${label}에 인용한 근거 ID가 없습니다`);
          return;
        }
        const seen = new Set();
        for (const id of ids) {
          const text = typeof id === 'string' && id.trim() ? id : null;
          if (text === null || !evidenceText.has(text)) {
            unmatched.push(received(id));
          } else if (seen.has(text)) {
            problems.push(`근거 불일치 · ${label}에 같은 근거 ID가 중복됨(${received(text)})`);
          }
          if (text !== null) seen.add(text);
        }
      };
      if (!data) {
        problems.push('설명 자료 없음');
      } else {
        if (typeof data.summary !== 'string' || !data.summary.trim()) problems.push('AI 요약 없음');
        if (data.executed !== false) problems.push(`AI가 이미 실행했다고 답한 설명은 쓸 수 없습니다(executed: ${typeof data.executed === 'boolean' ? String(data.executed) : received(data.executed)})`);
        if (data.requiresHumanConfirmation !== true) problems.push('사람 확인 필요 표시(requiresHumanConfirmation: true)가 없습니다');
        if (!evidenceRows || evidenceText.size === 0) problems.push('근거 부족 · 선택한 기록에 대조할 근거가 없습니다');
        checkIds(data.evidenceIds, 'AI 요약');
        if (!Array.isArray(data.proposals)) {
          problems.push('확인 불가(unknown) · 제안 목록 형식이 아님');
        } else {
          data.proposals.forEach((proposal, index) => {
            const label = `제안 ${index + 1}`;
            if (!isRecord(proposal)) {
              problems.push(`확인 불가(unknown) · ${label} 형식이 아님`);
              return;
            }
            const action = scalarText(proposal.action);
            if (action === null) problems.push(`확인 불가(unknown) · ${label}의 조치 이름 없음`);
            else if (!supportedActions || !supportedActions.includes(action)) problems.push(`연동 시스템이 지원하지 않는 조치 제안(${received(action)})`);
            checkIds(proposal.evidenceIds, label);
          });
        }
        const targetIds = ['eventId', 'incidentId'].filter((key) => Object.hasOwn(data, key) && data[key] !== undefined && data[key] !== null && data[key] !== '');
        if (targetIds.some((key) => scalarText(data[key]) !== eventId)) problems.push('선택한 사건과 설명 대상 사건이 다름');
      }
      if (unmatched.length > 0) {
        problems.push(`근거 불일치 · 선택한 기록에 없는 근거 ID: ${[...new Set(unmatched)].join(', ')}`);
      }
      if (problems.length > 0) {
        appendText(root, 'p', `선택한 사건 ID: ${eventId}`);
        appendText(root, 'p', 'AI 설명을 쓸 수 없습니다 · 내용을 표시하지 않습니다', 'unknown');
        const list = document.createElement('ul');
        for (const problem of problems) appendText(list, 'li', `이유: ${problem}`);
        root.append(list);
        if (isRecord(explanation.error) && typeof explanation.error.code === 'string' && explanation.error.code.trim()) {
          appendText(root, 'p', `오류 코드: ${safeCode(explanation.error.code)}`);
        }
        appendText(root, 'p', '기록은 그대로입니다 · 업무 앱 판정과 보안 기록은 계속 사용할 수 있습니다');
        appendNotExecuted();
        return root;
      }

      root.setAttribute('data-student-explanation-event', eventId);
      appendText(root, 'h3', 'AI 설명(참고용)');
      appendText(root, 'p', `사건 ID: ${eventId}`);
      appendText(root, 'p', `AI 요약: ${safeText(data.summary, 1500) ?? '확인 불가'}`);
      appendText(root, 'p', 'AI 설명은 해석입니다 · 사실 판단은 아래 근거 글과 연동 시스템이 알려 준 상태로 합니다');

      appendText(root, 'h4', '인용한 근거');
      const evidenceList = document.createElement('ul');
      for (const id of data.evidenceIds) {
        appendText(evidenceList, 'li', `${id} — ${safeText(evidenceText.get(id), 500) ?? '근거 글 확인 불가'}`);
      }
      root.append(evidenceList);

      appendText(root, 'h4', '규칙');
      const rules = event.rules;
      if (!Array.isArray(rules)) {
        appendText(root, 'p', '확인 불가(unknown) · 규칙 목록 형식이 아님', 'unknown');
      } else if (rules.length === 0) {
        appendText(root, 'p', '규칙 없음(0건)');
      } else {
        const ruleList = document.createElement('ul');
        for (const rule of rules) {
          const id = isRecord(rule) ? safeText(rule.id, 80) : null;
          const text = isRecord(rule) ? safeText(rule.text, 500) : null;
          appendText(ruleList, 'li', `${id ?? '규칙 ID 확인 불가'} — ${text ?? '규칙 글 확인 불가'}`);
        }
        root.append(ruleList);
      }

      const state = isRecord(event.state) ? event.state : {};
      const stateItems = [
        ['접속', state.access, { allowed: '허용됨(allowed)', denied: '거부됨(denied)' }],
        ['세션', state.session, { active: '활성(active)', expired: '주의: 만료(expired)', revoked: '주의: 철회됨(revoked)' }],
        ['기기', state.device, { compliant: '보안 기준 충족(compliant)', noncompliant: '주의: 보안 기준 미충족(noncompliant)' }],
      ];
      appendText(root, 'h4', '현재 상태(연동 시스템이 알려 준 값)');
      const unknownLines = [];
      for (const [label, value, known] of stateItems) {
        let line;
        if (typeof value === 'string' && Object.hasOwn(known, value)) {
          line = `${label}: ${known[value]}`;
        } else if (value === 'unknown') {
          line = `${label}: 확인 불가(unknown)`;
          unknownLines.push(line);
        } else {
          line = `${label}: 확인 불가(unknown) · 받은 값: ${received(value)}`;
          unknownLines.push(line);
        }
        appendText(root, 'p', line, unknownLines.includes(line) ? 'unknown' : undefined);
      }
      appendText(root, 'h4', '확인 불가 상태');
      if (unknownLines.length === 0) {
        appendText(root, 'p', '없음');
      } else {
        const unknownList = document.createElement('ul');
        for (const line of unknownLines) appendText(unknownList, 'li', line, 'unknown');
        root.append(unknownList);
        appendText(root, 'p', '확인 불가 상태는 정상이나 안전으로 보지 않습니다');
      }

      appendText(root, 'h4', 'AI 제안');
      if (data.proposals.length === 0) {
        if (supportedActions && supportedActions.length === 0) {
          appendText(root, 'p', '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상)');
        } else if (!supportedActions) {
          appendText(root, 'p', 'AI가 제안한 조치가 없습니다 · 지원 조치 목록은 확인 불가(unknown)');
        } else {
          appendText(root, 'p', 'AI가 제안한 조치가 없습니다');
        }
      } else {
        const proposalList = document.createElement('ul');
        for (const proposal of data.proposals) {
          const item = document.createElement('li');
          appendText(item, 'p', `조치: ${safeText(proposal.action, 80) ?? '확인 불가'}`);
          appendText(item, 'p', `이유: ${safeText(proposal.reason, 500) ?? '이유 없음'}`);
          appendText(item, 'p', `근거 ID: ${proposal.evidenceIds.join(', ')}`);
          appendText(item, 'p', '사람 확인이 필요하며 실행되지 않았습니다', 'not-executed');
          proposalList.append(item);
        }
        root.append(proposalList);
      }

      const checkedAt = payload.checkedAt ?? explanation.checkedAt ?? (isRecord(explanation.meta) ? explanation.meta.checkedAt : undefined);
      appendText(root, 'p', `설명 시각: ${safeText(checkedAt, 40) ?? '확인 불가'}`);
      appendNotExecuted();
      return root;
    },
    renderAction(input) {
      const root = document.createElement('div');
      root.setAttribute('aria-label', '조치 상태');
      const appendText = (parent, tag, value, state) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (state) node.setAttribute('data-state', state);
        parent.append(node);
        return node;
      };
      const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
      const scalarText = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return null;
      };
      const redact = (value) => {
        if (typeof value !== 'string') return null;
        return /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}|\bbearer\s+\S+|token=|key=|password|secret/i.test(value) ? '[가림]' : value;
      };
      const safeText = (value, max) => {
        const text = scalarText(value);
        return text === null ? null : (redact(text.slice(0, max)) ?? null);
      };
      const received = (value) => {
        if (typeof value === 'boolean') return String(value);
        return safeText(value, 40) ?? '없음';
      };
      const safeCode = (value) => {
        if (typeof value !== 'string' || !value.trim()) return '코드 없음';
        const text = value.trim();
        return /^[A-Za-z0-9_.:-]{1,80}$/.test(text) ? text : (redact(text.slice(0, 80)) ?? '코드 없음');
      };
      const safeMessage = (value) => {
        if (typeof value !== 'string') return null;
        const firstLine = value.split(/\r?\n/)[0] ?? '';
        if (!firstLine.trim()) return null;
        return redact(firstLine.slice(0, 300));
      };
      const timeLabel = (value) => {
        const original = safeText(value, 40);
        if (original === null) return '확인 불가(받은 값: 없음)';
        const milliseconds = Date.parse(original);
        if (!Number.isFinite(milliseconds)) return `확인 불가(받은 값: ${original})`;
        const korean = new Date(milliseconds + 9 * 60 * 60 * 1000);
        if (!Number.isFinite(korean.getTime())) return `확인 불가(받은 값: ${original})`;
        const pad = (number, width = 2) => String(number).padStart(width, '0');
        return `${original} (한국 시각 ${pad(korean.getUTCFullYear(), 4)}-${pad(korean.getUTCMonth() + 1)}-${pad(korean.getUTCDate())} ${pad(korean.getUTCHours())}:${pad(korean.getUTCMinutes())}:${pad(korean.getUTCSeconds())})`;
      };
      const rerequestGuide = '결과는 제공 화면의 「원천 결과만 재조회」(문서 이름 「연동 시스템 결과만 재조회」)로만 다시 조회하세요 · 집행을 다시 요청하지 마세요';

      const payload = isRecord(input) ? input : {};
      const status = payload.status;
      const event = isRecord(payload.event) ? payload.event : null;
      const eventId = event ? scalarText(event.id) : null;
      const actionId = safeText(payload.actionId, 80);
      const target = isRecord(payload.target) ? payload.target : null;
      const receipt = isRecord(payload.receipt) ? payload.receipt : null;
      const observation = isRecord(payload.observation)
        ? payload.observation
        : (receipt && isRecord(receipt.observation) ? receipt.observation : null);
      const requestId = receipt ? safeText(receipt.requestId, 80) : null;

      // 현재 사건·조치와 서버 접수 기록이 다르면 이전 결과로 보고 표시하지 않습니다.
      const bindingProblems = [];
      if (receipt) {
        const receiptEventId = scalarText(receipt.eventId);
        const receiptActionId = scalarText(receipt.actionId);
        if (receiptEventId !== null && eventId !== null && receiptEventId !== eventId) bindingProblems.push(`접수 기록의 사건(${received(receiptEventId)})이 현재 사건(${received(eventId)})과 다름`);
        if (receiptActionId !== null && actionId !== null && receiptActionId !== actionId) bindingProblems.push(`접수 기록의 조치(${received(receiptActionId)})가 현재 조치(${received(actionId)})와 다름`);
      }

      appendText(root, 'p', '이 칸에는 집행 버튼이 없습니다 · 조치 준비·집행·결과 재조회·취소는 제공 화면 버튼으로 사람이 직접 합니다 · 학생 화면은 요청을 보내지 않습니다');

      const known = ['idle', 'loading', 'prepared', 'executing', 'pending', 'succeeded', 'denied', 'failed', 'unknown', 'error', 'expired'];
      if (!known.includes(status)) {
        appendText(root, 'p', `결과 불명(unknown) · 받은 status: ${received(status)} · 성공으로도 효과 없음으로도 판단하지 않습니다`, 'unknown');
        appendText(root, 'p', rerequestGuide);
        return root;
      }
      if (bindingProblems.length > 0) {
        appendText(root, 'p', '확인 불가(unknown): 현재 사건·조치와 서버 접수 기록이 맞지 않아 이 결과를 표시하지 않습니다', 'unknown');
        const list = document.createElement('ul');
        for (const problem of bindingProblems) appendText(list, 'li', `이유: ${problem}`);
        root.append(list);
        appendText(root, 'p', '결과 불명으로 봅니다 · 성공으로도 효과 없음으로도 판단하지 않습니다');
        appendText(root, 'p', rerequestGuide);
        return root;
      }

      // 상태 문장
      const effectConfirmed = status === 'succeeded'
        && observation !== null
        && observation.effectApplied === true
        && safeText(observation.observedAt, 40) !== null
        && receipt !== null
        && safeText(receipt.receiptId, 80) !== null
        && receipt.superseded !== true
        && (receipt.status === undefined || receipt.status === 'succeeded');
      const message = safeMessage(payload.message);
      if (status === 'idle') {
        appendText(root, 'p', '아직 미실행(idle) · 조치를 준비하거나 집행하지 않았습니다', 'idle');
        if (event && Array.isArray(event.supportedActions) && event.supportedActions.length === 0) {
          appendText(root, 'p', '이 기록은 연동 시스템이 지원하는 조치가 없어 조치 준비 버튼이 나오지 않습니다(정상) · AI 제안은 참고 정보이며 실행되지 않습니다');
        } else {
          appendText(root, 'p', 'AI 제안만으로는 실행되지 않습니다 · 제공 화면에서 「조치 준비」를 누르고 사람이 확인해야 서버에 전달됩니다');
        }
      } else if (status === 'loading') {
        appendText(root, 'p', '조치 준비 또는 결과 조회 중(loading) · 결과가 아직 확인되지 않았습니다(완료 아님)', 'loading');
      } else if (status === 'prepared') {
        appendText(root, 'p', '준비됨·미실행(prepared) · 아직 서버에 집행을 요청하지 않았습니다', 'prepared');
        appendText(root, 'p', `확인 기한: ${timeLabel(payload.confirmationExpiresAt)}`);
        appendText(root, 'p', '아래 사건·근거·조치·실제 대상을 확인한 뒤, 기한 안에 제공 화면의 「대상과 조치를 확인했으며 집행합니다」를 사람이 직접 눌러야 전달됩니다');
      } else if (status === 'executing') {
        appendText(root, 'p', '서버에 전달 중(executing) · 결과가 아직 없습니다(완료 아님)', 'executing');
      } else if (status === 'pending') {
        appendText(root, 'p', '서버 접수·처리 중(pending) · 서버가 요청을 받았다는 응답(ACK)일 뿐 연동 시스템의 효과는 아직 관측되지 않았습니다 · 결과 확인 전(완료 아님)', 'pending');
        appendText(root, 'p', rerequestGuide);
      } else if (status === 'succeeded') {
        if (effectConfirmed) {
          appendText(root, 'p', '효과 확인(succeeded) · 서버가 연동 시스템에서 조회해 관측한 결과입니다', 'succeeded');
          appendText(root, 'p', `관측 시각: ${timeLabel(observation.observedAt)}`);
          appendText(root, 'p', 'effectApplied: true');
          appendText(root, 'p', `receiptId: ${safeText(receipt.receiptId, 80)}`);
        } else {
          appendText(root, 'p', `결과 불명(unknown) · 받은 status: succeeded · 효과 관측(effectApplied: true·관측 시각·receiptId)이 확인되지 않아 효과가 관측된 결과로 표시하지 않습니다 · effectApplied: ${observation ? received(observation.effectApplied) : '없음'}`, 'unknown');
          appendText(root, 'p', '성공으로도 효과 없음으로도 판단하지 않습니다');
          appendText(root, 'p', rerequestGuide);
        }
      } else if (status === 'denied') {
        appendText(root, 'p', `연동 시스템 거절(denied): ${message ?? '원인 확인 불가'}`, 'denied');
        appendText(root, 'p', '조치 효과는 확인되지 않았습니다');
      } else if (status === 'failed') {
        appendText(root, 'p', `연동 시스템 처리 실패(failed): ${message ?? '원인 확인 불가'}`, 'failed');
        appendText(root, 'p', '조치 효과는 확인되지 않았습니다');
      } else if (status === 'unknown') {
        appendText(root, 'p', '결과 불명(unknown) · 성공으로도 효과 없음으로도 판단하지 않습니다', 'unknown');
        if (receipt && receipt.superseded === true) appendText(root, 'p', '다른 요청으로 대체된 접수 기록입니다(superseded: true)');
        appendText(root, 'p', rerequestGuide);
      } else if (status === 'expired') {
        appendText(root, 'p', '확인 기한 지남(expired) · 집행 요청을 보내지 않았습니다 · AI 제안에서 「조치 준비」를 다시 누르세요', 'expired');
        appendText(root, 'p', `확인 기한: ${timeLabel(payload.confirmationExpiresAt)}`);
      } else if (status === 'error') {
        const error = isRecord(payload.error) ? payload.error : {};
        appendText(root, 'p', `요청 처리 안 됨(error, ${safeCode(error.code)}): ${safeMessage(error.message) ?? '원인 확인 불가'}`, 'error');
        appendText(root, 'p', '조치 효과는 확인되지 않았습니다 · 자동으로 다시 요청하지 않습니다');
      }
      if (message && !['denied', 'failed'].includes(status)) appendText(root, 'p', `제공 화면 안내: ${message}`);

      // 받은 범위의 식별자
      appendText(root, 'h4', '현재 조치 대상');
      if (eventId !== null) {
        root.setAttribute('data-student-action-event', eventId);
        appendText(root, 'p', `사건 ID(event.id): ${safeText(eventId, 80)}`);
        if (Array.isArray(event.evidence)) {
          const ids = event.evidence.map((row) => (isRecord(row) ? safeText(row.id, 80) : null)).filter((id) => id !== null);
          appendText(root, 'p', `근거 ID: ${ids.length > 0 ? ids.join(', ') : '없음'}`);
        }
      } else {
        appendText(root, 'p', '사건 ID: 없음 · 보안 기록에서 사건을 고르고 AI 제안에서 조치를 준비하세요');
      }
      if (actionId !== null) appendText(root, 'p', `조치(actionId): ${actionId}`);
      if (target) {
        appendText(root, 'p', `실제 대상(target.id): ${safeText(target.id, 80) ?? '확인 불가'}`);
        appendText(root, 'p', `대상 세대(target.generation): ${safeText(target.generation, 40) ?? '확인 불가'}`);
      }
      if (receipt) {
        if (requestId !== null) {
          root.setAttribute('data-student-action-request', requestId);
          appendText(root, 'p', `requestId: ${requestId}`);
        }
        const receiptId = safeText(receipt.receiptId, 80);
        if (receiptId !== null && !effectConfirmed) appendText(root, 'p', `receiptId: ${receiptId}`);
        const version = safeText(receipt.version, 20);
        if (version !== null) appendText(root, 'p', `version: ${version}`);
        if (receipt.replayed === true) appendText(root, 'p', '같은 요청에 대한 기존 접수 결과를 다시 받음(replayed: true) · 새로 집행한 것이 아닙니다');
        else if (receipt.replayed === false) appendText(root, 'p', 'replayed: false');
      }

      appendText(root, 'p', '「조치 화면 취소」는 화면만 닫으며 이미 서버에 전달된 조치 효과를 되돌리지 않습니다');
      return root;
    },
  };
  return view;
}
