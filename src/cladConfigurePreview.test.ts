import { describe, expect, test } from 'vitest';
import { describeEffectiveConfig, describeFindingsTreeLayout } from './cladConfigurePreview.js';
import { DEFAULT_FINDINGS_VIEW_CONFIG } from './findingsViewTypes.js';

test('describeFindingsTreeLayout for root + nested rule', () => {
  expect(describeFindingsTreeLayout({ groupBy: 'root', nestedGroupBy: 'rule' })).toBe(
    'Audit root → By rule → File → Finding',
  );
});

test('describeFindingsTreeLayout hides nested when not root mode', () => {
  expect(describeFindingsTreeLayout({ groupBy: 'rule', nestedGroupBy: 'tier' })).toBe(
    'Rule → File → Finding',
  );
});

test('describeEffectiveConfig includes project yaml hint', () => {
  const lines = describeEffectiveConfig({
    ...DEFAULT_FINDINGS_VIEW_CONFIG,
    groupBy: 'rule',
    projectConfigSource: '/repo/apps/mappy/.clad-audit.yaml',
    useProjectConfig: true,
  });
  expect(lines.some((l) => l.includes('YAML defaults'))).toBe(true);
  expect(lines.some((l) => l.includes('Rule'))).toBe(true);
});
