// Shared helpers for the Vitest-flavoured TestRail / CQM reporters.
//
// Vitest 4.x: the canonical end-of-run hook is `onTestRunEnd(testModules)`.
// Each element has `.task` — the root file task (same shape JUnitReporter uses).
// `onTestCaseResult` may not fire on the main reporter instance when the default
// pool runs tests in worker threads, so always derive records from `testModules`
// when present (see `collectRecordsFromTestModules`).

const { getTasks, getFullName } = require('@vitest/runner/utils');

function isTestModuleList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const first = value[0];
  if (!first || typeof first !== 'object') {
    return false;
  }
  if (first.task && Array.isArray(first.task.tasks)) {
    return true;
  }
  return first.type === 'module' && typeof first.moduleId === 'string';
}

function pickTestModulesArg(args) {
  for (const arg of args) {
    if (isTestModuleList(arg)) {
      return arg;
    }
  }
  return [];
}

const PASSED_STATES = new Set(['passed', 'pass']);
const FAILED_STATES = new Set(['failed', 'fail']);
const SKIPPED_STATES = new Set(['skipped', 'skip', 'pending', 'todo', 'only']);

function classifyState(state) {
  if (PASSED_STATES.has(state)) {
    return 'passed';
  }
  if (FAILED_STATES.has(state)) {
    return 'failed';
  }
  if (SKIPPED_STATES.has(state)) {
    return 'skipped';
  }
  return 'failed';
}

function statusFromVitestTask(task) {
  if (!task) {
    return 'failed';
  }
  if (task.mode === 'skip' || task.mode === 'todo' || task.mode === 'only') {
    return 'skipped';
  }
  return classifyState(task.result?.state);
}

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function readResult(testCase) {
  if (!testCase) {
    return undefined;
  }
  if (typeof testCase.result === 'function') {
    return safeCall(() => testCase.result());
  }
  return testCase.result;
}

function readDiagnostic(testCase) {
  if (!testCase) {
    return undefined;
  }
  if (typeof testCase.diagnostic === 'function') {
    return safeCall(() => testCase.diagnostic());
  }
  return testCase.diagnostic;
}

function buildTitlePath(testCase) {
  const parts = [];
  let cursor = testCase;
  let guard = 0;
  while (cursor && guard < 50) {
    const name = cursor.name || cursor.title;
    if (name) {
      parts.unshift(name);
    }
    cursor = cursor.parent;
    guard += 1;
  }
  if (testCase?.module?.moduleId) {
    parts.unshift(testCase.module.moduleId);
  }
  return parts.filter(Boolean);
}

function firstErrorMessage(result) {
  const error = result?.errors?.[0];
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message || error.stack || String(error);
}

function toRecord(testCase) {
  const result = readResult(testCase);
  const diagnostic = readDiagnostic(testCase);
  const status = classifyState(result?.state ?? testCase?.mode);
  const duration = Number(diagnostic?.duration ?? result?.duration ?? 0) || 0;
  const startedAt = new Date();
  const endedAt = new Date(startedAt.getTime() + duration);
  const titlePath = buildTitlePath(testCase);
  const fullTitle = titlePath.slice(testCase?.module?.moduleId ? 1 : 0).join(' > ');
  return {
    title: testCase?.name || '',
    titlePath,
    fullTitle: fullTitle || titlePath.join(' > '),
    status,
    duration,
    startedAt,
    endedAt,
    errorMessage: firstErrorMessage(result),
    filePath: testCase?.module?.moduleId || ''
  };
}

function collectFromReportedTestCase(testCase, filePath) {
  const task = testCase?.task;
  if (!task || task.type !== 'test') {
    return null;
  }

  const fullTitle =
    typeof testCase.fullName === 'string' && testCase.fullName
      ? testCase.fullName
      : getFullName(task);
  const status = statusFromVitestTask(task);
  const duration = Number(task.result?.duration ?? 0) || 0;
  const startedAt = new Date();
  const endedAt = new Date(startedAt.getTime() + duration);

  return {
    title: task.name || '',
    titlePath: [],
    fullTitle,
    status,
    duration,
    startedAt,
    endedAt,
    errorMessage: firstErrorMessage(task.result),
    filePath: filePath || ''
  };
}

function collectFromReportedModuleChildren(testModule) {
  const records = [];
  const filePath = testModule?.moduleId || testModule?.task?.filepath || testModule?.task?.name || '';

  const children = testModule?.children;
  if (!children) {
    return records;
  }

  const iterable = typeof children.allTests === 'function' ? children.allTests() : children;
  for (const testCase of iterable) {
    const row = collectFromReportedTestCase(testCase, filePath);
    if (row) {
      records.push(row);
    }
  }

  return records;
}

function collectRecordsFromTestModules(testModules = []) {
  const records = [];

  for (const testModule of testModules) {
    const file = testModule?.task;
    if (file && Array.isArray(file.tasks)) {
      const tasks = getTasks(file.tasks);
      for (const task of tasks) {
        if (task.type !== 'test') {
          continue;
        }

        const fullTitle = getFullName(task);
        const status = statusFromVitestTask(task);
        const duration = Number(task.result?.duration ?? 0) || 0;
        const startedAt = new Date();
        const endedAt = new Date(startedAt.getTime() + duration);

        records.push({
          title: task.name || '',
          titlePath: [],
          fullTitle,
          status,
          duration,
          startedAt,
          endedAt,
          errorMessage: firstErrorMessage(task.result),
          filePath: file.filepath || file.name || ''
        });
      }
      continue;
    }

    records.push(...collectFromReportedModuleChildren(testModule));
  }

  return records;
}

module.exports = {
  classifyState,
  collectRecordsFromTestModules,
  pickTestModulesArg,
  statusFromVitestTask,
  toRecord
};
