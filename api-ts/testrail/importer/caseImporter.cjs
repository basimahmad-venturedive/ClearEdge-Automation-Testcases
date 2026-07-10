class CaseImporter {
  constructor({
    client,
    projectId,
    mappingStore,
    customQanameId,
    templateId,
    apiTypeId = 15,
    customAutomatedNo,
    customAutomatedYes,
    automatedCaseIds = new Set()
  }) {
    this.client = client;
    this.projectId = projectId;
    this.mappingStore = mappingStore;
    /** @type {number|undefined} API expects a natural number (dropdown option id). */
    this.customQanameId = customQanameId;
    /** @type {number|undefined} TestRail case template id (e.g. 6 for backend in this project). */
    this.templateId = templateId;
    /** @type {number} TestRail case type id — TEST type for API cases (default 15). */
    this.apiTypeId = apiTypeId;
    /** @type {number|undefined} custom_automated dropdown id for "No". */
    this.customAutomatedNo = customAutomatedNo;
    /** @type {number|undefined} custom_automated dropdown id for "Yes". */
    this.customAutomatedYes = customAutomatedYes;
    /** @type {Set<string>} TC-IDs with automation/backend paths in TRACEABILITY.md */
    this.automatedCaseIds = automatedCaseIds;
  }

  async importCases(testCases) {
    const sections = await this.ensureSections(testCases);
    const existingCases = await this.client.getCases(this.projectId);
    const mapping = this.mappingStore.loadMapping();
    let automatedYesCount = 0;

    for (const testCase of testCases) {
      const section = sections.get(testCase.module);
      const existingCase = this.findExistingCase(existingCases, testCase, section.id);
      const payload = this.toTestRailPayload(testCase);

      if (payload.custom_automated === this.customAutomatedYes) {
        automatedYesCount += 1;
      }

      if (existingCase) {
        const updatedCase = await this.client.updateCase(existingCase.id, payload);
        mapping[testCase.caseId] = updatedCase.id || existingCase.id;
      } else {
        const createdCase = await this.client.addCase(section.id, payload);
        mapping[testCase.caseId] = createdCase.id;
        existingCases.push(createdCase);
      }
    }

    this.mappingStore.saveMapping(mapping);
    this.lastAutomatedYesCount = automatedYesCount;
    return mapping;
  }

  async ensureSections(testCases) {
    const sections = await this.client.getSections(this.projectId);
    const sectionByName = new Map(sections.map((section) => [section.name, section]));
    const modules = [...new Set(testCases.map((testCase) => testCase.module))];

    for (const moduleName of modules) {
      if (!sectionByName.has(moduleName)) {
        const createdSection = await this.client.addSection(this.projectId, moduleName);
        sectionByName.set(moduleName, createdSection);
      }
    }

    return sectionByName;
  }

  findExistingCase(existingCases, testCase, sectionId) {
    return existingCases.find((existingCase) => {
      const sameRef = (existingCase.refs || '').split(',').map((ref) => ref.trim()).includes(testCase.caseId);
      const sameTitleAndSection = existingCase.title === testCase.title && existingCase.section_id === sectionId;
      return sameRef || sameTitleAndSection;
    });
  }

  toTestRailPayload(testCase) {
    const payload = {
      title: testCase.title,
      refs: testCase.caseId,
      type_id: this.apiTypeId,
      priority_id: this.priorityIdFor(testCase.priority || testCase.label),
      custom_preconds: this.buildPreconditions(testCase),
      custom_steps: testCase.steps.join('\n'),
      custom_expected: testCase.expectedResult
    };
    if (this.customQanameId !== undefined) {
      payload.custom_qaname = this.customQanameId;
    }
    if (this.templateId !== undefined) {
      payload.template_id = this.templateId;
    }
    const automatedValue = this.customAutomatedValueFor(testCase.caseId);
    if (automatedValue !== undefined) {
      payload.custom_automated = automatedValue;
    }
    return payload;
  }

  customAutomatedValueFor(caseId) {
    const isAutomated = this.automatedCaseIds.has(caseId);
    if (isAutomated) {
      return this.customAutomatedYes;
    }
    return this.customAutomatedNo;
  }

  buildPreconditions(testCase) {
    const lines = [];

    if (testCase.actor) {
      lines.push(`Actor: ${testCase.actor}`);
    }

    if (testCase.label) {
      lines.push(`Label: ${testCase.label}`);
    }

    if (testCase.description) {
      lines.push(`Description: ${testCase.description}`);
    }

    return lines.join('\n');
  }

  priorityIdFor(priority) {
    const normalizedPriority = (priority || '').toLowerCase();

    if (normalizedPriority.includes('critical')) {
      return 4;
    }

    if (normalizedPriority.includes('high')) {
      return 3;
    }

    if (normalizedPriority.includes('low')) {
      return 1;
    }

    return 2;
  }
}

module.exports = { CaseImporter };
