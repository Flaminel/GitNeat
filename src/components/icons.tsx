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
  plus: svg(<path d="M8 3v10 M3 8h10" />),
};
