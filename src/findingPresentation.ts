import type { CladFinding } from '@underwoodinc/clad-audit/types';
import * as vscode from 'vscode';

/** Convert 1-based auditor range to a VS Code Range (0-based, end-exclusive). */
export function findingToRange(finding: CladFinding): vscode.Range {
  const startLine = Math.max(0, (finding.line ?? 1) - 1);
  const startColumn = Math.max(0, (finding.column ?? 1) - 1);
  const endLine = Math.max(startLine, (finding.endLine ?? finding.line ?? 1) - 1);

  let endColumn: number;
  if (finding.endColumn != null) {
    endColumn = Math.max(startColumn + 1, finding.endColumn);
  } else {
    endColumn = Number.MAX_SAFE_INTEGER;
  }

  return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

export function formatFindingLocation(finding: CladFinding): string {
  const line = finding.line ?? 1;
  if (finding.column != null && finding.column > 1) {
    return `${line}:${finding.column}`;
  }
  return String(line);
}

export function remediationDocument(finding: CladFinding): string {
  const lines = [
    `# CLAD remediation — ${finding.rule}`,
    '',
    finding.message,
    '',
    '## Advice',
    finding.advice,
  ];

  if (finding.reasoning?.length) {
    lines.push('', '## Reasoning', ...finding.reasoning.map((r) => `- ${r}`));
  }

  const plan = finding.remediation;
  if (plan) {
    lines.push('', '## Plan', plan.summary, '');
    plan.steps.forEach((step, i) => {
      lines.push(`${i + 1}. **${step.action}** — ${step.summary}`);
      if (step.details) lines.push(`   ${step.details}`);
    });
    if (plan.suggestedTargetPath) {
      lines.push('', `**Suggested path:** \`${plan.suggestedTargetPath}\``);
    }
    if (plan.configExceptionYaml) {
      lines.push('', '## Config exception (`.clad-audit.yaml`)', '```yaml', plan.configExceptionYaml, '```');
    }
  }

  if (finding.expectedTier) {
    lines.push('', `**Expected tier:** \`${finding.expectedTier}\``);
  }
  if (finding.importSpecifier) {
    lines.push('', `**Import:** \`${finding.importSpecifier}\``);
  }

  return lines.join('\n');
}

export function copyableRemediation(finding: CladFinding): string {
  const parts = [finding.advice, finding.remediation?.summary];
  if (finding.remediation?.suggestedTargetPath) {
    parts.push(`Suggested path: ${finding.remediation.suggestedTargetPath}`);
  }
  if (finding.remediation?.configExceptionYaml) {
    parts.push('', 'Config exception:', finding.remediation.configExceptionYaml);
  }
  return parts.filter(Boolean).join('\n\n');
}
