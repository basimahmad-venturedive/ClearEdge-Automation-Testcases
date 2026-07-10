const { isAutomatedCase } = require('../utils/automationIds');

class CaseImporter {
  constructor({ client, projectId, mappingStore, automatedIds = new Set() }) {
    this.client = client;
    this.projectId = projectId;
    this.mappingStore = mappingStore;
    this.automatedIds = automatedIds;
  }

  async importCases(testCases) {
    const sections = await this.ensureSections(testCases);
    const existingCases = await this.client.getCases(this.projectId);
    const mapping = this.mappingStore.loadMapping();

    for (const testCase of testCases) {
      const section = sections.get(testCase.module);
      const existingCase = this.findExistingCase(existingCases, testCase, section.id);
      const payload = this.toTestRailPayload(testCase);

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
      type_id: this.typeIdFor(testCase.type),
      priority_id: this.priorityIdFor(testCase.priority || testCase.label),
      custom_preconds: this.buildPreconditions(testCase),
      custom_steps: testCase.steps.join('\n'),
      custom_expected: testCase.expectedResult
    };

    if (isAutomatedCase(testCase, this.automatedIds)) {
      payload.custom_automated = 1;
    }

    return payload;
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

  typeIdFor(type) {
    const normalizedType = (type || '').toLowerCase().replace(/\s+/g, ' ').trim();

    if (normalizedType.includes('functional web')) {
      return 13;
    }

    if (normalizedType.includes('functional mobile')) {
      return 14;
    }

    if (normalizedType.includes('security')) {
      return 8;
    }

    if (normalizedType.includes('performance')) {
      return 9;
    }

    if (normalizedType.includes('functional')) {
      return 6;
    }

    return 13;
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
