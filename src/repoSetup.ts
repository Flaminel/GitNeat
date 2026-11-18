export const BAD_REF_NAME = /^-|\s|\.\.|[~^:?*\[\\]/;

export const DEFAULT_BRANCH = "main";
export const DEFAULT_DEPTH = 50;

export const cloneName = (url: string): string => url.trim().replace(/[/\\]+$/, "").split(/[/\\:]/).pop()?.replace(/\.git$/, "") || "repo";

export const isAbsolutePath = (path: string): boolean => /^([a-zA-Z]:[\\/]|[\\/])/.test(path.trim());

export const pathSeparator = (path: string): string => (path.includes("\\") && !path.includes("/") ? "\\" : "/");

export const trimSeparators = (path: string): string => path.trim().replace(/[/\\]+$/, "");

export const joinPath = (parent: string, name: string): string => `${trimSeparators(parent)}${pathSeparator(parent)}${name.trim()}`;

export const validFolderName = (name: string): boolean => {
  const value = name.trim();
  return value !== "" && value !== "." && !/[/\\]/.test(value) && !value.includes("..");
};

export const validBranchName = (name: string): boolean => !BAD_REF_NAME.test(name.trim());

export const validSince = (since: string): boolean => since.trim() === "" || !Number.isNaN(Date.parse(since.trim()));

export const validDepth = (depth: string): boolean => depth.trim() === "" || /^[1-9]\d*$/.test(depth.trim());
