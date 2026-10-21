import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.ts'
import { Spinner } from './Spinner.tsx'

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm' | 'icon'

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,transform,box-shadow] duration-150 ease-out ' +
  'active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 disabled:aria-busy:cursor-progress disabled:aria-busy:opacity-100'

// 흰색은 "확정하는 행동"(주 행동 하나), 호박색은 "지금 내 차례"에만, 나머지는 면의 밝기 단계로 말한다.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-canvas hover:bg-white',
  accent: 'bg-accent text-accent-deep hover:brightness-110',
  secondary: 'bg-lift text-ink hover:bg-[#2c2c32]',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
  danger: 'bg-bad-soft text-bad hover:bg-[#3b1a1f]',
}

const SIZE: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-[15px]',
  sm: 'h-9 px-4 text-[13px]',
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
