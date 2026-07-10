const fs = require('node:fs');

class MarkdownTestCaseParser {
  parseFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parse(content);
  }

  parse(content) {
    return content
      .split(/^---$/m)
      .map((block) => block.trim())
      .filter((block) => block.includes('## Test Case ID:'))
      .map((block) => this.parseBlock(block));
  }

  parseBlock(block) {
    const testCase = {
      caseId: this.extractSingleLineField(block, 'Test Case ID'),
      title: this.extractSingleLineField(block, 'Title'),
      description: this.extractSingleLineField(block, 'Description'),
      module: this.extractSingleLineField(block, 'Module'),
      actor: this.extractSingleLineField(block, 'Actor'),
      label: this.extractSingleLineField(block, 'Label'),
      type: this.extractSingleLineField(block, 'Type'),
      priority: this.extractSingleLineField(block, 'Priority'),
      steps: this.extractListField(block, 'Steps'),
      expectedResult: this.extractTextField(block, 'Expected Result')
    };

    testCase.description = testCase.description || testCase.title;
    return testCase;
  }

  extractSingleLineField(block, fieldName) {
    const pattern = new RegExp(`(?:^|\\n)(?:##\\s*)?${fieldName}:\\s*(.+)`, 'i');
    const match = block.match(pattern);
    return match ? match[1].trim() : '';
  }

  extractListField(block, fieldName) {
    const fieldText = this.extractSection(block, fieldName);

    if (!fieldText) {
      return [];
    }

    return fieldText
      .split('\n')
      .map((line) => line.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }

  extractTextField(block, fieldName) {
    return this.extractSection(block, fieldName).trim();
  }

  extractSection(block, fieldName) {
    const pattern = new RegExp(`${fieldName}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Za-z ]+:|$)`, 'i');
    const match = block.match(pattern);
    return match ? match[1].trim() : '';
  }
}

module.exports = { MarkdownTestCaseParser };
