import './FooterBar.css'
import { memo } from 'react'

/**
 * @param {{ links: import('../../data/feedData').FooterLink[] }} props
 */
export default memo(function FooterBar({ links }) {
  return (
    <footer>
      <span>VE REALIDAD</span>
      {links.map((link) => (
        <a key={link.label} href={link.href}>
          {link.label}
        </a>
      ))}
      <small>© 2026</small>
    </footer>
  )
})
