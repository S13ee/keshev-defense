// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
let eventFilterState = { kind: 'all', appId: 'all', access: 'all' };

export function createStudentView() {
  return {
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
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
