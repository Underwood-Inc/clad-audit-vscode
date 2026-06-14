import type { CladFinding } from '@underwoodinc/clad-audit/types';

export type StoredFinding = {
  id: string;
  rootDir: string;
  finding: CladFinding;
};

let findingCounter = 0;

export function storeFinding(rootDir: string, finding: CladFinding): StoredFinding {
  findingCounter += 1;
  return {
    id: `clad-${findingCounter}`,
    rootDir,
    finding,
  };
}
