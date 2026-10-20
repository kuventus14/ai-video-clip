import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.ts'
import { Spinner } from './Spinner.tsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm' | 'icon'

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:aria-busy:cursor-progress disabled:aria-busy:opacity-100'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-hover',
  secondary: 'border border-field-line bg-panel text-ink hover:bg-sunken active:bg-sunken',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink active:bg-sunken',
  danger: 'border border-bad bg-panel text-bad hover:bg-bad-soft active:bg-bad-soft',
}

const SIZE: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-[15px]',
  sm: 'h-9 px-3 text-[13px]',
  icon: 'size-9',
}

/** 버튼처럼 보여야 하는 링크(next/link 등)에 붙이는 클래스. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cx(BASE, VARIANT[variant], SIZE[size], className)
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** true 면 눌러도 동작하지 않고 돌아가는 표시가 앞에 붙는다(글자는 그대로 둔다) */
  loading?: boolean
  /** 글자 앞 아이콘(lucide 아이콘 요소) */
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  )
}
