export const COMMIT_STEP = 200;
export const COMMIT_CEILING = 100000;

export const pageSize = (limit: number): number => Math.max(0, Math.min(COMMIT_STEP, COMMIT_CEILING - limit));

export const canLoadMore = (lazyLoad: boolean, loaded: number, limit: number): boolean =>
  lazyLoad && loaded >= limit && limit < COMMIT_CEILING;

export const showsFooter = (lazyLoad: boolean): boolean => !lazyLoad;
