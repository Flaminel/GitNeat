import { ReactElement } from "react";

const svg = (body: ReactElement, size = 14) => (
  <svg viewBox="0 0 16 16" className="icon" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {body}
  </svg>
);

export const Icon = {
  local: svg(<path d="M3 3.5h10v6.5H3z M1.5 12.5h13" />, 13),
  remote: svg(<path d="M4.5 12.5h7a3 3 0 0 0 .3-6 4 4 0 0 0-7.6-1A3.5 3.5 0 0 0 4.5 12.5z" />, 13),
  tag: svg(
    <>
      <path d="M2 2h6l6 6-6 6-6-6z" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
    </>,
    13,
  ),
  gear: svg(
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4" />
    </>,
  ),
  check: svg(<path d="M3 8.5l3 3 7-7" strokeWidth="2" />, 13),
  branch: svg(
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 5v6 M11.5 6.5c0 3-7 2-7 4.5" />
    </>,
  ),
  folder: svg(<path d="M1.5 4h5l1.5 1.5h6.5v7.5h-13z" />),
  eye: svg(
    <>
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </>,
  ),
  eyeOff: svg(
    <>
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <path d="M2 2l12 12" />
    </>,
  ),
  worktree: svg(<path d="M8 1.5v13 M8 5l-4-2.5 M8 8l4-2.5 M8 11l-4-2" />),
  stash: svg(<path d="M2 4h12v3H2z M3 7v6h10V7 M6.5 9.5h3" />),
  submodule: svg(<path d="M2 2h8v8H2z M6 6h8v8H6z" />),
  search: svg(<path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z M10.5 10.5L14 14" />),
  undo: svg(<path d="M5 3.5L2.5 6 5 8.5 M2.5 6h7a4 4 0 0 1 0 8H6" />, 20),
  redo: svg(<path d="M11 3.5L13.5 6 11 8.5 M13.5 6h-7a4 4 0 0 0 0 8H10" />, 20),
  pull: svg(<path d="M8 2v9 M4.5 7.5L8 11l3.5-3.5 M3 14h10" />, 20),
  push: svg(<path d="M8 14V5 M4.5 8.5L8 5l3.5 3.5 M3 2h10" />, 20),
  branchTool: svg(
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 5v6 M11.5 6.5c0 3-7 2-7 4.5" />
    </>,
    18,
  ),
  stashTool: svg(<path d="M2 9v4.5h12V9 M8 2v7 M5 6l3 3 3-3" />, 20),
  popTool: svg(<path d="M2 9v4.5h12V9 M8 9V2 M5 5l3-3 3 3" />, 20),
  terminal: svg(<path d="M2.5 4l4 4-4 4 M8 12.5h6" />, 20),
  paletteTool: svg(<path d="M3 13L11 5 M10 2.5v3 M8.5 4h3 M13 8v2.5 M11.75 9.25h2.5 M4 3v2 M3 4h2" />, 20),
  searchTool: svg(<path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z M10.5 10.5L14 14" />, 20),
  sort: svg(<path d="M4 2.5v11 M2 11.5l2 2 2-2 M9 3h4l-4 4.5h4 M9 9.5h4 M9 13h4" />),
  plus: svg(<path d="M8 3v10 M3 8h10" />),
  collapseLeft: svg(
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M9 5.5L6.5 8 9 10.5" />
    </>,
    14,
  ),
  collapseRight: svg(
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M7 5.5L9.5 8 7 10.5" />
    </>,
    14,
  ),
  star: svg(<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />, 13),
  repos: svg(<path d="M2 2.5h5v5H2z M9 2.5h5v5H9z M2 9.5h5v5H2z M9 9.5h5v5H9z" />, 14),
  more: svg(
    <>
      <circle cx="8" cy="3.5" r="0.8" fill="currentColor" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
      <circle cx="8" cy="12.5" r="0.8" fill="currentColor" />
    </>,
    14,
  ),
};
