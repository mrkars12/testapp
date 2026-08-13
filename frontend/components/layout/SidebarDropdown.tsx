'use client'
import { useMemo, ReactNode, isValidElement } from 'react'
import { usePathname } from 'next/navigation'

interface SidebarDropdownProps {
  id: string
  label: string
  icon: string
  children: ReactNode
  isOpen: boolean
  toggle: () => void
}

export default function SidebarDropdown({
  id,
  label,
  icon,
  children,
  isOpen,
  toggle,
}: SidebarDropdownProps) {

  const pathname = usePathname()

  const childPaths = useMemo(() => {
    const paths: string[] = []

    const extract = (nodes: ReactNode) => {
      if (!nodes) return

      if (Array.isArray(nodes)) {
        nodes.forEach(extract)
      } else if (isValidElement(nodes)) {
        const props = nodes.props as { href?: string; children?: ReactNode }

        if (props.href) {
          paths.push(props.href)
        }

        if (props.children) {
          extract(props.children)
        }
      }
    }

    extract(children)
    return paths
  }, [children])

  const isActiveGroup = useMemo(() => {
    if (!pathname) return false
    return childPaths.some(path =>
      pathname === path || pathname.startsWith(path + '/')
    )
  }, [pathname, childPaths])

  return (
    <div>
      <button
        onClick={toggle}                     // ← استخدام الدالة الجاية
        className={`flex w-full items-center h-10 p-2 gap-2 mb-1 text-sm text-left
          rounded-md outline-none
          transition-[width,height,padding] cursor-pointer duration-150 ease-in-out
          text-[#0097c7]
          hover:bg-[hsl(240_4.8%_95.9%)] hover:text-[#0097c7] border-0 bg-transparent ${
            isActiveGroup || isOpen
              ? 'bg-[hsl(240_4.8%_95.9%)]'
              : ''
          }`}
      >
        <i className={`${icon} text-lg w-5`}></i>
        <span className="flex-1 text-left truncate font-sans font-medium text-[#333]">
          {label}
        </span>
        <i
          className={`fas fa-chevron-right text-xs ml-auto transition-transform duration-200 ${
            isOpen ? 'rotate-90' : ''
          }`}
        ></i>
      </button>

      <div
        className={`flex flex-col min-w-0 gap-1 mx-3.5 px-2.5 py-0.5 border-l border-[hsl(220_13%_91%)] translate-x-px overflow-hidden transition-all duration-300 ${
          isOpen ? 'max-h-96 opacity-100 mt-1 mb-1' : 'max-h-0 opacity-0 m-0'
        }`}
      >
        {children}
      </div>
    </div>
  )
}