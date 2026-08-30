import Link from "next/link";

/**
 * Discourse-style pill row: Categories | Latest. Server component — the active
 * pill is decided by the page from the `?view=` param. The underline is
 * `.forum-pill[data-active]` in globals.css.
 */
export function ForumNav({ active }: { active: "categories" | "latest" }) {
  return (
    <nav className="forum-pills">
      <Link
        href="/forum"
        data-active={active === "categories"}
        className="forum-pill"
      >
        Categories
      </Link>
      <Link
        href="/forum?view=latest"
        data-active={active === "latest"}
        className="forum-pill"
      >
        Latest
      </Link>
    </nav>
  );
}
