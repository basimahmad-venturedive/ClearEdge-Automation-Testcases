/**
 * Standardized test case wrapper with TestRail ID and tags.
 * Pass the extended test instance (webFixtures or apiFixtures).
 * testFn must use object destructuring for fixtures: async ({ loginPage }) => {}
 */
export const testCase = (test, { id, tags = [], title, test: testFn }) => {
  const allTags = [...tags, id ? `@${id}` : ''].filter(Boolean);

  test(title, {
    tag: allTags,
    annotation: [{ type: 'testrail', description: id || '' }],
  }, testFn);
};
