import type { GitNeatApi } from "../../src/api";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ReferenceApi extends GitNeatApi {
  git(cwd: string, args: string[], env?: Record<string, string>, input?: string): Promise<GitResult>;
}

export const gitneat = (): ReferenceApi => window.gitneat as ReferenceApi;
