interface NavbarProps {
  updatedAt: string | null
}

export function Navbar({ updatedAt }: NavbarProps) {
  return (
    <nav className="navbar" aria-label="main navigation">
      <a href="https://checks.wiki" className="nav-brand">
        <svg viewBox="0 0 36 36" width="20" height="20" className="nav-brand-icon">
          <path fillRule="evenodd" d="M21.36 9.886A3.933 3.933 0 0 0 18 8c-1.423 0-2.67.755-3.36 1.887a3.935 3.935 0 0 0-4.753 4.753A3.933 3.933 0 0 0 8 18c0 1.423.755 2.669 1.886 3.36a3.935 3.935 0 0 0 4.753 4.753 3.933 3.933 0 0 0 4.863 1.59 3.953 3.953 0 0 0 1.858-1.589 3.935 3.935 0 0 0 4.753-4.754A3.933 3.933 0 0 0 28 18a3.933 3.933 0 0 0-1.887-3.36 3.934 3.934 0 0 0-1.042-3.711 3.934 3.934 0 0 0-3.71-1.043Zm-3.958 11.713 4.562-6.844c.566-.846-.751-1.724-1.316-.878l-4.026 6.043-1.371-1.368c-.717-.722-1.836.396-1.116 1.116l2.17 2.15a.788.788 0 0 0 1.097-.22Z" fill="#ffffff"/>
        </svg>
        Checks.wiki
      </a>
      {updatedAt && (
        <span className="nav-updated">Updated {new Date(updatedAt).toLocaleString()}</span>
      )}
    </nav>
  )
}
