// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
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
      const unknownValue = (value) => {
        const raw = rawCode(value);
        return raw === null ? '확인 불가(값 없음)' : `확인 불가(받은 값: ${raw})`;
      };
      const displayValue = (value) => {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return '확인 불가';
      };
      const mode = payload
        ? (payload.mode ?? (isRecord(payload.meta) ? payload.meta.mode : undefined))
        : undefined;
      let modeLabel = unknownValue(mode);
      if (mode === 'connected') modeLabel = '실제 연결(connected)';
      else if (mode === 'demo') modeLabel = '예제 자료(demo)';
      else if (mode === 'disconnected') modeLabel = '연결 없음(disconnected)';
      else if (mode === 'unknown') modeLabel = '확인 불가(unknown)';
      appendText(root, 'p', `연결 모드: ${modeLabel}`);

      if (!payload) {
        appendText(root, 'p', '확인 불가(값 없음)', 'unknown');
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
          appendText(root, 'p', `확인 불가: 응답 형식이 계약과 다름(error, ${code}): ${message} · 허용도 거부도 아닙니다`, 'unknown');
        } else {
          appendText(root, 'p', `요청 실패(error, ${code}): ${message} · 접근 거부 판정이 아닙니다`, 'error');
        }
        return root;
      }
      if (status !== 'ok') {
        appendText(root, 'p', status === undefined || status === null || status === ''
          ? '확인 불가(값 없음)'
          : unknownValue(status), 'unknown');
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
        appendText(root, 'p', '확인 불가: 선택한 앱과 판정 대상 앱이 다름 · 허용되지 않음', 'mismatch');
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
          const decisionLabel = decision === undefined || decision === null || decision === ''
            ? '확인 불가(값 없음)'
            : unknownValue(decision);
          appendText(root, 'p', `판정: ${decisionLabel} · 허용되지 않음`, 'unknown');
        }
      }

      const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason : '확인 불가';
      const checkedAtValue = data.checkedAt ?? (isRecord(payload.meta) ? payload.meta.checkedAt : undefined);
      appendText(root, 'p', `판정 이유: ${reason}`);
      appendText(root, 'p', `판정 시각: ${displayValue(checkedAtValue)}`);
      return root;
    },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
