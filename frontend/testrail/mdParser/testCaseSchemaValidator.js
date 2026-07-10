class TestCaseSchemaValidator {
  validateAll(testCases) {
    if (testCases.length === 0) {
      throw new Error('No test cases found in markdown file.');
    }

    for (const testCase of testCases) {
      this.validate(testCase);
    }
  }

  validate(testCase) {
    const missingFields = [];

    for (const field of ['caseId', 'title', 'module', 'steps', 'expectedResult']) {
      if (Array.isArray(testCase[field]) && testCase[field].length === 0) {
        missingFields.push(field);
      } else if (!Array.isArray(testCase[field]) && !testCase[field]) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      throw new Error(`Invalid test case ${testCase.caseId || '(unknown)'}: missing ${missingFields.join(', ')}`);
    }
  }
}

module.exports = { TestCaseSchemaValidator };
